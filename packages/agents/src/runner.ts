import {
  type AgentMemory,
  AgentRegistryAbi,
  AgentVaultAbi,
  failoverTransport,
  freshMemory,
  isTemplateInDanger,
  learn,
  MarketManagerAbi,
  type PricingStrategy,
  quoteMaxStake,
  type SettledBet,
  signQuote,
  TEMPLATE_NAME_BY_ID,
} from "@ninety/core";
import { type Address, type Chain, createPublicClient, type PublicClient } from "viem";
import type { LocalAccount } from "viem/accounts";
import type { MatchStateProvider } from "./match-state.js";
import type { QuotePublisher } from "./quote-client.js";

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

  constructor(private readonly config: AgentRunnerConfig) {
    // Agents only ever sign quotes off-chain (see signQuote below); nothing here submits a
    // transaction, so a public client for reads is all this needs -- no wallet client.
    // Reads go to a dedicated server RPC when one is configured, leaving the public RPC's 15 req/s
    // cap to fans' browsers; rate limits on either fall through or back off rather than failing a sweep.
    this.publicClient = createPublicClient({
      chain: config.chain,
      transport: failoverTransport(config.rpcUrls),
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
    if (this.config.settledBets) {
      this.learnTimer = setInterval(() => {
        this.learnFromSettled().catch((err) => console.error("[agent] learning failed:", err));
      }, this.config.learnEveryMs ?? 120_000);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.learnTimer) clearInterval(this.learnTimer);
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

    for (let id = 1n; id <= this.highestMarketIdSeen; id++) {
      if (this.retired.has(id)) continue;
      await this.quoteMarket(id, vault as Address);
    }
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
  }
}
