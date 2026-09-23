// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title OddsMath
/// @notice Pure pricing arithmetic for Ninety's micro-markets.
/// @dev All probabilities are basis points of implied probability (`probBps`), so decimal odds are
///      `BPS / probBps`. All amounts are AUSD base units, which have **6 decimals** — every division
///      here floors, and flooring the payout is always in the agent's favour, never the fan's.
///      Keeping the rounding direction one-sided is what lets the vault's solvency invariant hold:
///      the liability booked at bet time is always >= the amount actually paid out at settlement.
library OddsMath {
    /// @notice Basis-point denominator. A `probBps` of 10_000 means 100% implied probability.
    uint256 internal constant BPS = 10_000;

    /// @notice `probBps` was zero or above 100%, so it does not describe a real probability.
    error ProbOutOfRange(uint256 probBps);
    /// @notice The two sides of a quote did not carry enough overround.
    error MarginTooLow(uint256 sum, uint256 required);
    /// @notice The ladder could not place the whole stake within the given capacities.
    error LadderUnfilled(uint256 remaining);
    /// @notice Caps and weights must describe the same number of fills.
    error LengthMismatch(uint256 caps, uint256 weights);
    /// @notice A ladder with no fills cannot place a stake.
    error EmptyLadder();

    /// @notice Gross amount a winning bet returns, including the original stake.
    /// @dev Floors. `payout >= stake` for every `probBps <= BPS`, which `liabilityFor` relies on.
    function payoutFor(uint256 stake, uint256 probBps) internal pure returns (uint256) {
        if (probBps == 0 || probBps > BPS) revert ProbOutOfRange(probBps);
        return (stake * BPS) / probBps;
    }

    /// @notice The amount an agent's vault must reserve to honour a bet: payout minus the stake.
    /// @dev Cannot underflow: `payoutFor` floors but `probBps <= BPS` guarantees `payout >= stake`.
    function liabilityFor(uint256 stake, uint256 probBps) internal pure returns (uint256) {
        return payoutFor(stake, probBps) - stake;
    }

    /// @notice Largest stake at `probBps` whose liability stays inside `liabilityBudget`.
    /// @dev Inverts `liabilityFor`. Since
    ///          liability(s) = floor(s * BPS / p) - s  <=  s * (BPS - p) / p,
    ///      the bound `s <= budget * p / (BPS - p)` is conservative: flooring can only make the
    ///      realised liability smaller. At `probBps == BPS` the liability is always zero, so no
    ///      budget can bind and the answer is unbounded.
    ///
    ///      `BetRouter` uses this to size a fill against an agent's free capital, so that a bet
    ///      routes around a stretched vault instead of reverting on it.
    function maxStakeForLiability(uint256 liabilityBudget, uint256 probBps) internal pure returns (uint256) {
        if (probBps == 0 || probBps > BPS) revert ProbOutOfRange(probBps);
        if (probBps == BPS) return type(uint256).max;
        return Math.mulDiv(liabilityBudget, probBps, BPS - probBps);
    }

    /// @notice Decimal odds scaled by 1e18, for display only. Never used in settlement arithmetic.
    function decimalOddsWad(
        uint256 probBps
    ) internal pure returns (uint256) {
        if (probBps == 0 || probBps > BPS) revert ProbOutOfRange(probBps);
        return (BPS * 1e18) / probBps;
    }

    /// @notice How far the two sides of a quote sum above 100%, in basis points.
    function overround(uint256 probYesBps, uint256 probNoBps) internal pure returns (uint256) {
        uint256 sum = probYesBps + probNoBps;
        return sum > BPS ? sum - BPS : 0;
    }

    /// @notice The agent's theoretical hold on balanced two-way flow, in basis points.
    /// @dev `overround / (probYes + probNo)`. On one-sided flow the realised edge differs; this is
    ///      the balanced-book figure quoted in the docs, not a promise about any single bet.
    function holdBps(uint256 probYesBps, uint256 probNoBps) internal pure returns (uint256) {
        uint256 sum = probYesBps + probNoBps;
        if (sum == 0) return 0;
        return (overround(probYesBps, probNoBps) * BPS) / sum;
    }

    /// @notice Reverts unless a quote is a usable two-sided price with enough margin.
    /// @param minProbBps Floor on either side, so no agent can quote an absurd longshot price.
    /// @param maxProbBps Ceiling on either side.
    /// @param minMarginBps Minimum overround. This is what stops a race to zero margin.
    function validateQuote(
        uint256 probYesBps,
        uint256 probNoBps,
        uint256 minProbBps,
        uint256 maxProbBps,
        uint256 minMarginBps
    ) internal pure {
        if (probYesBps < minProbBps || probYesBps > maxProbBps) revert ProbOutOfRange(probYesBps);
        if (probNoBps < minProbBps || probNoBps > maxProbBps) revert ProbOutOfRange(probNoBps);
        uint256 sum = probYesBps + probNoBps;
        uint256 required = BPS + minMarginBps;
        if (sum < required) revert MarginTooLow(sum, required);
    }

    /// @notice Splits a stake across ranked quotes using a fixed weight ladder, then sweeps any
    ///         remainder into whatever capacity is left, best price first.
    /// @dev Two passes:
    ///      1. Each rank takes `totalStake * weightsBps[i] / BPS`, clamped to its remaining capacity.
    ///      2. Anything still unplaced — because a rank was capped, or because integer division of
    ///         the weights left dust — is swept across the ranks in order, so the leftover lands on
    ///         the best price that can still absorb it.
    ///
    ///      A single-pass ladder that only rolled shortfalls into the final rank would revert on
    ///      bets that were perfectly fillable, whenever a middle rank still had room. The two-pass
    ///      form gives an exact success condition that `BetRouter` can rely on:
    ///      **allocation succeeds if and only if `sum(caps) >= totalStake`**, and on success
    ///      `sum(stakes) == totalStake` with `stakes[i] <= caps[i]` for every `i`.
    /// @param caps Remaining fillable size per quote, in rank order (best price first).
    /// @param weightsBps Ladder weights in rank order, e.g. [5000, 3000, 2000].
    function ladderAllocate(
        uint256 totalStake,
        uint256[] memory caps,
        uint16[] memory weightsBps
    ) internal pure returns (uint256[] memory stakes) {
        uint256 n = caps.length;
        if (n != weightsBps.length) revert LengthMismatch(n, weightsBps.length);
        if (n == 0) revert EmptyLadder();

        stakes = new uint256[](n);
        uint256 remaining = totalStake;

        // Pass 1: the ladder's intended shape.
        for (uint256 i = 0; i < n; ++i) {
            uint256 target = (totalStake * weightsBps[i]) / BPS;
            if (target > remaining) target = remaining;

            uint256 cap = caps[i];
            uint256 take = target < cap ? target : cap;

            stakes[i] = take;
            remaining -= take;
        }

        // Pass 2: sweep the remainder into spare capacity, best price first.
        for (uint256 i = 0; i < n && remaining > 0; ++i) {
            uint256 spare = caps[i] - stakes[i];
            if (spare == 0) continue;

            uint256 take = spare < remaining ? spare : remaining;
            stakes[i] += take;
            remaining -= take;
        }

        if (remaining != 0) revert LadderUnfilled(remaining);
    }
}
