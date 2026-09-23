// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

enum Side {
    Yes,
    No
}

enum BetStatus {
    None,
    Open,
    Won,
    Lost,
    Voided
}

/// @notice An agent's signed offer on one market.
/// @dev Signed off-chain by the agent's `quoteSigner` and passed in with the bet. The struct hash
///      doubles as the replay key, so a quote can be partially filled across several bets up to
///      `maxStake` but never beyond it. A sequential nonce would serialise an agent that re-quotes
///      several markets every few seconds, and drop fills.
/// @param maxStake Total size the agent is willing to take at this price, across all bets.
/// @param expiry Unix seconds. Agents sign very short expiries so a stale price cannot be sniped.
/// @param salt Makes otherwise identical quotes distinct.
struct Quote {
    uint256 marketId;
    uint32 agentId;
    uint16 probYesBps;
    uint16 probNoBps;
    uint128 maxStake;
    uint64 expiry;
    uint256 salt;
}

struct SignedQuote {
    Quote quote;
    bytes signature;
}

/// @param probBps The price this fill was actually struck at, on the side that was bought.
/// @param payout Gross amount returned if the bet wins, stake included.
struct Bet {
    uint256 marketId;
    address bettor;
    uint32 agentId;
    Side side;
    uint16 probBps;
    uint128 stake;
    uint128 payout;
    uint64 placedAt;
    BetStatus status;
}

interface IBetRouter {
    event BetPlaced(
        uint256 indexed betId,
        uint256 indexed marketId,
        address indexed bettor,
        uint256 groupId,
        uint32 agentId,
        Side side,
        uint16 probBps,
        uint128 stake,
        uint128 payout
    );
    event QuoteFilled(
        bytes32 indexed quoteHash, uint32 indexed agentId, uint128 filledNow, uint128 filledTotal
    );
    event BetSettled(uint256 indexed betId, uint256 indexed marketId, BetStatus status, uint128 amountOwed);
    event BetVoidedBySniperRule(
        uint256 indexed betId, uint256 indexed marketId, uint64 placedAt, uint64 qualifyingEventTs
    );
    event BetClaimed(uint256 indexed betId, address indexed bettor, uint128 amount);

    function placeBet(
        uint256 marketId,
        Side side,
        uint128 totalStake,
        uint128 minPayout,
        SignedQuote[] calldata quotes
    ) external returns (uint256 groupId, uint256[] memory betIds);

    function settleBatch(
        uint256[] calldata betIds
    ) external;
    function claim(
        uint256[] calldata betIds
    ) external returns (uint256 total);

    function hashQuote(
        Quote calldata q
    ) external view returns (bytes32);
    function quoteFilled(
        bytes32 quoteHash
    ) external view returns (uint128);
    function getBet(
        uint256 betId
    ) external view returns (Bet memory);
    function claimableAmount(
        uint256 betId
    ) external view returns (uint128);
    function betCount() external view returns (uint256);
}
