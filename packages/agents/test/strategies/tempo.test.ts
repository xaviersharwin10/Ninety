import { describe, expect, it } from "vitest";
import { TEMPO_MARGIN_BPS, tempoPrice } from "../../src/strategies/tempo.js";

describe("tempoPrice", () => {
  it("with zero recent pressure, matches Steady's shape: depends only on template and window", () => {
    const a = tempoPrice({ template: "GOAL_NEXT_N", windowSec: 300, recentQualifyingCount: 0 });
    const b = tempoPrice({ template: "GOAL_NEXT_N", windowSec: 300, recentQualifyingCount: 0 });
    expect(a).toEqual(b);
  });

  it("more recent qualifying events raises the YES price, all else equal", () => {
    const quiet = tempoPrice({
      template: "CORNER_NEXT_N",
      windowSec: 180,
      recentQualifyingCount: 0,
    });
    const busy = tempoPrice({
      template: "CORNER_NEXT_N",
      windowSec: 180,
      recentQualifyingCount: 8,
    });
    expect(busy.probYesBps).toBeGreaterThan(quiet.probYesBps);
  });

  it("a longer window still prices a higher YES probability, holding pressure fixed", () => {
    const short = tempoPrice({
      template: "CORNER_NEXT_N",
      windowSec: 60,
      recentQualifyingCount: 2,
    });
    const long = tempoPrice({
      template: "CORNER_NEXT_N",
      windowSec: 600,
      recentQualifyingCount: 2,
    });
    expect(long.probYesBps).toBeGreaterThan(short.probYesBps);
  });

  it("carries at least the 250bps margin for every CORE template, busy or quiet", () => {
    for (const template of [
      "SHOT_ON_TARGET_NEXT_N",
      "CORNER_NEXT_N",
      "CARD_NEXT_N",
      "GOAL_NEXT_N",
    ] as const) {
      for (const recentQualifyingCount of [0, 15]) {
        const q = tempoPrice({ template, windowSec: 180, recentQualifyingCount });
        expect(q.probYesBps + q.probNoBps).toBeGreaterThanOrEqual(10_000 + TEMPO_MARGIN_BPS);
      }
    }
  });

  it("stays within BetRouter's [200, 9800] bounds even under an extreme pressure spike", () => {
    const q = tempoPrice({ template: "GOAL_NEXT_N", windowSec: 300, recentQualifyingCount: 500 });
    expect(q.probYesBps).toBeGreaterThanOrEqual(200);
    expect(q.probYesBps).toBeLessThanOrEqual(9800);
    expect(q.probNoBps).toBeGreaterThanOrEqual(200);
    expect(q.probNoBps).toBeLessThanOrEqual(9800);
  });
});
