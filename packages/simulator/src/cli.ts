#!/usr/bin/env tsx
import { pulseStrategy } from "@ninety/agents/src/strategies/pulse.js";
import { steadyStrategy } from "@ninety/agents/src/strategies/steady.js";
import { tempoStrategy } from "@ninety/agents/src/strategies/tempo.js";
/**
 * Runs the three vendored Wyscout fixtures through the full simulator pipeline and prints a
 * markdown report. This is what docs/simulator-results.md is built from -- run this and paste the
 * output, don't hand-write the numbers.
 *
 * Casual/Sharp scenarios run across NUM_SEEDS RNG seeds and report the mean, since any single seed
 * is noisy (a 46-market, ~80-bet match has real variance) -- the mean across seeds is what's worth
 * citing, not one lucky or unlucky draw. Sniper scenarios don't: `sniperPopulation` never reads its
 * `rng` argument (it acts on the real, known outcome of each market), so its result is identical
 * across every seed and one run already is the answer.
 */
import { type AgentMemory, LOCK_HOLD_SEC, type NormalizedEvent } from "@ninety/core";
import { WyscoutAdapter } from "@ninety/match-data";
import {
  casualPopulation,
  SHARP_EDGE_THRESHOLD,
  SHARP_LOOKBACK_SEC,
  SHARP_PRIOR_WINDOW_SEC,
  sharpPopulation,
  sniperPopulation,
} from "./bettors.js";
import {
  DANGER_COOLDOWN_SEC,
  DANGER_LEAD_SEC,
  DELAY_SECONDS,
  INITIAL_VAULT_BALANCE,
  LEARN_EVERY_SEC,
  nUSD,
} from "./constants.js";
import { type HouseAgent, type MatchSimulationResult, runMatch } from "./engine.js";
import { type HoldRow, simulateHolds } from "./holds.js";
import { mulberry32 } from "./rng.js";
import { scheduleMarkets } from "./scheduler.js";

const FIXTURE_IDS = ["1694390", "1694391", "1694392"];
const NUM_SEEDS = 20;

const AGENTS: HouseAgent[] = [
  { name: "Steady", strategy: steadyStrategy },
  { name: "Tempo", strategy: tempoStrategy },
  { name: "Pulse", strategy: pulseStrategy },
];

function nusd(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / nUSD;
  const frac = (abs % nUSD).toString().padStart(6, "0").slice(0, 2);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

function nusdNum(n: number): string {
  return n.toFixed(2);
}

function pctNum(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

type Fixture = { matchId: string; events: NormalizedEvent[] };

/** Runs one scenario across every fixture and every seed, returning per-agent aggregate P&L (in
 *  whole nUSD, as a plain number) for each seed -- the caller decides how to summarise across them. */
function runAcrossSeeds(
  fixtures: Fixture[],
  populationsFor: (seed: number) => ReturnType<typeof casualPopulation>[],
  numSeeds: number,
): Record<string, number[]> {
  const byAgent: Record<string, number[]> = Object.fromEntries(AGENTS.map((a) => [a.name, []]));

  for (let seed = 0; seed < numSeeds; seed++) {
    const totals: Record<string, bigint> = Object.fromEntries(AGENTS.map((a) => [a.name, 0n]));
    // What each agent learns carries from one match to the next, as it would live.
    const memories = new Map<string, AgentMemory>();
    for (let i = 0; i < fixtures.length; i++) {
      const result = runMatch({
        memories,
        matchId: fixtures[i]!.matchId,
        events: fixtures[i]!.events,
        agents: AGENTS,
        populations: populationsFor(seed),
        rng: mulberry32(seed * 1000 + i),
      });
      for (const a of result.agents) totals[a.name] = totals[a.name]! + a.pnl;
    }
    for (const name of Object.keys(byAgent)) {
      byAgent[name]!.push(Number(totals[name]) / Number(nUSD));
    }
  }

  return byAgent;
}

function printSeedTable(title: string, byAgent: Record<string, number[]>, numSeeds: number): void {
  console.log(`\n### ${title}\n`);
  console.log(
    `Mean total P&L across ${FIXTURE_IDS.length} matches, averaged over ${numSeeds} seeds.\n`,
  );
  console.log("| Agent | Mean P&L (nUSD) | Mean ROI | Positive seeds | Min | Max |");
  console.log("|---|---:|---:|---:|---:|---:|");

  const startingTotal = Number(INITIAL_VAULT_BALANCE * BigInt(FIXTURE_IDS.length)) / Number(nUSD);

  for (const [name, values] of Object.entries(byAgent)) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const positive = values.filter((v) => v > 0).length;
    console.log(
      `| ${name} | ${nusdNum(mean)} | ${pctNum(mean / startingTotal)} | ${positive}/${values.length} | ` +
        `${nusdNum(Math.min(...values))} | ${nusdNum(Math.max(...values))} |`,
    );
  }
}

function printSniperComparison(rows: [string, MatchSimulationResult[]][]): void {
  console.log("\n### Sniper: how far ahead of the feed it has to be\n");
  console.log("| | Bets | Voided | Won (paid out) | Bettor net P&L (nUSD) |");
  console.log("|---|---:|---:|---:|---:|");

  for (const [label, results] of rows) {
    let total = 0;
    let voided = 0;
    let won = 0;
    let bettorNet = 0n;
    for (const match of results) {
      for (const bet of match.bets) {
        total++;
        if (bet.outcome === "voided") voided++;
        if (bet.outcome === "won") won++;
        bettorNet += bet.payout - bet.stake;
      }
    }
    console.log(`| ${label} | ${total} | ${voided} | ${won} | ${nusd(bettorNet)} |`);
  }
}

/**
 * Odds Lock: every hold each agent would sell, every 10 match-seconds, bought and used two ways.
 * At 30 match-seconds, a hold live (1x), and at 50, what a hold covers in the app's 5x replays.
 */
function printHolds(fixtures: Fixture[]): void {
  console.log("\n### Odds Lock: what holding a price costs the agent\n");
  console.log(
    "A hold every 10 match-seconds of every market, on each side. *Patient* fans wait out the hold " +
      "and bet at the held price only when it pays -- the best use of a hold there is. *Casual* fans " +
      "bet at the held price at the end of the hold regardless. Amounts are per unit of stake held. " +
      `${LOCK_HOLD_SEC}s is a hold live; 50s is what one covers in the app's 5x replays.\n`,
  );
  console.log(
    "| Hold | Agent | Fans | Side | Holds | Bet on | Mean fee | Agent's bet P&L | Agent net |",
  );
  console.log("|---:|---|---|---|---:|---:|---:|---:|---:|");
  for (const holdSec of [LOCK_HOLD_SEC, 50]) {
    for (const agent of AGENTS) {
      const totals = new Map<string, HoldRow>();
      for (const f of fixtures) {
        const matchEndSec = f.events.reduce((m, e) => Math.max(m, e.matchClockSec), 0);
        const rows = simulateHolds(f.events, scheduleMarkets({ matchEndSec }), agent, 10, holdSec);
        for (const r of rows) {
          const key = `${r.population}:${r.side}`;
          const t = totals.get(key) ?? { ...r, holds: 0, exercised: 0, fees: 0, betPnl: 0 };
          t.holds += r.holds;
          t.exercised += r.exercised;
          t.fees += r.fees;
          t.betPnl += r.betPnl;
          totals.set(key, t);
        }
      }
      for (const t of totals.values()) {
        console.log(
          `| ${holdSec}s | ${agent.name} | ${t.population} | ${t.side.toUpperCase()} | ${t.holds} | ${t.exercised} | ` +
            `${pctNum(t.fees / t.holds)} | ${pctNum(t.betPnl / t.holds)} | ${pctNum((t.fees + t.betPnl) / t.holds)} |`,
        );
      }
    }
  }
}

async function main() {
  const fixturesDir = new URL("../../match-data/fixtures", import.meta.url).pathname;
  const adapter = new WyscoutAdapter({ fixturesDir });
  const fixtures: Fixture[] = await Promise.all(
    FIXTURE_IDS.map(async (matchId) => ({
      matchId,
      events: (await adapter.loadMatch(matchId)).events,
    })),
  );

  console.log("# Simulator results\n");
  console.log(
    `Three vendored Wyscout fixtures (${FIXTURE_IDS.join(", ")}), each house agent starting from ` +
      `${nusd(INITIAL_VAULT_BALANCE)} nUSD per match. \`DELAY_SECONDS=${DELAY_SECONDS}\`, matching \`BetRouter\`.`,
  );

  const casualOnly = runAcrossSeeds(
    fixtures,
    () => [casualPopulation({ minArrivals: 0, maxArrivals: 4 })],
    NUM_SEEDS,
  );
  printSeedTable("Casual bettors only", casualOnly, NUM_SEEDS);

  const withSharp = runAcrossSeeds(
    fixtures,
    () => [casualPopulation({ minArrivals: 0, maxArrivals: 4 }), sharpPopulation()],
    NUM_SEEDS,
  );
  printSeedTable("Casual + Sharp bettors", withSharp, NUM_SEEDS);

  const sniperRun = (leadSec: number) =>
    fixtures.map((f) =>
      runMatch({
        matchId: f.matchId,
        events: f.events,
        agents: AGENTS,
        populations: [sniperPopulation({ leadSec })],
        rng: mulberry32(1),
      }),
    );
  printSniperComparison([
    [`3s ahead: inside the pause and DELAY_SECONDS=${DELAY_SECONDS}`, sniperRun(3)],
    [`12s ahead: past the delay rule, inside the ${DANGER_LEAD_SEC}s pause`, sniperRun(12)],
    [`15s ahead: past both`, sniperRun(15)],
  ]);

  printHolds(fixtures);

  console.log("\n---\n");
  console.log(
    `Sharp's assumed edge: a ${SHARP_LOOKBACK_SEC}s-lookback / ${SHARP_PRIOR_WINDOW_SEC}s-prior pressure ` +
      `model (faster-reacting than any house agent) plus noticing when a qualifying event already ` +
      `happened earlier in a window a stale quote hasn't repriced for, acted on above a ` +
      `${pctNum(SHARP_EDGE_THRESHOLD)} edge threshold. Agents price every bet as it arrives, over what's left of the window, pull ` +
      `quotes from ${DANGER_LEAD_SEC}s before to ${DANGER_COOLDOWN_SEC}s after an event that would decide ` +
      `a market, and every ${LEARN_EVERY_SEC / 60} match-minutes learn from their settled bets ` +
      "(`learn`, the same rule an operator's agent uses), carrying that from match to match. Every " +
      "number above comes directly from this run; nothing here is hand-edited.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
