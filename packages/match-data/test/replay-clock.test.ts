import type { NormalizedEvent } from "@ninety/core";
import { describe, expect, it, vi } from "vitest";
import { ReplayClock } from "../src/replay/clock.js";

function ev(period: "1H" | "2H", periodSec: number, id: number): NormalizedEvent {
  return {
    matchId: "m1",
    type: "other",
    teamId: 1,
    period,
    periodSec,
    matchClockSec: (period === "1H" ? 0 : 45 * 60) + periodSec,
    source: { provider: "wyscout", eventId: id },
  };
}

describe("ReplayClock", () => {
  it("rejects a non-positive speed", () => {
    expect(() => new ReplayClock([], 0)).toThrow(/speed must be positive/);
    expect(() => new ReplayClock([], -1)).toThrow(/speed must be positive/);
  });

  it("emits every event exactly once, in order, then end", async () => {
    vi.useFakeTimers();
    const events = [ev("1H", 0, 1), ev("1H", 5, 2), ev("1H", 12, 3)];
    const clock = new ReplayClock(events, 1);

    const seen: number[] = [];
    let ended = false;
    clock.on("event", (e) => seen.push(e.source.eventId));
    clock.on("end", () => (ended = true));

    clock.start();
    await vi.runAllTimersAsync();

    expect(seen).toEqual([1, 2, 3]);
    expect(ended).toBe(true);
    vi.useRealTimers();
  });

  it("paces events by real elapsed periodSec divided by speed", async () => {
    vi.useFakeTimers();
    const events = [ev("1H", 0, 1), ev("1H", 10, 2)];
    const clock = new ReplayClock(events, 5); // 10 match-seconds at 5x = 2 real seconds

    const seen: number[] = [];
    clock.on("event", (e) => seen.push(e.source.eventId));
    clock.start();

    await vi.advanceTimersByTimeAsync(1999);
    expect(seen).toEqual([1]); // second event not due yet

    await vi.advanceTimersByTimeAsync(2);
    expect(seen).toEqual([1, 2]);
    vi.useRealTimers();
  });

  it("collapses the half-time gap to zero instead of waiting out the real interval", async () => {
    vi.useFakeTimers();
    // A large gap in periodSec across the 1H/2H boundary would be many real seconds at 1x if not
    // collapsed; it must fire immediately once the first event's own tiny delay has passed.
    const events = [ev("1H", 2800, 1), ev("2H", 0, 2)];
    const clock = new ReplayClock(events, 1);

    const seen: number[] = [];
    clock.on("event", (e) => seen.push(e.source.eventId));
    clock.start();

    await vi.advanceTimersByTimeAsync(2800 * 1000);
    expect(seen).toEqual([1]);

    // The zero-delay timer for event 2 is only scheduled once event 1's callback runs, so it
    // needs its own tick rather than being caught by the same advance call.
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([1, 2]);
    vi.useRealTimers();
  });

  it("an empty event list ends immediately without scheduling anything", async () => {
    vi.useFakeTimers();
    const clock = new ReplayClock([], 1);
    let ended = false;
    clock.on("end", () => (ended = true));
    clock.start();
    await vi.runAllTimersAsync();
    expect(ended).toBe(true);
    vi.useRealTimers();
  });

  it("stop() prevents further events from firing", async () => {
    vi.useFakeTimers();
    const events = [ev("1H", 0, 1), ev("1H", 100, 2)];
    const clock = new ReplayClock(events, 1);
    const seen: number[] = [];
    clock.on("event", (e) => seen.push(e.source.eventId));

    clock.start();
    await vi.advanceTimersByTimeAsync(0);
    clock.stop();
    await vi.advanceTimersByTimeAsync(200_000);

    expect(seen).toEqual([1]);
    vi.useRealTimers();
  });

  it("cursorMatchClockSec tracks the most recently emitted event", async () => {
    vi.useFakeTimers();
    const events = [ev("1H", 0, 1), ev("1H", 30, 2)];
    const clock = new ReplayClock(events, 1);
    expect(clock.cursorMatchClockSec).toBe(0);

    clock.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(clock.cursorMatchClockSec).toBe(0);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(clock.cursorMatchClockSec).toBe(30);
    vi.useRealTimers();
  });
});
