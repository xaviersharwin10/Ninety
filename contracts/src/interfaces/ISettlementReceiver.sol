// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice One market's outcome as reported by the settlement workflow.
/// @param outcome 1 = Yes, 2 = No, 3 = Void. Never 0 (Unresolved) — a report only ever asserts a
///        final state.
/// @param evidenceHash keccak256 of the event slice the workflow used to reach this outcome, for
///        after-the-fact audit against the match data service.
struct MarketReport {
    uint256 marketId;
    uint8 outcome;
    uint64 qualifyingEventTs;
    bytes32 evidenceHash;
}

/// @param producedAt Wall-clock time the workflow assembled this report. Rejected if stale or if
///        it does not advance past the last accepted report for this match, which is what stops a
///        replayed report from being accepted twice through the unauthenticated simulation path.
struct SettlementReport {
    uint64 matchId;
    uint64 asOfMatchClock;
    uint64 producedAt;
    MarketReport[] markets;
}

interface ISettlementReceiver {
    event ForwarderAllowed(address indexed forwarder, bool allowed);
    event SimAttestorSet(address indexed attestor);
    event ProductionLocked();
    event ExpectedWorkflowSet(bytes32 workflowId, bytes10 workflowName, address workflowOwner);

    event ReportAccepted(
        address indexed forwarder,
        bytes32 workflowId,
        bytes10 workflowName,
        address workflowOwner,
        uint64 indexed matchId,
        uint256 marketCount,
        uint64 producedAt
    );
    event MarketSettledFromReport(
        uint256 indexed marketId, uint8 outcome, uint64 qualifyingEventTs, bytes32 evidenceHash
    );
    event ReportRejected(uint256 indexed marketId, bytes32 reason);

    function onReport(bytes calldata metadata, bytes calldata report) external;
    function supportsInterface(
        bytes4 interfaceId
    ) external view returns (bool);

    function isAllowedForwarder(
        address forwarder
    ) external view returns (bool);
    function setForwarder(address forwarder, bool allowed) external;
    function setSimAttestor(
        address attestor
    ) external;
    function lockProduction() external;
    function productionLocked() external view returns (bool);
    function setExpectedWorkflow(bytes32 workflowId, bytes10 workflowName, address workflowOwner) external;

    function PRODUCTION_FORWARDER() external view returns (address);
    function SIMULATION_FORWARDER() external view returns (address);
    function lastProducedAt(
        uint64 matchId
    ) external view returns (uint64);
}
