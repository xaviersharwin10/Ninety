import { describe, expect, it } from "vitest";
import { STEADY_MARGIN_BPS, steadyPrice } from "../../src/strategies/steady.js";

describe("steadyPrice", () => {
  it("depends only on template and window length, not on any live state", () => {
    const a = steadyPrice({ template: "GOAL_NEXT_N", windowSec: 300 });
    const b = steadyPrice({ template: "GOAL_NEXT_N", windowSec: 300 });
    expect(a).toEqual(b);
  });

  it("a longer window prices a higher YES probability", () => {
    const short = steadyPrice({ template: "CORNER_NEXT_N", windowSec: 60 });
    const long = steadyPrice({ template: "CORNER_NEXT_N", windowSec: 600 });
    expect(long.probYesBps).toBeGreaterThan(short.probYesBps);
  });

  it("carries at least the 300bps margin for every CORE template", () => {
    for (const template of [
      "SHOT_ON_TARGET_NEXT_N",
      "CORNER_NEXT_N",
      "CARD_NEXT_N",
      "GOAL_NEXT_N",
    ] as const) {
      const q = steadyPrice({ template, windowSec: 180 });
      expect(q.probYesBps + q.probNoBps).toBeGreaterThanOrEqual(10_000 + STEADY_MARGIN_BPS);
    }
  });

  it("stays within BetRouter's [200, 9800] bounds even for extreme windows", () => {
    for (const windowSec of [1, 60, 600, 5400, 100_000]) {
      const q = steadyPrice({ template: "GOAL_NEXT_N", windowSec });
      expect(q.probYesBps).toBeGreaterThanOrEqual(200);
      expect(q.probYesBps).toBeLessThanOrEqual(9800);
      expect(q.probNoBps).toBeGreaterThanOrEqual(200);
      expect(q.probNoBps).toBeLessThanOrEqual(9800);
    }
  });
});
