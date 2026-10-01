/**
 * Runs an operator's own agent from their browser: the same job the house agents' runner does
 * (packages/agents/src/runner.ts), with the quote-signing key held in a Mera signing session
 * instead of an .env file. The key is derived from the passkey when the run starts and zeroed when
 * it stops; it never exists anywhere else. The trade-off is that the agent quotes only while its
 * operator keeps this tab open -- the right one for a key that must never leave their control.
 *
 * Pricing is the operator's sealed strategy (margin, max stake, quote expiry) on the shared
 * base-rate model, plus whatever margin adjustment the agent's memory has learned for each market
 * type. It pulls its quotes around big moments exactly like the house agents (see match-data's
 * DANGER_LEAD_REAL_SEC).
 */
import {
  type AgentMemory,
  BASE_RATE_PER_SEC,
  isTemplateInDanger,
  liveWindow,
  MarketManagerAbi,
  marginedQuote,
  type NormalizedEvent,
  poissonProbability,
  quoteMaxStake,
  signQuote,
  TEMPLATE_NAME_BY_ID,
  toWire,
} from "@ninety/core";
import type { Address, Hex } from "viem";
import type { AgentSigner } from "./agent-identity";
import { CHAIN_ID, publicClient } from "./chain";
import { AgentVaultAbi, BET_ROUTER, MARKET_MANAGER } from "./contracts";
import { MATCH_DATA_URL } from "./match-data";
import { RELAY_HTTP_URL } from "./quote-relay";
import type { AgentStrategy } from "./strategy-vault";

/** Re-quote cadence. Quotes expire in seconds, so this keeps one live without hammering the RPC. */
const SWEEP_MS = 4000;
/** Only the newest markets can still be open; no need to rescan the whole history each sweep. */
const RECENT_MARKETS = 12;
const MARKET_STATE_OPEN = 1;

export interface BrowserAgentStatus {
  running: boolean;
  quotesPublished: number;
  /** Markets it priced on the last sweep. */
  quoting: number;
  /** Markets it held back on the last sweep because a big moment was imminent. */
  paused: number;
  /** Why it isn't quoting, when that's the case: no capital, no open markets, an error. */
  note: string | null;
}

export class BrowserAgent {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly retired = new Set<bigint>();
  private status: BrowserAgentStatus = {
    running: false,
    quotesPublished: 0,
    quoting: 0,
    paused: 0,
    note: null,
  };

  constructor(
    private readonly agentId: number,
    private readonly vault: Address,
    private readonly signer: AgentSigner,
    private readonly strategy: AgentStrategy,
    private readonly memory: AgentMemory,
    private readonly onStatus: (status: BrowserAgentStatus) => void,
  ) {}

  start(): void {
    if (this.status.running) return;
    this.update({ running: true });
    this.tick();
  }

  /** Stops quoting and zeroes the signing key. The agent can't sign again until re-opened. */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.signer.end();
    this.update({ running: false, quoting: 0, paused: 0 });
  }

  private update(patch: Partial<BrowserAgentStatus>) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }

  private async tick() {
    try {
      await this.sweep();
    } catch (err) {
      this.update({ note: err instanceof Error ? err.message.split("\n")[0]! : "Sweep failed" });
    }
    if (this.status.running) this.timer = setTimeout(() => this.tick(), SWEEP_MS);
  }

  /**
   * The replaying match as it stands: its clock, what has aired, and which event types are in
   * danger. Null when nothing is replaying.
   */
  private async matchNow(): Promise<{
    clockSec: number;
    events: NormalizedEvent[];
    danger: string[];
  } | null> {
    try {
      const res = await fetch(`${MATCH_DATA_URL}/matches`);
      const { matches } = (await res.json()) as {
        matches: { matchId: string; isReplaying: boolean }[];
      };
      const live = matches.find((m) => m.isReplaying);
      if (!live) return null;
      const [state, aired] = await Promise.all([
        fetch(`${MATCH_DATA_URL}/matches/${live.matchId}/state`).then((r) => r.json()),
        fetch(`${MATCH_DATA_URL}/matches/${live.matchId}/events`).then((r) => r.json()),
      ]);
      return {
        clockSec: (state as { matchClockSec: number }).matchClockSec,
        events: (aired as { events: NormalizedEvent[] }).events,
        danger: (state as { danger: string[] }).danger ?? [],
      };
    } catch {
      return null;
    }
  }

  private async sweep() {
    const count = (await publicClient.readContract({
      address: MARKET_MANAGER,
      abi: MarketManagerAbi,
      functionName: "marketCount",
    })) as bigint;
    const ids: bigint[] = [];
    for (let id = count; id > 0n && id > count - BigInt(RECENT_MARKETS); id--) {
      if (!this.retired.has(id)) ids.push(id);
    }
    const [markets, now] = await Promise.all([
      Promise.all(
        ids.map(
          (id) =>
            publicClient.readContract({
              address: MARKET_MANAGER,
              abi: MarketManagerAbi,
              functionName: "getMarket",
              args: [id],
            }) as Promise<{
              templateId: Hex;
              windowStart: number;
              windowEnd: number;
              state: number;
            }>,
        ),
      ),
      this.matchNow(),
    ]);
    const danger = now?.danger ?? [];

    let quoting = 0;
    let paused = 0;
    let noCapital = false;
    for (const [i, market] of markets.entries()) {
      const marketId = ids[i]!;
      if (market.state !== MARKET_STATE_OPEN) {
        if (market.state >= 3) this.retired.add(marketId);
        continue;
      }
      const template = TEMPLATE_NAME_BY_ID[market.templateId];
      if (!template) continue;
      if (isTemplateInDanger(template, danger as never)) {
        paused++;
        continue;
      }

      const budget = (await publicClient.readContract({
        address: this.vault,
        abi: AgentVaultAbi,
        functionName: "quotableBudget",
        args: [marketId],
      })) as bigint;
      if (budget === 0n) {
        noCapital = true;
        continue;
      }

      // Priced over what's left of the window; nothing to price once it's decided.
      const window = now
        ? liveWindow(now.events, template, market.windowStart, market.windowEnd, now.clockSec)
        : { decided: false, remainingSec: market.windowEnd - market.windowStart };
      if (window.decided || window.remainingSec <= 0) continue;

      const learned = this.memory.templates[template]?.marginAdjBps ?? 0;
      // Never below the 200bps the contract requires, whatever the memory learned.
      const marginBps = Math.max(200, this.strategy.marginBps + learned);
      const pYes = poissonProbability(BASE_RATE_PER_SEC[template], window.remainingSec);
      const { probYesBps, probNoBps } = marginedQuote(pYes, marginBps);
      // The vault's budget caps liability: sized for the longer-odds side so every fill lands.
      const maxStake = quoteMaxStake(
        budget,
        BigInt(probYesBps),
        BigInt(probNoBps),
        BigInt(this.strategy.maxStakePerQuote),
      );
      if (maxStake === 0n) continue;
      const quote = {
        marketId,
        agentId: this.agentId,
        probYesBps,
        probNoBps,
        maxStake,
        expiry: BigInt(Math.floor(Date.now() / 1000) + this.strategy.quoteExpirySec),
        salt: BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
      };
      const signature = await signQuote(this.signer.account, CHAIN_ID, BET_ROUTER, quote);
      const res = await fetch(`${RELAY_HTTP_URL}/quotes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toWire(quote, signature)),
      });
      if (!res.ok) throw new Error(`The price feed rejected a quote (HTTP ${res.status})`);
      quoting++;
      this.status.quotesPublished++;
    }

    this.update({
      quoting,
      paused,
      note:
        quoting > 0
          ? null
          : noCapital
            ? "No capital to quote with — deposit into this agent's vault."
            : paused > 0
              ? "Holding back: a big moment is imminent."
              : "No open markets right now — start a match to give it something to price.",
    });
  }
}
