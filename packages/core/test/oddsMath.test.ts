import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  LadderUnfilledError,
  ladderAllocate,
  liabilityFor,
  ODDS_MATH_BPS,
  overround,
  ProbOutOfRangeError,
  payoutFor,
} from "../src/oddsMath.js";

describe("payoutFor / liabilityFor", () => {
  it("reproduces the worked example from the design notes exactly (stake 15 AUSD @ 4635bps)", () => {
    // 15.000000 AUSD at Steady's 4635bps YES price in the ladder worked example: payout
    // 32.362459, liability 17.362459. Cross-checked against contracts/test/BetRouter.t.sol's
    // reproduction of the same example.
    const stake = 15_000_000n;
    const probBps = 4635n;
    expect(payoutFor(stake, probBps)).toBe(32_362_459n);
    expect(liabilityFor(stake, probBps)).toBe(17_362_459n);
  });

  it("rejects probBps outside (0, BPS]", () => {
    expect(() => payoutFor(1n, 0n)).toThrow(ProbOutOfRangeError);
    expect(() => payoutFor(1n, ODDS_MATH_BPS + 1n)).toThrow(ProbOutOfRangeError);
  });

  it("at probBps == BPS, payout equals stake exactly (liability zero)", () => {
    expect(payoutFor(1_000_000n, ODDS_MATH_BPS)).toBe(1_000_000n);
    expect(liabilityFor(1_000_000n, ODDS_MATH_BPS)).toBe(0n);
  });

  it("payout is always >= stake for any valid probBps -- the invariant liabilityFor relies on", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10_000_000_000n }),
        fc.bigInt({ min: 1n, max: ODDS_MATH_BPS }),
        (stake, probBps) => {
          expect(payoutFor(stake, probBps)).toBeGreaterThanOrEqual(stake);
        },
      ),
    );
  });
});

describe("overround", () => {
  it("is 0 when the two sides don't cross 100%", () => {
    expect(overround(4000n, 5000n)).toBe(0n);
  });

  it("is the excess above BPS when they do", () => {
    expect(overround(5100n, 5200n)).toBe(300n);
  });
});

describe("ladderAllocate", () => {
  const LADDER_50_30_20 = [5000n, 3000n, 2000n];

  it("reproduces the worked example: 30 AUSD across three 25-AUSD-capped quotes -> 15/9/6", () => {
    const stakes = ladderAllocate(
      30_000_000n,
      [25_000_000n, 25_000_000n, 25_000_000n],
      LADDER_50_30_20,
    );
    expect(stakes).toEqual([15_000_000n, 9_000_000n, 6_000_000n]);
  });

  it("rolls a capped rank's shortfall down to the next rank that still has room", () => {
    // Rank 0 can only take 5 of its 15 target; the other 10 must roll to rank 1 (still has room),
    // not get stuck or silently dropped.
    const stakes = ladderAllocate(
      30_000_000n,
      [5_000_000n, 25_000_000n, 6_000_000n],
      LADDER_50_30_20,
    );
    expect(stakes[0]).toBe(5_000_000n);
    expect(stakes[0]! + stakes[1]! + stakes[2]!).toBe(30_000_000n);
    expect(stakes[2]).toBeLessThanOrEqual(6_000_000n);
  });

  it("throws LadderUnfilledError when total capacity is short of the stake", () => {
    expect(() => ladderAllocate(100_000_000n, [10_000_000n, 10_000_000n], [5000n, 5000n])).toThrow(
      LadderUnfilledError,
    );
  });

  it("property: whenever sum(caps) >= totalStake, allocation exactly fills and respects every cap", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 50_000_000n }), { minLength: 1, maxLength: 5 }),
        fc.bigInt({ min: 0n, max: 150_000_000n }),
        (caps, totalStakeRaw) => {
          const capSum = caps.reduce((a, b) => a + b, 0n);
          fc.pre(capSum >= totalStakeRaw);
          const weights = caps.map(() => 10_000n / BigInt(caps.length));

          const stakes = ladderAllocate(totalStakeRaw, caps, weights);

          expect(stakes.reduce((a, b) => a + b, 0n)).toBe(totalStakeRaw);
          for (let i = 0; i < caps.length; i++) {
            expect(stakes[i]!).toBeLessThanOrEqual(caps[i]!);
            expect(stakes[i]!).toBeGreaterThanOrEqual(0n);
          }
        },
      ),
    );
  });
});
