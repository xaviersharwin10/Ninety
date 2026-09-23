import {
  AgentRegistryAbi,
  AgentVaultAbi,
  MarketManagerAbi,
  TEMPLATE_NAME_BY_ID,
} from "@ninety/core";
import { type Address, type Chain, createPublicClient, http, type PublicClient } from "viem";
import type { LocalAccount } from "viem/accounts";
import { signQuote } from "./eip712.js";
import type { QuotePublisher } from "./quote-client.js";
import {
  STEADY_MAX_STAKE_PER_QUOTE,
  STEADY_QUOTE_EXPIRY_SEC,
  steadyPrice,
} from "./strategies/steady.js";

// On-chain MarketState enum (MarketManager.sol): None, Open, Suspended, Closed, Resolved, Voided.
const MARKET_STATE_OPEN = 1;

export interface AgentRunnerConfig {
  chain: Chain;
  rpcUrl: string;
  agentId: number;
  quoteSigner: LocalAccount;
  agentRegistry: Address;
  marketManager: Address;
  betRouter: Address;
  publisher: QuotePublisher;
  /** How often to sweep open markets for a quote that needs (re-)issuing. Default 3s. */
  pollIntervalMs?: number;
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

  constructor(private readonly config: AgentRunnerConfig) {
    // Agents only ever sign quotes off-chain (see signQuote below); nothing here submits a
    // transaction, so a public client for reads is all this needs -- no wallet client.
    this.publicClient = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) });
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
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
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

    const windowSec = market.windowEnd - market.windowStart;
    const { probYesBps, probNoBps } = steadyPrice({ template: templateName, windowSec });

    const budget = (await this.publicClient.readContract({
      address: vault,
      abi: AgentVaultAbi,
      functionName: "quotableBudget",
      args: [marketId],
    })) as bigint;
    if (budget === 0n) return; // no free capital -- nothing to offer

    const maxStake = budget < STEADY_MAX_STAKE_PER_QUOTE ? budget : STEADY_MAX_STAKE_PER_QUOTE;
    const chainId = this.config.chain.id;
    const quote = {
      marketId,
      agentId: this.config.agentId,
      probYesBps,
      probNoBps,
      maxStake,
      expiry: BigInt(Math.floor(Date.now() / 1000) + STEADY_QUOTE_EXPIRY_SEC),
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
