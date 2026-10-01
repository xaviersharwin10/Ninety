import {
  type LockOffer,
  lockClaimMessage,
  lockOfferToWire,
  type Quote,
  signLockOffer,
  signQuote,
  toWire,
} from "@ninety/core";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { QuoteRelay } from "../src/server.js";

const CHAIN_ID = 10143;
const BET_ROUTER = getAddress("0x0000000000000000000000000000000000beef00");
const ODDS_LOCK = getAddress("0x0000000000000000000000000000000000beef01");
const agent = privateKeyToAccount(
  "0xc8519e53f3c3f041f518e4c31f79eae11a4571f5d04c80de41d9ab3b2f6cc26b",
);
const fan = privateKeyToAccount(
  "0x70891076f8348c0d18b32e27850a34da372f4c7d5b6c88c99918915cffdd7f95",
);
const stranger = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const soon = () => BigInt(Math.floor(Date.now() / 1000) + 30);

function offer(overrides: Partial<LockOffer> = {}): LockOffer {
  return {
    marketId: 1n,
    agentId: 1,
    side: 1,
    probBps: 5600,
    maxStake: 25_000_000n,
    feeBps: 200,
    holdSeconds: 30,
    expiry: soon(),
    salt: 1n,
    ...overrides,
  };
}

async function postOffer(base: string, o: LockOffer) {
  const signature = await signLockOffer(agent, CHAIN_ID, ODDS_LOCK, o);
  return fetch(`${base}/lock-offers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(lockOfferToWire(o, signature)),
  });
}

describe("QuoteRelay holds", () => {
  let relay: QuoteRelay;
  let base: string;

  beforeEach(async () => {
    relay = new QuoteRelay({ chainId: CHAIN_ID, betRouter: BET_ROUTER, oddsLock: ODDS_LOCK });
    base = `http://127.0.0.1:${await relay.listen()}`;
  });
  afterEach(() => relay.close());

  it("broadcasts the best hold offer per side with the quotes", async () => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws?marketId=1`);
    await new Promise((r) => ws.on("open", r));
    const message = new Promise<{ holds: { yes: unknown; no: { offer: { probBps: number } } } }>(
      (resolve) => ws.on("message", (d) => resolve(JSON.parse(d.toString()))),
    );
    expect((await postOffer(base, offer())).status).toBe(202);
    const got = await message;
    expect(got.holds.no.offer.probBps).toBe(5600);
    expect(got.holds.yes).toBeNull();
    ws.close();
  });

  it("rejects an offer signed under another contract's domain", async () => {
    const o = offer();
    const signature = await signLockOffer(agent, CHAIN_ID, BET_ROUTER, o);
    const res = await fetch(`${base}/lock-offers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(lockOfferToWire({ ...o, expiry: 1n }, signature)),
    });
    expect(res.status).toBe(400);
  });

  it("hands a hold's quote to the fan who bought it, and nobody else", async () => {
    const quote: Quote = {
      marketId: 1n,
      agentId: 1,
      probYesBps: 9800,
      probNoBps: 5600,
      maxStake: 10_000_000n,
      expiry: soon(),
      salt: (1n << 255n) | 7n,
    };
    const signature = await signQuote(agent, CHAIN_ID, BET_ROUTER, quote);
    const posted = await fetch(`${base}/holds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lockId: "7", fan: fan.address, quote: toWire(quote, signature) }),
    });
    expect(posted.status).toBe(202);

    const asFan = await fan.signMessage({ message: lockClaimMessage(7n) });
    const ok = await fetch(`${base}/holds/7?signature=${asFan}`);
    expect(ok.status).toBe(200);
    expect(
      ((await ok.json()) as { quote: { quote: { probNoBps: number } } }).quote.quote.probNoBps,
    ).toBe(5600);

    const asStranger = await stranger.signMessage({ message: lockClaimMessage(7n) });
    expect((await fetch(`${base}/holds/7?signature=${asStranger}`)).status).toBe(403);
    // A signature for another hold doesn't open this one.
    const otherHold = await fan.signMessage({ message: lockClaimMessage(8n) });
    expect((await fetch(`${base}/holds/7?signature=${otherHold}`)).status).toBe(403);
  });
});
