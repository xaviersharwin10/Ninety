// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @notice Per-agent capital pool. Backers deposit AUSD and receive shares; the pool collateralises
///         the agent's open liabilities and its profit and loss accrues to the share price.
interface IAgentVault is IERC4626 {
    event LiabilityLocked(
        uint256 indexed marketId, uint256 indexed betId, uint256 liability, uint256 lockedTotal
    );
    event LiabilitySettled(
        uint256 indexed marketId, uint256 indexed betId, uint256 liability, int256 pnl, uint256 lockedTotal
    );
    event PerformanceFeeAccrued(
        address indexed operator, uint256 feeShares, uint256 feeAssets, uint256 newHighWaterMark
    );
    event MarketExposureUpdated(uint256 indexed marketId, uint256 exposure);

    function lockedLiability() external view returns (uint256);
    function freeCapital() external view returns (uint256);
    function marketExposure(
        uint256 marketId
    ) external view returns (uint256);
    function highWaterMark() external view returns (uint256);
    function pricePerShare() external view returns (uint256);
    function performanceFeeBps() external view returns (uint16);
    function maxMarketExposureBps() external view returns (uint16);
    function operator() external view returns (address);
    function agentId() external view returns (uint32);

    /// @notice How long, after any deposit, that depositor's whole position stays locked.
    /// @dev Defends a specific timing attack: `totalAssets()` is a plain balance, unchanged while
    ///      a bet is pending and only moving at settlement, so a deposit made after learning a
    ///      pending bet's real-world outcome (but before that outcome is reflected on chain) buys
    ///      in at a stale price and could exit immediately after capturing the move — a value
    ///      transfer from genuine backers who carried the risk for the bet's whole pending life,
    ///      requiring no privileged access, only being faster than settlement. The cooldown does
    ///      not prevent capturing that one move; it forces the position to also sit exposed to
    ///      every other market this vault settles during the window, which is what makes the
    ///      attack risk-free today and removes that guarantee.
    function withdrawalCooldownSeconds() external view returns (uint32);
    /// @notice When `owner_`'s cooldown last reset. Withdrawals are blocked until this plus
    ///         `withdrawalCooldownSeconds()` has passed.
    function lastDepositAt(
        address owner_
    ) external view returns (uint256);

    /// @notice Largest additional liability this vault can take on `marketId` right now.
    function quotableBudget(
        uint256 marketId
    ) external view returns (uint256);

    function lockLiability(uint256 marketId, uint256 betId, uint256 liability) external;
    function settleAgentWon(
        uint256 marketId,
        uint256 betId,
        uint256 liability,
        uint256 stakeCredited
    ) external;
    function settleAgentLost(uint256 marketId, uint256 betId, uint256 liability, address payTo) external;
    function releaseVoided(uint256 marketId, uint256 betId, uint256 liability) external;

    function harvest() external returns (uint256 feeShares);
}
