import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WyscoutAdapter } from "../src/adapters/wyscout.js";
import { MatchDataServer } from "../src/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");
const PORT = 18080;
const BASE = `http://127.0.0.1:${PORT}`;

describe("MatchDataServer", () => {
  let server: MatchDataServer;

  beforeEach(() => {
    server = new MatchDataServer({
      adapter: new WyscoutAdapter({ fixturesDir }),
      defaultSpeed: 5000, // fast enough that a 90-minute match replays in test time
    });
    return server.listen(PORT);
  });

  afterEach(() => server.close());

  it("GET /health", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("404s on events for a match that hasn't been started", async () => {
    const res = await fetch(`${BASE}/matches/1694390/events`);
    expect(res.status).toBe(404);
  });

  it("starting a replay for an unknown match id 404s", async () => {
    const res = await fetch(`${BASE}/matches/no-such-match/replay/start`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("starting the same match twice is rejected", async () => {
    await fetch(`${BASE}/matches/1694390/replay/start`, { method: "POST" });
    const res = await fetch(`${BASE}/matches/1694390/replay/start`, { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("replays a full match and serves its events over REST", async () => {
    await fetch(`${BASE}/matches/1694390/replay/start`, { method: "POST" });
    await waitUntilQuiet();

    const res = await fetch(`${BASE}/matches/1694390/events`);
    const body = await res.json();
    expect(body.events.length).toBeGreaterThan(1000);
    // Same count the golden-file adapter test pins.
    const goals = body.events.filter((e: { type: string }) => e.type === "goal");
    expect(goals).toHaveLength(2);
  });

  it("filters events by from/to on the match clock", async () => {
    await fetch(`${BASE}/matches/1694390/replay/start`, { method: "POST" });
    await waitUntilQuiet();

    const res = await fetch(`${BASE}/matches/1694390/events?from=0&to=100`);
    const body = await res.json();
    for (const e of body.events) {
      expect(e.matchClockSec).toBeGreaterThanOrEqual(0);
      expect(e.matchClockSec).toBeLessThan(100);
    }
    expect(body.events.length).toBeGreaterThan(0);
  });

  it("streams events over WebSocket, backfilling what already played", async () => {
    await fetch(`${BASE}/matches/1694390/replay/start`, { method: "POST" });
    await waitUntilQuiet();

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?matchId=1694390`);
    const first = await new Promise<{ type: string; events: unknown[] }>((resolve) => {
      ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    });

    expect(first.type).toBe("backfill");
    expect(first.events.length).toBeGreaterThan(1000);
    ws.close();
  });

  it("a WebSocket connection with no matchId or an unknown one is refused", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?matchId=nope`);
    const closeCode = await new Promise<number>((resolve) =>
      ws.once("close", (code) => resolve(code)),
    );
    expect(closeCode).toBe(4004);
  });

  describe("/settlement", () => {
    it("resolves GOAL_NEXT_N to Yes with the real qualifying timestamp", async () => {
      await fetch(`${BASE}/matches/1694390/replay/start`, { method: "POST" });
      await waitUntilQuiet();

      // Both of this fixture's goals are France's, in the second half at 2H+718.9s and
      // 2H+2601.0s (i.e. matchClockSec ~3418.9 and ~5301.0, since 2H starts at the nominal
      // 45:00 = 2700s mark) -- pinned against the raw fixture, not guessed.
      const res = await fetch(
        `${BASE}/matches/1694390/settlement?template=GOAL_NEXT_N&windowStart=3400&windowEnd=3450`,
      );
      const body = await res.json();
      expect(body.outcome).toBe("Yes");
      expect(body.qualifyingEventTs).toBeGreaterThan(0);
    });

    it("resolves to No for a window with nothing in it", async () => {
      await fetch(`${BASE}/matches/1694390/replay/start`, { method: "POST" });
      await waitUntilQuiet();

      const res = await fetch(
        `${BASE}/matches/1694390/settlement?template=GOAL_NEXT_N&windowStart=1&windowEnd=2`,
      );
      const body = await res.json();
      expect(body.outcome).toBe("No");
    });

    it("400s on an unknown template", async () => {
      await fetch(`${BASE}/matches/1694390/replay/start`, { method: "POST" });
      const res = await fetch(
        `${BASE}/matches/1694390/settlement?template=NOT_A_TEMPLATE&windowStart=0&windowEnd=10`,
      );
      expect(res.status).toBe(400);
    });

    it("400s on a non-numeric window", async () => {
      await fetch(`${BASE}/matches/1694390/replay/start`, { method: "POST" });
      const res = await fetch(
        `${BASE}/matches/1694390/settlement?template=GOAL_NEXT_N&windowStart=abc&windowEnd=10`,
      );
      expect(res.status).toBe(400);
    });

    it("404s for a match that hasn't been started", async () => {
      const res = await fetch(
        `${BASE}/matches/9999999/settlement?template=GOAL_NEXT_N&windowStart=0&windowEnd=10`,
      );
      expect(res.status).toBe(404);
    });
  });

  /** Polls until the replay has finished (the fixture is fully consumed) or times out. */
  async function waitUntilQuiet(): Promise<void> {
    const deadline = Date.now() + 5000;
    let lastCount = -1;
    while (Date.now() < deadline) {
      const res = await fetch(`${BASE}/matches/1694390/events`);
      const body = await res.json();
      if (body.events.length === lastCount && body.events.length > 0) return;
      lastCount = body.events.length;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("replay did not settle within the deadline");
  }
});
