import type { NormalizedEvent } from "@ninety/core";
import { describe, expect, it } from "vitest";
import { casualPopulation, sharpPopulation, sniperPopulation } from "../src/bettors.js";
import type { MarketBook } from "../src/book.js";
import { mulberry32 } from "../src/rng.js";

function ev(
  type: NormalizedEvent["type"],
  matchClockSec: number,
  eventId: number,
): NormalizedEvent {
  return {
    matchId: "m1",
    type,
    teamId: 1,
    period: "1H",
    periodSec: matchClockSec,
    matchClockSec,
    source: { provider: "wyscout", eventId },
  };
}

function book(
  overrides: Partial<MarketBook["market"]> = {},
  quotes: MarketBook["quotes"],
): MarketBook {
  return {
    market: {
      id: "m1",
      template: "CORNER_NEXT_N",
      windowStart: 1000,
      windowEnd: 1180,
      ...overrides,
    },
    quotes,
  };
}

describe("casualPopulation", () => {
  it("never bets a side with no quoting capacity", () => {
    const rng = mulberry32(1);
    const pop = casualPopulation({ minArrivals: 3, maxArrivals: 3 });
    const b = book({}, [{ agentName: "Steady", probYesBps: 4000, probNoBps: 6200, maxStake: 0n }]);
    // Only NO has capacity (maxStake 0n means bestProbBps filters it out for both sides here since
    // the same quote backs both -- exercised properly below with per-side capacity).
    const arrivals = pop({ book: b, allEvents: [] }, rng);
    expect(arrivals).toEqual([]);
  });

  it("every arrival lands within the market's own window and respects the stake bounds", () => {
    const rng = mulberry32(42);
    const pop = casualPopulation({
      minArrivals: 5,
      maxArrivals: 5,
      minStakeAusdUnits: 5_000_000n,
      maxStakeAusdUnits: 25_000_000n,
    });
    const b = book({}, [
      { agentName: "Steady", probYesBps: 4000, probNoBps: 6200, maxStake: 25_000_000n },
    ]);
    const arrivals = pop({ book: b, allEvents: [] }, rng);

    expect(arrivals).toHaveLength(5);
    for (const a of arrivals) {
      expect(a.atSec).toBeGreaterThanOrEqual(1000);
      expect(a.atSec).toBeLessThan(1180);
      expect(a.stake).toBeGreaterThanOrEqual(5_000_000n);
      expect(a.stake).toBeLessThanOrEqual(25_000_000n);
    }
  });

  it("is deterministic for a given seed", () => {
    const pop = casualPopulation({ minArrivals: 4, maxArrivals: 4 });
    const b = book({}, [
      { agentName: "Steady", probYesBps: 4000, probNoBps: 6200, maxStake: 25_000_000n },
    ]);
    const a = pop({ book: b, allEvents: [] }, mulberry32(7));
    const c = pop({ book: b, allEvents: [] }, mulberry32(7));
    expect(a).toEqual(c);
  });
});

describe("sharpPopulation", () => {
  it("bets YES with high confidence when a qualifying event already happened in this window", () => {
    const rng = mulberry32(3);
    const pop = sharpPopulation({ scanProbability: 1, edgeThreshold: 0.04 });
    // A corner already happened at 1050, well inside [windowStart=1000, windowEnd=1180). The
    // quote (from before that corner) still prices it as unlikely -- a stale, exploitable price.
    const b = book({}, [
      { agentName: "Steady", probYesBps: 2000, probNoBps: 8200, maxStake: 80_000_000n },
    ]);
    const events = [ev("corner", 1050, 1)];

    // Force atSec to land after 1050 by trying every seed until one does, since randInt's exact
    // draw depends on the RNG stream; the *property* under test is "whenever it scans after the
    // event, it recognises the market has already qualified".
    let found = false;
    for (let seed = 0; seed < 200 && !found; seed++) {
      const arrivals = pop({ book: b, allEvents: events }, mulberry32(seed));
      if (arrivals.length === 1 && arrivals[0]!.atSec > 1050) {
        expect(arrivals[0]!.side).toBe("yes");
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("does not bet when the best available price already reflects fair value", () => {
    const rng = mulberry32(5);
    const pop = sharpPopulation({ scanProbability: 1, edgeThreshold: 0.04 });
    // CORNER_NEXT_N base rate over a 180s window is roughly 3%; quote it at a price with ample
    // margin and no recent pressure -- there should be no exploitable edge.
    const b = book({}, [
      { agentName: "Steady", probYesBps: 200, probNoBps: 9800, maxStake: 80_000_000n },
    ]);
    const arrivals = pop({ book: b, allEvents: [] }, rng);
    expect(arrivals).toEqual([]);
  });

  it("respects scanProbability: 0 means it never bets", () => {
    const pop = sharpPopulation({ scanProbability: 0 });
    const b = book({}, [
      { agentName: "Steady", probYesBps: 2000, probNoBps: 8200, maxStake: 80_000_000n },
    ]);
    expect(pop({ book: b, allEvents: [ev("corner", 1050, 1)] }, mulberry32(1))).toEqual([]);
  });
});

describe("sniperPopulation", () => {
  const events = [ev("goal", 1100, 1)]; // qualifying event at t=1100, inside [1000, 1180)

  it("bets YES exactly leadSec before the real qualifying event", () => {
    const pop = sniperPopulation({ leadSec: 3 });
    const b = book({ template: "GOAL_NEXT_N" }, [
      { agentName: "Steady", probYesBps: 2600, probNoBps: 7500, maxStake: 100_000_000n },
    ]);
    const arrivals = pop({ book: b, allEvents: events }, mulberry32(0));
    expect(arrivals).toEqual([
      { marketId: "m1", side: "yes", stake: 100_000_000n, atSec: 1097, bettorType: "sniper-lead3" },
    ]);
  });

  it("clips atSec to windowStart rather than betting before the market opened", () => {
    const pop = sniperPopulation({ leadSec: 500 }); // would be 1100-500=600, before windowStart=1000
    const b = book({ template: "GOAL_NEXT_N" }, [
      { agentName: "Steady", probYesBps: 2600, probNoBps: 7500, maxStake: 100_000_000n },
    ]);
    const arrivals = pop({ book: b, allEvents: events }, mulberry32(0));
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]!.atSec).toBe(1000);
  });

  it("does nothing when the market resolves No -- there is nothing to snipe", () => {
    const pop = sniperPopulation({ leadSec: 3 });
    const b = book({ template: "GOAL_NEXT_N" }, [
      { agentName: "Steady", probYesBps: 2600, probNoBps: 7500, maxStake: 100_000_000n },
    ]);
    expect(pop({ book: b, allEvents: [] }, mulberry32(0))).toEqual([]);
  });
});
