import { createServer, type Server } from "node:http";
import { fromWire, type Quote, type SignedQuoteWire, toWire } from "@ninety/core";
import express, { type Express } from "express";
import type { Address } from "viem";
import { type WebSocket, WebSocketServer } from "ws";
import { QuoteBook } from "./book.js";
import { isStructurallyValid } from "./verify.js";

export interface QuoteRelayOptions {
  chainId: number;
  betRouter: Address;
  /** How often to drop expired quotes from the book. Default 5s. */
  sweepIntervalMs?: number;
}

/**
 * Stateless (in the sense that matters: nothing here is trusted) aggregation of agent quotes.
 * Agents POST signed quotes; the frontend (or a bet-placing script) reads back the best up-to-3
 * per market/side, already ordered the way `BetRouter.placeBet` requires them, and subscribes
 * over WebSocket for live updates instead of polling.
 */
export class QuoteRelay {
  private readonly app: Express;
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly book = new QuoteBook();
  private readonly sockets = new Map<string, Set<WebSocket>>(); // marketId -> subscribers
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: QuoteRelayOptions) {
    this.app = express();
    this.http = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.http, path: "/ws" });

    this.app.use(express.json());
    this.registerRoutes();
    this.registerWebSocket();

    this.sweepTimer = setInterval(
      () => this.book.sweepExpired(),
      this.options.sweepIntervalMs ?? 5000,
    );
  }

  listen(port = 0): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(port, () => {
        const addr = this.http.address();
        resolve(typeof addr === "object" && addr ? addr.port : port);
      });
    });
    // Ephemeral-port-by-default matches match-data's MatchDataServer, for the same reason: it
    // keeps repeated test runs from racing a not-yet-released hardcoded port.
  }

  async close(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.wss.close();
    await new Promise<void>((resolve, reject) =>
      this.http.close((err) => (err ? reject(err) : resolve())),
    );
  }

  private registerRoutes(): void {
    this.app.get("/health", (_req, res) => res.json({ ok: true }));

    this.app.post("/quotes", async (req, res) => {
      const wire = req.body as SignedQuoteWire;
      let parsed: { quote: Quote; signature: `0x${string}` };
      try {
        parsed = fromWire(wire);
      } catch (err) {
        res.status(400).json({ error: "malformed_quote", detail: (err as Error).message });
        return;
      }

      const result = await isStructurallyValid(
        parsed.quote,
        parsed.signature,
        this.options.chainId,
        this.options.betRouter,
      );
      if (!result.valid) {
        res.status(400).json({ error: "invalid_quote", detail: result.reason });
        return;
      }

      this.book.accept({
        quote: parsed.quote,
        signature: parsed.signature,
        signer: result.signer,
        receivedAt: Date.now(),
      });

      this.broadcast(parsed.quote.marketId);
      res.status(202).json({ accepted: true });
    });

    this.app.get("/quotes/:marketId", (req, res) => {
      const side = req.query.side;
      if (side !== "yes" && side !== "no") {
        res.status(400).json({ error: "side must be 'yes' or 'no'" });
        return;
      }

      let marketId: bigint;
      try {
        marketId = BigInt(req.params.marketId);
      } catch {
        res.status(400).json({ error: "invalid marketId" });
        return;
      }

      const best = this.book.best(marketId, side);
      res.json({
        marketId: req.params.marketId,
        side,
        quotes: best.map((s) => toWire(s.quote, s.signature)),
      });
    });
  }

  private registerWebSocket(): void {
    this.wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "", "http://localhost");
      const marketId = url.searchParams.get("marketId");
      if (!marketId) {
        ws.close(4000, "marketId query param required");
        return;
      }

      let subs = this.sockets.get(marketId);
      if (!subs) {
        subs = new Set();
        this.sockets.set(marketId, subs);
      }
      subs.add(ws);
      ws.on("close", () => subs.delete(ws));
    });
  }

  private broadcast(marketId: bigint): void {
    const subs = this.sockets.get(marketId.toString());
    if (!subs || subs.size === 0) return;

    const payload = JSON.stringify({
      type: "quotes_updated",
      marketId: marketId.toString(),
      yes: this.book.best(marketId, "yes").map((s) => toWire(s.quote, s.signature)),
      no: this.book.best(marketId, "no").map((s) => toWire(s.quote, s.signature)),
    });
    for (const ws of subs) if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
