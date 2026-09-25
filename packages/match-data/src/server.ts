import { createServer, type Server } from "node:http";
import {
  type NormalizedEvent,
  resolveMarket,
  TEMPLATE_NAMES,
  type TemplateName,
} from "@ninety/core";
import express, { type Express } from "express";
import { type WebSocket, WebSocketServer } from "ws";
import type { MatchDataAdapter, RawMatchData } from "./adapters/types.js";
import { ReplayClock } from "./replay/clock.js";

/**
 * An event as this server actually delivered it, paired with the wall-clock moment it did so.
 *
 * `event.matchClockSec` and `revealedAtMs` are deliberately different clocks answering different
 * questions, and conflating them is a real bug this project shipped once: `matchClockSec` is
 * replay-speed-independent match time, used for window matching against the same clock
 * `MarketManager`'s `windowStart`/`windowEnd` use. `revealedAtMs` is `Date.now()` at the instant
 * this server actually emitted the event — compressed by replay speed, just like `block.timestamp`
 * is when a bet is placed against an accelerated replay. `BetRouter`'s anti-sniping rule compares
 * a bet's `placedAt` (`block.timestamp`, wall-clock) against a market's `qualifyingEventTs`, so
 * that field must be built from `revealedAtMs`, never from `matchClockSec` — the two are ~1.7
 * billion apart in magnitude, and using the wrong one makes the delay-window check fire on every
 * single bet, always, regardless of timing. See `/settlement`'s `qualifyingEventTsWallClock`.
 */
interface DeliveredEvent {
  event: NormalizedEvent;
  revealedAtMs: number;
}

interface LiveMatch {
  data: RawMatchData;
  /** Every event emitted so far this replay — what `/events` and the settlement endpoint read. */
  emitted: DeliveredEvent[];
  clock: ReplayClock;
  sockets: Set<WebSocket>;
}

export interface MatchDataServerOptions {
  adapter: MatchDataAdapter;
  /** Match-time multiplier for newly started replays. 1 = real time, 10 = ten times faster. */
  defaultSpeed?: number;
}

/**
 * Replay server: loads a match through the given adapter, streams its events on a clock over
 * WebSocket, and serves REST endpoints for the event history and — the one CRE actually
 * depends on — settlement resolution. `/settlement` calls the same `resolveMarket` a workflow
 * auditor would call independently, so the workflow is not trusting this server's arithmetic,
 * only its record of which events occurred.
 */
export class MatchDataServer {
  private readonly app: Express;
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly matches = new Map<string, LiveMatch>();

  constructor(private readonly options: MatchDataServerOptions) {
    this.app = express();
    this.http = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.http, path: "/ws" });

    this.app.use((_req, res, next) => {
      // Public replay data, no auth/secrets -- wildcard is fine. Without this, a browser fetching
      // this server from a different origin than the web app (e.g. two separate tunnel domains
      // during local testing, or the deployed app calling a separately-hosted match-data service)
      // gets silently blocked by CORS with no network-level error to debug from.
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type");
      if (_req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
    this.app.use(express.json());
    this.registerRoutes();
    this.registerWebSocket();
  }

  /** Resolves with the port actually bound. Pass `0` (or omit) for an OS-assigned ephemeral
   *  port, which is what test suites should use to avoid racing a previous test's not-yet-fully-
   *  released port under load. */
  listen(port = 0): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(port, () => {
        const addr = this.http.address();
        resolve(typeof addr === "object" && addr ? addr.port : port);
      });
    });
  }

  async close(): Promise<void> {
    for (const m of this.matches.values()) m.clock.stop();
    this.wss.close();
    await new Promise<void>((resolve, reject) =>
      this.http.close((err) => (err ? reject(err) : resolve())),
    );
  }

  // ------------------------------------------------------------------
  // Routes
  // ------------------------------------------------------------------

  private registerRoutes(): void {
    this.app.get("/health", (_req, res) => res.json({ ok: true }));

    // What the web app's Home screen lists. Not every adapter can enumerate its catalogue (a
    // future live-feed adapter has no fixed one), so this is empty rather than erroring if not.
    this.app.get("/matches", async (_req, res) => {
      const summaries = (await this.options.adapter.listMatches?.()) ?? [];
      const matches = summaries.map((m) => ({ ...m, isReplaying: this.matches.has(m.matchId) }));
      res.json({ matches });
    });

    this.app.post("/matches/:id/replay/start", async (req, res) => {
      const matchId = req.params.id;
      if (this.matches.has(matchId)) {
        res.status(409).json({ error: "already_replaying", matchId });
        return;
      }
      const speed = Number(req.query.speed ?? this.options.defaultSpeed ?? 1);

      let data: RawMatchData;
      try {
        data = await this.options.adapter.loadMatch(matchId);
      } catch (err) {
        res.status(404).json({ error: "match_not_found", detail: (err as Error).message });
        return;
      }

      this.startReplay(data, speed);
      res.status(202).json({ matchId, events: data.events.length, speed });
    });

    this.app.get("/matches/:id/events", (req, res) => {
      const match = this.matches.get(req.params.id);
      if (!match) {
        res.status(404).json({ error: "match_not_found" });
        return;
      }

      const from = req.query.from !== undefined ? Number(req.query.from) : 0;
      const to = req.query.to !== undefined ? Number(req.query.to) : Number.POSITIVE_INFINITY;
      const events = match.emitted
        .filter((e) => e.event.matchClockSec >= from && e.event.matchClockSec < to)
        .map((e) => ({ ...e.event, revealedAtMs: e.revealedAtMs }));
      res.json({ matchId: req.params.id, events });
    });

    // The endpoint the CRE settlement workflow fetches from: given a market's template and
    // window, what has actually happened in this replay so far. Deliberately takes the template
    // and window as query params rather than a market id — this service has no notion of
    // on-chain market ids, only of match time and event kinds, which keeps it decoupled from
    // MarketManager entirely.
    this.app.get("/matches/:id/settlement", (req, res) => {
      const match = this.matches.get(req.params.id);
      if (!match) {
        res.status(404).json({ error: "match_not_found" });
        return;
      }

      const template = req.query.template as string;
      if (!TEMPLATE_NAMES.includes(template as TemplateName)) {
        res.status(400).json({ error: "unknown_template", template, valid: TEMPLATE_NAMES });
        return;
      }
      const windowStart = Number(req.query.windowStart);
      const windowEnd = Number(req.query.windowEnd);
      if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
        res.status(400).json({ error: "invalid_window" });
        return;
      }

      // Resolving against `match.emitted` (only what has actually played out so far) rather than
      // the full match, so a workflow polling before the window has closed gets an honest "no
      // qualifying event yet" instead of a result leaked from the future.
      const emittedEvents = match.emitted.map((e) => e.event);
      const resolution = resolveMarket(
        emittedEvents,
        template as TemplateName,
        windowStart,
        windowEnd,
      );

      // resolution.qualifyingEventTs is match-clock seconds -- correct for reasoning about the
      // window, wrong for the chain. A settlement workflow submitting this on-chain must use the
      // wall-clock moment this server actually delivered the qualifying event, since that is what
      // BetRouter's anti-sniping rule compares against a bet's block.timestamp. Found by an
      // integrated rehearsal that placed a real bet and watched it come back voided every time:
      // see the DeliveredEvent doc comment above for the full explanation.
      let qualifyingEventTsWallClock = 0;
      if (resolution.outcome === "Yes") {
        const hit = match.emitted.find(
          (e) => e.event.matchClockSec === resolution.qualifyingEventTs,
        );
        qualifyingEventTsWallClock = hit ? Math.floor(hit.revealedAtMs / 1000) : 0;
      }

      res.json({
        matchId: req.params.id,
        template,
        windowStart,
        windowEnd,
        ...resolution,
        qualifyingEventTsWallClock,
      });
    });
  }

  private registerWebSocket(): void {
    this.wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "", "http://localhost");
      const matchId = url.searchParams.get("matchId");
      const match = matchId ? this.matches.get(matchId) : undefined;

      if (!match) {
        ws.close(4004, "unknown or not-yet-started matchId");
        return;
      }

      match.sockets.add(ws);
      const events = match.emitted.map((e) => ({ ...e.event, revealedAtMs: e.revealedAtMs }));
      ws.send(JSON.stringify({ type: "backfill", events }));
      ws.on("close", () => match.sockets.delete(ws));
    });
  }

  // ------------------------------------------------------------------
  // Replay lifecycle
  // ------------------------------------------------------------------

  private startReplay(data: RawMatchData, speed: number): void {
    const clock = new ReplayClock(data.events, speed);
    const match: LiveMatch = { data, emitted: [], clock, sockets: new Set() };
    this.matches.set(data.matchId, match);

    clock.on("event", (event) => {
      match.emitted.push({ event, revealedAtMs: Date.now() });
      const payload = JSON.stringify({ type: "event", event });
      for (const ws of match.sockets) if (ws.readyState === ws.OPEN) ws.send(payload);
    });
    clock.on("end", () => {
      const payload = JSON.stringify({ type: "end" });
      for (const ws of match.sockets) if (ws.readyState === ws.OPEN) ws.send(payload);
    });

    clock.start();
  }
}
