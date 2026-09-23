import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../src/events.js";
import { countRecentQualifyingEvents } from "../src/pressure.js";

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

describe("countRecentQualifyingEvents", () => {
  it("counts only qualifying event types for the template", () => {
    const events = [ev("corner", 100, 1), ev("shot_on_target", 105, 2), ev("goal", 110, 3)];
    // GOAL_NEXT_N qualifies on "goal" only.
    expect(countRecentQualifyingEvents(events, "GOAL_NEXT_N", 200, 200)).toBe(1);
    // SHOT_ON_TARGET_NEXT_N qualifies on both shot_on_target and goal.
    expect(countRecentQualifyingEvents(events, "SHOT_ON_TARGET_NEXT_N", 200, 200)).toBe(2);
    expect(countRecentQualifyingEvents(events, "CORNER_NEXT_N", 200, 200)).toBe(1);
  });

  it("window is (asOfSec - lookbackSec, asOfSec], exclusive on the old end, inclusive on the new", () => {
    const events = [ev("corner", 100, 1), ev("corner", 200, 2), ev("corner", 300, 3)];
    // asOf=300, lookback=100 -> window (200, 300]: excludes the event exactly at the old
    // boundary (200), includes the one exactly at asOf (300).
    expect(countRecentQualifyingEvents(events, "CORNER_NEXT_N", 300, 100)).toBe(1);
  });

  it("ignores events after asOfSec -- never leaks the future", () => {
    const events = [ev("corner", 50, 1), ev("corner", 500, 2)];
    expect(countRecentQualifyingEvents(events, "CORNER_NEXT_N", 50, 1000)).toBe(1);
  });

  it("is 0 for an empty event list or a zero lookback", () => {
    expect(countRecentQualifyingEvents([], "CORNER_NEXT_N", 100, 60)).toBe(0);
    expect(countRecentQualifyingEvents([ev("corner", 100, 1)], "CORNER_NEXT_N", 100, 0)).toBe(0);
  });

  it("rejects a negative lookback", () => {
    expect(() => countRecentQualifyingEvents([], "CORNER_NEXT_N", 100, -1)).toThrow(/lookbackSec/);
  });
});
