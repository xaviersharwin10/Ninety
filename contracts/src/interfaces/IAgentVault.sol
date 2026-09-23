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
