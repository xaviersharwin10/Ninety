/**
 * Poisson event-rate pricing and the margined-quote arithmetic every house agent builds a quote
 * with. Written to be imported unchanged by the simulator (offline, thousands of runs) and by the
 * live agent runner, so a backtest never silently diverges from what actually quotes on chain.
 */

export const BPS = 10_000;

/**
 * Fixed, conservative base rates in events per second, one per CORE template. These are
 * order-of-magnitude professional-match averages (roughly: ~9 shots on target, ~10 corners,
 * ~3.5 cards, ~2.6 goals per 90-minute match, combined across both teams), not fit to any
 * particular dataset. That is deliberate: "Steady" (the conservative house agent) is specified as
 * pricing off base rates rather than live match state — see the strategy note in
 * packages/agents/src/strategies/steady.ts — and fitting three vendored fixtures would be circular
 * and overfit to exactly the matches used to test it.
 */
export const BASE_RATE_PER_SEC: Record<
  "SHOT_ON_TARGET_NEXT_N" | "CORNER_NEXT_N" | "CARD_NEXT_N" | "GOAL_NEXT_N",
  number
> = {
  SHOT_ON_TARGET_NEXT_N: 9 / (90 * 60),
  CORNER_NEXT_N: 10 / (90 * 60),
  CARD_NEXT_N: 3.5 / (90 * 60),
  GOAL_NEXT_N: 2.6 / (90 * 60),
};

/**
 * P(at least one Poisson-distributed event of rate `lambdaPerSec` occurs in `windowSec` seconds).
 * Clamped to `[0, 1)` — a Poisson process technically never reaches exactly 1, and clamping the
 * input guards the same against `windowSec <= 0` or a pathologically large window.
 */
export function poissonProbability(lambdaPerSec: number, windowSec: number): number {
  if (lambdaPerSec < 0) throw new Error(`lambdaPerSec must be >= 0, got ${lambdaPerSec}`);
  if (windowSec <= 0) return 0;
  const p = 1 - Math.exp(-lambdaPerSec * windowSec);
  // Guard against floating-point creeping to exactly 1 for a very large window * rate.
  return Math.min(p, 1 - 1e-9);
}

export interface MarginedQuote {
  probYesBps: number;
  probNoBps: number;
}

/**
 * Turns a fair win probability into a two-sided quote that clears the on-chain checks in
 * `BetRouter`/`OddsMath.validateQuote` by construction: both sides land in
 * `[minProbBps, maxProbBps]`, and `probYesBps + probNoBps >= BPS + marginBps`, never merely
 * "approximately" — the invariant is enforced exactly, with any rounding shortfall repaired
 * deterministically rather than left to chance. A signed quote that could revert on chain is
 * worse than useless: it burns the agent's short expiry window for nothing.
 *
 * @param pYes Fair probability of Yes, in `[0, 1]`.
 */
export function marginedQuote(
  pYes: number,
  marginBps: number,
  minProbBps = 200,
  maxProbBps = 9800,
): MarginedQuote {
  if (pYes < 0 || pYes > 1) throw new Error(`pYes must be in [0,1], got ${pYes}`);
  if (minProbBps < 1 || maxProbBps > BPS - 1 || minProbBps >= maxProbBps) {
    throw new Error(`invalid bounds [${minProbBps}, ${maxProbBps}]`);
  }
  const required = BPS + marginBps;
  if (2 * maxProbBps < required) {
    // Structurally impossible: even both sides at the ceiling can't reach the required margin.
    // Not reachable with this project's real constants (marginBps up to a few thousand against a
    // 9800 ceiling), but a wrong config should fail loudly here, not produce a silently-invalid
    // quote that reverts on chain later.
    throw new Error(`margin ${marginBps}bps unreachable with maxProbBps ${maxProbBps}`);
  }

  // Fair probabilities in bps, summing to exactly BPS.
  const fairYes = Math.round(pYes * BPS);

  // Split the overround evenly in bps between the two sides, rather than scaling each side
  // proportionally to its own fair share. Proportional scaling multiplies a near-zero fair
  // probability by almost nothing, so all of the margin ends up on the other side -- which then
  // gets clamped down at `maxProbBps`, silently destroying the margin the clamp was supposed to
  // preserve. An earlier version did exactly that; a property test caught it (see the fixed
  // regression case in pricing.test.ts). Splitting evenly keeps `yes` monotonic in `pYes` for a
  // fixed margin and, combined with the compensation step below, keeps the margin invariant exact
  // under clamping instead of merely "usually true".
  let yes = fairYes + Math.round(marginBps / 2);
  let no = required - yes; // exact complement: the *unclamped* sum is exactly `required`.

  // Clamp yes, and push whatever the clamp cost (or gained) onto no so the sum is preserved.
  const yesClamped = clamp(yes, minProbBps, maxProbBps);
  no += yes - yesClamped;
  yes = yesClamped;

  // Clamp no the same way, pushing its cost back onto yes. Two passes suffice: the
  // unreachable-margin check above guarantees both sides can't need clamping downward at once,
  // so at most one side is still out of range after this second pass.
  const noClamped = clamp(no, minProbBps, maxProbBps);
  yes += no - noClamped;
  no = noClamped;

  yes = clamp(yes, minProbBps, maxProbBps);
  no = clamp(no, minProbBps, maxProbBps);

  // Backstop, not a trusted invariant: verified directly by the property tests in
  // pricing.test.ts, not just asserted here.
  if (yes + no < required) {
    throw new Error(
      `marginedQuote could not satisfy the margin invariant: ${yes}+${no} < ${required}`,
    );
  }

  return { probYesBps: yes, probNoBps: no };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
