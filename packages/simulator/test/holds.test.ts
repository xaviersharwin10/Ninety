import { pulseStrategy } from "@ninety/agents/src/strategies/pulse.js";
import { steadyStrategy } from "@ninety/agents/src/strategies/steady.js";
import { tempoStrategy } from "@ninety/agents/src/strategies/tempo.js";
import { WyscoutAdapter } from "@ninety/match-data";
import { beforeAll, describe, expect, it } from "vitest";
import { simulateHolds } from "../src/holds.js";
import { scheduleMarkets } from "../src/scheduler.js";

const FIXTURES_DIR = new URL("../../match-data/fixtures", import.meta.url).pathname;

describe("simulateHolds", () => {
  let events: Awaited<ReturnType<WyscoutAdapter["loadMatch"]>>["events"];
  let markets: ReturnType<typeof scheduleMarkets>;

  beforeAll(async () => {
    events = (await new WyscoutAdapter({ fixturesDir: FIXTURES_DIR }).loadMatch("1694390")).events;
    const matchEndSec = events.reduce((m, e) => Math.max(m, e.matchClockSec), 0);
    markets = scheduleMarkets({ matchEndSec });
  });

  // The claim the fee model makes: even used as well as a hold can be, it pays the agent.
  it("every house agent nets a profit on holds, against the best possible use of them", () => {
    for (const [strategy, holdSec] of [steadyStrategy, tempoStrategy, pulseStrategy].flatMap((s) =>
      [30, 50].map((h) => [s, h] as const),
    )) {
      const rows = simulateHolds(events, markets, { name: strategy.name, strategy }, 10, holdSec);
      // Casual fans' bets just win or lose like any bet; the claim is about the best use of a hold.
      for (const r of rows.filter((row) => row.population === "Patient")) {
        expect(r.holds).toBeGreaterThan(0);
        expect(r.fees + r.betPnl).toBeGreaterThan(0);
      }
    }
  });

  it("a patient fan never bets a held YES: its price only gets better by waiting", () => {
    const yes = simulateHolds(events, markets, { name: "Steady", strategy: steadyStrategy }).find(
      (r) => r.population === "Patient" && r.side === "yes",
    );
    expect(yes?.exercised).toBe(0);
  });
});
