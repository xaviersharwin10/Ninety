import type { PositionSide } from "./account-engine";
import { freshQuotes, previewBet } from "./bet-preview";
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
