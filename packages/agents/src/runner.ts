import {
  type AgentMemory,
  AgentRegistryAbi,
  AgentVaultAbi,
  BetRouterAbi,
  failoverTransport,
  freshMemory,
  holdRealSec,
  honouringQuote,
  isTemplateInDanger,
  learn,
  lockFeeBps,
  MarketManagerAbi,
  OddsLockAbi,
  type PricingStrategy,
  QUOTE_TYPES,
  quoteDomain,
  quoteMaxStake,
  type SettledBet,
  signLockOffer,
  signQuote,
  TEMPLATE_NAME_BY_ID,
} from "@ninety/core";
import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  hashTypedData,
  type PublicClient,
} from "viem";
import type { LocalAccount } from "viem/accounts";
import type { MatchStateProvider } from "./match-state.js";
import type { QuotePublisher } from "./quote-client.js";

/** How often holds are checked for a quote to re-sign. */
const HOLD_POLL_MS = 1000;

// On-chain MarketState enum (MarketManager.sol): None, Open, Suspended, Closed, Resolved, Voided.
const MARKET_STATE_OPEN = 1;

export interface AgentRunnerConfig {
  chain: Chain;
  /** RPCs to read from, best first (see `serverRpcUrls` in @ninety/core). */
  rpcUrls: string[];
  agentId: number;
  quoteSigner: LocalAccount;
  agentRegistry: Address;
  marketManager: Address;
  betRouter: Address;
  /** The deployed `OddsLock`. Omit and the agent sells no holds. */
  oddsLock?: Address;
  publisher: QuotePublisher;
  /** The house agent's pricing behaviour -- Steady, Tempo, Pulse, or any other implementation. */
  strategy: PricingStrategy;
  /**
   * Required whenever `strategy.lookbackSec > 0` (Tempo, Pulse); omit for a strategy that ignores
   * live state entirely (Steady). Not checked at construction -- a strategy with a positive
   * lookback but no provider fails loudly the first time it actually needs one, in `quoteMarket`.
   */
  matchState?: MatchStateProvider;
  /** How often to sweep open markets for a quote that needs (re-)issuing. Default 3s. */
  pollIntervalMs?: number;
  /**
   * The agent's settled bets, for it to learn from (see `learn` in @ninety/core): a market type it
   * keeps paying out on gets a wider margin, one it keeps winning a slightly tighter one. Omit and
   * the agent prices on its base margin throughout.
   */
  settledBets?: () => Promise<SettledBet[]>;
  /** How often to learn from newly settled bets. Default 2 minutes. */
  learnEveryMs?: number;
}

/**
 * Watches on-chain markets and keeps a signed quote flowing to the relay for every one this
 * agent is willing to price. Deliberately polls `MarketManager` by incrementing market id rather
 * than watching `MarketOpened` logs: Monad's public RPC caps `eth_getLogs` at a 100-block range
 * (measured directly, see docs/cre-forwarder-trust-model.md's sibling finding on the same RPC),
 * and a market count is a single cheap read with no range to get wrong.
 */
export class AgentRunner {
  private readonly publicClient: PublicClient;
  private timer: NodeJS.Timeout | undefined;
  private highestMarketIdSeen = 0n;
  /** Markets confirmed Resolved/Voided/Closed -- no longer worth polling. */
  private readonly retired = new Set<bigint>();
  private learnTimer: NodeJS.Timeout | undefined;
  /** What it has learned this run. In memory only: a house agent's memory isn't sealed anywhere. */
  private memory: AgentMemory;
  /** Holds this agent sold and is still honouring, by lock id. */
  private readonly holds = new Map<bigint, Hold>();
  private highestLockIdSeen = 0n;
  private holdTimer: NodeJS.Timeout | undefined;
  private honouring = false;

  constructor(private readonly config: AgentRunnerConfig) {
    // Agents only ever sign quotes off-chain (see signQuote below); nothing here submits a
    // transaction, so a public client for reads is all this needs -- no wallet client.
    // Reads go to a dedicated server RPC when one is configured, leaving the public RPC's 15 req/s
    // cap to fans' browsers; rate limits on either fall through or back off rather than failing a sweep.
    this.publicClient = createPublicClient({
      chain: config.chain,
      transport: failoverTransport(config.rpcUrls),
      // Every open market is quoted at once, so their reads land together and go out as one
      // multicall rather than several calls each: with three agents re-quoting every few seconds,
      // one-by-one reads ran into RPC rate limits mid-match. Off where the chain has no Multicall3.
      batch: { multicall: !!config.chain.contracts?.multicall3 },
    });
    this.memory = freshMemory(config.agentId);
  }

  start(): void {
    if (this.timer) return;
    const interval = this.config.pollIntervalMs ?? 3000;
    this.timer = setInterval(() => {
      this.sweep().catch((err) => {
        // A single bad sweep (a flaky RPC call, a market that reverts unexpectedly) must not
        // kill the process -- the next tick tries again.
        console.error("[agent] sweep failed:", err);
      });
    }, interval);
    // Holds get their own, faster loop: a fan who taps "Bet" on a held price is waiting on the
    // next honouring quote, and only one is ever out at a time (see honourHolds).
    if (this.config.oddsLock) {
      this.holdTimer = setInterval(() => {
        if (this.honouring) return;
        this.honouring = true;
        this.honourHolds()
          .catch((err) => console.error("[agent] honouring holds failed:", err))
          .finally(() => {
            this.honouring = false;
          });
      }, HOLD_POLL_MS);
    }
    if (this.config.settledBets) {
      this.learnTimer = setInterval(() => {
        this.learnFromSettled().catch((err) => console.error("[agent] learning failed:", err));
      }, this.config.learnEveryMs ?? 120_000);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.learnTimer) clearInterval(this.learnTimer);
    if (this.holdTimer) clearInterval(this.holdTimer);
    this.holdTimer = undefined;
    this.timer = undefined;
    this.learnTimer = undefined;
  }

  /** Folds bets settled since the last pass into the agent's memory. */
  async learnFromSettled(): Promise<void> {
    if (!this.config.settledBets) return;
    const next = learn(this.memory, await this.config.settledBets());
    if (next === this.memory) return;
    this.memory = next;
    console.log(`[agent] ${this.config.strategy.name}: ${next.lessons[0]}`);
  }

  /** Learned margin adjustment for a market type, in bps. */
  marginAdjBps(template: keyof AgentMemory["templates"]): number {
    return this.memory.templates[template].marginAdjBps;
  }

  /** One pass: discover new markets, then quote every open one that isn't retired. */
  async sweep(): Promise<void> {
    await this.discoverNewMarkets();

    const vault = await this.publicClient.readContract({
      address: this.config.agentRegistry,
      abi: AgentRegistryAbi,
      functionName: "vaultOf",
      args: [this.config.agentId],
    });

    const live: bigint[] = [];
    for (let id = 1n; id <= this.highestMarketIdSeen; id++) {
      if (!this.retired.has(id)) live.push(id);
    }
    // Together, so their reads batch (see the client above). One market failing doesn't stop the
    // others being quoted; the first failure is still raised afterwards, so it isn't swallowed.
    const results = await Promise.allSettled(
      live.map((id) => this.quoteMarket(id, vault as Address)),
    );
    const failed = results.find((r) => r.status === "rejected");

    if (this.config.oddsLock) await this.discoverHolds(this.config.oddsLock);
    if (failed) throw failed.reason;
  }

  /** Picks up holds sold since the last sweep. */
  private async discoverHolds(oddsLock: Address): Promise<void> {
    const count = (await this.publicClient.readContract({
      address: oddsLock,
      abi: OddsLockAbi,
      functionName: "lockCount",
    })) as bigint;
    for (let id = this.highestLockIdSeen + 1n; id <= count; id++) {
      const lock = (await this.publicClient.readContract({
        address: oddsLock,
        abi: OddsLockAbi,
        functionName: "getLock",
        args: [id],
      })) as {
        fan: Address;
        agentId: number;
        side: number;
        probBps: number;
        heldUntil: bigint;
        marketId: bigint;
        stake: bigint;
      };
      if (lock.agentId !== this.config.agentId) continue;
      this.holds.set(id, {
        lockId: id,
        fan: lock.fan,
        marketId: lock.marketId,
        side: lock.side === 0 ? "yes" : "no",
        probBps: lock.probBps,
        heldUntil: lock.heldUntil,
        remaining: lock.stake,
      });
    }
    this.highestLockIdSeen = count;
  }

  /**
   * Keeps every hold this agent sold honoured: one live quote at a time at the held price, sized to
   * what's still held, re-signed as each expires until the hold ends. None while an event that
   * would decide the market is coming -- a hold pauses during big moments, just as betting does --
   * and none once the market is decided or closed. One at a time, and shrunk by whatever the last
   * one filled, so a hold can never be bet more than once over.
   */
  async honourHolds(): Promise<void> {
    if (this.holds.size === 0) return;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const danger = (await this.config.matchState?.dangerTypes?.()) ?? [];
    for (const hold of this.holds.values()) {
      if (now >= hold.heldUntil) {
        this.holds.delete(hold.lockId);
        continue;
      }
      if (hold.live && hold.live.expiry > now) continue; // one at a time

      if (hold.live) {
        const filled = (await this.publicClient.readContract({
          address: this.config.betRouter,
          abi: BetRouterAbi,
          functionName: "quoteFilled",
          args: [hold.live.hash],
        })) as bigint;
        hold.remaining -= filled;
        hold.live = undefined;
        if (hold.remaining <= 0n) {
          this.holds.delete(hold.lockId);
          continue;
        }
      }

      const market = await this.marketInfo(hold.marketId);
      if (!market || market.state !== MARKET_STATE_OPEN) {
        this.holds.delete(hold.lockId);
        continue;
      }
      if (isTemplateInDanger(market.template, danger)) continue; // paused, not over
      const window = await this.config.matchState?.liveWindow?.(
        market.template,
        market.windowStart,
        market.windowEnd,
      );
      if (window?.decided) {
        this.holds.delete(hold.lockId);
        continue;
      }

      const quote = honouringQuote({
        ...hold,
        agentId: this.config.agentId,
        stake: hold.remaining,
        expiry: now + BigInt(this.config.strategy.quoteExpirySec),
      });
      const signature = await signQuote(
        this.config.quoteSigner,
        this.config.chain.id,
        this.config.betRouter,
        quote,
      );
      const hash = hashTypedData({
        domain: quoteDomain(this.config.chain.id, this.config.betRouter),
        types: QUOTE_TYPES,
        primaryType: "Quote",
        message: quote,
      });
      hold.live = { hash, expiry: quote.expiry };
      await this.config.publisher.publishHold?.(hold.lockId, hold.fan, quote, signature);
    }
  }

  private async marketInfo(marketId: bigint) {
    const market = (await this.publicClient.readContract({
      address: this.config.marketManager,
      abi: MarketManagerAbi,
      functionName: "getMarket",
      args: [marketId],
    })) as { templateId: `0x${string}`; windowStart: number; windowEnd: number; state: number };
    const template = TEMPLATE_NAME_BY_ID[market.templateId];
    return template ? { ...market, template } : null;
  }

  private async discoverNewMarkets(): Promise<void> {
    const count = (await this.publicClient.readContract({
      address: this.config.marketManager,
      abi: MarketManagerAbi,
      functionName: "marketCount",
    })) as bigint;
    if (count > this.highestMarketIdSeen) this.highestMarketIdSeen = count;
  }

  private async quoteMarket(marketId: bigint, vault: Address): Promise<void> {
    const market = (await this.publicClient.readContract({
      address: this.config.marketManager,
      abi: MarketManagerAbi,
      functionName: "getMarket",
      args: [marketId],
    })) as {
      templateId: `0x${string}`;
      windowStart: number;
      windowEnd: number;
      state: number;
    };

    if (market.state !== MARKET_STATE_OPEN) {
      if (market.state >= 3) this.retired.add(marketId); // Closed, Resolved, or Voided
      return;
    }

    const templateName = TEMPLATE_NAME_BY_ID[market.templateId];
    if (!templateName) return; // a template this agent doesn't know how to price -- skip, don't crash

    // Pull the quote for a market an imminent event would decide: with no signed quote there's nothing
    // to bet against, which is how markets are suspended around big moments (see match-data's
    // DANGER_LEAD_REAL_SEC). The last quote issued lives at most quoteExpirySec longer; BetRouter's
    // bet-delay rule voids anything struck in that gap.
    const danger = (await this.config.matchState?.dangerTypes?.()) ?? [];
    if (isTemplateInDanger(templateName, danger)) return;

    const { strategy } = this.config;
    // Priced over what's left of the window, not all of it: late in a window, a full-window price
    // hands informed bettors a cheap NO. And once the window is decided there's nothing to price.
    const window = (await this.config.matchState?.liveWindow?.(
      templateName,
      market.windowStart,
      market.windowEnd,
    )) ?? { decided: false, remainingSec: market.windowEnd - market.windowStart };
    if (window.decided || window.remainingSec <= 0) return;
    const windowSec = window.remainingSec;

    let recentQualifyingCount = 0;
    if (strategy.lookbackSec > 0) {
      if (!this.config.matchState) {
        throw new Error(
          `strategy "${strategy.name}" needs live match state (lookbackSec=${strategy.lookbackSec}) but no matchState provider was configured`,
        );
      }
      recentQualifyingCount = await this.config.matchState.recentQualifyingCount(
        templateName,
        strategy.lookbackSec,
      );
    }

    const { probYesBps, probNoBps } = strategy.price({
      template: templateName,
      windowSec,
      recentQualifyingCount,
      marginAdjBps: this.marginAdjBps(templateName),
    });

    const budget = (await this.publicClient.readContract({
      address: vault,
      abi: AgentVaultAbi,
      functionName: "quotableBudget",
      args: [marketId],
    })) as bigint;
    if (budget === 0n) return; // no free capital -- nothing to offer

    // The vault's budget caps liability, not stake: sized for the side with the longer odds, so
    // any fill this quote allows is one the vault will actually accept.
    const maxStake = quoteMaxStake(
      budget,
      BigInt(probYesBps),
      BigInt(probNoBps),
      strategy.maxStakePerQuote,
    );
    if (maxStake === 0n) return;
    const chainId = this.config.chain.id;
    const quote = {
      marketId,
      agentId: this.config.agentId,
      probYesBps,
      probNoBps,
      maxStake,
      expiry: BigInt(Math.floor(Date.now() / 1000) + strategy.quoteExpirySec),
      salt: BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
    };

    const signature = await signQuote(
      this.config.quoteSigner,
      chainId,
      this.config.betRouter,
      quote,
    );
    await this.config.publisher.publish(quote, signature);

    if (this.config.oddsLock) {
      await this.offerHolds(this.config.oddsLock, quote, windowSec);
    }
  }

  /**
   * Alongside each quote, an offer to hold either side's price for a moment of the match (see
   * `holdRealSec`), at a fee `lockFeeBps` prices over the match time that moment covers -- or no
   * offer, where that says a hold isn't worth selling.
   */
  private async offerHolds(
    oddsLock: Address,
    quote: {
      marketId: bigint;
      probYesBps: number;
      probNoBps: number;
      maxStake: bigint;
      expiry: bigint;
      salt: bigint;
    },
    remainingSec: number,
  ): Promise<void> {
    const speed = (await this.config.matchState?.speed?.()) ?? 1;
    const holdSeconds = holdRealSec(speed);
    for (const side of ["yes", "no"] as const) {
      const feeBps = lockFeeBps({ side, ...quote, remainingSec, holdSec: holdSeconds * speed });
      if (feeBps === null) continue;
      const offer = {
        marketId: quote.marketId,
        agentId: this.config.agentId,
        side: side === "yes" ? 0 : 1,
        probBps: side === "yes" ? quote.probYesBps : quote.probNoBps,
        maxStake: quote.maxStake,
        feeBps,
        holdSeconds,
        expiry: quote.expiry,
        salt: quote.salt * 2n + (side === "yes" ? 0n : 1n),
      };
      const signature = await signLockOffer(
        this.config.quoteSigner,
        this.config.chain.id,
        oddsLock,
        offer,
      );
      await this.config.publisher.publishLockOffer?.(offer, signature);
    }
  }
}

interface Hold {
  lockId: bigint;
  fan: Address;
  marketId: bigint;
  side: "yes" | "no";
  probBps: number;
  heldUntil: bigint;
  /** Stake still held: the hold's stake, less whatever the fan has already bet of it. */
  remaining: bigint;
  /** The honouring quote out right now, if any. */
  live?: { hash: Hex; expiry: bigint } | undefined;
}
