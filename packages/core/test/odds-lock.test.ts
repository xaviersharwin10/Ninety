import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";
import {
  holdRealSec,
  honouringQuote,
  LOCK_HOLD_SEC,
  LOCK_MIN_TAIL_SEC,
  LOCK_OFFER_TYPES,
  type LockOffer,
  lockDomain,
  lockFeeBps,
  lockFeeFor,
  lockOfferFromWire,
  lockOfferToWire,
} from "../src/odds-lock.js";
import { marginedQuote } from "../src/pricing.js";

describe("LockOffer EIP-712 (cross-language pin against Solidity)", () => {
  // Matches contracts/script/smoke/PrintLockOfferHash.s.sol exactly; re-run it if the struct or
  // domain changes, and this test fails until both sides agree again.
  it("hashes byte-identically to OddsLock.hashOffer", () => {
    const offer: LockOffer = {
      marketId: 42n,
      agentId: 7,
      side: 1,
      probBps: 5665,
      maxStake: 25_000_000n,
      feeBps: 340,
      holdSeconds: 30,
      expiry: 1_700_000_100n,
      salt: 1_234_567_890n,
    };
    const digest = hashTypedData({
      domain: lockDomain(31337, "0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3"),
      types: LOCK_OFFER_TYPES,
      primaryType: "LockOffer",
      message: offer,
    });
    expect(digest).toBe("0x0035de45212634869c720f759044be26acef0716cd78cdbad0f62445f2949f17");
  });

  it("round-trips through the wire format", () => {
    const offer: LockOffer = {
      marketId: 9n,
      agentId: 2,
      side: 0,
      probBps: 4100,
      maxStake: 10_000_000n,
      feeBps: 250,
      holdSeconds: 30,
      expiry: 99n,
      salt: 1n << 200n,
    };
    const back = lockOfferFromWire(JSON.parse(JSON.stringify(lockOfferToWire(offer, "0xab"))));
    expect(back.offer).toEqual(offer);
    expect(back.signature).toBe("0xab");
  });
});

describe("lockFeeBps", () => {
  const corner = marginedQuote(0.4, 400); // a 2-3 minute corner window, mid-match

  it("charges the floor for YES, which waiting never improves", () => {
    expect(lockFeeBps({ side: "yes", ...corner, remainingSec: 150 })).toBe(100);
  });

  it("charges NO for the time it lets the fan skip", () => {
    const fee = lockFeeBps({ side: "no", ...corner, remainingSec: 150 });
    expect(fee as number).toBeGreaterThan(100);
  });

  it("costs more the longer the hold", () => {
    const short = lockFeeBps({ side: "no", ...corner, remainingSec: 170, holdSec: 15 });
    const long = lockFeeBps({ side: "no", ...corner, remainingSec: 170, holdSec: 60 });
    expect(long as number).toBeGreaterThan(short as number);
  });

  it("isn't offered when too little of the window would remain after the hold", () => {
    expect(
      lockFeeBps({ side: "no", ...corner, remainingSec: LOCK_HOLD_SEC + LOCK_MIN_TAIL_SEC - 1 }),
    ).toBeNull();
  });

  it("isn't offered on a price the honouring quote couldn't carry", () => {
    expect(
      lockFeeBps({ side: "yes", probYesBps: 300, probNoBps: 9800, remainingSec: 300 }),
    ).toBeNull();
  });

  it("isn't offered when it would cost more than it could plausibly help", () => {
    // A likely event: holding NO through most of its window would be worth a fortune.
    const q = marginedQuote(0.7, 400);
    expect(lockFeeBps({ side: "no", ...q, remainingSec: 160, holdSec: 120 })).toBeNull();
  });

  it("charges exactly what OddsLock.buy charges, rounded up", () => {
    expect(lockFeeFor(10_000_000n, 300)).toBe(300_000n);
    expect(lockFeeFor(1n, 1)).toBe(1n);
  });
});

describe("honouringQuote", () => {
  it("carries the held price on the held side and clears the contract's minimum margin", () => {
    const q = honouringQuote({
      lockId: 5n,
      marketId: 3n,
      agentId: 1,
      side: "no",
      probBps: 400,
      stake: 10_000_000n,
      heldUntil: 123n,
      expiry: 200n,
    });
    expect(q.probNoBps).toBe(400);
    expect(q.probYesBps).toBe(9800);
    expect(q.probYesBps + q.probNoBps).toBeGreaterThanOrEqual(10_200);
    expect(q.maxStake).toBe(10_000_000n);
    expect(q.expiry).toBe(123n); // never outlives the hold
    expect(q.salt & ((1n << 255n) - 1n)).toBe(5n);
  });
});

describe("holdRealSec", () => {
  it("is 30 real seconds live, and shorter -- but never too short to use -- in a fast replay", () => {
    expect(holdRealSec(1)).toBe(30);
    expect(holdRealSec(2)).toBe(15);
    expect(holdRealSec(5)).toBe(10);
    expect(holdRealSec(20)).toBe(10);
  });
});
