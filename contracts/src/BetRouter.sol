// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IAgentRegistry } from "./interfaces/IAgentRegistry.sol";
import { IAgentVault } from "./interfaces/IAgentVault.sol";

import { Bet, BetStatus, IBetRouter, Quote, Side, SignedQuote } from "./interfaces/IBetRouter.sol";
import { IMarketManager, Market, MarketState, Outcome } from "./interfaces/IMarketManager.sol";
import { OddsMath } from "./libraries/OddsMath.sol";

/// @title BetRouter
/// @notice Takes a fan's bet, splits it across competing agent quotes, and holds the stake until
///         settlement.
///
/// @dev What this contract does and does not guarantee about the "best three quotes" is worth
///      stating plainly, because it is easy to overclaim.
///
///      Enforced on chain: every fill is priced at its own signed quote; fills are ordered
///      best-price-first on the side being bought; no agent appears twice; the 50/30/20 allocation
///      ladder is computed here rather than supplied by the caller; each fill respects the quote's
///      remaining size and the agent's free capital; and the fan's total payout clears `minPayout`.
///
///      Not enforced on chain: that these were the best three quotes *in existence*. The contract
///      never saw the others. That selection comes from the off-chain relay, which is untrusted —
///      it can only ever offer the fan a worse price, and `minPayout` is the fan's protection
///      against that.
contract BetRouter is IBetRouter, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(uint256 marketId,uint32 agentId,uint16 probYesBps,uint16 probNoBps,uint128 maxStake,uint64 expiry,uint256 salt)"
    );

    /// @notice Minimum overround an agent must carry. This is what stops a race to zero margin.
    uint16 public constant MIN_MARGIN_BPS = 200;
    uint16 public constant MIN_PROB_BPS = 200;
    uint16 public constant MAX_PROB_BPS = 9800;
    uint8 public constant MAX_FILLS = 3;

    /// @notice Bets struck within this many seconds before a qualifying event are voided.
    /// @dev Symmetric: both sides are refunded, not just the side that benefited. Voiding only the
    ///      winning side would itself be exploitable — a sniper could take the losing side to force
    ///      a refund and bet for free.
    uint32 public constant DELAY_SECONDS = 8;

    /// @dev Everything `_record` needs about a bet, gathered into one memory struct. Passing
    ///      these as separate arguments overflowed the stack even under via-ir.
    struct FillPlan {
        uint256 marketId;
        Side side;
        uint256 groupId;
        bytes32[] hashes;
        uint16[] probs;
        uint256[] caps;
        uint256[] stakes;
    }

    IERC20 public immutable ASSET;
    IAgentRegistry public immutable REGISTRY;
    IMarketManager public immutable MARKETS;

    uint256 public betCount;
    uint256 public groupCount;

    mapping(uint256 betId => Bet) private _bets;
    /// @inheritdoc IBetRouter
    mapping(bytes32 quoteHash => uint128 filled) public quoteFilled;
    /// @notice Whether a settled bet's proceeds have been collected. Kept separate from
    ///         `BetStatus` so "won" and "voided" stay distinguishable after the money moves.
    mapping(uint256 betId => bool) public claimed;

    error MarketNotBettable(uint256 marketId);
    error InvalidFillCount(uint256 count);
    error ZeroStake();
    error QuoteForWrongMarket(uint256 expected, uint256 actual);
    error QuoteExpired(uint64 expiry, uint64 nowTs);
    error QuoteOverfilled(bytes32 quoteHash, uint128 filled, uint128 maxStake);
    error AgentNotQuotable(uint32 agentId, address recovered);
    error DuplicateAgent(uint32 agentId);
    error FillsNotBestPriceFirst(uint16 previous, uint16 current);
    error PayoutBelowMinimum(uint256 payout, uint128 minPayout);
    error MarketNotSettled(uint256 marketId, MarketState state);
    error UnknownBet(uint256 betId);
    error NotBettor(uint256 betId, address caller);

    constructor(IERC20 asset_, IAgentRegistry registry_, IMarketManager markets_) EIP712("Ninety", "1") {
        ASSET = asset_;
        REGISTRY = registry_;
        MARKETS = markets_;
    }

    // ------------------------------------------------------------------
    // Placing a bet
    // ------------------------------------------------------------------

    /// @inheritdoc IBetRouter
    /// @param minPayout Smallest gross return the fan will accept. Protects against the relay
    ///        handing over quotes worse than the ones the interface displayed.
    function placeBet(
        uint256 marketId,
        Side side,
        uint128 totalStake,
        uint128 minPayout,
        SignedQuote[] calldata quotes
    ) external nonReentrant returns (uint256 groupId, uint256[] memory betIds) {
        if (!MARKETS.isBettable(marketId)) revert MarketNotBettable(marketId);
        if (totalStake == 0) revert ZeroStake();

        uint256 n = quotes.length;
        if (n == 0 || n > MAX_FILLS) revert InvalidFillCount(n);

        FillPlan memory plan = _validateAndSize(marketId, side, quotes);
        plan.stakes = OddsMath.ladderAllocate(totalStake, plan.caps, _ladderFor(n));
        plan.groupId = ++groupCount;

        groupId = plan.groupId;
        betIds = _record(plan, quotes, minPayout);

        ASSET.safeTransferFrom(msg.sender, address(this), totalStake);
    }

    /// @dev Checks every quote and works out how much each one can actually absorb.
    function _validateAndSize(
        uint256 marketId,
        Side side,
        SignedQuote[] calldata quotes
    ) private view returns (FillPlan memory plan) {
        uint256 n = quotes.length;
        plan.marketId = marketId;
        plan.side = side;
        plan.hashes = new bytes32[](n);
        plan.probs = new uint16[](n);
        plan.caps = new uint256[](n);

        for (uint256 i = 0; i < n; ++i) {
            Quote calldata q = quotes[i].quote;

            if (q.marketId != marketId) revert QuoteForWrongMarket(marketId, q.marketId);
            if (block.timestamp > q.expiry) revert QuoteExpired(q.expiry, uint64(block.timestamp));

            OddsMath.validateQuote(q.probYesBps, q.probNoBps, MIN_PROB_BPS, MAX_PROB_BPS, MIN_MARGIN_BPS);

            bytes32 h = _hash(q);
            address recovered = ECDSA.recover(h, quotes[i].signature);
            if (!REGISTRY.isQuotable(q.agentId, recovered)) {
                revert AgentNotQuotable(q.agentId, recovered);
            }

            // One agent must not occupy several rungs of the ladder.
            for (uint256 j = 0; j < i; ++j) {
                if (quotes[j].quote.agentId == q.agentId) revert DuplicateAgent(q.agentId);
            }

            uint16 p = side == Side.Yes ? q.probYesBps : q.probNoBps;
            if (i > 0 && p < plan.probs[i - 1]) revert FillsNotBestPriceFirst(plan.probs[i - 1], p);

            plan.hashes[i] = h;
            plan.probs[i] = p;

            uint128 already = quoteFilled[h];
            if (already >= q.maxStake) revert QuoteOverfilled(h, already, q.maxStake);

            uint256 remainingSize = q.maxStake - already;
            uint256 budget = IAgentVault(REGISTRY.vaultOf(q.agentId)).quotableBudget(marketId);
            plan.caps[i] = Math.min(remainingSize, OddsMath.maxStakeForLiability(budget, p));
        }
    }

    /// @dev Writes the bets and reserves each agent's side of the risk.
    function _record(
        FillPlan memory plan,
        SignedQuote[] calldata quotes,
        uint128 minPayout
    ) private returns (uint256[] memory betIds) {
        uint256 n = plan.stakes.length;
        betIds = new uint256[](n);
        uint256 written;
        uint256 totalPayout;

        for (uint256 i = 0; i < n; ++i) {
            if (plan.stakes[i] == 0) continue;
            (uint256 betId, uint128 payout) = _writeFill(plan, quotes[i].quote.agentId, i);
            betIds[written++] = betId;
            totalPayout += payout;
        }

        if (totalPayout < minPayout) revert PayoutBelowMinimum(totalPayout, minPayout);

        // Trim entries for rungs that ended up with nothing.
        assembly {
            mstore(betIds, written)
        }
    }

    /// @dev One rung of the ladder: record the bet and reserve the agent's liability.
    function _writeFill(
        FillPlan memory plan,
        uint32 agentId,
        uint256 i
    ) private returns (uint256 betId, uint128 payout) {
        uint128 stake = uint128(plan.stakes[i]);
        payout = uint128(OddsMath.payoutFor(stake, plan.probs[i]));

        uint128 filledTotal = quoteFilled[plan.hashes[i]] + stake;
        quoteFilled[plan.hashes[i]] = filledTotal;

        betId = ++betCount;
        _bets[betId] = Bet({
            marketId: plan.marketId,
            bettor: msg.sender,
            agentId: agentId,
            side: plan.side,
            probBps: plan.probs[i],
            stake: stake,
            payout: payout,
            placedAt: uint64(block.timestamp),
            status: BetStatus.Open
        });

        IAgentVault(REGISTRY.vaultOf(agentId)).lockLiability(plan.marketId, betId, payout - stake);

        emit QuoteFilled(plan.hashes[i], agentId, stake, filledTotal);
        emit BetPlaced(
            betId, plan.marketId, msg.sender, plan.groupId, agentId, plan.side, plan.probs[i], stake, payout
        );
    }

    /// @dev Ladder weights, normalised per fill count so the shape stays sensible when the relay
    ///      offers fewer than three quotes.
    function _ladderFor(
        uint256 n
    ) private pure returns (uint16[] memory w) {
        w = new uint16[](n);
        if (n == 1) {
            w[0] = 10_000;
        } else if (n == 2) {
            w[0] = 6000;
            w[1] = 4000;
        } else {
            w[0] = 5000;
            w[1] = 3000;
            w[2] = 2000;
        }
    }

    // ------------------------------------------------------------------
    // Settlement
    // ------------------------------------------------------------------

    /// @inheritdoc IBetRouter
    /// @dev Permissionless and idempotent: bets that are already settled are skipped rather than
    ///      reverting, so a batch can be retried freely and two callers cannot race each other
    ///      into a failure.
    function settleBatch(
        uint256[] calldata betIds
    ) external nonReentrant {
        for (uint256 i = 0; i < betIds.length; ++i) {
            uint256 betId = betIds[i];
            Bet storage b = _bets[betId];
            if (b.status != BetStatus.Open) continue;

            Market memory m = MARKETS.getMarket(b.marketId);
            if (m.state != MarketState.Resolved && m.state != MarketState.Voided) {
                revert MarketNotSettled(b.marketId, m.state);
            }

            IAgentVault vault = IAgentVault(REGISTRY.vaultOf(b.agentId));
            uint256 liability = b.payout - b.stake;

            // Anti-sniping: a bet struck in the seconds before the event is refunded, whichever
            // side it took.
            bool sniped =
                m.qualifyingEventTs != 0 && uint256(b.placedAt) + DELAY_SECONDS > uint256(m.qualifyingEventTs);

            if (m.state == MarketState.Voided || sniped) {
                b.status = BetStatus.Voided;
                vault.releaseVoided(b.marketId, betId, liability);
                if (sniped) {
                    emit BetVoidedBySniperRule(betId, b.marketId, b.placedAt, m.qualifyingEventTs);
                }
                emit BetSettled(betId, b.marketId, BetStatus.Voided, b.stake);
                continue;
            }

            bool won = (m.outcome == Outcome.Yes && b.side == Side.Yes)
                || (m.outcome == Outcome.No && b.side == Side.No);

            if (won) {
                b.status = BetStatus.Won;
                // The vault sends its share here; the stake is already held by this contract.
                vault.settleAgentLost(b.marketId, betId, liability, address(this));
                emit BetSettled(betId, b.marketId, BetStatus.Won, b.payout);
            } else {
                b.status = BetStatus.Lost;
                ASSET.safeTransfer(address(vault), b.stake);
                vault.settleAgentWon(b.marketId, betId, liability, b.stake);
                emit BetSettled(betId, b.marketId, BetStatus.Lost, 0);
            }
        }
    }

    /// @inheritdoc IBetRouter
    /// @dev Pull rather than push. Monad charges gas on the limit rather than on what is used, so
    ///      an unbounded payout loop at settlement is both expensive and a denial-of-service
    ///      surface. The web app submits this with the fan's signing session the moment a market
    ///      resolves, so it still feels immediate.
    function claim(
        uint256[] calldata betIds
    ) external nonReentrant returns (uint256 total) {
        for (uint256 i = 0; i < betIds.length; ++i) {
            uint256 betId = betIds[i];
            Bet storage b = _bets[betId];
            if (b.status == BetStatus.None) revert UnknownBet(betId);
            if (b.bettor != msg.sender) revert NotBettor(betId, msg.sender);
            if (claimed[betId]) continue;

            uint128 owed = _owed(b);
            if (owed == 0) continue;

            claimed[betId] = true;
            total += owed;
            emit BetClaimed(betId, msg.sender, owed);
        }

        if (total > 0) ASSET.safeTransfer(msg.sender, total);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @inheritdoc IBetRouter
    function hashQuote(
        Quote calldata q
    ) external view returns (bytes32) {
        return _hash(q);
    }

    /// @inheritdoc IBetRouter
    function getBet(
        uint256 betId
    ) external view returns (Bet memory) {
        Bet memory b = _bets[betId];
        if (b.status == BetStatus.None) revert UnknownBet(betId);
        return b;
    }

    /// @inheritdoc IBetRouter
    function claimableAmount(
        uint256 betId
    ) external view returns (uint128) {
        if (claimed[betId]) return 0;
        return _owed(_bets[betId]);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _owed(
        Bet memory b
    ) private pure returns (uint128) {
        if (b.status == BetStatus.Won) return b.payout;
        if (b.status == BetStatus.Voided) return b.stake;
        return 0;
    }

    function _hash(
        Quote calldata q
    ) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH,
                    q.marketId,
                    q.agentId,
                    q.probYesBps,
                    q.probNoBps,
                    q.maxStake,
                    q.expiry,
                    q.salt
                )
            )
        );
    }
}
