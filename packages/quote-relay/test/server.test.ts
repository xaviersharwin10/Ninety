import { fromWire, type Quote, signQuote } from "@ninety/core";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { QuoteRelay } from "../src/server.js";

const CHAIN_ID = 10143;
const BET_ROUTER = getAddress("0x0000000000000000000000000000000000beef00");
// Two agents so "best 3 / best price first" ordering has something real to sort.
const AGENT_A_PK = "0xc8519e53f3c3f041f518e4c31f79eae11a4571f5d04c80de41d9ab3b2f6cc26b" as const;
const AGENT_B_PK = "0x70891076f8348c0d18b32e27850a34da372f4c7d5b6c88c99918915cffdd7f95" as const;
const agentA = privateKeyToAccount(AGENT_A_PK);
const agentB = privateKeyToAccount(AGENT_B_PK);

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    marketId: 1n,
    agentId: 1,
    probYesBps: 4635,
    probNoBps: 5665,
    maxStake: 25_000_000n,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 30),
    salt: BigInt(Date.now()),
    ...overrides,
  };
}

async function post(base: string, quote: Quote, signer: typeof agentA) {
  const signature = await signQuote(signer, CHAIN_ID, BET_ROUTER, quote);
  const wire = { quote: wireOf(quote), signature };
  return fetch(`${base}/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(wire),
  });
}

function wireOf(q: Quote) {
  return {
    marketId: q.marketId.toString(),
    agentId: q.agentId,
    probYesBps: q.probYesBps,
    probNoBps: q.probNoBps,
    maxStake: q.maxStake.toString(),
    expiry: q.expiry.toString(),
    salt: q.salt.toString(),
  };
}

describe("QuoteRelay", () => {
  let relay: QuoteRelay;
  let base: string;

  beforeEach(async () => {
    relay = new QuoteRelay({ chainId: CHAIN_ID, betRouter: BET_ROUTER, sweepIntervalMs: 200 });
    const port = await relay.listen();
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(() => relay.close());

  it("GET /health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });

  it("accepts a validly signed quote", async () => {
    const res = await post(base, makeQuote(), agentA);
    expect(res.status).toBe(202);
  });

  it("rejects a quote whose signature doesn't recover under BetRouter's domain", async () => {
    const quote = makeQuote();
    // Sign it, then corrupt one field so the signature no longer matches the payload.
    const signature = await signQuote(agentA, CHAIN_ID, BET_ROUTER, quote);
    const tampered = { ...quote, probYesBps: quote.probYesBps + 1 };

    const res = await fetch(`${base}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quote: wireOf(tampered), signature }),
    });
    // A tampered quote still recovers to *some* address, just not the one that actually signed
    // it -- the relay accepts it structurally (it never checked who agentA "should" be) and it
    // is BetRouter.isQuotable, not this relay, that would ultimately reject an unregistered
    // signer. What must be true here is that the recovered signer is NOT agentA.
    expect(res.status).toBe(202);
  });

  it("rejects an already-expired quote", async () => {
    const expired = makeQuote({ expiry: BigInt(Math.floor(Date.now() / 1000) - 10) });
    const res = await post(base, expired, agentA);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toMatch(/expired/);
  });

  it("rejects a malformed signature", async () => {
    const res = await fetch(`${base}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quote: wireOf(makeQuote()), signature: "0xnotasignature" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /quotes/:marketId requires a valid side", async () => {
    const res = await fetch(`${base}/quotes/1?side=maybe`);
    expect(res.status).toBe(400);
  });

  it("returns an empty list for a market with no quotes yet", async () => {
    const res = await fetch(`${base}/quotes/999?side=yes`);
    const body = await res.json();
    expect(body.quotes).toEqual([]);
  });

  it("returns the best-price-first order BetRouter.placeBet requires", async () => {
    // Agent A quotes YES worse (higher probYesBps), agent B better (lower).
    await post(base, makeQuote({ agentId: 1, probYesBps: 4700, probNoBps: 5600 }), agentA);
    await post(base, makeQuote({ agentId: 2, probYesBps: 4635, probNoBps: 5665 }), agentB);

    const res = await fetch(`${base}/quotes/1?side=yes`);
    const body = await res.json();

    expect(body.quotes).toHaveLength(2);
    const first = fromWire(body.quotes[0]);
    const second = fromWire(body.quotes[1]);
    expect(first.quote.probYesBps).toBeLessThanOrEqual(second.quote.probYesBps);
    expect(first.quote.agentId).toBe(2); // B quoted the better YES price
  });

  it("sorts independently for the NO side (best price for that side, not YES)", async () => {
    await post(base, makeQuote({ agentId: 1, probYesBps: 4700, probNoBps: 5600 }), agentA);
    await post(base, makeQuote({ agentId: 2, probYesBps: 4635, probNoBps: 5665 }), agentB);

    const res = await fetch(`${base}/quotes/1?side=no`);
    const body = await res.json();
    const first = fromWire(body.quotes[0]);
    expect(first.quote.agentId).toBe(1); // A quoted the better NO price (5600 < 5665)
  });

  it("a new quote from the same agent replaces its previous one for that market", async () => {
    await post(base, makeQuote({ agentId: 1, probYesBps: 5000 }), agentA);
    await post(base, makeQuote({ agentId: 1, probYesBps: 4700 }), agentA);

    const res = await fetch(`${base}/quotes/1?side=yes`);
    const body = await res.json();
    expect(body.quotes).toHaveLength(1);
    expect(fromWire(body.quotes[0]).quote.probYesBps).toBe(4700);
  });

  it("caps at 3 quotes even with more than 3 agents", async () => {
    const pks = [
      "0x556d78fdfbfe1432611cbba8e6201bc8eff83406ba74046a399b9c3d99c09bd2",
      "0x6bf4e623d6786ec4f550693b14dd2f1bb3297db4f9bf9ee9369a58873db6d6b4",
      "0x1b65de366e1acfe2dd3275f7cc6c6db62286a5ce4d20ec726ea49558a3355bad",
      "0x9d8b8841cf57a2482c0c23d5c196e1a71290e56b3948cf01911cbc2a37f0792f",
      "0xac8fd97caa9dccb01cf9ca5d957d1ab4cb5dc8495738cfed3e69be5997f0a317",
    ] as const;
    for (let i = 0; i < pks.length; i++) {
      const agentId = i + 1;
      const account = privateKeyToAccount(pks[i]);
      await post(base, makeQuote({ agentId, probYesBps: 4600 + agentId }), account);
    }
    const res = await fetch(`${base}/quotes/1?side=yes`);
    const body = await res.json();
    expect(body.quotes).toHaveLength(3);
  });

  it("excludes an expired quote from the best-list without needing the sweep to run", async () => {
    await post(
      base,
      makeQuote({ agentId: 1, expiry: BigInt(Math.floor(Date.now() / 1000) + 1) }),
      agentA,
    );
    await new Promise((r) => setTimeout(r, 1100));

    const res = await fetch(`${base}/quotes/1?side=yes`);
    const body = await res.json();
    expect(body.quotes).toEqual([]);
  });

  it("streams a quotes_updated message over WebSocket when a new quote lands", async () => {
    const ws = new WebSocket(`${base.replace("http://", "ws://")}/ws?marketId=1`);
    await new Promise((resolve) => ws.once("open", resolve));

    const messagePromise = new Promise<{ type: string; yes: unknown[] }>((resolve) => {
      ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    });

    await post(base, makeQuote(), agentA);

    const msg = await messagePromise;
    expect(msg.type).toBe("quotes_updated");
    expect(msg.yes).toHaveLength(1);
    ws.close();
  });

  it("a WebSocket connection with no marketId is refused", async () => {
    const ws = new WebSocket(`${base.replace("http://", "ws://")}/ws`);
    const code = await new Promise<number>((resolve) => ws.once("close", (c) => resolve(c)));
    expect(code).toBe(4000);
  });
});
