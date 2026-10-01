// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import { IAgentRegistry } from "./interfaces/IAgentRegistry.sol";
import { Side } from "./interfaces/IBetRouter.sol";
import { IMarketManager } from "./interfaces/IMarketManager.sol";

/// @title OddsLock
/// @notice An agent sells a fan the right to bet at today's price for a short while: pay a small
///         fee now, and the price is held for `holdSeconds` whatever happens to the market in the
///         meantime. It is a call on the odds, and the agent's second way to earn: the fee goes
///         straight into the agent's vault, so its backers are paid for writing it.
///
/// @dev The bet itself still goes through `BetRouter`, unchanged. Once a lock is bought, the
///      agent honours it with an ordinary signed quote at the held price, sized to the stake still
///      held and as short-lived as any other quote; it re-signs one every few seconds until the
///      hold ends. The fan places it like any other bet, so every check `BetRouter` makes --
///      signature, size, the agent's free capital, the bet-delay rule -- applies in full. And
///      because the agent stops signing while an event that would decide the market is coming,
///      exactly as it pulls its ordinary quotes, a hold pauses during big moments just as betting
///      does: it can't be used to bet on what the fan can see is about to happen.
///
///      What this contract guarantees is the part the fan pays for: that the agent really offered
///      these terms (its quote signer signed them), that the fee went to the agent's vault and
///      nowhere else, and a public record of the hold the agent must honour. What it cannot force
///      is the agent handing over that quote. That is a promise kept off chain, and every lock
///      and every bet is on chain, so a hold that was paid for and never honoured is there for
///      anyone to see. See README "Odds Lock" for the full trust model.
contract OddsLock is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant LOCK_OFFER_TYPEHASH = keccak256(
        "LockOffer(uint256 marketId,uint32 agentId,uint8 side,uint16 probBps,uint128 maxStake,uint16 feeBps,uint32 holdSeconds,uint64 expiry,uint256 salt)"
    );

    /// @notice The held price must leave room for the quote that honours it. That quote carries the
    ///         held price on one side and the most an agent may charge (`BetRouter.MAX_PROB_BPS`,
    ///         9800) on the other, and the two must clear `BetRouter`'s 2% minimum margin -- so the
    ///         held side can be no cheaper than 400 bps (25x).
    uint16 public constant MIN_PROB_BPS = 400;
    uint16 public constant MAX_PROB_BPS = 9800;
    /// @notice A hold is a few moments of a live match, not an open-ended position.
    uint32 public constant MAX_HOLD_SECONDS = 120;
    /// @notice No fee above half the stake: past that it isn't a price hold, it's a mistake.
    uint16 public constant MAX_FEE_BPS = 5000;

    /// @notice An agent's signed offer to hold a price.
    /// @param side Which side's price is held.
    /// @param probBps The held price, as the implied probability `BetRouter` prices in.
    /// @param maxStake Total stake the agent will hold at this price, across every fan who buys.
    /// @param feeBps Fee per unit of stake held, charged up front.
    /// @param expiry Unix seconds; like a quote, the offer itself is short-lived.
    struct LockOffer {
        uint256 marketId;
        uint32 agentId;
        Side side;
        uint16 probBps;
        uint128 maxStake;
        uint16 feeBps;
        uint32 holdSeconds;
        uint64 expiry;
        uint256 salt;
    }

    struct Lock {
        address fan;
        uint32 agentId;
        Side side;
        uint16 probBps;
        uint64 heldUntil;
        uint256 marketId;
        uint128 stake;
        uint128 fee;
    }

    IERC20 public immutable ASSET;
    IAgentRegistry public immutable REGISTRY;
    IMarketManager public immutable MARKETS;

    uint256 public lockCount;
    mapping(uint256 lockId => Lock) private _locks;
    /// @notice Stake already held against each offer, so one offer can't be sold past `maxStake`.
    mapping(bytes32 offerHash => uint128) public offerFilled;

    event LockBought(
        uint256 indexed lockId,
        uint256 indexed marketId,
        address indexed fan,
        uint32 agentId,
        Side side,
        uint16 probBps,
        uint128 stake,
        uint128 fee,
        uint64 heldUntil
    );

    error MarketNotBettable(uint256 marketId);
    error OfferExpired(uint64 expiry, uint64 nowTs);
    error PriceOutOfRange(uint16 probBps);
    error HoldOutOfRange(uint32 holdSeconds);
    error FeeOutOfRange(uint16 feeBps);
    error ZeroStake();
    error OfferOverfilled(bytes32 offerHash, uint128 filled, uint128 maxStake);
    error AgentNotQuotable(uint32 agentId, address recovered);
    error FeeAboveMaximum(uint128 fee, uint128 maxFee);
    error UnknownLock(uint256 lockId);

    constructor(
        IERC20 asset_,
        IAgentRegistry registry_,
        IMarketManager markets_
    ) EIP712("Ninety Odds Lock", "1") {
        ASSET = asset_;
        REGISTRY = registry_;
        MARKETS = markets_;
    }

    /// @notice Buys a hold on `stake` at the offer's price, paying the fee into the agent's vault.
    /// @param maxFee The most the fan agreed to pay, as shown to them.
    function buy(
        LockOffer calldata offer,
        bytes calldata signature,
        uint128 stake,
        uint128 maxFee
    ) external nonReentrant returns (uint256 lockId) {
        if (!MARKETS.isBettable(offer.marketId)) revert MarketNotBettable(offer.marketId);
        if (block.timestamp > offer.expiry) revert OfferExpired(offer.expiry, uint64(block.timestamp));
        if (offer.probBps < MIN_PROB_BPS || offer.probBps > MAX_PROB_BPS) {
            revert PriceOutOfRange(offer.probBps);
        }
        if (offer.holdSeconds == 0 || offer.holdSeconds > MAX_HOLD_SECONDS) {
            revert HoldOutOfRange(offer.holdSeconds);
        }
        if (offer.feeBps == 0 || offer.feeBps > MAX_FEE_BPS) revert FeeOutOfRange(offer.feeBps);
        if (stake == 0) revert ZeroStake();

        bytes32 h = hashOffer(offer);
        address recovered = ECDSA.recover(h, signature);
        if (!REGISTRY.isQuotable(offer.agentId, recovered)) revert AgentNotQuotable(offer.agentId, recovered);

        uint128 filled = offerFilled[h] + stake;
        if (filled > offer.maxStake) revert OfferOverfilled(h, offerFilled[h], offer.maxStake);
        offerFilled[h] = filled;

        // Rounded up: a hold is never free.
        uint128 fee = uint128((uint256(stake) * offer.feeBps + 9999) / 10_000);
        if (fee > maxFee) revert FeeAboveMaximum(fee, maxFee);

        lockId = _record(offer, stake, fee);

        // Straight into the vault: the fee is the vault's income, earned by its backers.
        ASSET.safeTransferFrom(msg.sender, REGISTRY.vaultOf(offer.agentId), fee);
    }

    /// @dev Split out of `buy` to keep its stack shallow.
    function _record(LockOffer calldata offer, uint128 stake, uint128 fee) private returns (uint256 lockId) {
        lockId = ++lockCount;
        Lock storage l = _locks[lockId];
        l.fan = msg.sender;
        l.agentId = offer.agentId;
        l.side = offer.side;
        l.probBps = offer.probBps;
        l.heldUntil = uint64(block.timestamp) + offer.holdSeconds;
        l.marketId = offer.marketId;
        l.stake = stake;
        l.fee = fee;
        emit LockBought(
            lockId,
            offer.marketId,
            msg.sender,
            offer.agentId,
            offer.side,
            offer.probBps,
            stake,
            fee,
            l.heldUntil
        );
    }

    function getLock(
        uint256 lockId
    ) external view returns (Lock memory lock) {
        lock = _locks[lockId];
        if (lock.fan == address(0)) revert UnknownLock(lockId);
    }

    function hashOffer(
        LockOffer calldata o
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LOCK_OFFER_TYPEHASH,
                    o.marketId,
                    o.agentId,
                    o.side,
                    o.probBps,
                    o.maxStake,
                    o.feeBps,
                    o.holdSeconds,
                    o.expiry,
                    o.salt
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
