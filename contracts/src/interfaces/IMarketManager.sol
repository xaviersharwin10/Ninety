// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Lifecycle of a micro-market. Betting is only possible while `Open`.
enum MarketState {
    None,
    Open,
    Suspended,
    Closed,
    Resolved,
    Voided
}

/// @notice How a market ended. `Void` refunds every stake.
enum Outcome {
    Unresolved,
    Yes,
    No,
    Void
}

/// @param matchId Match this market belongs to.
/// @param templateId Which question this is, e.g. keccak256("SHOT_ON_TARGET_NEXT_N").
/// @param windowStart Start of the question's window, in match-clock seconds.
/// @param windowEnd End of the question's window, in match-clock seconds.
/// @param closesAt Wall-clock timestamp after which no more bets are accepted.
/// @param qualifyingEventTs Wall-clock timestamp of the first qualifying event, or 0 if none
///        occurred. Drives the anti-sniping rule at settlement.
/// @param teamFilter 0 = either team, 1 = home, 2 = away.
struct Market {
    uint64 matchId;
    bytes32 templateId;
    uint32 windowStart;
    uint32 windowEnd;
    uint64 openedAt;
    uint64 closesAt;
    uint64 qualifyingEventTs;
    MarketState state;
    Outcome outcome;
    uint16 teamFilter;
}

interface IMarketManager {
    event MatchCreated(uint64 indexed matchId, bytes32 sourceRef, uint64 kickoffTs, string metadataURI);
    event TemplateSet(bytes32 indexed templateId, bool enabled);
    event MarketOpened(
        uint256 indexed marketId,
        uint64 indexed matchId,
        bytes32 indexed templateId,
        uint32 windowStart,
        uint32 windowEnd,
        uint64 closesAt,
        uint16 teamFilter
    );
    event MarketSuspended(uint256 indexed marketId, bytes32 reason);
    event MarketResumed(uint256 indexed marketId);
    event MarketClosed(uint256 indexed marketId);
    event MarketResolved(uint256 indexed marketId, Outcome outcome, uint64 qualifyingEventTs);
    event MarketVoided(uint256 indexed marketId, bytes32 reason);

    function createMatch(
        bytes32 sourceRef,
        uint64 kickoffTs,
        string calldata metadataURI
    ) external returns (uint64 matchId);

    function openMarket(
        uint64 matchId,
        bytes32 templateId,
        uint32 windowStart,
        uint32 windowEnd,
        uint64 closesAt,
        uint16 teamFilter
    ) external returns (uint256 marketId);

    function suspend(uint256 marketId, bytes32 reason) external;
    function resume(
        uint256 marketId
    ) external;
    function close(
        uint256 marketId
    ) external;
    function resolve(uint256 marketId, Outcome outcome, uint64 qualifyingEventTs) external;
    function voidMarket(uint256 marketId, bytes32 reason) external;

    function isBettable(
        uint256 marketId
    ) external view returns (bool);
    function getMarket(
        uint256 marketId
    ) external view returns (Market memory);
    function marketCount() external view returns (uint256);
}
