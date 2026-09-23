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

interface LiveMatch {
  data: RawMatchData;
  /** Every event emitted so far this replay — what `/events` and the settlement endpoint read. */
  emitted: NormalizedEvent[];
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
      const events = match.emitted.filter((e) => e.matchClockSec >= from && e.matchClockSec < to);
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
      const resolution = resolveMarket(
        match.emitted,
        template as TemplateName,
        windowStart,
        windowEnd,
      );
      res.json({ matchId: req.params.id, template, windowStart, windowEnd, ...resolution });
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
      ws.send(JSON.stringify({ type: "backfill", events: match.emitted }));
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
      match.emitted.push(event);
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
