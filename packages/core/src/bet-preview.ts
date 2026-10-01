import type { Hex } from "viem";
import type { Quote } from "./eip712.js";
import { ladderAllocate, payoutFor } from "./oddsMath.js";

/** A quote with the agent signature that makes it fillable. */
export interface SignedQuote {
  quote: Quote;
  signature: Hex;
}

const LADDER_BPS = [5000n, 3000n, 2000n];

export interface BetFill {
  quote: SignedQuote;
  stake: bigint;
  probBps: number;
  payout: bigint;
}

export interface BetPreview {
  /** What will actually be staked -- clipped down from the requested amount if the book can't
   *  fill it all, exactly like `BetRouter.placeBet` would (it reverts rather than partial-fill). */
  fillableStake: bigint;
  requestedStake: bigint;
  totalPayout: bigint;
  blendedOdds: number;
  fills: BetFill[];
}

/**
 * Previews exactly what `BetRouter.placeBet` would do with these quotes and this stake, using the
 * same ladder-allocation and payout math the contract runs (`@ninety/core`'s `oddsMath.ts` is a
 * byte-exact TypeScript port of `OddsMath.sol`) -- not an approximation of it.
 */
export function previewBet(
  quotes: SignedQuote[],
  side: "yes" | "no",
  requestedStake: bigint,
): BetPreview {
  const ranked = quotes.slice(0, 3); // the relay already returns best-price-first
  if (ranked.length === 0 || requestedStake === 0n) {
    return { fillableStake: 0n, requestedStake, totalPayout: 0n, blendedOdds: 0, fills: [] };
  }

  const caps = ranked.map((q) => q.quote.maxStake);
  const available = caps.reduce((a, b) => a + b, 0n);
  const stake = requestedStake < available ? requestedStake : available;

  const weights = LADDER_BPS.slice(0, ranked.length);
  const stakes = ladderAllocate(stake, caps, weights);

  const fills: BetFill[] = ranked.map((q, i) => {
    const probBps = side === "yes" ? q.quote.probYesBps : q.quote.probNoBps;
    const fillStake = stakes[i] ?? 0n;
    const payout = fillStake > 0n ? payoutFor(fillStake, BigInt(probBps)) : 0n;
    return { quote: q, stake: fillStake, probBps, payout };
  });

  const totalPayout = fills.reduce((sum, f) => sum + f.payout, 0n);
  const blendedOdds = stake > 0n ? Number(totalPayout) / Number(stake) : 0;

  return { fillableStake: stake, requestedStake, totalPayout, blendedOdds, fills };
}

/**
 * How long a quote must still have to live when a bet is sent, in milliseconds. Once sent, a bet is
 * included on Monad in about a second, after signing and a gas estimate; a quote with less left
 * could expire on the way and the bet revert -- and Monad bills a reverted transaction its full gas
 * limit. Measured in real milliseconds, not whole seconds: comparing `expiry` with the current
 * second let through quotes with barely one second left, and they did expire in flight. Not much
 * stricter than this, though: agents re-quote every few seconds on a 5s expiry, so a higher bar
 * leaves too little of the book usable at any moment (a cash-out, which needs the other side's
 * whole book, felt that first).
 */
export const MIN_QUOTE_LIFE_MS = 2500;

/** Quotes that will still be valid by the time a bet sent now lands, best price first. */
export function freshQuotes(quotes: SignedQuote[], nowMs = Date.now()): SignedQuote[] {
  return quotes.filter((q) => Number(q.quote.expiry) * 1000 - nowMs >= MIN_QUOTE_LIFE_MS);
}
