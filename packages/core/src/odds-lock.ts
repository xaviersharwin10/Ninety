import type { Address, Hex, LocalAccount } from "viem";
import { BPS } from "./pricing.js";

/**
 * Odds Lock: an agent sells a fan the right to bet at the current price for a short while. This
 * file holds what both sides of that need -- the fee an agent charges for it, and the EIP-712
 * offer it signs -- shared by the agent runner, the simulator and the web app, so the fee the
 * simulator stress-tests is the fee the agents actually charge.
 */

/** How long a hold lasts, in match seconds. Short on purpose: a few moments of a match, not a position. */
export const LOCK_HOLD_SEC = 30;
/** The shortest a hold may last in real seconds, however fast a replay runs: long enough to use. */
export const LOCK_MIN_HOLD_REAL_SEC = 10;

/**
 * A hold's length in real seconds -- what `OddsLock` counts down -- for a match running at `speed`
 * match seconds per real second: {@link LOCK_HOLD_SEC} of match, but never under
 * {@link LOCK_MIN_HOLD_REAL_SEC}. Live football runs at 1x, and a hold lasts 30 seconds; a 5x
 * replay gets 10 real seconds, which is 50 seconds of match, and is priced as such.
 */
export function holdRealSec(speed = 1): number {
  return Math.min(
    LOCK_HOLD_SEC,
    Math.max(LOCK_MIN_HOLD_REAL_SEC, Math.round(LOCK_HOLD_SEC / speed)),
  );
}
/**
 * A hold is only offered while at least this much of the window would remain once it ends. A NO
 * held to the last seconds of a window is nearly a sure thing; this keeps the fee meaningful.
 */
export const LOCK_MIN_TAIL_SEC = 30;
/** `OddsLock.MIN_PROB_BPS` / `MAX_PROB_BPS` / `MAX_FEE_BPS`. */
export const LOCK_MIN_PROB_BPS = 400;
export const LOCK_MAX_PROB_BPS = 9800;
export const LOCK_MAX_FEE_BPS = 5000;
/** Fees above this aren't worth showing a fan: the hold would cost more than it could help. */
export const LOCK_FEE_CEILING_BPS = 2500;

export interface LockFeeInput {
  side: "yes" | "no";
  /** The agent's current two-sided price; the held side's price is what the hold locks in. */
  probYesBps: number;
  probNoBps: number;
  /** Seconds left in the market's window. */
  remainingSec: number;
  /** How much of the window the hold covers, in match seconds. Default {@link LOCK_HOLD_SEC}. */
  holdSec?: number;
  /** Extra charged on top of the hold's worth, as a fraction of it. Default 25%. */
  markup?: number;
  /** Flat floor, in bps of stake. Default 100 (1%). */
  floorBps?: number;
}

/**
 * The fee, in bps of the stake held, for holding `side`'s price for `holdSec`; or `null` when the
 * agent shouldn't offer a hold at all.
 *
 * A hold pauses during big moments exactly as betting does: the agent honours it with a
 * short-lived quote it re-signs every few seconds and stops signing when an event is coming (see
 * the runner). So a hold can't be used to bet on an event the fan sees coming, and what's left is
 * what waiting is worth. Events arrive as a Poisson process at the rate implied by the agent's own
 * price, and the fan is assumed to use the hold as well as anyone could:
 *
 * - **YES.** Waiting only makes YES less likely (the window shrinks), so the held price is never
 *   better than the one on offer later. Worth nothing; the fee is the floor.
 * - **NO.** Every quiet second makes NO likelier, so the fan waits to the end of the hold and bets
 *   only if nothing has happened. Worth `P(quiet through the hold) * (P(NO | quiet) / q - 1)`, which
 *   simplifies to `pNo / q - e^(-lambda * hold)`.
 *
 * The fee is that worth plus a markup and a floor, so on average the agent is paid more for a hold
 * than the hold costs it -- the simulator measures exactly that against fans who exercise this way.
 */
export function lockFeeBps(input: LockFeeInput): number | null {
  const holdSec = input.holdSec ?? LOCK_HOLD_SEC;
  const markup = input.markup ?? 0.25;
  const floorBps = input.floorBps ?? 100;
  const heldBps = input.side === "yes" ? input.probYesBps : input.probNoBps;

  if (heldBps < LOCK_MIN_PROB_BPS || heldBps > LOCK_MAX_PROB_BPS) return null;
  if (input.remainingSec < holdSec + LOCK_MIN_TAIL_SEC) return null;

  // The agent's fair view, with its margin taken back out.
  const pYes = input.probYesBps / (input.probYesBps + input.probNoBps);
  const lambda = -Math.log(1 - pYes) / input.remainingSec;
  const q = heldBps / BPS;

  const worth =
    input.side === "yes" ? 0 : Math.max(0, (1 - pYes) / q - Math.exp(-lambda * holdSec));

  const fee = Math.ceil(BPS * worth * (1 + markup) + floorBps);
  if (fee > LOCK_FEE_CEILING_BPS) return null;
  return Math.min(fee, LOCK_MAX_FEE_BPS);
}

/** The fee for holding `stake`, exactly as `OddsLock.buy` charges it (rounded up). */
export function lockFeeFor(stake: bigint, feeBps: number): bigint {
  return (stake * BigInt(feeBps) + 9999n) / 10_000n;
}

/**
 * The quote that honours a hold: the held price on the held side, and the most an agent may charge
 * on the other, so it's useless for anything but betting the held side. Sized to the stake held.
 * Short-lived like any quote (`expiry`, never past the hold's end): the agent re-signs it every few
 * seconds while the hold lasts, and stops while an event is coming, which is how a hold pauses
 * during big moments. Salted with the lock id so it's unique to this hold.
 */
export function honouringQuote(lock: {
  lockId: bigint;
  marketId: bigint;
  agentId: number;
  side: "yes" | "no";
  probBps: number;
  stake: bigint;
  heldUntil: bigint;
  /** Unix seconds; capped at `heldUntil`. */
  expiry: bigint;
}) {
  return {
    marketId: lock.marketId,
    agentId: lock.agentId,
    probYesBps: lock.side === "yes" ? lock.probBps : LOCK_MAX_PROB_BPS,
    probNoBps: lock.side === "no" ? lock.probBps : LOCK_MAX_PROB_BPS,
    maxStake: lock.stake,
    expiry: lock.expiry < lock.heldUntil ? lock.expiry : lock.heldUntil,
    salt: (1n << 255n) | lock.lockId,
  };
}

// ---------------------------------------------------------------------------------------------
// EIP-712: mirrors OddsLock's domain (`EIP712("Ninety Odds Lock", "1")`) and LOCK_OFFER_TYPEHASH.
// ---------------------------------------------------------------------------------------------

export const LOCK_DOMAIN_NAME = "Ninety Odds Lock";
export const LOCK_DOMAIN_VERSION = "1";

export const LOCK_OFFER_TYPES = {
  LockOffer: [
    { name: "marketId", type: "uint256" },
    { name: "agentId", type: "uint32" },
    { name: "side", type: "uint8" },
    { name: "probBps", type: "uint16" },
    { name: "maxStake", type: "uint128" },
    { name: "feeBps", type: "uint16" },
    { name: "holdSeconds", type: "uint32" },
    { name: "expiry", type: "uint64" },
    { name: "salt", type: "uint256" },
  ],
} as const;

export interface LockOffer {
  marketId: bigint;
  agentId: number;
  /** 0 = YES, 1 = NO, as `Side` in the contracts. */
  side: number;
  probBps: number;
  maxStake: bigint;
  feeBps: number;
  holdSeconds: number;
  expiry: bigint;
  salt: bigint;
}

export function lockDomain(chainId: number, verifyingContract: Address) {
  return {
    name: LOCK_DOMAIN_NAME,
    version: LOCK_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const;
}

export function signLockOffer(
  account: LocalAccount,
  chainId: number,
  oddsLock: Address,
  offer: LockOffer,
): Promise<Hex> {
  return account.signTypedData({
    domain: lockDomain(chainId, oddsLock),
    types: LOCK_OFFER_TYPES,
    primaryType: "LockOffer",
    message: offer,
  });
}

/** Wire format, bigints as decimal strings (see quote-wire.ts). */
export interface SignedLockOfferWire {
  offer: {
    marketId: string;
    agentId: number;
    side: number;
    probBps: number;
    maxStake: string;
    feeBps: number;
    holdSeconds: number;
    expiry: string;
    salt: string;
  };
  signature: Hex;
}

export function lockOfferToWire(offer: LockOffer, signature: Hex): SignedLockOfferWire {
  return {
    offer: {
      ...offer,
      marketId: offer.marketId.toString(),
      maxStake: offer.maxStake.toString(),
      expiry: offer.expiry.toString(),
      salt: offer.salt.toString(),
    },
    signature,
  };
}

export function lockOfferFromWire(wire: SignedLockOfferWire): { offer: LockOffer; signature: Hex } {
  return {
    offer: {
      marketId: BigInt(wire.offer.marketId),
      agentId: wire.offer.agentId,
      side: wire.offer.side,
      probBps: wire.offer.probBps,
      maxStake: BigInt(wire.offer.maxStake),
      feeBps: wire.offer.feeBps,
      holdSeconds: wire.offer.holdSeconds,
      expiry: BigInt(wire.offer.expiry),
      salt: BigInt(wire.offer.salt),
    },
    signature: wire.signature,
  };
}

/** The message a fan signs to collect the quote for their own hold from the relay. */
export function lockClaimMessage(lockId: bigint): string {
  return `Ninety: the price I'm holding (#${lockId})`;
}
