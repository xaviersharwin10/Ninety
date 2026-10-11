import { describe, expect, it } from "vitest";
import { previewBet, type SignedQuote } from "../src/bet-preview.js";

function quote(agentId: number, probNoBps: number, maxStake: bigint): SignedQuote {
  return {
    quote: {
      marketId: 254n,
      agentId,
      probYesBps: 10300 - probNoBps,
      probNoBps,
      maxStake,
      expiry: 1791685979n,
      salt: 1n,
    },
    signature: "0x",
  };
}

describe("previewBet", () => {
  it("splits 50/30/20 across three quotes", () => {
    const book = [
      quote(1, 9089, 25_000_000n),
      quote(2, 9273, 30_000_000n),
      quote(3, 9336, 50_000_000n),
    ];
    const preview = previewBet(book, "no", 2_000_000n);
    expect(preview.fills.map((f) => f.stake)).toEqual([1_000_000n, 600_000n, 400_000n]);
  });

  it("splits 60/40 across two, as BetRouter does", () => {
    // A real bet on market #254: BetRouter paid 2.182996 for these two quotes. Slicing the
    // three-quote ladder to 50/30 and sweeping the rest previewed 2.187362, and the bet, sent with
    // that as its minimum payout, reverted with PayoutBelowMinimum.
    const book = [quote(1, 9089, 25_000_000n), quote(2, 9273, 30_000_000n)];
    const preview = previewBet(book, "no", 2_000_000n);
    expect(preview.fills.map((f) => f.stake)).toEqual([1_200_000n, 800_000n]);
    expect(preview.totalPayout).toBe(2_182_996n);
  });

  it("gives a single quote the whole stake", () => {
    const preview = previewBet([quote(1, 9089, 25_000_000n)], "no", 2_000_000n);
    expect(preview.fills.map((f) => f.stake)).toEqual([2_000_000n]);
  });
});
