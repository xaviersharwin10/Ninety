import { steadyStrategy } from "@ninety/agents/src/strategies/steady.js";
import { tempoStrategy } from "@ninety/agents/src/strategies/tempo.js";
import { WyscoutAdapter } from "@ninety/match-data";
import { beforeAll, describe, expect, it } from "vitest";
import { casualPopulation, sharpPopulation, sniperPopulation } from "../src/bettors.js";
import { INITIAL_VAULT_BALANCE } from "../src/constants.js";
import { type HouseAgent, runMatch } from "../src/engine.js";
import { mulberry32 } from "../src/rng.js";

const FIXTURES_DIR = new URL("../../match-data/fixtures", import.meta.url).pathname;
const MATCH_ID = "1694390";

const AGENTS: HouseAgent[] = [
  { name: "Steady", strategy: steadyStrategy },
  { name: "Tempo", strategy: tempoStrategy },
];

describe("runMatch", () => {
  let events: Awaited<ReturnType<WyscoutAdapter["loadMatch"]>>["events"];

  beforeAll(async () => {
    const adapter = new WyscoutAdapter({ fixturesDir: FIXTURES_DIR });
    const raw = await adapter.loadMatch(MATCH_ID);
    events = raw.events;
  });

  it("produces at least one settled bet against a real fixture with casual bettors", () => {
    const result = runMatch({
      matchId: MATCH_ID,
      events,
      agents: AGENTS,
      populations: [casualPopulation({ minArrivals: 1, maxArrivals: 3 })],
      rng: mulberry32(1),
    });

    expect(result.markets.length).toBeGreaterThan(0);
    expect(result.bets.length).toBeGreaterThan(0);
    expect(result.agents).toHaveLength(2);
  });

  it("is deterministic: the same seed and inputs reproduce an identical result", () => {
    const run = () =>
      runMatch({
        matchId: MATCH_ID,
        events,
        agents: AGENTS,
        populations: [
          casualPopulation({ minArrivals: 0, maxArrivals: 3 }),
          sharpPopulation(),
          sniperPopulation({ leadSec: 3 }),
        ],
        rng: mulberry32(99),
      });

    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it("money is conserved: every agent's P&L exactly offsets every bettor's net P&L, bet by bet", () => {
    const result = runMatch({
      matchId: MATCH_ID,
      events,
      agents: AGENTS,
      populations: [
        casualPopulation({ minArrivals: 0, maxArrivals: 4 }),
        sharpPopulation(),
        sniperPopulation({ leadSec: 3 }),
        sniperPopulation({ leadSec: 15, label: "sniper-evasive" }),
      ],
      rng: mulberry32(7),
    });

    let bettorNet = 0n;
    for (const bet of result.bets) {
      bettorNet += bet.payout - bet.stake;
    }
    const agentNet = result.agents.reduce((sum, a) => sum + a.pnl, 0n);

    expect(agentNet).toBe(-bettorNet);
  });

  it("never lets a vault's totalAssets fall below its lockedLiability (solvency holds throughout)", () => {
    // Re-derive it from the public result rather than reaching into engine internals: ending
    // balance must be non-negative and every settled liability must have come out of a vault that
    // had it to give, which -- since SimVault throws the instant that's violated -- runMatch
    // completing without throwing already proves this. This test exists to make that assertion
    // explicit rather than implicit in "it didn't crash".
    expect(() =>
      runMatch({
        matchId: MATCH_ID,
        events,
        agents: AGENTS,
        populations: [
          casualPopulation({ minArrivals: 2, maxArrivals: 6, maxStakeAusdUnits: 200_000_000n }),
          sharpPopulation({ stakeMaxAusdUnits: 500_000_000n, scanProbability: 1 }),
        ],
        rng: mulberry32(123),
      }),
    ).not.toThrow();
  });

  it("every agent starts from the same documented initial balance", () => {
    const result = runMatch({
      matchId: MATCH_ID,
      events,
      agents: AGENTS,
      populations: [casualPopulation()],
      rng: mulberry32(1),
    });
    for (const a of result.agents) {
      expect(a.startingBalance).toBe(INITIAL_VAULT_BALANCE);
      expect(a.endingBalance).toBe(a.startingBalance + a.pnl);
    }
  });

  it("a caught sniper (leadSec inside DELAY_SECONDS) never wins; an evasive one (well outside it) can", () => {
    const caughtOnly = runMatch({
      matchId: MATCH_ID,
      events,
      agents: AGENTS,
      populations: [sniperPopulation({ leadSec: 3 })],
      rng: mulberry32(1),
    });
    for (const bet of caughtOnly.bets) {
      expect(bet.outcome).toBe("voided");
    }

    const evasiveOnly = runMatch({
      matchId: MATCH_ID,
      events,
      agents: AGENTS,
      populations: [sniperPopulation({ leadSec: 15, label: "sniper-evasive" })],
      rng: mulberry32(1),
    });
    expect(evasiveOnly.bets.some((b) => b.outcome === "won")).toBe(true);
  });
});
