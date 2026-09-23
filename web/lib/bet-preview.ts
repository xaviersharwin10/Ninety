import { ladderAllocate, payoutFor } from "@ninety/core";
import type { SignedQuote } from "./quote-relay";

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
