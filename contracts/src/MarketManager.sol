// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

import { IMarketManager, Market, MarketState, Outcome } from "./interfaces/IMarketManager.sol";

/// @title MarketManager
/// @notice Creates matches and the micro-markets on them, and owns their state machine.
///
/// @dev The platform decides *what* markets exist; agents compete only on *how* they are priced.
///      That is why templates are an explicit on-chain allowlist rather than a free-form field:
///      letting anyone mint arbitrary questions would fragment liquidity into many markets with a
///      handful of bettors each, which is the failure mode this design exists to avoid.
///
///      Two roles, deliberately separate:
///      - SCHEDULER_ROLE opens, suspends and closes markets. Held by the cadence scheduler.
///      - SETTLER_ROLE resolves and voids them. Held by SettlementReceiver, which only acts on a
///        Chainlink CRE report. Splitting them means the key that opens markets cannot decide
///        how they end.
contract MarketManager is IMarketManager, AccessControl {
    bytes32 public constant SCHEDULER_ROLE = keccak256("SCHEDULER_ROLE");
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

    uint64 private _matchCount;
    uint256 private _marketCount;

    mapping(uint256 marketId => Market) private _markets;
    /// @notice Questions the platform is willing to open. See the note on fragmentation above.
    mapping(bytes32 templateId => bool enabled) public templateEnabled;
    mapping(uint64 matchId => bool exists) public matchExists;

    error UnknownMatch(uint64 matchId);
    error UnknownMarket(uint256 marketId);
    error TemplateNotEnabled(bytes32 templateId);
    error InvalidWindow(uint32 windowStart, uint32 windowEnd);
    error CloseTimeInPast(uint64 closesAt, uint64 nowTs);
    error InvalidTeamFilter(uint16 teamFilter);
    error WrongState(uint256 marketId, MarketState actual);
    error StillOpenForBetting(uint256 marketId, uint64 closesAt);
    error InvalidOutcome(Outcome outcome);

    constructor(
        address admin
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------
    // Configuration
    // ------------------------------------------------------------------

    function setTemplate(bytes32 templateId, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        templateEnabled[templateId] = enabled;
        emit TemplateSet(templateId, enabled);
    }

    // ------------------------------------------------------------------
    // Matches and markets
    // ------------------------------------------------------------------

    /// @inheritdoc IMarketManager
    function createMatch(
        bytes32 sourceRef,
        uint64 kickoffTs,
        string calldata metadataURI
    ) external onlyRole(SCHEDULER_ROLE) returns (uint64 matchId) {
        matchId = ++_matchCount;
        matchExists[matchId] = true;
        emit MatchCreated(matchId, sourceRef, kickoffTs, metadataURI);
    }

    /// @inheritdoc IMarketManager
    function openMarket(
        uint64 matchId,
        bytes32 templateId,
        uint32 windowStart,
        uint32 windowEnd,
        uint64 closesAt,
        uint16 teamFilter
    ) external onlyRole(SCHEDULER_ROLE) returns (uint256 marketId) {
        if (!matchExists[matchId]) revert UnknownMatch(matchId);
        if (!templateEnabled[templateId]) revert TemplateNotEnabled(templateId);
        if (windowEnd <= windowStart) revert InvalidWindow(windowStart, windowEnd);
        if (closesAt <= block.timestamp) revert CloseTimeInPast(closesAt, uint64(block.timestamp));
        if (teamFilter > 2) revert InvalidTeamFilter(teamFilter);

        marketId = ++_marketCount;
        _markets[marketId] = Market({
            matchId: matchId,
            templateId: templateId,
            windowStart: windowStart,
            windowEnd: windowEnd,
            openedAt: uint64(block.timestamp),
            closesAt: closesAt,
            qualifyingEventTs: 0,
            state: MarketState.Open,
            outcome: Outcome.Unresolved,
            teamFilter: teamFilter
        });

        emit MarketOpened(marketId, matchId, templateId, windowStart, windowEnd, closesAt, teamFilter);
    }

    // ------------------------------------------------------------------
    // State transitions
    // ------------------------------------------------------------------

    /// @inheritdoc IMarketManager
    /// @dev Used around dangerous moments — a penalty, a VAR check — when a price is about to
    ///      move faster than agents can re-quote.
    function suspend(uint256 marketId, bytes32 reason) external onlyRole(SCHEDULER_ROLE) {
        Market storage m = _get(marketId);
        if (m.state != MarketState.Open) revert WrongState(marketId, m.state);
        m.state = MarketState.Suspended;
        emit MarketSuspended(marketId, reason);
    }

    /// @inheritdoc IMarketManager
    function resume(
        uint256 marketId
    ) external onlyRole(SCHEDULER_ROLE) {
        Market storage m = _get(marketId);
        if (m.state != MarketState.Suspended) revert WrongState(marketId, m.state);
        m.state = MarketState.Open;
        emit MarketResumed(marketId);
    }

    /// @inheritdoc IMarketManager
    /// @dev Permissionless once `closesAt` has passed, so a market can never be stranded by an
    ///      offline scheduler.
    function close(
        uint256 marketId
    ) external {
        Market storage m = _get(marketId);
        if (m.state != MarketState.Open && m.state != MarketState.Suspended) {
            revert WrongState(marketId, m.state);
        }
        if (block.timestamp < m.closesAt && !hasRole(SCHEDULER_ROLE, msg.sender)) {
            revert StillOpenForBetting(marketId, m.closesAt);
        }
        m.state = MarketState.Closed;
        emit MarketClosed(marketId);
    }

    /// @inheritdoc IMarketManager
    /// @dev Accepts a market that is still nominally Open or Suspended and closes it on the way
    ///      through, so settlement never depends on a separate close transaction having landed.
    ///      Betting is already impossible by then: `isBettable` requires `block.timestamp` to be
    ///      before `closesAt`, and so does this function's guard.
    function resolve(
        uint256 marketId,
        Outcome outcome,
        uint64 qualifyingEventTs
    ) external onlyRole(SETTLER_ROLE) {
        if (outcome != Outcome.Yes && outcome != Outcome.No) revert InvalidOutcome(outcome);

        Market storage m = _get(marketId);
        if (m.state == MarketState.Open || m.state == MarketState.Suspended) {
            if (block.timestamp < m.closesAt) revert StillOpenForBetting(marketId, m.closesAt);
            m.state = MarketState.Closed;
            emit MarketClosed(marketId);
        }
        if (m.state != MarketState.Closed) revert WrongState(marketId, m.state);

        m.state = MarketState.Resolved;
        m.outcome = outcome;
        m.qualifyingEventTs = qualifyingEventTs;

        emit MarketResolved(marketId, outcome, qualifyingEventTs);
    }

    /// @inheritdoc IMarketManager
    /// @dev The escape hatch for bad or missing data. Every stake is refunded, so it is always
    ///      safe relative to paying out on a wrong outcome.
    function voidMarket(uint256 marketId, bytes32 reason) external onlyRole(SETTLER_ROLE) {
        Market storage m = _get(marketId);
        if (m.state == MarketState.Resolved || m.state == MarketState.Voided) {
            revert WrongState(marketId, m.state);
        }
        m.state = MarketState.Voided;
        m.outcome = Outcome.Void;
        emit MarketVoided(marketId, reason);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @inheritdoc IMarketManager
    function isBettable(
        uint256 marketId
    ) external view returns (bool) {
        Market storage m = _markets[marketId];
        return m.state == MarketState.Open && block.timestamp < m.closesAt;
    }

    /// @inheritdoc IMarketManager
    function getMarket(
        uint256 marketId
    ) external view returns (Market memory) {
        return _get(marketId);
    }

    /// @inheritdoc IMarketManager
    function marketCount() external view returns (uint256) {
        return _marketCount;
    }

    function matchCount() external view returns (uint64) {
        return _matchCount;
    }

    function _get(
        uint256 marketId
    ) private view returns (Market storage m) {
        m = _markets[marketId];
        if (m.state == MarketState.None) revert UnknownMarket(marketId);
    }
}
