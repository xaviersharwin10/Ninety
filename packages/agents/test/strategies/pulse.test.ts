import { describe, expect, it } from "vitest";
import { PULSE_MARGIN_BPS, pulsePrice } from "../../src/strategies/pulse.js";
import { tempoPrice } from "../../src/strategies/tempo.js";

describe("pulsePrice", () => {
  it("more recent qualifying events raises the YES price, all else equal", () => {
    const quiet = pulsePrice({
      template: "CORNER_NEXT_N",
      windowSec: 180,
      recentQualifyingCount: 0,
    });
    const busy = pulsePrice({
      template: "CORNER_NEXT_N",
      windowSec: 180,
      recentQualifyingCount: 8,
    });
    expect(busy.probYesBps).toBeGreaterThan(quiet.probYesBps);
  });

  it("carries exactly the legal-floor 200bps margin, not more", () => {
    const q = pulsePrice({ template: "GOAL_NEXT_N", windowSec: 180, recentQualifyingCount: 3 });
    expect(q.probYesBps + q.probNoBps).toBe(10_000 + PULSE_MARGIN_BPS);
  });

  it("reacts to the same burst of recent pressure faster (in absolute terms) than Tempo", () => {
    // 4 qualifying events in Pulse's 90s lookback is a far busier match than the same 4 events
    // spread across Tempo's 300s lookback -- Pulse's shorter window and smaller prior should
    // move its price further from the quiet baseline for the same raw count.
    const input = { template: "CORNER_NEXT_N" as const, windowSec: 180, recentQualifyingCount: 4 };
    const quietPulse = pulsePrice({ ...input, recentQualifyingCount: 0 });
    const busyPulse = pulsePrice(input);
    const quietTempo = tempoPrice({ ...input, recentQualifyingCount: 0 });
    const busyTempo = tempoPrice(input);

    const pulseMove = busyPulse.probYesBps - quietPulse.probYesBps;
    const tempoMove = busyTempo.probYesBps - quietTempo.probYesBps;
    expect(pulseMove).toBeGreaterThan(tempoMove);
  });

  it("stays within BetRouter's [200, 9800] bounds even under an extreme pressure spike", () => {
    const q = pulsePrice({ template: "GOAL_NEXT_N", windowSec: 300, recentQualifyingCount: 500 });
    expect(q.probYesBps).toBeGreaterThanOrEqual(200);
    expect(q.probYesBps).toBeLessThanOrEqual(9800);
    expect(q.probNoBps).toBeGreaterThanOrEqual(200);
    expect(q.probNoBps).toBeLessThanOrEqual(9800);
  });
});
