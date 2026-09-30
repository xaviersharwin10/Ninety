import { payoutFor } from "@ninety/core";
import { describe, expect, it } from "vitest";
import { previewBet } from "@/lib/bet-preview";
import { cashOutOffer } from "@/lib/cash-out";
import type { SignedQuote } from "@/lib/quote-relay";

const NOW = 1_800_000_000_000;
const in10s = BigInt(NOW / 1000 + 10);

function quote(
  agentId: number,
  probYesBps: number,
  probNoBps: number,
  maxStake = 500_000_000n,
  expiry = in10s,
): SignedQuote {
  return {
    quote: { marketId: 7n, agentId, probYesBps, probNoBps, maxStake, expiry, salt: 1n },
    signature: "0x",
  } as SignedQuote;
}

// A YES bet of 10 nUSD struck at 40%: pays 25 nUSD if it wins.
const held = { stake: 10_000_000n, payout: payoutFor(10_000_000n, 4000n) };

describe("cashOutOffer", () => {
  it("covers the bet from the other side, so the fan gets the same whichever way it goes", () => {
    const noBook = [quote(1, 4000, 6200)];
    const offer = cashOutOffer(held, "yes", noBook, NOW)!;
    // Both outcomes pay at least the offer's value once the cover's cost is taken off.
    expect(held.payout - offer.coverStake).toBeGreaterThanOrEqual(offer.value);
    expect(offer.coverPayout - offer.coverStake).toBeGreaterThanOrEqual(offer.value);
    // ~25 x (1 - 0.62) = ~9.50 nUSD.
    expect(offer.value).toBeGreaterThan(9_400_000n);
    expect(offer.value).toBeLessThan(9_600_000n);
    // And it's the cheapest cover that does it.
    expect(previewBet(noBook, "no", offer.coverStake - 1n).totalPayout).toBeLessThan(held.payout);
  });

  it("prices off the whole ladder when the cover is split across agents", () => {
    const noBook = [quote(1, 4000, 6200, 8_000_000n), quote(2, 4000, 6300), quote(3, 4000, 6400)];
    const offer = cashOutOffer(held, "yes", noBook, NOW)!;
    expect(offer.coverPayout).toBeGreaterThanOrEqual(held.payout);
    expect(offer.value).toBe(held.payout - offer.coverStake);
  });

  it("offers nothing on quotes that would expire before the cover lands", () => {
    const stale = [quote(1, 4000, 6200, 500_000_000n, BigInt(NOW / 1000 + 1))];
    expect(cashOutOffer(held, "yes", stale, NOW)).toBeNull();
  });

  it("offers nothing when the book can't cover the whole bet", () => {
    expect(cashOutOffer(held, "yes", [quote(1, 4000, 6200, 5_000_000n)], NOW)).toBeNull();
  });
});
