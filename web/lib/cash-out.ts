import type { LocalAccount, TransactionReceipt } from "viem";
import type { PositionSide } from "./account-engine";
import { freshQuotes, previewBet } from "./bet-preview";
import { PriceMovedError, sendBet } from "./place-bet";
import type { SignedQuote } from "./quote-relay";

/**
 * Cash out, as a fan sees it: "take X now, whatever happens". Built from an ordinary bet rather
 * than a contract of its own: the fan backs the *other* side of the same market, sized so it pays
 * what their bet would -- then one of the two pays out, whichever way the market goes, and they
 * get the same either way. The price is the agents' own live quotes on that other side, so it's
 * as competitive as any bet, and the agents earn their margin on it like any bet. The money
 * arrives when the market settles, 1-3 minutes later, not at the tap; the UI says so.
 */
export interface CashOutOffer {
  /** What the fan ends up with whatever happens: the smaller of the two payouts, less the cover. */
  value: bigint;
  /** The stake of the covering bet on the other side. */
  coverStake: bigint;
  /** What the covering bet pays if it wins. */
  coverPayout: bigint;
}

/**
 * The best cash-out on offer for `held` (the fan's open bets on one side), priced from `opposite`,
 * the book for the other side. Null when there's no quote that will last, or not enough of the book
 * to cover the whole bet.
 */
export function cashOutOffer(
  held: PositionSide,
  heldSide: "yes" | "no",
  opposite: SignedQuote[],
  nowMs = Date.now(),
): CashOutOffer | null {
  const other = heldSide === "yes" ? "no" : "yes";
  const book = freshQuotes(opposite, nowMs);
  if (book.length === 0 || held.payout === 0n) return null;
  const cover = (stake: bigint) => previewBet(book, other, stake);

  // The whole payout staked on the other side always covers it (odds are at least 1x); if the book
  // can't take even that, it can't cover the bet.
  if (cover(held.payout).fillableStake < held.payout) return null;

  // Smallest cover stake whose payout reaches the held payout. Payout is monotonic in stake, so a
  // binary search over 6-decimal units is exact.
  let lo = 0n;
  let hi = held.payout;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (cover(mid).totalPayout >= held.payout) hi = mid;
    else lo = mid;
  }
  const coverPayout = cover(hi).totalPayout;
  const guaranteed = coverPayout < held.payout ? coverPayout : held.payout;
  const value = guaranteed - hi;
  if (value <= 0n) return null;
  return { value, coverStake: hi, coverPayout };
}

/** How far below the value shown a cash-out may land before it's abandoned: 3%, nothing spent. */
const VALUE_TOLERANCE_PCT = 97n;
const REPRICE_WAIT_MS = 4000;

/**
 * Cashes out: re-prices the cover from the live book at the moment it's sent, not when the fan
 * tapped -- the quotes it was shown on may have aged out of the book by then, and a cover fixed at
 * that moment would fall short -- and goes ahead only if the fan still gets at least 97% of what
 * they were shown. Waits briefly for the agents' next round of quotes rather than give up at once.
 */
export function placeCashOut(args: {
  account: LocalAccount;
  marketId: string;
  heldSide: "yes" | "no";
  held: PositionSide;
  shownValue: bigint;
  /** The live book for the *other* side, read at the moment of sending. */
  quotes: () => SignedQuote[];
}): Promise<TransactionReceipt> {
  const { account, marketId, heldSide, held, shownValue, quotes } = args;
  const other = heldSide === "yes" ? "no" : "yes";
  // The cover always pays at least what it stakes, so it never needs to stake more than the payout.
  return sendBet(account, marketId, other, held.payout, async () => {
    const deadline = Date.now() + REPRICE_WAIT_MS;
    for (;;) {
      const now = Date.now();
      const offer = cashOutOffer(held, heldSide, quotes(), now);
      if (offer && offer.value * 100n >= shownValue * VALUE_TOLERANCE_PCT) {
        const fills = previewBet(freshQuotes(quotes(), now), other, offer.coverStake);
        if (fills.fillableStake === offer.coverStake) {
          // The cover pays what the bet would (bar rounding), or this isn't a cash-out.
          return { fills, minPayout: (held.payout * 995n) / 1000n };
        }
      }
      if (Date.now() > deadline) throw new PriceMovedError();
      await new Promise((r) => setTimeout(r, 250));
    }
  });
}
