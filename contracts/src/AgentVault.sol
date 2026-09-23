// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IAgentRegistry } from "./interfaces/IAgentRegistry.sol";
import { IAgentVault } from "./interfaces/IAgentVault.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @title AgentVault
/// @notice Capital backing a single market-making agent. Backers deposit AUSD and receive shares.
///
/// @dev Assets never move when a bet is placed. `BetRouter` escrows the fan's stake, and the vault
///      only *books* the agent's side of the risk in `lockedLiability`. Assets move once, at
///      settlement. That keeps the hot path cheap and leaves one invariant to defend:
///
///          totalAssets() >= lockedLiability()
///
///      which holds because liabilities can only be locked against free capital, and withdrawals
///      are capped at free capital.
///
///      Shares are ERC-4626 with a decimals offset, which is OpenZeppelin's mitigation for the
///      first-depositor inflation attack. That matters more than usual here: the asset has 6
///      decimals, so an unmitigated vault is cheap to grief.
contract AgentVault is ERC4626, ReentrancyGuard, IAgentVault {
    using SafeERC20 for IERC20;

    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;

    /// @notice Registry that deployed this vault. The only source of the authorised router.
    IAgentRegistry public immutable REGISTRY;
    /// @inheritdoc IAgentVault
    uint32 public immutable agentId;
    /// @inheritdoc IAgentVault
    address public immutable operator;
    /// @inheritdoc IAgentVault
    uint16 public immutable performanceFeeBps;
    /// @notice Cap on how much of the vault may be at risk on any single market, in basis points.
    uint16 public immutable maxMarketExposureBps;

    /// @inheritdoc IAgentVault
    uint256 public lockedLiability;
    /// @inheritdoc IAgentVault
    mapping(uint256 marketId => uint256 exposure) public marketExposure;
    /// @notice Share price the performance fee was last charged at. Fees accrue only above it.
    uint256 public highWaterMark;

    error OnlyRouter(address caller, address router);
    error InsufficientFreeCapital(uint256 requested, uint256 available);
    error MarketExposureExceeded(uint256 requested, uint256 cap);
    error FeeTooHigh(uint16 bps);

    modifier onlyRouter() {
        address router = REGISTRY.betRouter();
        if (msg.sender != router) revert OnlyRouter(msg.sender, router);
        _;
    }

    constructor(
        IERC20 asset_,
        IAgentRegistry registry_,
        uint32 agentId_,
        address operator_,
        uint16 performanceFeeBps_,
        uint16 maxMarketExposureBps_,
        string memory name_,
        string memory symbol_
    ) ERC4626(asset_) ERC20(name_, symbol_) {
        if (performanceFeeBps_ > 5000) revert FeeTooHigh(performanceFeeBps_);
        if (maxMarketExposureBps_ > BPS) revert FeeTooHigh(maxMarketExposureBps_);

        REGISTRY = registry_;
        agentId = agentId_;
        operator = operator_;
        performanceFeeBps = performanceFeeBps_;
        maxMarketExposureBps = maxMarketExposureBps_;

        // Seed the high-water mark at the empty vault's rate, so the first profit is the first
        // thing that can ever be charged a fee.
        highWaterMark = _convertToAssets(WAD, Math.Rounding.Floor);
    }

    /// @dev Shares carry 6 more decimals than the asset. With a 6-decimal asset that is the
    ///      difference between an inflation attack costing a fraction of a cent and costing a
    ///      prohibitive amount.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ------------------------------------------------------------------
    // Capital accounting
    // ------------------------------------------------------------------

    /// @inheritdoc IAgentVault
    function freeCapital() public view returns (uint256) {
        uint256 assets = totalAssets();
        uint256 locked = lockedLiability;
        return assets > locked ? assets - locked : 0;
    }

    /// @inheritdoc IAgentVault
    /// @dev Assets per 1e18 shares, using the vault's own conversion so it stays consistent with
    ///      the decimals offset. Used only as the high-water mark yardstick.
    function pricePerShare() public view returns (uint256) {
        return _convertToAssets(WAD, Math.Rounding.Floor);
    }

    /// @dev Backers can only take out what is not currently collateralising an open bet. Without
    ///      this cap a backer could withdraw mid-match and leave the agent unable to pay a winner.
    function maxWithdraw(
        address owner_
    ) public view override(ERC4626, IERC4626) returns (uint256) {
        return Math.min(super.maxWithdraw(owner_), freeCapital());
    }

    function maxRedeem(
        address owner_
    ) public view override(ERC4626, IERC4626) returns (uint256) {
        uint256 freeShares = _convertToShares(freeCapital(), Math.Rounding.Floor);
        return Math.min(super.maxRedeem(owner_), freeShares);
    }

    // ------------------------------------------------------------------
    // Liability lifecycle, driven by BetRouter
    // ------------------------------------------------------------------

    /// @inheritdoc IAgentVault
    function lockLiability(uint256 marketId, uint256 betId, uint256 liability) external onlyRouter {
        uint256 free = freeCapital();
        if (liability > free) revert InsufficientFreeCapital(liability, free);

        uint256 newExposure = marketExposure[marketId] + liability;
        uint256 cap = Math.mulDiv(totalAssets(), maxMarketExposureBps, BPS);
        if (newExposure > cap) revert MarketExposureExceeded(newExposure, cap);

        lockedLiability += liability;
        marketExposure[marketId] = newExposure;

        emit LiabilityLocked(marketId, betId, liability, lockedLiability);
        emit MarketExposureUpdated(marketId, newExposure);
    }

    /// @inheritdoc IAgentVault
    /// @dev The router transfers the fan's forfeited stake in before calling. Passing the amount
    ///      explicitly keeps the event honest rather than inferring it from a balance delta.
    function settleAgentWon(
        uint256 marketId,
        uint256 betId,
        uint256 liability,
        uint256 stakeCredited
    ) external onlyRouter {
        _release(marketId, liability);
        emit LiabilitySettled(marketId, betId, liability, int256(stakeCredited), lockedLiability);
    }

    /// @inheritdoc IAgentVault
    function settleAgentLost(
        uint256 marketId,
        uint256 betId,
        uint256 liability,
        address payTo
    ) external onlyRouter nonReentrant {
        // Release before paying: checks-effects-interactions, and it keeps the solvency
        // invariant true at every point inside the call.
        _release(marketId, liability);
        IERC20(asset()).safeTransfer(payTo, liability);
        emit LiabilitySettled(marketId, betId, liability, -int256(liability), lockedLiability);
    }

    /// @inheritdoc IAgentVault
    function releaseVoided(uint256 marketId, uint256 betId, uint256 liability) external onlyRouter {
        _release(marketId, liability);
        emit LiabilitySettled(marketId, betId, liability, int256(0), lockedLiability);
    }

    /// @dev Checked arithmetic throughout: releasing more than was locked means the router is
    ///      broken, and that should stop the transaction rather than silently clamp to zero.
    function _release(uint256 marketId, uint256 liability) private {
        lockedLiability -= liability;
        uint256 remaining = marketExposure[marketId] - liability;
        marketExposure[marketId] = remaining;
        emit MarketExposureUpdated(marketId, remaining);
    }

    // ------------------------------------------------------------------
    // Performance fee
    // ------------------------------------------------------------------

    /// @inheritdoc IAgentVault
    /// @dev Permissionless: it can only ever pay the operator, and only on gains above the
    ///      previous peak, so there is no reason to restrict who triggers it.
    ///
    ///      The fee is minted as shares, which dilutes holders rather than moving assets out.
    ///      The new high-water mark is read *after* that dilution, so the same gain can never be
    ///      charged twice.
    function harvest() external nonReentrant returns (uint256 feeShares) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;

        uint256 pps = pricePerShare();
        uint256 hwm = highWaterMark;
        if (pps <= hwm) return 0;

        uint256 profitAssets = Math.mulDiv(pps - hwm, supply, WAD);
        uint256 feeAssets = Math.mulDiv(profitAssets, performanceFeeBps, BPS);
        if (feeAssets == 0) {
            highWaterMark = pps;
            return 0;
        }

        // Minting the fee dilutes every holder, including the operator's new shares. Converting
        // `feeAssets` at the *pre-mint* rate therefore underpays: the shares end up owning a
        // slice of a pool that now contains themselves. Solve for the post-dilution value instead:
        //
        //     feeShares / (supply + feeShares) * assets = feeAssets
        //  => feeShares = feeAssets * supply / (assets - feeAssets)
        //
        // using the same virtual supply and assets the vault's own conversions use, so the result
        // is consistent with previewRedeem.
        uint256 virtualSupply = supply + 10 ** _decimalsOffset();
        uint256 virtualAssets = totalAssets() + 1;
        if (virtualAssets <= feeAssets) {
            highWaterMark = pps;
            return 0;
        }

        feeShares = Math.mulDiv(feeAssets, virtualSupply, virtualAssets - feeAssets, Math.Rounding.Floor);
        if (feeShares == 0) {
            highWaterMark = pps;
            return 0;
        }

        _mint(operator, feeShares);
        highWaterMark = pricePerShare();

        emit PerformanceFeeAccrued(operator, feeShares, feeAssets, highWaterMark);
    }

    // ------------------------------------------------------------------
    // Disambiguation between ERC4626 and IAgentVault
    // ------------------------------------------------------------------

    function asset() public view override(ERC4626, IERC4626) returns (address) {
        return super.asset();
    }

    function totalAssets() public view override(ERC4626, IERC4626) returns (uint256) {
        return super.totalAssets();
    }

    function decimals() public view override(ERC4626, IERC20Metadata) returns (uint8) {
        return super.decimals();
    }
}
