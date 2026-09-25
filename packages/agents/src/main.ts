import type { TemplateName } from "@ninety/core";
import { type Address, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HttpMatchStateProvider, type MatchStateProvider } from "./match-state.js";
import { HttpQuotePublisher } from "./quote-client.js";
import { AgentRunner } from "./runner.js";
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

const rpcUrl = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const chain = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.MONAD_CHAIN_ID ?? 10143),
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  testnet: true,
});

const agentRegistry = requiredEnv("NEXT_PUBLIC_AGENT_REGISTRY") as Address;
const marketManager = requiredEnv("NEXT_PUBLIC_MARKET_MANAGER") as Address;
const betRouter = requiredEnv("NEXT_PUBLIC_BET_ROUTER") as Address;

const matchDataUrl = (
  process.env.MATCH_DATA_URL ?? `http://localhost:${process.env.MATCH_DATA_PORT ?? 8082}`
).replace(/\/$/, "");
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

  async recentQualifyingCount(template: TemplateName, lookbackSec: number): Promise<number> {
    const res = await fetch(`${this.matchDataBaseUrl}/matches`);
    if (!res.ok) return 0;
    const body = (await res.json()) as { matches: { matchId: string; isReplaying: boolean }[] };
    const active = body.matches.find((m) => m.isReplaying);
    if (!active) return 0;
    return new HttpMatchStateProvider(this.matchDataBaseUrl, active.matchId).recentQualifyingCount(
      template,
      lookbackSec,
    );
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
    rpcUrl,
    agentId,
    quoteSigner: account,
    agentRegistry,
    marketManager,
    betRouter,
    strategy,
    publisher,
    // Staggered per agent (base 4s, +1.5s per agentId) so three independent runners don't burst
    // reads at the same instant -- Monad's public RPC caps at 15 req/sec, and one sweep issues
    // several reads per open market; measured live, three runners all on the default 3s interval
    // pushed a large fraction of sweeps into 429s under just a handful of open markets.
    pollIntervalMs: 4000 + agentId * 1500,
    ...(strategy.lookbackSec > 0 ? { matchState } : {}),
  });
  runner.start();
  console.log(
    `[agents] ${strategy.name} running (agentId=${agentId}, signer=${account.address}, relay=${relayUrl})`,
  );
}

console.log("[agents] all house agents started");
