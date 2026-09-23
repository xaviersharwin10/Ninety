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
import type { NormalizedEvent } from "@ninety/core";
import { WyscoutAdapter } from "@ninety/match-data";
import {
  casualPopulation,
  SHARP_EDGE_THRESHOLD,
  SHARP_LOOKBACK_SEC,
  SHARP_PRIOR_WINDOW_SEC,
  sharpPopulation,
  sniperPopulation,
} from "./bettors.js";
import { AUSD, DELAY_SECONDS, INITIAL_VAULT_BALANCE } from "./constants.js";
import { type HouseAgent, type MatchSimulationResult, runMatch } from "./engine.js";
import { mulberry32 } from "./rng.js";

const FIXTURE_IDS = ["1694390", "1694391", "1694392"];
const NUM_SEEDS = 20;

const AGENTS: HouseAgent[] = [
  { name: "Steady", strategy: steadyStrategy },
  { name: "Tempo", strategy: tempoStrategy },
  { name: "Pulse", strategy: pulseStrategy },
];

function ausd(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / AUSD;
  const frac = (abs % AUSD).toString().padStart(6, "0").slice(0, 2);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

function ausdNum(n: number): string {
  return n.toFixed(2);
}

function pctNum(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

type Fixture = { matchId: string; events: NormalizedEvent[] };

/** Runs one scenario across every fixture and every seed, returning per-agent aggregate P&L (in
 *  whole AUSD, as a plain number) for each seed -- the caller decides how to summarise across them. */
function runAcrossSeeds(
  fixtures: Fixture[],
  populationsFor: (seed: number) => ReturnType<typeof casualPopulation>[],
  numSeeds: number,
): Record<string, number[]> {
  const byAgent: Record<string, number[]> = Object.fromEntries(AGENTS.map((a) => [a.name, []]));

  for (let seed = 0; seed < numSeeds; seed++) {
    const totals: Record<string, bigint> = Object.fromEntries(AGENTS.map((a) => [a.name, 0n]));
    for (let i = 0; i < fixtures.length; i++) {
      const result = runMatch({
        matchId: fixtures[i]!.matchId,
        events: fixtures[i]!.events,
        agents: AGENTS,
        populations: populationsFor(seed),
        rng: mulberry32(seed * 1000 + i),
      });
      for (const a of result.agents) totals[a.name] = totals[a.name]! + a.pnl;
    }
    for (const name of Object.keys(byAgent)) {
      byAgent[name]!.push(Number(totals[name]) / Number(AUSD));
    }
  }

  return byAgent;
}

function printSeedTable(title: string, byAgent: Record<string, number[]>, numSeeds: number): void {
  console.log(`\n### ${title}\n`);
  console.log(
    `Mean total P&L across ${FIXTURE_IDS.length} matches, averaged over ${numSeeds} seeds.\n`,
  );
  console.log("| Agent | Mean P&L (AUSD) | Mean ROI | Positive seeds | Min | Max |");
  console.log("|---|---:|---:|---:|---:|---:|");

  const startingTotal = Number(INITIAL_VAULT_BALANCE * BigInt(FIXTURE_IDS.length)) / Number(AUSD);

  for (const [name, values] of Object.entries(byAgent)) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const positive = values.filter((v) => v > 0).length;
    console.log(
      `| ${name} | ${ausdNum(mean)} | ${pctNum(mean / startingTotal)} | ${positive}/${values.length} | ` +
        `${ausdNum(Math.min(...values))} | ${ausdNum(Math.max(...values))} |`,
    );
  }
}

function printSniperComparison(
  caught: MatchSimulationResult[],
  evasive: MatchSimulationResult[],
): void {
  console.log("\n### Sniper: caught by the delay rule vs. evasive\n");
  console.log("| | Bets | Voided | Won (paid out) | Bettor net P&L (AUSD) |");
  console.log("|---|---:|---:|---:|---:|");

  for (const [label, results] of [
    [`Caught (3s lead, inside DELAY_SECONDS=${DELAY_SECONDS})`, caught],
    [`Evasive (15s lead, outside DELAY_SECONDS=${DELAY_SECONDS})`, evasive],
  ] as const) {
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
    console.log(`| ${label} | ${total} | ${voided} | ${won} | ${ausd(bettorNet)} |`);
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
      `${ausd(INITIAL_VAULT_BALANCE)} AUSD per match. \`DELAY_SECONDS=${DELAY_SECONDS}\`, matching \`BetRouter\`.`,
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

  const caught = fixtures.map((f) =>
    runMatch({
      matchId: f.matchId,
      events: f.events,
      agents: AGENTS,
      populations: [sniperPopulation({ leadSec: 3 })],
      rng: mulberry32(1),
    }),
  );
  const evasive = fixtures.map((f) =>
    runMatch({
      matchId: f.matchId,
      events: f.events,
      agents: AGENTS,
      populations: [sniperPopulation({ leadSec: 15, label: "sniper-evasive" })],
      rng: mulberry32(1),
    }),
  );
  printSniperComparison(caught, evasive);

  console.log("\n---\n");
  console.log(
    `Sharp's assumed edge: a ${SHARP_LOOKBACK_SEC}s-lookback / ${SHARP_PRIOR_WINDOW_SEC}s-prior pressure ` +
      `model (faster-reacting than any house agent) plus noticing when a qualifying event already ` +
      `happened earlier in a window a stale quote hasn't repriced for, acted on above a ` +
      `${pctNum(SHARP_EDGE_THRESHOLD)} edge threshold. Quotes are priced once per market at open, ` +
      "not continuously re-quoted (see the doc comment on `priceMarket` in `engine.ts`). Every " +
      "number above comes directly from this run; nothing here is hand-edited.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
