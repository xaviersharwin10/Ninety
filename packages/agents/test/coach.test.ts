import type { NormalizedEvent } from "@ninety/core";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeMatch, llmEndpointsFromEnv, MatchReader, parseRead } from "../src/coach.js";
import { pulsePrice } from "../src/strategies/pulse.js";

const teams = [
  { id: 1, name: "France" },
  { id: 2, name: "Romania" },
];
const event = (type: NormalizedEvent["type"], teamId: number, minute: number): NormalizedEvent =>
  ({
    matchId: "m",
    type,
    teamId,
    period: "1H",
    periodSec: minute * 60,
    matchClockSec: minute * 60,
    source: { eventId: minute },
  }) as NormalizedEvent;
const snapshot = {
  teams,
  clockSec: 34 * 60,
  events: [
    event("goal", 1, 10),
    event("corner", 1, 30),
    event("corner", 1, 32),
    event("card", 2, 33),
  ],
};
const reply = JSON.stringify({
  shot_on_target: { either: 1.2, home: 1.5, away: 0.8 },
  corner: { either: 1.6, home: 1.9, away: 0.7 },
  card: { either: 1.3, home: 1, away: 1.6 },
  goal: { either: 1.1, home: 1.3, away: 0.9 },
  note: "France pinning Romania back with two corners in three minutes: France corners up.",
});
const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);

afterEach(() => vi.unstubAllGlobals());

describe("describeMatch", () => {
  it("gives the reader the score, the minute and who did what lately", () => {
    const text = describeMatch(snapshot);
    expect(text).toContain("Minute 34. Score: France 1-0 Romania.");
    expect(text).toContain("32' corner France");
    expect(text).toContain("33' card Romania");
    // Older than the recent window: counted in the totals, not listed.
    expect(text).not.toContain("10' goal");
  });
});

describe("parseRead", () => {
  it("reads a multiplier per market type and team", () => {
    const read = parseRead(reply, 5);
    expect(read?.multipliers["CORNER_NEXT_N:1"]).toBe(1.9);
    expect(read?.multipliers["CARD_NEXT_N:2"]).toBe(1.6);
    expect(read?.note).toMatch(/France/);
  });

  it("treats anything out of range or missing as no change", () => {
    const read = parseRead('{"corner":{"either":9,"home":1.4},"note":"x"}', 0);
    expect(read?.multipliers["CORNER_NEXT_N:0"]).toBe(1);
    expect(read?.multipliers["CORNER_NEXT_N:1"]).toBe(1.4);
    expect(read?.multipliers["GOAL_NEXT_N:0"]).toBe(1);
  });

  it("rejects a reply that isn't the JSON asked for", () => {
    expect(parseRead("I think corners are likely", 0)).toBeNull();
    expect(parseRead('{"note":"nothing usable"}', 0)).toBeNull();
  });
});

describe("MatchReader", () => {
  const endpoint = { baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" };
  const llm = (content: string, ok = true) =>
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ choices: [{ message: { content } }] }),
    }));

  it("reads the match, signs its note, and forgets a read once it's old", async () => {
    vi.stubGlobal("fetch", llm(reply));
    let now = 1000;
    const published: unknown[] = [];
    const reader = new MatchReader({
      endpoints: [endpoint],
      snapshot: async () => snapshot,
      publish: async (note) => void published.push(note),
      agentId: 3,
      signer,
      now: () => now,
    });
    expect(reader.multiplier("CORNER_NEXT_N", 1)).toBeUndefined();
    await reader.read();
    expect(reader.multiplier("CORNER_NEXT_N", 1)).toBe(1.9);
    expect(published).toEqual([
      expect.objectContaining({ agentId: 3, at: 1000, signature: expect.stringMatching(/^0x/) }),
    ]);
    now += 91_000;
    expect(reader.multiplier("CORNER_NEXT_N", 1)).toBeUndefined();
  });

  it("falls back to the next endpoint, and leaves no read if all of them fail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: reply } }] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const reader = new MatchReader({
      endpoints: [endpoint, endpoint],
      snapshot: async () => snapshot,
      agentId: 3,
      signer,
    });
    expect((await reader.read())?.note).toMatch(/France/);

    vi.stubGlobal("fetch", llm("not json"));
    const lost = new MatchReader({
      endpoints: [endpoint],
      snapshot: async () => snapshot,
      agentId: 3,
      signer,
    });
    expect(await lost.read()).toBeNull();
    expect(lost.multiplier("GOAL_NEXT_N", 0)).toBeUndefined();
  });

  it("doesn't ask again while the match clock hasn't moved, or when nothing is on", async () => {
    const fetchMock = llm(reply);
    vi.stubGlobal("fetch", fetchMock);
    const reader = new MatchReader({
      endpoints: [endpoint],
      snapshot: async () => snapshot,
      agentId: 3,
      signer,
    });
    await reader.read();
    await reader.read();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const idle = new MatchReader({
      endpoints: [endpoint],
      snapshot: async () => null,
      agentId: 3,
      signer,
    });
    expect(await idle.read()).toBeNull();
  });
});

describe("the reader's effect on Pulse's price", () => {
  const input = { template: "CORNER_NEXT_N" as const, windowSec: 180, recentQualifyingCount: 0 };

  it("moves the price, but only within its bounds", () => {
    const plain = pulsePrice(input).probYesBps;
    expect(pulsePrice({ ...input, rateMultiplier: 1.5 }).probYesBps).toBeGreaterThan(plain);
    expect(pulsePrice({ ...input, rateMultiplier: 0.7 }).probYesBps).toBeLessThan(plain);
    expect(pulsePrice({ ...input, rateMultiplier: 50 }).probYesBps).toBe(
      pulsePrice({ ...input, rateMultiplier: 2 }).probYesBps,
    );
    expect(pulsePrice({ ...input, rateMultiplier: Number.NaN }).probYesBps).toBe(plain);
  });

  it("prices a one-team market at about half the either-team rate", () => {
    const either = pulsePrice(input).probYesBps;
    const home = pulsePrice({ ...input, teamFilter: 1 }).probYesBps;
    expect(home).toBeLessThan(either);
    expect(home).toBeGreaterThan(either / 2 - 200);
  });
});

describe("llmEndpointsFromEnv", () => {
  it("lists the endpoints that are fully configured, primary first", () => {
    expect(
      llmEndpointsFromEnv({
        LLM_BASE_URL: "https://a/v1/",
        LLM_API_KEY: "k1",
        LLM_MODEL: "m1",
        LLM_FALLBACK_BASE_URL: "https://b/v1",
        LLM_FALLBACK_API_KEY: "k2",
      }),
    ).toEqual([{ baseUrl: "https://a/v1", apiKey: "k1", model: "m1" }]);
  });
});
