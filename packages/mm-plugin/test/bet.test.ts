import { payoutFor, type SignedQuote } from "@ninety/core";
import { describe, expect, it } from "vitest";
import { planBet } from "../src/lib/bet.js";

const NOW = 1_800_000_000_000;

function quote(agentId: number, probYesBps: number, maxStake: bigint, lifeMs = 5000): SignedQuote {
  return {
    quote: {
      marketId: 7n,
      agentId,
      probYesBps,
      probNoBps: 10_300 - probYesBps,
      maxStake,
      expiry: BigInt(Math.floor((NOW + lifeMs) / 1000)),
      salt: BigInt(agentId),
    },
    signature: "0x01",
  };
}

const NUSD = 1_000_000n;

describe("planBet", () => {
  const book = [quote(1, 4635, 25n * NUSD), quote(2, 4680, 25n * NUSD), quote(3, 4700, 25n * NUSD)];

  it("splits the stake 50/30/20 across the best three prices, as the contract does", () => {
    const plan = planBet(book, "yes", 30n * NUSD, { nowMs: NOW });
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.fills.map((f) => f.quote.agentId)).toEqual([1, 2, 3]);
    const expected =
      payoutFor(15n * NUSD, 4635n) + payoutFor(9n * NUSD, 4680n) + payoutFor(6n * NUSD, 4700n);
    expect(plan.payout).toBe(expected);
    // The signed prices fix the payout, so the floor sent with the bet is that payout exactly.
    expect(plan.minPayout).toBe(expected);
    expect(plan.blendedOdds).toBeCloseTo(2.1453, 3);
  });

  it("ignores prices that would expire before the bet lands", () => {
    const plan = planBet(
      [quote(1, 4635, 25n * NUSD, 3000), quote(2, 4680, 25n * NUSD)],
      "yes",
      5n * NUSD,
      {
        nowMs: NOW,
      },
    );
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.fills.map((f) => f.quote.agentId)).toEqual([2]);
  });

  it("refuses rather than quietly staking less than asked", () => {
    expect(planBet(book, "yes", 100n * NUSD, { nowMs: NOW })).toBe("too_big");
  });

  it("refuses odds worse than the trader's floor", () => {
    expect(planBet(book, "yes", 10n * NUSD, { nowMs: NOW, minOdds: 2.5 })).toBe("below_min_odds");
  });

  it("says so when nothing is priced", () => {
    expect(planBet([], "no", NUSD, { nowMs: NOW })).toBe("no_prices");
  });
});
