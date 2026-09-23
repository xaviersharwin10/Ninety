/**
 * TypeScript port of `contracts/src/libraries/OddsMath.sol`, kept arithmetically identical
 * (`BigInt` floor division mirrors Solidity's integer division exactly) so the simulator's P&L
 * numbers are the same math the chain would actually run, not a lookalike. Every function here has
 * a matching Solidity function of the same name and the same doc comment's substance; changes to
 * one should be mirrored in the other.
 */

export const ODDS_MATH_BPS = 10_000n;

export class ProbOutOfRangeError extends Error {
  constructor(probBps: bigint) {
    super(`probBps out of range: ${probBps}`);
  }
}

export class LadderUnfilledError extends Error {
  constructor(remaining: bigint) {
    super(`ladder could not place the whole stake: ${remaining} unfilled`);
  }
}

function requireValidProb(probBps: bigint): void {
  if (probBps <= 0n || probBps > ODDS_MATH_BPS) throw new ProbOutOfRangeError(probBps);
}

/** Gross amount a winning bet returns, including the original stake. Floors, like the contract. */
export function payoutFor(stake: bigint, probBps: bigint): bigint {
  requireValidProb(probBps);
  return (stake * ODDS_MATH_BPS) / probBps;
}

/** The amount an agent's vault must reserve to honour a bet: payout minus the stake. */
export function liabilityFor(stake: bigint, probBps: bigint): bigint {
  return payoutFor(stake, probBps) - stake;
}

/** How far the two sides of a quote sum above 100%, in basis points. */
export function overround(probYesBps: bigint, probNoBps: bigint): bigint {
  const sum = probYesBps + probNoBps;
  return sum > ODDS_MATH_BPS ? sum - ODDS_MATH_BPS : 0n;
}

/** The agent's theoretical hold on balanced two-way flow, in basis points. */
export function holdBps(probYesBps: bigint, probNoBps: bigint): bigint {
  const sum = probYesBps + probNoBps;
  if (sum === 0n) return 0n;
  return (overround(probYesBps, probNoBps) * ODDS_MATH_BPS) / sum;
}

/**
 * Splits a stake across ranked quotes using a fixed weight ladder, then sweeps any remainder into
 * whatever capacity is left, best price first. Mirrors `OddsMath.ladderAllocate` exactly, including
 * its two-pass shape and its success condition: allocation succeeds iff `sum(caps) >= totalStake`,
 * and on success `sum(stakes) === totalStake` with `stakes[i] <= caps[i]` for every `i`.
 *
 * @param caps Remaining fillable size per quote, in rank order (best price first).
 * @param weightsBps Ladder weights in rank order, e.g. `[5000n, 3000n, 2000n]`.
 */
export function ladderAllocate(totalStake: bigint, caps: bigint[], weightsBps: bigint[]): bigint[] {
  const n = caps.length;
  if (n !== weightsBps.length) {
    throw new Error(`caps/weightsBps length mismatch: ${n} vs ${weightsBps.length}`);
  }
  if (n === 0) throw new Error("empty ladder");

  const stakes = new Array<bigint>(n).fill(0n);
  let remaining = totalStake;

  // Pass 1: the ladder's intended shape.
  for (let i = 0; i < n; i++) {
    let target = (totalStake * weightsBps[i]!) / ODDS_MATH_BPS;
    if (target > remaining) target = remaining;
    const cap = caps[i]!;
    const take = target < cap ? target : cap;
    stakes[i] = take;
    remaining -= take;
  }

  // Pass 2: sweep the remainder into spare capacity, best price first.
  for (let i = 0; i < n && remaining > 0n; i++) {
    const spare = caps[i]! - stakes[i]!;
    if (spare === 0n) continue;
    const take = spare < remaining ? spare : remaining;
    stakes[i] = stakes[i]! + take;
    remaining -= take;
  }

  if (remaining !== 0n) throw new LadderUnfilledError(remaining);
  return stakes;
}
