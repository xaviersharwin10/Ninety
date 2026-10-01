import {
  fromWire,
  lockClaimMessage,
  lockFeeFor,
  payoutFor,
  type SignedQuoteWire,
} from "@ninety/core";
import { type LocalAccount, parseEventLogs, type TransactionReceipt } from "viem";
import { MIN_QUOTE_LIFE_MS, previewBet } from "./bet-preview";
import { ODDS_LOCK, OddsLockAbi } from "./contracts";
import { ensureAllowance } from "./erc20";
import { PriceMovedError, sendBet } from "./place-bet";
import { RELAY_HTTP_URL, type SignedLockOffer, type SignedQuote } from "./quote-relay";
import { revertErrorName, sendTx, TxRevertedError } from "./tx";

/**
 * Holding a price (Odds Lock, contracts/src/OddsLock.sol): pay a small fee and the price is the
 * fan's for a moment of the match (`holdRealSec`), to bet whenever they like in that time. The fee goes to the
 * agent who holds it; the bet, when it comes, is an ordinary bet at the held price.
 */
export interface Hold {
  lockId: bigint;
  marketId: string;
  side: "yes" | "no";
  probBps: number;
  stake: bigint;
  fee: bigint;
  /** Unix seconds. */
  heldUntil: number;
}

/** How long to wait for a fresh hold offer, or for the agent's quote honouring a hold. */
const WAIT_MS = 5000;

/** The fan's odds for a price held at `probBps`. */
export function heldOdds(probBps: number): number {
  return 10_000 / probBps;
}

export function holdSecondsLeft(hold: Hold, nowMs = Date.now()): number {
  return Math.max(0, hold.heldUntil - Math.floor(nowMs / 1000));
}

/**
 * Buys a hold on `stake` at the best offer on hand when it's sent -- which must hold a price at
 * least as good as the one the fan saw, for no more than the fee they saw.
 */
export async function buyHold(args: {
  account: LocalAccount;
  marketId: string;
  side: "yes" | "no";
  stake: bigint;
  /** The offer the fan tapped. */
  shown: SignedLockOffer;
  /** The live best offer, read at the moment of sending. */
  offer: () => SignedLockOffer | null;
}): Promise<Hold> {
  const { account, stake, shown } = args;
  // Prices and fees move every few seconds (a NO's shortens by the second as its window runs
  // down), so when the offer tapped has gone stale, a fresh one within a whisker of it -- 1% on the
  // payout, half a percent of the stake on the fee, the same kind of buffer a bet carries -- stands
  // in for it. Never more than that.
  const maxFee = lockFeeFor(stake, shown.offer.feeBps) + stake / 200n;
  const acceptable = (o: SignedLockOffer) =>
    o.offer.probBps * 99 <= shown.offer.probBps * 100 &&
    o.offer.maxStake >= stake &&
    lockFeeFor(stake, o.offer.feeBps) <= maxFee;
  const fresh = (o: SignedLockOffer) =>
    Number(o.offer.expiry) * 1000 - Date.now() >= MIN_QUOTE_LIFE_MS;

  // The first hold approves the hold contract for good, like the account's setup does for bets.
  await ensureAllowance(account, ODDS_LOCK, maxFee);

  const receipt = await sendTx(account, async (wallet) => {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const latest = args.offer();
      const pick = [shown, latest].find((o) => o && fresh(o));
      if (pick) {
        if (!acceptable(pick)) throw new PriceMovedError();
        return wallet.writeContract({
          address: ODDS_LOCK,
          abi: OddsLockAbi,
          functionName: "buy",
          args: [pick.offer, pick.signature, stake, maxFee],
        });
      }
      if (Date.now() > deadline) throw new PriceMovedError();
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  return holdFromReceipt(receipt);
}

function holdFromReceipt(receipt: TransactionReceipt): Hold {
  const [bought] = parseEventLogs({
    abi: OddsLockAbi,
    logs: receipt.logs,
    eventName: "LockBought",
  });
  if (!bought) throw new Error("hold bought, but no LockBought event in the receipt");
  const a = (bought as unknown as { args: unknown }).args as {
    lockId: bigint;
    marketId: bigint;
    side: number;
    probBps: number;
    stake: bigint;
    fee: bigint;
    heldUntil: bigint;
  };
  return {
    lockId: a.lockId,
    marketId: a.marketId.toString(),
    side: a.side === 0 ? "yes" : "no",
    probBps: a.probBps,
    stake: a.stake,
    fee: a.fee,
    heldUntil: Number(a.heldUntil),
  };
}

/**
 * Bets the held stake at the held price. The agent honours a hold with a short-lived quote it
 * re-signs every few seconds, handed only to whoever bought the hold; this proves that's the fan
 * by signing for it, then sends the bet on the freshest one. While a big moment pauses the market
 * there is none, and this waits briefly before giving up.
 */
export async function betHeld(account: LocalAccount, hold: Hold): Promise<TransactionReceipt> {
  const proof = await account.signMessage({ message: lockClaimMessage(hold.lockId) });
  const payout = payoutFor(hold.stake, BigInt(hold.probBps));
  return sendBet(account, hold.marketId, hold.side, hold.stake, async () => {
    const quote = await honouringQuote(hold.lockId, proof);
    const fills = previewBet([quote], hold.side, hold.stake);
    if (fills.fillableStake !== hold.stake) throw new PriceMovedError();
    return { fills, minPayout: payout };
  });
}

async function honouringQuote(lockId: bigint, proof: string): Promise<SignedQuote> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const res = await fetch(`${RELAY_HTTP_URL}/holds/${lockId}?signature=${proof}`).catch(
      () => null,
    );
    if (res?.ok) {
      const quote = fromWire(((await res.json()) as { quote: SignedQuoteWire }).quote);
      if (Number(quote.quote.expiry) * 1000 - Date.now() >= MIN_QUOTE_LIFE_MS) return quote;
    }
    if (Date.now() > deadline) throw new HoldUnavailableError();
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** The held price isn't on offer right now: a big moment has paused it, or the hold is over. */
export class HoldUnavailableError extends Error {}

export function holdErrorMessage(err: unknown): string {
  const nothingCharged = "Nothing was charged.";
  if (err instanceof HoldUnavailableError) {
    return "Your price is paused for a big moment. Try again in a few seconds.";
  }
  if (err instanceof PriceMovedError) {
    return `The price moved before your hold went out. ${nothingCharged}`;
  }
  if (err instanceof TxRevertedError) {
    return `That didn't go through — the market may have just closed. ${nothingCharged}`;
  }
  switch (revertErrorName(err)) {
    case "OfferExpired":
    case "OfferOverfilled":
    case "FeeAboveMaximum":
    case "QuoteExpired":
    case "QuoteOverfilled":
      return `The price moved before it went through. ${nothingCharged}`;
    case "MarketNotBettable":
      return `This market just closed. ${nothingCharged}`;
  }
  return `That couldn't go through. ${nothingCharged}`;
}
