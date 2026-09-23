import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BASE_RATE_PER_SEC,
  BPS,
  blendedRate,
  marginedQuote,
  poissonProbability,
} from "../src/pricing.js";

describe("poissonProbability", () => {
  it("is 0 for a non-positive window", () => {
    expect(poissonProbability(0.01, 0)).toBe(0);
    expect(poissonProbability(0.01, -5)).toBe(0);
  });

  it("is 0 when the rate is 0, regardless of window", () => {
    expect(poissonProbability(0, 1000)).toBe(0);
  });

  it("approaches but never reaches 1 for a very large window", () => {
    const p = poissonProbability(1, 1e6);
    expect(p).toBeLessThan(1);
    expect(p).toBeGreaterThan(0.999999);
  });

  it("matches the closed form for a known case: lambda=1/60, N=60 -> 1 - e^-1", () => {
    const p = poissonProbability(1 / 60, 60);
    expect(p).toBeCloseTo(1 - Math.exp(-1), 10);
  });

  it("rejects a negative rate", () => {
    expect(() => poissonProbability(-0.01, 60)).toThrow(/lambdaPerSec must be/);
  });

  it("is monotonically increasing in the window length", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0001, max: 0.01, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        (lambda, a, b) => {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          if (lo === hi) return;
          expect(poissonProbability(lambda, hi)).toBeGreaterThanOrEqual(
            poissonProbability(lambda, lo),
          );
        },
      ),
    );
  });
});

describe("marginedQuote", () => {
  const MIN = 200;
  const MAX = 9800;

  it("worked example: p=0.45, 300bps margin -> the numbers from the on-chain design notes", () => {
    // Not identical to the Solidity worked example (that used specific per-agent prices chosen
    // for the ladder demo), but the same shape: a ~45% fair probability at a 300bps overround.
    const q = marginedQuote(0.45, 300, MIN, MAX);
    expect(q.probYesBps + q.probNoBps).toBeGreaterThanOrEqual(BPS + 300);
    expect(q.probYesBps).toBeGreaterThan(4400);
    expect(q.probYesBps).toBeLessThan(4700);
  });

  it("rejects a probability outside [0,1]", () => {
    expect(() => marginedQuote(-0.1, 200)).toThrow(/pYes must be in/);
    expect(() => marginedQuote(1.1, 200)).toThrow(/pYes must be in/);
  });

  it("rejects invalid bounds", () => {
    expect(() => marginedQuote(0.5, 200, 9800, 200)).toThrow(/invalid bounds/);
  });

  it("rejects a structurally unreachable margin", () => {
    expect(() => marginedQuote(0.5, 20_000, MIN, MAX)).toThrow(/unreachable/);
  });

  // The property that matters most: every quote this function can produce must be immediately
  // acceptable to BetRouter.validateQuote's on-chain checks, mirroring exactly how OddsMath's
  // Solidity fuzz tests are framed.
  it("[property] every quote satisfies the on-chain margin and bounds invariants", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 3000 }),
        (pYes, marginBps) => {
          const q = marginedQuote(pYes, marginBps, MIN, MAX);
          expect(q.probYesBps).toBeGreaterThanOrEqual(MIN);
          expect(q.probYesBps).toBeLessThanOrEqual(MAX);
          expect(q.probNoBps).toBeGreaterThanOrEqual(MIN);
          expect(q.probNoBps).toBeLessThanOrEqual(MAX);
          expect(q.probYesBps + q.probNoBps).toBeGreaterThanOrEqual(BPS + marginBps);
        },
      ),
      { numRuns: 25000 },
    );
  });

  it("[property] is monotonic: a higher fair probability never yields a lower probYesBps", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 2000 }),
        (a, b, marginBps) => {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const qLo = marginedQuote(lo, marginBps, MIN, MAX);
          const qHi = marginedQuote(hi, marginBps, MIN, MAX);
          expect(qHi.probYesBps).toBeGreaterThanOrEqual(qLo.probYesBps);
        },
      ),
      { numRuns: 10000 },
    );
  });

  it("extreme fair probabilities still clamp into range without breaking the margin invariant", () => {
    for (const pYes of [0, 1e-9, 0.5, 1 - 1e-9, 1]) {
      for (const marginBps of [0, 200, 1000, 3000]) {
        const q = marginedQuote(pYes, marginBps, MIN, MAX);
        expect(q.probYesBps + q.probNoBps).toBeGreaterThanOrEqual(BPS + marginBps);
        expect(q.probYesBps).toBeGreaterThanOrEqual(MIN);
        expect(q.probNoBps).toBeGreaterThanOrEqual(MIN);
      }
    }
  });
});

describe("BASE_RATE_PER_SEC", () => {
  it("every CORE template has a positive base rate", () => {
    for (const [name, rate] of Object.entries(BASE_RATE_PER_SEC)) {
      expect(rate, name).toBeGreaterThan(0);
    }
  });

  it("produces plausible probabilities for typical market windows", () => {
    // A 2-minute SHOT_ON_TARGET_NEXT_N window shouldn't look like a coin flip or a near-certainty.
    const p = poissonProbability(BASE_RATE_PER_SEC.SHOT_ON_TARGET_NEXT_N, 120);
    expect(p).toBeGreaterThan(0.05);
    expect(p).toBeLessThan(0.5);
  });
});

describe("blendedRate", () => {
  const BASE = BASE_RATE_PER_SEC.CORNER_NEXT_N;

  it("returns exactly the base rate when lookbackSec is 0 (nothing observed)", () => {
    expect(blendedRate(BASE, 0, 0, 1200)).toBe(BASE);
  });

  it("converges to the raw empirical rate as priorWindowSec -> 0", () => {
    const raw = blendedRate(BASE, 10, 100, 1e-9);
    expect(raw).toBeCloseTo(10 / 100, 6);
  });

  it("is the exact posterior mean of the Poisson-Gamma conjugate update", () => {
    // baseRate=0.01/s treated as 100 pseudo-events over a 10_000s prior window; 5 real events
    // observed over a 500s lookback. Posterior mean = (alpha + count) / (beta + lookback).
    const base = 0.01;
    const priorWindowSec = 10_000;
    const recentCount = 5;
    const lookbackSec = 500;
    const expected = (base * priorWindowSec + recentCount) / (priorWindowSec + lookbackSec);
    expect(blendedRate(base, recentCount, lookbackSec, priorWindowSec)).toBeCloseTo(expected, 12);
  });

  it("lies strictly between the base rate and the raw empirical rate whenever they differ", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0001, max: 0.01, noNaN: true }),
        fc.integer({ min: 0, max: 50 }),
        fc.double({ min: 1, max: 1000, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        (base, recentCount, lookbackSec, priorWindowSec) => {
          const raw = recentCount / lookbackSec;
          const blended = blendedRate(base, recentCount, lookbackSec, priorWindowSec);
          if (Math.abs(raw - base) < 1e-12) return; // nothing to bracket
          const [lo, hi] = base < raw ? [base, raw] : [raw, base];
          expect(blended).toBeGreaterThanOrEqual(lo - 1e-9);
          expect(blended).toBeLessThanOrEqual(hi + 1e-9);
        },
      ),
    );
  });

  it("rejects a non-positive priorWindowSec", () => {
    expect(() => blendedRate(0.01, 1, 60, 0)).toThrow(/priorWindowSec/);
  });
});
