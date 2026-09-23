import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWyscoutMatch, WyscoutAdapter } from "../src/adapters/wyscout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

/**
 * Golden-file tests against the real vendored fixtures. The exact counts are pinned in
 * docs/wyscout-fixtures.md — a change here means either the fixture files changed (they shouldn't)
 * or the classification logic changed (which should be a deliberate, reviewed decision).
 */
describe("parseWyscoutMatch (golden fixtures)", () => {
  async function load(matchId: string) {
    const raw = JSON.parse(await readFile(join(fixturesDir, `${matchId}.json`), "utf8"));
    return parseWyscoutMatch(matchId, raw);
  }

  it("1694390 (France v Romania): 22 shots, 7 on target, 2 goals, 9 corners, 4 cards", async () => {
    const { events, teams } = await load("1694390");

    expect(
      events.filter(
        (e) => e.type === "shot_on_target" || e.type === "shot_off_target" || e.type === "goal",
      ),
    ).toHaveLength(22);
    expect(events.filter((e) => e.type === "shot_on_target" || e.type === "goal")).toHaveLength(7);
    expect(events.filter((e) => e.type === "goal")).toHaveLength(2);
    expect(events.filter((e) => e.type === "corner")).toHaveLength(9);
    expect(events.filter((e) => e.type === "card")).toHaveLength(4);

    expect(teams.map((t) => t.name).sort()).toEqual(["France", "Romania"]);
  });

  it("1694391 (Albania v Switzerland): 7 cards -- the richest CARD_NEXT_N fixture", async () => {
    const { events } = await load("1694391");
    expect(events.filter((e) => e.type === "card")).toHaveLength(7);
    expect(events.filter((e) => e.type === "goal")).toHaveLength(1);
  });

  it("1694392 (Romania v Switzerland): 11 corners -- the richest CORNER_NEXT_N fixture", async () => {
    const { events } = await load("1694392");
    expect(events.filter((e) => e.type === "corner")).toHaveLength(11);
  });

  it("events are sorted ascending by matchClockSec", async () => {
    const { events } = await load("1694390");
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.matchClockSec).toBeGreaterThanOrEqual(events[i - 1]!.matchClockSec);
    }
  });

  it("every event carries a stable, unique provenance id", async () => {
    const { events } = await load("1694390");
    const ids = new Set(events.map((e) => e.source.eventId));
    expect(ids.size).toBe(events.length);
  });

  it("second-half events carry a matchClockSec past the nominal 45:00 boundary", async () => {
    const { events } = await load("1694390");
    const secondHalf = events.filter((e) => e.period === "2H");
    expect(secondHalf.length).toBeGreaterThan(0);
    for (const e of secondHalf) expect(e.matchClockSec).toBeGreaterThanOrEqual(45 * 60);
  });
});

describe("WyscoutAdapter", () => {
  it("loads a vendored fixture through the adapter's public interface", async () => {
    const adapter = new WyscoutAdapter({ fixturesDir });
    const data = await adapter.loadMatch("1694390");
    expect(data.matchId).toBe("1694390");
    expect(data.events.length).toBeGreaterThan(1000);
  });

  it("rejects a match id with no fixture and no mirror configured", async () => {
    const adapter = new WyscoutAdapter({ fixturesDir });
    await expect(adapter.loadMatch("9999999")).rejects.toThrow(/No source configured/);
  });

  it("falls back to the mirror when a match isn't vendored", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ events: [], teams: {} }), { status: 200 });
    }) as typeof fetch;

    try {
      const adapter = new WyscoutAdapter({
        fixturesDir,
        mirrorBase: "https://example.test/mirror",
      });
      const data = await adapter.loadMatch("not-vendored");
      expect(calls).toEqual(["https://example.test/mirror/not-vendored.json"]);
      expect(data.events).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
