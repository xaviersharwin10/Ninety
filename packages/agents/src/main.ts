import { createServer } from "node:http";
import type { EventType, NormalizedEvent, TemplateName } from "@ninety/core";
import { serverRpcUrls } from "@ninety/core";
import { type Address, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { llmEndpointsFromEnv, MatchReader, type MatchSnapshot } from "./coach.js";
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
// The relay is on this machine unless QUOTE_RELAY_URL says otherwise (agents hosted apart from it).
const relayUrl = (
  process.env.QUOTE_RELAY_URL ?? `http://localhost:${process.env.QUOTE_RELAY_PORT ?? 8081}`
).replace(/\/$/, "");

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
    const body = (await res.json()) as {
      matches: { matchId: string; isReplaying: boolean; teams?: { id: number }[] }[];
    };
    const match = body.matches.find((m) => m.isReplaying);
    return match
      ? new HttpMatchStateProvider(this.matchDataBaseUrl, match.matchId, match.teams)
      : null;
  }

  async recentQualifyingCount(
    template: TemplateName,
    lookbackSec: number,
    teamFilter = 0,
  ): Promise<number> {
    return (await this.active())?.recentQualifyingCount(template, lookbackSec, teamFilter) ?? 0;
  }

  async dangerTypes(): Promise<EventType[]> {
    return (await this.active())?.dangerTypes() ?? [];
  }

  async speed(): Promise<number> {
    return (await this.active())?.speed() ?? 1;
  }

  async liveWindow(template: TemplateName, windowStart: number, windowEnd: number, teamFilter = 0) {
    const active = await this.active();
    // Nothing replaying: no clock to measure against, so price the whole window.
    if (!active) return { decided: false, remainingSec: windowEnd - windowStart };
    return active.liveWindow(template, windowStart, windowEnd, teamFilter);
  }
}

/** The match being played, for Pulse's reader: teams, clock and what has aired. */
async function matchSnapshot(): Promise<MatchSnapshot | null> {
  const list = await fetch(`${matchDataUrl}/matches`);
  if (!list.ok) return null;
  const { matches } = (await list.json()) as {
    matches: { matchId: string; isReplaying: boolean; teams: { id: number; name: string }[] }[];
  };
  const live = matches.find((m) => m.isReplaying);
  if (!live) return null;
  const [state, aired] = await Promise.all([
    fetch(`${matchDataUrl}/matches/${live.matchId}/state`),
    fetch(`${matchDataUrl}/matches/${live.matchId}/events`),
  ]);
  if (!state.ok || !aired.ok) return null;
  const { matchClockSec, ended } = (await state.json()) as {
    matchClockSec: number;
    ended: boolean;
  };
  if (ended) return null;
  const { events } = (await aired.json()) as { events: NormalizedEvent[] };
  return { teams: live.teams, clockSec: matchClockSec, events };
}

const matchState = new ActiveMatchStateProvider(matchDataUrl);
const publisher = new HttpQuotePublisher(relayUrl);

// A host with a sliver of CPU can't sign and deliver three agents' prices every few seconds: offers
// arrived at the relay already expired. These slow the pace and let each price live longer there.
// Unset, the agents keep their own 5s expiry and 2.5-3.5s cycle.
const QUOTE_EXPIRY_SEC = process.env.AGENT_QUOTE_EXPIRY_SEC
  ? Number(process.env.AGENT_QUOTE_EXPIRY_SEC)
  : undefined;
const POLL_BASE_MS = process.env.AGENT_POLL_BASE_MS
  ? Number(process.env.AGENT_POLL_BASE_MS)
  : undefined;

const houseAgents = [
  { agentId: 1, envKey: "AGENT_STEADY_PRIVATE_KEY", strategy: steadyStrategy },
  { agentId: 2, envKey: "AGENT_TEMPO_PRIVATE_KEY", strategy: tempoStrategy },
  { agentId: 3, envKey: "AGENT_PULSE_PRIVATE_KEY", strategy: pulseStrategy },
] as const;

const llmEndpoints = llmEndpointsFromEnv(process.env);

const runners: AgentRunner[] = [];
for (const { agentId, envKey, strategy } of houseAgents) {
  const account = privateKeyToAccount(requiredEnv(envKey) as `0x${string}`);
  // Pulse reads the match with an LLM when one is configured; without one it prices on its model.
  const reader =
    strategy === pulseStrategy && llmEndpoints.length > 0
      ? new MatchReader({
          endpoints: llmEndpoints,
          snapshot: matchSnapshot,
          agentId,
          signer: account,
          publish: async (note) => {
            await fetch(`${relayUrl}/agent-notes`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(note),
            });
          },
          log: console.log,
        })
      : undefined;
  reader?.start();
  const runner = new AgentRunner({
    chain,
    rpcUrls,
    agentId,
    quoteSigner: account,
    agentRegistry,
    marketManager,
    betRouter,
    ...(oddsLock ? { oddsLock } : {}),
    strategy: { ...strategy, quoteExpirySec: QUOTE_EXPIRY_SEC ?? strategy.quoteExpirySec },
    publisher,
    // Re-quote well inside the 5s quote expiry (2.5-3.5s, staggered so the three don't read at the
    // same instant), so a fan's bet -- or a cash-out, which needs the other side's whole book --
    // always has fresh prices to strike. At 5.5-8.5s, which the public
    // RPC's 15 req/s cap once forced, every agent spent part of each cycle with no valid quote;
    // server reads now go to SERVER_RPC_URL first (see serverRpcUrls).
    pollIntervalMs: (POLL_BASE_MS ?? 2000) + agentId * 500,
    // Every agent gets it now, not only the live-state strategies: all three pull their quotes
    // around big moments, whatever their pricing model.
    matchState,
    ...(reader ? { reader } : {}),
    ...(indexerUrl ? { settledBets: () => fetchSettledBets(indexerUrl, agentId) } : {}),
  });
  runner.start();
  runners.push(runner);
  console.log(
    `[agents] ${strategy.name} running (agentId=${agentId}, signer=${account.address}, relay=${relayUrl})`,
  );
}

console.log("[agents] all house agents started");

// The market scheduler calls this the moment a market opens, so the agents price it at once
// (see AgentRunner.nudge). Nothing is taken from the request; it only says "look now".
const nudgePort = Number(process.env.AGENTS_NUDGE_PORT ?? 8083);
createServer((req, res) => {
  if (req.method === "POST" && req.url?.startsWith("/market-opened")) {
    for (const runner of runners) runner.nudge();
    res.writeHead(204).end();
    return;
  }
  res.writeHead(404).end();
}).listen(nudgePort, () => console.log(`[agents] listening for new markets on :${nudgePort}`));
