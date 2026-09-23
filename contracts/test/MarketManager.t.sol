// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Test } from "forge-std/Test.sol";

import { MarketManager } from "../src/MarketManager.sol";
import { Market, MarketState, Outcome } from "../src/interfaces/IMarketManager.sol";

contract MarketManagerTest is Test {
    MarketManager internal mm;

    address internal admin = makeAddr("admin");
    address internal scheduler = makeAddr("scheduler");
    address internal settler = makeAddr("settler");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant SHOT = keccak256("SHOT_ON_TARGET_NEXT_N");
    bytes32 internal constant UNKNOWN_TEMPLATE = keccak256("NOT_ALLOWED");

    uint64 internal matchId;

    function setUp() public {
        vm.warp(1_700_000_000);
        mm = new MarketManager(admin);

        vm.startPrank(admin);
        mm.grantRole(mm.SCHEDULER_ROLE(), scheduler);
        mm.grantRole(mm.SETTLER_ROLE(), settler);
        mm.setTemplate(SHOT, true);
        vm.stopPrank();

        vm.prank(scheduler);
        matchId = mm.createMatch(keccak256("wyscout:1694390"), uint64(block.timestamp), "ipfs://m");
    }

    function _open() internal returns (uint256 marketId) {
        vm.prank(scheduler);
        return mm.openMarket(matchId, SHOT, 600, 720, uint64(block.timestamp + 120), 0);
    }

    // ------------------------------------------------------------------
    // Opening
    // ------------------------------------------------------------------

    function test_openMarket_startsOpenAndBettable() public {
        uint256 id = _open();
        Market memory m = mm.getMarket(id);

        assertEq(uint8(m.state), uint8(MarketState.Open));
        assertEq(uint8(m.outcome), uint8(Outcome.Unresolved));
        assertEq(m.matchId, matchId);
        assertEq(m.templateId, SHOT);
        assertTrue(mm.isBettable(id));
    }

    /// @dev The platform picks the question menu. Free-form templates would fragment liquidity
    ///      across many markets with a handful of bettors each.
    function test_openMarket_rejectsTemplateNotOnTheAllowlist() public {
        vm.prank(scheduler);
        vm.expectRevert(abi.encodeWithSelector(MarketManager.TemplateNotEnabled.selector, UNKNOWN_TEMPLATE));
        mm.openMarket(matchId, UNKNOWN_TEMPLATE, 600, 720, uint64(block.timestamp + 120), 0);
    }

    function test_openMarket_rejectsUnknownMatch() public {
        vm.prank(scheduler);
        vm.expectRevert(abi.encodeWithSelector(MarketManager.UnknownMatch.selector, uint64(99)));
        mm.openMarket(99, SHOT, 600, 720, uint64(block.timestamp + 120), 0);
    }

    function test_openMarket_rejectsEmptyOrInvertedWindow() public {
        vm.startPrank(scheduler);
        vm.expectRevert(abi.encodeWithSelector(MarketManager.InvalidWindow.selector, 720, 720));
        mm.openMarket(matchId, SHOT, 720, 720, uint64(block.timestamp + 120), 0);

        vm.expectRevert(abi.encodeWithSelector(MarketManager.InvalidWindow.selector, 720, 600));
        mm.openMarket(matchId, SHOT, 720, 600, uint64(block.timestamp + 120), 0);
        vm.stopPrank();
    }

    function test_openMarket_rejectsCloseTimeInThePast() public {
        vm.prank(scheduler);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarketManager.CloseTimeInPast.selector, uint64(block.timestamp), uint64(block.timestamp)
            )
        );
        mm.openMarket(matchId, SHOT, 600, 720, uint64(block.timestamp), 0);
    }

    function test_openMarket_onlyScheduler() public {
        vm.prank(stranger);
        vm.expectRevert();
        mm.openMarket(matchId, SHOT, 600, 720, uint64(block.timestamp + 120), 0);
    }

    // ------------------------------------------------------------------
    // Betting window
    // ------------------------------------------------------------------

    function test_isBettable_falseOnceCloseTimePasses() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 120);
        assertFalse(mm.isBettable(id), "closesAt is exclusive");
    }

    function test_isBettable_falseWhileSuspended() public {
        uint256 id = _open();
        vm.prank(scheduler);
        mm.suspend(id, "VAR");
        assertFalse(mm.isBettable(id));

        vm.prank(scheduler);
        mm.resume(id);
        assertTrue(mm.isBettable(id));
    }

    function test_suspend_onlyFromOpen() public {
        uint256 id = _open();
        vm.startPrank(scheduler);
        mm.suspend(id, "VAR");
        vm.expectRevert(abi.encodeWithSelector(MarketManager.WrongState.selector, id, MarketState.Suspended));
        mm.suspend(id, "VAR");
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Closing
    // ------------------------------------------------------------------

    /// @dev A market must never be strandable by an offline scheduler.
    function test_close_isPermissionlessAfterCloseTime() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 120);

        vm.prank(stranger);
        mm.close(id);

        assertEq(uint8(mm.getMarket(id).state), uint8(MarketState.Closed));
    }

    function test_close_earlyOnlyByScheduler() public {
        uint256 id = _open();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarketManager.StillOpenForBetting.selector, id, uint64(block.timestamp + 120)
            )
        );
        mm.close(id);

        vm.prank(scheduler);
        mm.close(id);
        assertEq(uint8(mm.getMarket(id).state), uint8(MarketState.Closed));
    }

    // ------------------------------------------------------------------
    // Resolution
    // ------------------------------------------------------------------

    function test_resolve_recordsOutcomeAndEventTimestamp() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 120);

        uint64 eventTs = uint64(block.timestamp - 30);
        vm.prank(settler);
        mm.resolve(id, Outcome.Yes, eventTs);

        Market memory m = mm.getMarket(id);
        assertEq(uint8(m.state), uint8(MarketState.Resolved));
        assertEq(uint8(m.outcome), uint8(Outcome.Yes));
        assertEq(m.qualifyingEventTs, eventTs);
    }

    /// @dev Settlement must not depend on a separate close transaction having landed first.
    function test_resolve_closesAnOpenMarketOnTheWayThrough() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 120);

        vm.prank(settler);
        mm.resolve(id, Outcome.No, 0);

        assertEq(uint8(mm.getMarket(id).state), uint8(MarketState.Resolved));
    }

    function test_resolve_refusesWhileBettingIsStillOpen() public {
        uint256 id = _open();
        vm.prank(settler);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarketManager.StillOpenForBetting.selector, id, uint64(block.timestamp + 120)
            )
        );
        mm.resolve(id, Outcome.Yes, 0);
    }

    function test_resolve_rejectsNonBinaryOutcomes() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 120);

        vm.startPrank(settler);
        vm.expectRevert(abi.encodeWithSelector(MarketManager.InvalidOutcome.selector, Outcome.Unresolved));
        mm.resolve(id, Outcome.Unresolved, 0);

        vm.expectRevert(abi.encodeWithSelector(MarketManager.InvalidOutcome.selector, Outcome.Void));
        mm.resolve(id, Outcome.Void, 0);
        vm.stopPrank();
    }

    function test_resolve_isNotRepeatable() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 120);

        vm.startPrank(settler);
        mm.resolve(id, Outcome.Yes, 0);
        vm.expectRevert(abi.encodeWithSelector(MarketManager.WrongState.selector, id, MarketState.Resolved));
        mm.resolve(id, Outcome.No, 0);
        vm.stopPrank();
    }

    /// @dev The key that opens markets must not be able to decide how they end.
    function test_resolve_schedulerCannotSettle() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 120);

        vm.prank(scheduler);
        vm.expectRevert();
        mm.resolve(id, Outcome.Yes, 0);
    }

    function test_voidMarket_worksFromOpen() public {
        uint256 id = _open();
        vm.prank(settler);
        mm.voidMarket(id, "DATA_GAP");

        Market memory m = mm.getMarket(id);
        assertEq(uint8(m.state), uint8(MarketState.Voided));
        assertEq(uint8(m.outcome), uint8(Outcome.Void));
    }

    function test_voidMarket_cannotOverrideAResolvedMarket() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 120);

        vm.startPrank(settler);
        mm.resolve(id, Outcome.Yes, 0);
        vm.expectRevert(abi.encodeWithSelector(MarketManager.WrongState.selector, id, MarketState.Resolved));
        mm.voidMarket(id, "TOO_LATE");
        vm.stopPrank();
    }

    function test_getMarket_revertsForUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(MarketManager.UnknownMarket.selector, uint256(42)));
        mm.getMarket(42);
    }
}
