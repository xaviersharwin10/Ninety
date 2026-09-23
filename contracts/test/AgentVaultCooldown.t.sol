// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { Test } from "forge-std/Test.sol";

import { AgentRegistry } from "../src/AgentRegistry.sol";
import { AgentVault } from "../src/AgentVault.sol";
import { MockUSD } from "./mocks/MockUSD.sol";

/// @notice Dedicated suite for `withdrawalCooldownSeconds`, the fix for a real finding from an
///         adversarial review: `totalAssets()` is a plain balance, flat while a bet is pending and
///         only moving at settlement, so a deposit timed to land after the real-world outcome is
///         known but before it is reflected on chain could buy in at a stale price and exit right
///         after capturing the move -- a value transfer from backers who carried the risk for the
///         bet's whole pending life, needing no privileged access, only being faster than
///         settlement. See the doc comment on `IAgentVault.withdrawalCooldownSeconds`.
contract AgentVaultCooldownTest is Test {
    uint256 internal constant AUSD = 1e6;
    uint32 internal constant COOLDOWN = 15 minutes;

    MockUSD internal usd;
    AgentRegistry internal registry;
    AgentVault internal vault;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal backer = makeAddr("backer");
    address internal attacker = makeAddr("attacker");
    address internal router = makeAddr("router");
    address internal bettor = makeAddr("bettor");

    function setUp() public {
        usd = new MockUSD();
        registry = new AgentRegistry(IERC20(address(usd)), owner, 2000, 3000, COOLDOWN);

        vm.prank(owner);
        registry.setBetRouter(router);

        vm.prank(operator);
        (, address v) = registry.register(makeAddr("signer"), hex"01020304", "ipfs://agent");
        vault = AgentVault(v);

        usd.mint(backer, 10_000 * AUSD);
        usd.mint(attacker, 10_000 * AUSD);
        usd.mint(router, 10_000 * AUSD);
    }

    function _deposit(address who, uint256 assets) internal returns (uint256 shares) {
        vm.startPrank(who);
        usd.approve(address(vault), assets);
        shares = vault.deposit(assets, who);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // The exploit, reproduced directly: blocked end to end
    // ------------------------------------------------------------------

    /// @dev The exact scenario the finding described: a bet is placed and sits pending (assets
    ///      flat), an opportunistic depositor buys in right before it settles favourably for the
    ///      vault, the settlement lands (assets jump), and the depositor tries to cash out
    ///      immediately. Before this fix that round trip was risk-free profit. Now it must revert.
    function test_exploitScenario_depositBeforeFavourableSettlementCannotImmediatelyExit() public {
        _deposit(backer, 1000 * AUSD);

        // A bet is placed against this vault and sits pending. totalAssets is unchanged -- this
        // is the flat window the attacker is timing.
        vm.prank(router);
        vault.lockLiability(1, 1, 100 * AUSD);
        uint256 ppsBeforeAttackerJoins = vault.pricePerShare();

        // The attacker deposits into the still-flat price, right before settlement.
        uint256 attackerShares = _deposit(attacker, 500 * AUSD);
        assertEq(vault.pricePerShare(), ppsBeforeAttackerJoins, "price had not moved yet");

        // Settlement lands: the agent won (the fan's stake becomes vault profit), moving assets.
        vm.prank(router);
        usd.transfer(address(vault), 30 * AUSD); // the fan's forfeited stake
        vm.prank(router);
        vault.settleAgentWon(1, 1, 100 * AUSD, 30 * AUSD);
        assertGt(vault.pricePerShare(), ppsBeforeAttackerJoins, "price moved in the attacker's favour");

        // The attacker tries to cash out immediately, capturing that move risk-free.
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxRedeem.selector, attacker, attackerShares, 0)
        );
        vault.redeem(attackerShares, attacker, attacker);
    }

    // ------------------------------------------------------------------
    // Mechanics
    // ------------------------------------------------------------------

    function test_freshDeposit_cannotWithdrawAtAll() public {
        _deposit(backer, 1000 * AUSD);
        assertEq(vault.maxWithdraw(backer), 0);
        assertEq(vault.maxRedeem(backer), 0);
    }

    function test_withdraw_revertsDuringCooldown() public {
        _deposit(backer, 1000 * AUSD);
        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxWithdraw.selector, backer, 1, 0));
        vault.withdraw(1, backer, backer);
    }

    function test_withdraw_succeedsOnceCooldownElapses() public {
        _deposit(backer, 1000 * AUSD);
        vm.warp(block.timestamp + COOLDOWN);

        vm.prank(backer);
        vault.withdraw(1000 * AUSD, backer, backer);
        assertEq(usd.balanceOf(backer), 10_000 * AUSD, "got the full deposit back");
    }

    function test_withdraw_revertsOneSecondBeforeCooldownElapses() public {
        _deposit(backer, 1000 * AUSD);
        vm.warp(block.timestamp + COOLDOWN - 1);

        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxWithdraw.selector, backer, 1, 0));
        vault.withdraw(1, backer, backer);
    }

    /// @dev A top-up resets the whole position's cooldown, not just the incremental amount -- the
    ///      documented, accepted tradeoff for staying simple rather than tracking per-deposit lots.
    function test_topUp_resetsTheWholePositionsCooldown() public {
        _deposit(backer, 500 * AUSD);
        vm.warp(block.timestamp + COOLDOWN);
        assertGt(vault.maxWithdraw(backer), 0, "original deposit unlocked");

        _deposit(backer, 1 * AUSD);
        assertEq(vault.maxWithdraw(backer), 0, "topping up relocks the entire balance");
    }

    /// @dev The cooldown and the free-capital cap are independent constraints; both must be
    ///      satisfied. An old, unlocked position is still bounded by whatever is currently at risk.
    function test_cooldownAndFreeCapitalCap_bothApply() public {
        _deposit(backer, 1000 * AUSD);
        vm.warp(block.timestamp + COOLDOWN);

        vm.prank(router);
        vault.lockLiability(1, 1, 300 * AUSD); // at the 30% max-market-exposure cap of 1000 AUSD

        assertEq(vault.maxWithdraw(backer), 700 * AUSD, "cooldown elapsed, but still capped by risk");
    }

    /// @dev The cooldown gates withdrawal, not deposit -- an attacker (or a genuine backer) can
    ///      always add capital; they just cannot immediately remove it again.
    function test_cooldown_doesNotBlockDepositing() public {
        uint256 shares = _deposit(backer, 1000 * AUSD);
        assertGt(shares, 0);
        assertEq(vault.totalAssets(), 1000 * AUSD);
    }

    function test_zeroCooldown_behavesAsUnrestricted() public {
        AgentRegistry noCooldownRegistry = new AgentRegistry(IERC20(address(usd)), owner, 2000, 3000, 0);
        vm.prank(owner);
        noCooldownRegistry.setBetRouter(router);
        vm.prank(operator);
        (, address v) = noCooldownRegistry.register(makeAddr("signer2"), hex"01", "ipfs://a2");
        AgentVault noCooldownVault = AgentVault(v);

        vm.startPrank(backer);
        usd.approve(address(noCooldownVault), 100 * AUSD);
        noCooldownVault.deposit(100 * AUSD, backer);
        noCooldownVault.withdraw(100 * AUSD, backer, backer);
        vm.stopPrank();

        assertEq(usd.balanceOf(backer), 10_000 * AUSD, "deposit and withdraw in the same block, no revert");
    }

    /// @dev A fuzzed version of the exploit-scenario test above: for any deposit/lock/settlement
    ///      size, and any elapsed time strictly less than the cooldown, withdrawal must stay
    ///      blocked. Only at or past the cooldown does it open up.
    function testFuzz_maxWithdraw_isZeroUntilCooldownElapsesRegardlessOfAmounts(
        uint96 depositAmount,
        uint32 elapsedBeforeCooldown
    ) public {
        uint256 dep = bound(depositAmount, 1, 5000 * AUSD);
        uint256 elapsed = bound(elapsedBeforeCooldown, 0, COOLDOWN - 1);

        usd.mint(backer, dep);
        _deposit(backer, dep);

        vm.warp(block.timestamp + elapsed);
        assertEq(vault.maxWithdraw(backer), 0, "still within the cooldown window");
        assertEq(vault.maxRedeem(backer), 0);
    }
}
