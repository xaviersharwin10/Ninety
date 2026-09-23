// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { Test } from "forge-std/Test.sol";

import { AgentRegistry } from "../src/AgentRegistry.sol";
import { AgentVault } from "../src/AgentVault.sol";
import { MockUSD } from "./mocks/MockUSD.sol";

contract AgentVaultTest is Test {
    uint256 internal constant AUSD = 1e6;
    uint16 internal constant FEE_BPS = 2000; // 20% performance fee
    uint16 internal constant MAX_MARKET_BPS = 3000; // 30% of the vault per market

    MockUSD internal usd;
    AgentRegistry internal registry;
    AgentVault internal vault;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal router = makeAddr("router");
    address internal bettor = makeAddr("bettor");

    function setUp() public {
        usd = new MockUSD();
        // Cooldown 0 here: this suite is about liability/settlement/fee accounting, not the
        // withdrawal-cooldown mechanism, which has its own dedicated suite in
        // AgentVaultCooldown.t.sol. A nonzero cooldown would force every withdraw-adjacent test
        // below to warp time for a property they aren't testing.
        registry = new AgentRegistry(IERC20(address(usd)), owner, FEE_BPS, MAX_MARKET_BPS, 0);

        vm.prank(owner);
        registry.setBetRouter(router);

        vm.prank(operator);
        (, address v) = registry.register(makeAddr("signer"), hex"01020304", "ipfs://agent");
        vault = AgentVault(v);

        usd.mint(alice, 10_000 * AUSD);
        usd.mint(bob, 10_000 * AUSD);
        usd.mint(router, 10_000 * AUSD);
    }

    function _deposit(address who, uint256 assets) internal returns (uint256 shares) {
        vm.startPrank(who);
        usd.approve(address(vault), assets);
        shares = vault.deposit(assets, who);
        vm.stopPrank();
    }

    /// @dev Locks `total` spread across as many markets as the per-market cap requires, so a
    ///      test about withdrawal limits isn't accidentally a test about the exposure cap.
    function _lockAcrossMarkets(
        uint256 total
    ) internal {
        uint256 cap = (vault.totalAssets() * MAX_MARKET_BPS) / 10_000;
        uint256 remaining = total;
        uint256 marketId = 1;
        vm.startPrank(router);
        while (remaining > 0) {
            uint256 take = remaining < cap ? remaining : cap;
            vault.lockLiability(marketId, marketId, take);
            remaining -= take;
            ++marketId;
        }
        vm.stopPrank();
    }

    /// @dev Simulates the agent winning a bet: the router forwards the forfeited stake, then
    ///      tells the vault to release the reservation.
    function _agentWins(uint256 marketId, uint256 betId, uint256 liability, uint256 stake) internal {
        vm.prank(router);
        usd.transfer(address(vault), stake);
        vm.prank(router);
        vault.settleAgentWon(marketId, betId, liability, stake);
    }

    // ------------------------------------------------------------------
    // Deposits and share accounting
    // ------------------------------------------------------------------

    function test_deposit_mintsSharesAndCountsAsFreeCapital() public {
        uint256 shares = _deposit(alice, 1000 * AUSD);

        assertGt(shares, 0, "shares minted");
        assertEq(vault.totalAssets(), 1000 * AUSD);
        assertEq(vault.lockedLiability(), 0);
        assertEq(vault.freeCapital(), 1000 * AUSD, "nothing locked yet");
    }

    function test_decimalsOffset_raisesInflationAttackCost() public view {
        // 6-decimal asset + 6-decimal offset => 12-decimal shares.
        assertEq(vault.decimals(), 12, "shares carry the offset");
    }

    /// @dev The classic first-depositor grief: deposit 1 wei, donate a large balance, and hope
    ///      the next depositor's shares round to zero. The offset must make that fail.
    function test_inflationAttack_secondDepositorStillGetsShares() public {
        vm.startPrank(alice);
        usd.approve(address(vault), type(uint256).max);
        vault.deposit(1, alice);
        vm.stopPrank();

        // Attacker donates directly to the vault to inflate the share price.
        vm.prank(alice);
        usd.transfer(address(vault), 1000 * AUSD);

        uint256 bobShares = _deposit(bob, 100 * AUSD);
        assertGt(bobShares, 0, "second depositor must not be rounded to zero");

        uint256 bobAssets = vault.previewRedeem(bobShares);
        assertGt(bobAssets, 99 * AUSD, "second depositor keeps essentially all their value");
    }

    // ------------------------------------------------------------------
    // Liability locking
    // ------------------------------------------------------------------

    function test_lockLiability_reducesFreeCapitalButNotTotalAssets() public {
        _deposit(alice, 1000 * AUSD);

        vm.prank(router);
        vault.lockLiability(1, 1, 100 * AUSD);

        assertEq(vault.totalAssets(), 1000 * AUSD, "assets do not move when a bet is placed");
        assertEq(vault.lockedLiability(), 100 * AUSD);
        assertEq(vault.freeCapital(), 900 * AUSD);
        assertEq(vault.marketExposure(1), 100 * AUSD);
    }

    function test_lockLiability_revertsBeyondFreeCapital() public {
        _deposit(alice, 100 * AUSD);

        vm.prank(router);
        vm.expectRevert(
            abi.encodeWithSelector(AgentVault.InsufficientFreeCapital.selector, 101 * AUSD, 100 * AUSD)
        );
        vault.lockLiability(1, 1, 101 * AUSD);
    }

    function test_lockLiability_enforcesPerMarketExposureCap() public {
        _deposit(alice, 1000 * AUSD);

        // Cap is 30% of 1000 = 300.
        vm.prank(router);
        vault.lockLiability(1, 1, 300 * AUSD);

        vm.prank(router);
        vm.expectRevert(
            abi.encodeWithSelector(AgentVault.MarketExposureExceeded.selector, 301 * AUSD, 300 * AUSD)
        );
        vault.lockLiability(1, 2, 1 * AUSD);
    }

    function test_lockLiability_capIsPerMarketNotGlobal() public {
        _deposit(alice, 1000 * AUSD);

        vm.startPrank(router);
        vault.lockLiability(1, 1, 300 * AUSD);
        vault.lockLiability(2, 2, 300 * AUSD); // different market, its own cap
        vm.stopPrank();

        assertEq(vault.lockedLiability(), 600 * AUSD);
    }

    function test_lockLiability_onlyRouter() public {
        _deposit(alice, 1000 * AUSD);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.OnlyRouter.selector, alice, router));
        vault.lockLiability(1, 1, 1 * AUSD);
    }

    // ------------------------------------------------------------------
    // Withdrawals are bounded by free capital
    // ------------------------------------------------------------------

    function test_maxWithdraw_isCappedByLockedLiability() public {
        _deposit(alice, 1000 * AUSD);

        _lockAcrossMarkets(400 * AUSD);

        assertEq(vault.maxWithdraw(alice), 600 * AUSD, "cannot withdraw collateral behind a bet");
    }

    function test_withdraw_revertsAboveFreeCapital() public {
        _deposit(alice, 1000 * AUSD);

        _lockAcrossMarkets(400 * AUSD);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxWithdraw.selector, alice, 601 * AUSD, 600 * AUSD)
        );
        vault.withdraw(601 * AUSD, alice, alice);
    }

    function test_withdraw_allowedUpToFreeCapital() public {
        _deposit(alice, 1000 * AUSD);

        _lockAcrossMarkets(400 * AUSD);

        vm.prank(alice);
        vault.withdraw(600 * AUSD, alice, alice);

        assertEq(usd.balanceOf(alice), 10_000 * AUSD - 400 * AUSD);
        assertEq(vault.totalAssets(), 400 * AUSD, "exactly the locked liability remains");
    }

    function test_maxRedeem_isCappedByFreeCapital() public {
        _deposit(alice, 1000 * AUSD);

        _lockAcrossMarkets(1000 * AUSD);

        assertEq(vault.maxRedeem(alice), 0, "fully committed vault allows no exit");
    }

    // ------------------------------------------------------------------
    // Settlement
    // ------------------------------------------------------------------

    function test_settleAgentWon_creditsStakeAndReleasesLock() public {
        _deposit(alice, 1000 * AUSD);

        vm.prank(router);
        vault.lockLiability(1, 1, 100 * AUSD);

        _agentWins(1, 1, 100 * AUSD, 50 * AUSD);

        assertEq(vault.lockedLiability(), 0);
        assertEq(vault.marketExposure(1), 0);
        assertEq(vault.totalAssets(), 1050 * AUSD, "the fan's stake became vault profit");
        assertEq(vault.freeCapital(), 1050 * AUSD);
    }

    function test_settleAgentLost_paysOutAndReleasesLock() public {
        _deposit(alice, 1000 * AUSD);

        vm.prank(router);
        vault.lockLiability(1, 1, 100 * AUSD);

        vm.prank(router);
        vault.settleAgentLost(1, 1, 100 * AUSD, bettor);

        assertEq(vault.lockedLiability(), 0);
        assertEq(vault.totalAssets(), 900 * AUSD, "the loss came out of the vault");
        assertEq(usd.balanceOf(bettor), 100 * AUSD, "winner was paid");
    }

    function test_releaseVoided_leavesAssetsUntouched() public {
        _deposit(alice, 1000 * AUSD);

        vm.prank(router);
        vault.lockLiability(1, 1, 100 * AUSD);

        vm.prank(router);
        vault.releaseVoided(1, 1, 100 * AUSD);

        assertEq(vault.lockedLiability(), 0);
        assertEq(vault.marketExposure(1), 0);
        assertEq(vault.totalAssets(), 1000 * AUSD, "a void is a no-op for the vault's balance");
    }

    function test_settle_onlyRouter() public {
        _deposit(alice, 1000 * AUSD);
        vm.prank(router);
        vault.lockLiability(1, 1, 100 * AUSD);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.OnlyRouter.selector, operator, router));
        vault.settleAgentLost(1, 1, 100 * AUSD, operator);
    }

    /// @dev Releasing more than was locked means the router is broken. It must revert, not clamp.
    function test_release_revertsWhenReleasingMoreThanLocked() public {
        _deposit(alice, 1000 * AUSD);

        vm.prank(router);
        vault.lockLiability(1, 1, 100 * AUSD);

        vm.prank(router);
        vm.expectRevert();
        vault.releaseVoided(1, 1, 101 * AUSD);
    }

    // ------------------------------------------------------------------
    // Performance fee
    // ------------------------------------------------------------------

    function test_harvest_noFeeWithoutProfit() public {
        _deposit(alice, 1000 * AUSD);
        assertEq(vault.harvest(), 0, "no profit, no fee");
        assertEq(vault.balanceOf(operator), 0);
    }

    function test_harvest_chargesTwentyPercentOfGain() public {
        _deposit(alice, 1000 * AUSD);

        // Agent wins 100 AUSD.
        vm.prank(router);
        vault.lockLiability(1, 1, 200 * AUSD);
        _agentWins(1, 1, 200 * AUSD, 100 * AUSD);

        vault.harvest();

        uint256 operatorAssets = vault.previewRedeem(vault.balanceOf(operator));
        // Two floored conversions (assets->shares, then shares->assets) cost a few base units.
        // They must be lost in the vault's favour, never the operator's.
        assertLe(operatorAssets, 20 * AUSD, "fee must never round up in the operator's favour");
        assertApproxEqAbs(operatorAssets, 20 * AUSD, 10, "20% of the 100 AUSD gain");

        uint256 aliceAssets = vault.previewRedeem(vault.balanceOf(alice));
        assertApproxEqAbs(aliceAssets, 1080 * AUSD, 10, "backer keeps the other 80%");
    }

    /// @dev The whole point of a high-water mark: a gain already charged must never be charged
    ///      again, and a loss must be recovered before fees resume.
    function test_harvest_highWaterMarkBlocksDoubleCharging() public {
        _deposit(alice, 1000 * AUSD);

        vm.prank(router);
        vault.lockLiability(1, 1, 200 * AUSD);
        _agentWins(1, 1, 200 * AUSD, 100 * AUSD);

        vault.harvest();
        uint256 sharesAfterFirst = vault.balanceOf(operator);
        assertGt(sharesAfterFirst, 0);

        // Harvesting again with no new profit must pay nothing.
        assertEq(vault.harvest(), 0, "same gain cannot be charged twice");
        assertEq(vault.balanceOf(operator), sharesAfterFirst);
    }

    function test_harvest_lossMustBeRecoveredBeforeFeesResume() public {
        _deposit(alice, 1000 * AUSD);

        // Gain 100, harvest.
        vm.prank(router);
        vault.lockLiability(1, 1, 200 * AUSD);
        _agentWins(1, 1, 200 * AUSD, 100 * AUSD);
        vault.harvest();
        uint256 sharesAfterGain = vault.balanceOf(operator);

        // Then lose 80.
        vm.prank(router);
        vault.lockLiability(2, 2, 80 * AUSD);
        vm.prank(router);
        vault.settleAgentLost(2, 2, 80 * AUSD, bettor);

        assertEq(vault.harvest(), 0, "under water: no fee");
        assertEq(vault.balanceOf(operator), sharesAfterGain, "no new shares while under water");

        // Recover only part of the loss: still under the previous peak.
        vm.prank(router);
        vault.lockLiability(3, 3, 100 * AUSD);
        _agentWins(3, 3, 100 * AUSD, 40 * AUSD);
        assertEq(vault.harvest(), 0, "partial recovery is still below the high-water mark");

        // Exceed the old peak: fees resume, charged only on the excess.
        vm.prank(router);
        vault.lockLiability(4, 4, 200 * AUSD);
        _agentWins(4, 4, 200 * AUSD, 100 * AUSD);
        assertGt(vault.harvest(), 0, "new high, fee resumes");
    }

    function test_harvest_isPermissionless() public {
        _deposit(alice, 1000 * AUSD);
        vm.prank(router);
        vault.lockLiability(1, 1, 200 * AUSD);
        _agentWins(1, 1, 200 * AUSD, 100 * AUSD);

        vm.prank(bob); // anyone may trigger it; it can only ever pay the operator
        vault.harvest();

        assertGt(vault.balanceOf(operator), 0);
        assertEq(vault.balanceOf(bob), 0, "the caller gets nothing");
    }

    // ------------------------------------------------------------------
    // Solvency invariant
    // ------------------------------------------------------------------

    /// @dev The property everything else exists to protect.
    function testFuzz_totalAssetsAlwaysCoverLockedLiability(
        uint96 depositAmount,
        uint96 lockAmount,
        uint96 stakeAmount,
        bool agentWins
    ) public {
        uint256 dep = bound(depositAmount, 1 * AUSD, 5000 * AUSD);
        _deposit(alice, dep);

        // Never lock more than the per-market cap allows.
        uint256 cap = (dep * MAX_MARKET_BPS) / 10_000;
        if (cap == 0) return;
        uint256 lock = bound(lockAmount, 0, cap);
        if (lock == 0) return;

        vm.prank(router);
        vault.lockLiability(1, 1, lock);
        assertGe(vault.totalAssets(), vault.lockedLiability(), "solvent while locked");

        if (agentWins) {
            uint256 stake = bound(stakeAmount, 0, 1000 * AUSD);
            _agentWins(1, 1, lock, stake);
        } else {
            vm.prank(router);
            vault.settleAgentLost(1, 1, lock, bettor);
        }

        assertGe(vault.totalAssets(), vault.lockedLiability(), "solvent after settlement");
        assertEq(vault.lockedLiability(), 0, "nothing left locked");
    }
}
