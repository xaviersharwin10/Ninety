import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import {
  type NormalizedEvent,
  resolveMarket,
  TEMPLATE_ID,
  TEMPLATE_NAMES,
  toMatchClockSec,
} from "../src/index.js";

function ev(
  partial: Partial<NormalizedEvent> & Pick<NormalizedEvent, "type" | "period" | "periodSec">,
): NormalizedEvent {
  return {
    matchId: "m1",
    teamId: 1,
    matchClockSec: toMatchClockSec(partial.period, partial.periodSec),
    source: {
      provider: "wyscout",
      eventId: partial.source?.eventId ?? Math.floor(Math.random() * 1e6),
    },
    ...partial,
  } as NormalizedEvent;
}

describe("TEMPLATE_ID", () => {
  it("matches the Solidity keccak256(name) convention", () => {
    // Pinned against MarketManagerTest.sol / Deploy.s.sol, which compute the same hash on-chain.
    expect(TEMPLATE_ID.SHOT_ON_TARGET_NEXT_N).toBe(keccak256(toBytes("SHOT_ON_TARGET_NEXT_N")));
  });

  it("has a distinct id for every CORE template", () => {
    const ids = new Set(TEMPLATE_NAMES.map((n) => TEMPLATE_ID[n]));
    expect(ids.size).toBe(TEMPLATE_NAMES.length);
  });
});

describe("resolveMarket", () => {
  it("resolves No when nothing qualifying falls in the window", () => {
    const events = [ev({ type: "corner", period: "1H", periodSec: 100 })];
    const r = resolveMarket(events, "SHOT_ON_TARGET_NEXT_N", 0, 200);
    expect(r.outcome).toBe("No");
    expect(r.qualifyingEventTs).toBe(0);
  });

  it("resolves Yes and reports the first qualifying event's timestamp", () => {
    const events = [
      ev({ type: "shot_off_target", period: "1H", periodSec: 50 }),
      ev({ type: "shot_on_target", period: "1H", periodSec: 90 }),
      ev({ type: "shot_on_target", period: "1H", periodSec: 150 }),
    ];
    const r = resolveMarket(events, "SHOT_ON_TARGET_NEXT_N", 0, 200);
    expect(r.outcome).toBe("Yes");
    expect(r.qualifyingEventTs).toBe(90);
  });

  it("a goal also satisfies SHOT_ON_TARGET_NEXT_N", () => {
    const events = [ev({ type: "goal", period: "1H", periodSec: 90 })];
    const r = resolveMarket(events, "SHOT_ON_TARGET_NEXT_N", 0, 200);
    expect(r.outcome).toBe("Yes");
  });

  it("windowEnd is exclusive, matching the on-chain Market semantics", () => {
    const events = [ev({ type: "corner", period: "1H", periodSec: 200 })];
    expect(resolveMarket(events, "CORNER_NEXT_N", 0, 200).outcome).toBe("No");
    expect(resolveMarket(events, "CORNER_NEXT_N", 0, 201).outcome).toBe("Yes");
  });

  it("windowStart is inclusive", () => {
    const events = [ev({ type: "card", period: "1H", periodSec: 100 })];
    expect(resolveMarket(events, "CARD_NEXT_N", 100, 200).outcome).toBe("Yes");
    expect(resolveMarket(events, "CARD_NEXT_N", 101, 200).outcome).toBe("No");
  });

  it("ignores events outside the window even when they qualify", () => {
    const events = [
      ev({ type: "goal", period: "1H", periodSec: 10 }),
      ev({ type: "goal", period: "1H", periodSec: 500 }),
    ];
    const r = resolveMarket(events, "GOAL_NEXT_N", 100, 200);
    expect(r.outcome).toBe("No");
  });

  it("templates only qualify their own event types", () => {
    const events = [ev({ type: "corner", period: "1H", periodSec: 50 })];
    expect(resolveMarket(events, "GOAL_NEXT_N", 0, 100).outcome).toBe("No");
    expect(resolveMarket(events, "CARD_NEXT_N", 0, 100).outcome).toBe("No");
    expect(resolveMarket(events, "CORNER_NEXT_N", 0, 100).outcome).toBe("Yes");
  });

  it("evidence always covers the full in-window scan, not just the hits", () => {
    const events = [
      ev({
        type: "shot_off_target",
        period: "1H",
        periodSec: 10,
        source: { provider: "wyscout", eventId: 1 },
      }),
      ev({
        type: "corner",
        period: "1H",
        periodSec: 20,
        source: { provider: "wyscout", eventId: 2 },
      }),
      ev({
        type: "goal",
        period: "1H",
        periodSec: 30,
        source: { provider: "wyscout", eventId: 3 },
      }),
    ];
    const r = resolveMarket(events, "GOAL_NEXT_N", 0, 100);
    expect(r.evidenceEventIds.sort()).toEqual([1, 2, 3]);
  });

  it("2H events carry a matchClockSec continuing past the first half's nominal boundary", () => {
    const first = toMatchClockSec("1H", 30);
    const second = toMatchClockSec("2H", 30);
    expect(second).toBeGreaterThan(first);
    expect(second).toBe(45 * 60 + 30);
  });
});
