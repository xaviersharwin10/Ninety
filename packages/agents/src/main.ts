import type { EventType, TemplateName } from "@ninety/core";
import { serverRpcUrls } from "@ninety/core";
import { type Address, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HttpMatchStateProvider, type MatchStateProvider } from "./match-state.js";
import { HttpQuotePublisher } from "./quote-client.js";
import { AgentRunner } from "./runner.js";
import { fetchSettledBets } from "./settled-bets.js";
import { pulseStrategy } from "./strategies/pulse.js";
import { steadyStrategy } from "./strategies/steady.js";
import { tempoStrategy } from "./strategies/tempo.js";

/**
 * Process entrypoint for the three house agents. `src/runner.ts` only exports the `AgentRunner`
 * class -- it has no side effects on its own -- so this is what actually needs to run as `pnpm
 * --filter @ninety/agents dev/start`. Without it, nothing quotes: the process would sit alive
 * doing nothing, which is exactly what shipped unnoticed until someone tried to place a real bet.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

const rpcUrls = serverRpcUrls();
const chain = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.MONAD_CHAIN_ID ?? 10143),
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: rpcUrls } },
  // Lets the runner's reads fold into one eth_call per sweep (see AgentRunner's client).
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

const agentRegistry = requiredEnv("NEXT_PUBLIC_AGENT_REGISTRY") as Address;
const marketManager = requiredEnv("NEXT_PUBLIC_MARKET_MANAGER") as Address;
const betRouter = requiredEnv("NEXT_PUBLIC_BET_ROUTER") as Address;
const oddsLock = process.env.NEXT_PUBLIC_ODDS_LOCK as Address | undefined;

const matchDataUrl = (
  process.env.MATCH_DATA_URL ?? `http://localhost:${process.env.MATCH_DATA_PORT ?? 8082}`
).replace(/\/$/, "");
const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL;
const relayUrl = `http://localhost:${process.env.QUOTE_RELAY_PORT ?? 8081}`;

/**
 * Resolves live-state lookups (recent shots/corners/cards, for Tempo and Pulse) against whichever
 * match is currently replaying. `HttpMatchStateProvider` is scoped to one match id, but this
 * process starts independently of the web app choosing a match to watch, so the active match id
 * isn't known at boot -- it's discovered by polling match-data's `/matches` list for the one
 * entry with `isReplaying: true`. If nothing is replaying (no one has opened a match screen yet),
 * this reports zero recent events rather than failing the whole sweep.
 */
class ActiveMatchStateProvider implements MatchStateProvider {
  constructor(private readonly matchDataBaseUrl: string) {}

  private async active(): Promise<HttpMatchStateProvider | null> {
    const res = await fetch(`${this.matchDataBaseUrl}/matches`);
    if (!res.ok) return null;
    const body = (await res.json()) as { matches: { matchId: string; isReplaying: boolean }[] };
    const match = body.matches.find((m) => m.isReplaying);
    return match ? new HttpMatchStateProvider(this.matchDataBaseUrl, match.matchId) : null;
  }

  async recentQualifyingCount(template: TemplateName, lookbackSec: number): Promise<number> {
    return (await this.active())?.recentQualifyingCount(template, lookbackSec) ?? 0;
  }

  async dangerTypes(): Promise<EventType[]> {
    return (await this.active())?.dangerTypes() ?? [];
  }

  async speed(): Promise<number> {
    return (await this.active())?.speed() ?? 1;
  }

  async liveWindow(template: TemplateName, windowStart: number, windowEnd: number) {
    const active = await this.active();
    // Nothing replaying: no clock to measure against, so price the whole window.
    if (!active) return { decided: false, remainingSec: windowEnd - windowStart };
    return active.liveWindow(template, windowStart, windowEnd);
  }
}

const matchState = new ActiveMatchStateProvider(matchDataUrl);
const publisher = new HttpQuotePublisher(relayUrl);

const houseAgents = [
  { agentId: 1, envKey: "AGENT_STEADY_PRIVATE_KEY", strategy: steadyStrategy },
  { agentId: 2, envKey: "AGENT_TEMPO_PRIVATE_KEY", strategy: tempoStrategy },
  { agentId: 3, envKey: "AGENT_PULSE_PRIVATE_KEY", strategy: pulseStrategy },
] as const;

for (const { agentId, envKey, strategy } of houseAgents) {
  const account = privateKeyToAccount(requiredEnv(envKey) as `0x${string}`);
  const runner = new AgentRunner({
    chain,
    rpcUrls,
    agentId,
    quoteSigner: account,
    agentRegistry,
    marketManager,
    betRouter,
    ...(oddsLock ? { oddsLock } : {}),
    strategy,
    publisher,
    // Re-quote well inside the 5s quote expiry (2.5-3.5s, staggered so the three don't read at the
    // same instant), so a fan's bet -- or a cash-out, which needs the other side's whole book --
    // always has fresh prices to strike. At 5.5-8.5s, which the public
    // RPC's 15 req/s cap once forced, every agent spent part of each cycle with no valid quote;
    // server reads now go to SERVER_RPC_URL first (see serverRpcUrls).
    pollIntervalMs: 2000 + agentId * 500,
    // Every agent gets it now, not only the live-state strategies: all three pull their quotes
    // around big moments, whatever their pricing model.
    matchState,
    ...(indexerUrl ? { settledBets: () => fetchSettledBets(indexerUrl, agentId) } : {}),
  });
  runner.start();
  console.log(
    `[agents] ${strategy.name} running (agentId=${agentId}, signer=${account.address}, relay=${relayUrl})`,
  );
}

console.log("[agents] all house agents started");
