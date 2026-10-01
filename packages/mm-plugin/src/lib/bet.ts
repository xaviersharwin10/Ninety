import { freshQuotes, previewBet, type SignedQuote } from "@ninety/core";

export interface BetPlan {
  fills: { quote: SignedQuote["quote"]; signature: SignedQuote["signature"] }[];
  stake: bigint;
  /** What the bet pays if it wins, at the prices it's sent at. */
  payout: bigint;
  /** The least it may pay; the contract reverts the bet below it. */
  minPayout: bigint;
  blendedOdds: number;
}

export type PlanFailure = "no_prices" | "too_big" | "below_min_odds";

/**
 * The bet to send now: `stake` split across the best live prices (top three, 50/30/20, exactly as
 * the contract allocates it), counting only quotes with enough life left to land. `minOdds`, if
 * given, is the worst blended price the trader accepts. Each fill is a signed price, so what the
 * bet pays can't drift on the way: `minPayout` is that exact payout, and the bet either lands at it
 * or reverts.
 */
export function planBet(
  quotes: SignedQuote[],
  side: "yes" | "no",
  stake: bigint,
  opts: { minOdds?: number; nowMs?: number } = {},
): BetPlan | PlanFailure {
  const live = freshQuotes(quotes, opts.nowMs);
  if (live.length === 0) return "no_prices";
  const preview = previewBet(live, side, stake);
  if (preview.fillableStake !== stake) return "too_big";
  if (opts.minOdds !== undefined && preview.blendedOdds < opts.minOdds) return "below_min_odds";
  return {
    fills: preview.fills
      .filter((f) => f.stake > 0n)
      .map((f) => ({ quote: f.quote.quote, signature: f.quote.signature })),
    stake,
    payout: preview.totalPayout,
    minPayout: preview.totalPayout,
    blendedOdds: preview.blendedOdds,
  };
}
