// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { OddsMath } from "../src/libraries/OddsMath.sol";
import { OddsMathHarness } from "./harness/OddsMathHarness.sol";
import { Test } from "forge-std/Test.sol";

contract OddsMathTest is Test {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant AUSD = 1e6; // AUSD has 6 decimals

    OddsMathHarness internal h;

    function setUp() public {
        h = new OddsMathHarness();
    }

    // ------------------------------------------------------------------
    // Worked example
    //
    // Locks in the exact numbers from the design notes so they can never
    // drift from the implementation. A SHOT_ON_TARGET_NEXT_2 market where
    // the true probability is 45.00% and three agents each quote a 300bps
    // overround; a fan stakes 30 AUSD on YES, split 50/30/20.
    // ------------------------------------------------------------------

    function test_workedExample_matchesDocumentedNumbers() public pure {
        uint256[3] memory stakes = [uint256(15 * AUSD), 9 * AUSD, 6 * AUSD];
        uint256[3] memory probs = [uint256(4635), 4680, 4700];
        uint256[3] memory expectedPayouts = [uint256(32_362_459), 19_230_769, 12_765_957];
        uint256[3] memory expectedLiabs = [uint256(17_362_459), 10_230_769, 6_765_957];

        uint256 totalPayout;
        uint256 totalLiability;

        for (uint256 i = 0; i < 3; ++i) {
            uint256 payout = OddsMath.payoutFor(stakes[i], probs[i]);
            uint256 liability = OddsMath.liabilityFor(stakes[i], probs[i]);

            assertEq(payout, expectedPayouts[i], "payout drifted from documented value");
            assertEq(liability, expectedLiabs[i], "liability drifted from documented value");
            assertEq(payout - stakes[i], liability, "liability must be payout minus stake");

            totalPayout += payout;
            totalLiability += liability;
        }

        // 64.359185 AUSD gross on a 30 AUSD stake => blended decimal odds 2.1453x
        assertEq(totalPayout, 64_359_185, "blended payout");
        assertEq(totalLiability, 34_359_185, "total liability across the three vaults");
        assertEq(totalPayout - 30 * AUSD, totalLiability, "stake + liability must reconcile");
    }

    function test_workedExample_ladderSplitsFiftyThirtyTwenty() public pure {
        uint256[] memory caps = _caps(25 * AUSD, 25 * AUSD, 25 * AUSD);
        uint256[] memory stakes = OddsMath.ladderAllocate(30 * AUSD, caps, _ladder());

        assertEq(stakes[0], 15 * AUSD, "rank 0 takes 50%");
        assertEq(stakes[1], 9 * AUSD, "rank 1 takes 30%");
        assertEq(stakes[2], 6 * AUSD, "rank 2 takes 20%");
    }

    function test_holdBps_balancedBook() public pure {
        // A 300bps overround on a 10_300 book is a 291bps hold on balanced flow.
        assertEq(OddsMath.overround(4635, 5665), 300);
        assertEq(OddsMath.holdBps(4635, 5665), 291);
    }

    // ------------------------------------------------------------------
    // payoutFor / liabilityFor
    // ------------------------------------------------------------------

    function test_payoutFor_evenMoneyDoublesStake() public pure {
        assertEq(OddsMath.payoutFor(100 * AUSD, 5000), 200 * AUSD);
    }

    function test_payoutFor_certaintyReturnsStakeAndNoLiability() public pure {
        assertEq(OddsMath.payoutFor(100 * AUSD, BPS), 100 * AUSD);
        assertEq(OddsMath.liabilityFor(100 * AUSD, BPS), 0);
    }

    function test_payoutFor_revertsOnZeroProbability() public {
        vm.expectRevert(abi.encodeWithSelector(OddsMath.ProbOutOfRange.selector, uint256(0)));
        h.payoutFor(1 * AUSD, 0);
    }

    function test_payoutFor_revertsAboveOneHundredPercent() public {
        vm.expectRevert(abi.encodeWithSelector(OddsMath.ProbOutOfRange.selector, uint256(BPS + 1)));
        h.payoutFor(1 * AUSD, BPS + 1);
    }

    /// @dev The core solvency property. Flooring must never produce a payout below the stake,
    ///      or `liabilityFor` would underflow and a vault could book negative risk.
    function testFuzz_payoutNeverBelowStake(uint128 stake, uint16 probBps) public pure {
        probBps = uint16(bound(probBps, 1, BPS));
        uint256 payout = OddsMath.payoutFor(stake, probBps);
        assertGe(payout, stake, "payout must cover the stake");
    }

    function testFuzz_liabilityPlusStakeEqualsPayout(uint128 stake, uint16 probBps) public pure {
        probBps = uint16(bound(probBps, 1, BPS));
        assertEq(
            OddsMath.liabilityFor(stake, probBps) + stake,
            OddsMath.payoutFor(stake, probBps),
            "liability and stake must reconstruct the payout exactly"
        );
    }

    /// @dev Flooring must always round in the agent's favour, never the fan's.
    function testFuzz_payoutRoundsTowardTheAgent(uint128 stake, uint16 probBps) public pure {
        probBps = uint16(bound(probBps, 1, BPS));
        uint256 payout = OddsMath.payoutFor(stake, probBps);
        assertLe(payout * probBps, uint256(stake) * BPS, "payout must never exceed the exact quotient");
    }

    /// @dev Better price (lower probBps) must never pay less.
    function testFuzz_payoutMonotonicInPrice(uint128 stake, uint16 a, uint16 b) public pure {
        uint256 lo = bound(a, 1, BPS);
        uint256 hi = bound(b, 1, BPS);
        if (lo > hi) (lo, hi) = (hi, lo);
        assertGe(OddsMath.payoutFor(stake, lo), OddsMath.payoutFor(stake, hi), "lower prob pays more");
    }

    // ------------------------------------------------------------------
    // validateQuote
    // ------------------------------------------------------------------

    function test_validateQuote_acceptsExactlyMinimumMargin() public pure {
        OddsMath.validateQuote(4600, 5600, 200, 9800, 200); // sums to 10_200
    }

    function test_validateQuote_rejectsMarginOneBpShort() public {
        vm.expectRevert(
            abi.encodeWithSelector(OddsMath.MarginTooLow.selector, uint256(10_199), uint256(10_200))
        );
        h.validateQuote(4599, 5600, 200, 9800, 200);
    }

    function test_validateQuote_rejectsSideBelowFloor() public {
        vm.expectRevert(abi.encodeWithSelector(OddsMath.ProbOutOfRange.selector, uint256(199)));
        h.validateQuote(199, 9900, 200, 9800, 200);
    }

    function test_validateQuote_rejectsSideAboveCeiling() public {
        vm.expectRevert(abi.encodeWithSelector(OddsMath.ProbOutOfRange.selector, uint256(9801)));
        h.validateQuote(9801, 900, 200, 9800, 200);
    }

    function testFuzz_validateQuote_acceptedImpliesEnoughMargin(uint16 yes, uint16 no) public pure {
        uint256 y = bound(yes, 200, 9800);
        uint256 n = bound(no, 200, 9800);
        if (y + n < BPS + 200) return; // only assert on quotes that should pass
        OddsMath.validateQuote(y, n, 200, 9800, 200);
        assertGe(OddsMath.overround(y, n), 200, "accepted quote must carry the minimum overround");
    }

    // ------------------------------------------------------------------
    // ladderAllocate
    // ------------------------------------------------------------------

    function test_ladder_sweepsShortfallIntoTheBestRemainingPrice() public pure {
        // Rank 0 wants 15 but can only take 4. The 11 it could not absorb must go to rank 1,
        // which is the better of the two remaining prices, not to the worst rank.
        uint256[] memory caps = _caps(4 * AUSD, 25 * AUSD, 25 * AUSD);
        uint256[] memory stakes = OddsMath.ladderAllocate(30 * AUSD, caps, _ladder());

        assertEq(stakes[0], 4 * AUSD, "capped at its remaining size");
        assertEq(stakes[1], 20 * AUSD, "its 30% plus the swept remainder");
        assertEq(stakes[2], 6 * AUSD, "worst price keeps only its ladder share");
        assertEq(stakes[0] + stakes[1] + stakes[2], 30 * AUSD, "whole stake placed");
    }

    function test_ladder_fillsExactlyWhenCapacityEqualsStake() public pure {
        uint256[] memory caps = _caps(4 * AUSD, 1 * AUSD, 25 * AUSD);
        uint256[] memory stakes = OddsMath.ladderAllocate(30 * AUSD, caps, _ladder());

        assertEq(stakes[0], 4 * AUSD);
        assertEq(stakes[1], 1 * AUSD);
        assertEq(stakes[2], 25 * AUSD);
    }

    /// @dev Integer division of the weights leaves dust. It must land on the best price with
    ///      room for it, not be dropped and not be dumped on the worst rank.
    function test_ladder_sweepsRoundingDustToTheBestPrice() public pure {
        uint256[] memory caps = _caps(100, 100, 100);
        // targets are 3 / 2 / 1, summing to 6, so one unit of dust remains
        uint256[] memory stakes = OddsMath.ladderAllocate(7, caps, _ladder());

        assertEq(stakes[0], 4, "dust swept to rank 0");
        assertEq(stakes[1], 2);
        assertEq(stakes[2], 1);
        assertEq(stakes[0] + stakes[1] + stakes[2], 7);
    }

    function test_ladder_revertsWhenCapacityIsInsufficient() public {
        uint256[] memory caps = _caps(1 * AUSD, 1 * AUSD, 1 * AUSD);
        vm.expectRevert(abi.encodeWithSelector(OddsMath.LadderUnfilled.selector, uint256(27 * AUSD)));
        h.ladderAllocate(30 * AUSD, caps, _ladder());
    }

    function test_ladder_singleFillTakesEverything() public pure {
        uint256[] memory caps = new uint256[](1);
        caps[0] = 50 * AUSD;
        uint16[] memory w = new uint16[](1);
        w[0] = uint16(BPS);

        uint256[] memory stakes = OddsMath.ladderAllocate(30 * AUSD, caps, w);
        assertEq(stakes[0], 30 * AUSD);
    }

    function test_ladder_revertsOnEmpty() public {
        vm.expectRevert(OddsMath.EmptyLadder.selector);
        h.ladderAllocate(1, new uint256[](0), new uint16[](0));
    }

    function test_ladder_revertsOnLengthMismatch() public {
        vm.expectRevert(abi.encodeWithSelector(OddsMath.LengthMismatch.selector, uint256(2), uint256(3)));
        h.ladderAllocate(1, new uint256[](2), _ladder());
    }

    /// @dev The post-condition `BetRouter` depends on: a successful allocation places the entire
    ///      stake and never exceeds any single quote's remaining capacity.
    function testFuzz_ladderPlacesWholeStakeWithinCaps(
        uint96 totalStake,
        uint96 cap0,
        uint96 cap1,
        uint96 cap2
    ) public view {
        uint256 total = bound(totalStake, 1, 1e18);
        uint256[] memory caps = _caps(cap0, cap1, cap2);
        vm.assume(caps[0] + caps[1] + caps[2] >= total);

        uint256[] memory stakes = h.ladderAllocate(total, caps, _ladder());

        uint256 sum;
        for (uint256 i = 0; i < 3; ++i) {
            assertLe(stakes[i], caps[i], "no fill may exceed its quote's remaining size");
            sum += stakes[i];
        }
        assertEq(sum, total, "the whole stake must be placed");
    }

    /// @dev The mirror property: if total capacity is short, allocation must fail loudly rather
    ///      than quietly placing a smaller bet than the fan asked for.
    /// @dev Capacity is constructed to be short rather than filtered for, so the fuzzer spends
    ///      every run on the case under test instead of rejecting inputs.
    function testFuzz_ladderRevertsWhenCapacityIsShort(
        uint96 totalStake,
        uint96 splitA,
        uint96 splitB,
        uint96 splitC
    ) public {
        uint256 total = bound(totalStake, 1, 1e18);

        // Any capacity strictly below `total`, partitioned arbitrarily across the three ranks.
        uint256 capacity = bound(uint256(splitA), 0, total - 1);
        uint256 c0 = bound(uint256(splitB), 0, capacity);
        uint256 c1 = bound(uint256(splitC), 0, capacity - c0);
        uint256 c2 = capacity - c0 - c1;

        uint256[] memory caps = _caps(c0, c1, c2);

        vm.expectRevert(abi.encodeWithSelector(OddsMath.LadderUnfilled.selector, total - capacity));
        h.ladderAllocate(total, caps, _ladder());
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _ladder() internal pure returns (uint16[] memory w) {
        w = new uint16[](3);
        w[0] = 5000;
        w[1] = 3000;
        w[2] = 2000;
    }

    function _caps(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory caps) {
        caps = new uint256[](3);
        caps[0] = a;
        caps[1] = b;
        caps[2] = c;
    }
}
