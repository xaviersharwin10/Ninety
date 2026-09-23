import type { NormalizedEvent } from "@ninety/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpMatchStateProvider } from "../src/match-state.js";

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

describe("HttpMatchStateProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches /matches/:id/events and counts qualifying events in the lookback ending at the latest event", async () => {
    const events = [ev("corner", 100, 1), ev("corner", 500, 2), ev("shot_on_target", 550, 3)];
    let requestedUrl: string | undefined;
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ matchId: "m1", events }), { status: 200 });
    }) as typeof fetch;

    const provider = new HttpMatchStateProvider("http://localhost:9999", "m1");
    const count = await provider.recentQualifyingCount("CORNER_NEXT_N", 100);

    expect(requestedUrl).toBe("http://localhost:9999/matches/m1/events");
    // "now" = 550 (the latest event), lookback 100 -> window (450, 550]. Only the corner at 500
    // qualifies; the one at 100 is long past, and the shot_on_target doesn't qualify CORNER_NEXT_N.
    expect(count).toBe(1);
  });

  it("strips a trailing slash from the base URL", async () => {
    let requestedUrl: string | undefined;
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ matchId: "m1", events: [] }), { status: 200 });
    }) as typeof fetch;

    const provider = new HttpMatchStateProvider("http://localhost:9999/", "m1");
    await provider.recentQualifyingCount("GOAL_NEXT_N", 60);

    expect(requestedUrl).toBe("http://localhost:9999/matches/m1/events");
  });

  it("returns 0 with no events revealed yet, without dividing by an empty max()", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ matchId: "m1", events: [] }), { status: 200 });
    }) as typeof fetch;

    const provider = new HttpMatchStateProvider("http://localhost:9999", "m1");
    expect(await provider.recentQualifyingCount("GOAL_NEXT_N", 300)).toBe(0);
  });

  it("throws on a non-OK response rather than silently pricing off stale or empty data", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;

    const provider = new HttpMatchStateProvider("http://localhost:9999", "m1");
    await expect(provider.recentQualifyingCount("GOAL_NEXT_N", 60)).rejects.toThrow(/HTTP 500/);
  });
});
