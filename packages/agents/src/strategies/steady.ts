import type { PricingStrategy, TemplateName } from "@ninety/core";
import { BASE_RATE_PER_SEC, marginedQuote, poissonProbability } from "@ninety/core";

/**
 * "Steady": conservative, base-rates-only pricing. Per the product spec (CLAUDE.md §6.10),
 * Steady prices off fixed historical base rates with a wide margin and low max exposure — it
 * deliberately does *not* read live match state (recent shots, current score, momentum). That is
 * "Tempo"'s job. Steady's price for a market therefore depends on nothing but the market's own
 * template and window length: same template, same window length, same quote, regardless of when
 * in the match it's offered or what just happened. This is what makes it the safe fallback house
 * agent — nothing about it can be thrown off by a live-data outage.
 */
export const STEADY_MARGIN_BPS = 300; // wider than the 200bps floor -- "wide margin" from the spec
export const STEADY_QUOTE_EXPIRY_SEC = 5; // short expiry so a stale quote can't be sniped

/** Hard ceiling per quote, independent of vault size — "low max exposure" from the spec. */
export const STEADY_MAX_STAKE_PER_QUOTE = 25_000_000n; // 25 AUSD (6 decimals)

export interface SteadyPriceInput {
  template: TemplateName;
  /** `windowEnd - windowStart` from the on-chain `Market`, in seconds. */
  windowSec: number;
}

export function steadyPrice(input: SteadyPriceInput): { probYesBps: number; probNoBps: number } {
  const lambda = BASE_RATE_PER_SEC[input.template];
  const pYes = poissonProbability(lambda, input.windowSec);
  return marginedQuote(pYes, STEADY_MARGIN_BPS);
}

/** The {@link PricingStrategy} shape `AgentRunner` and the simulator drive Steady through. */
export const steadyStrategy: PricingStrategy = {
  name: "Steady",
  maxStakePerQuote: STEADY_MAX_STAKE_PER_QUOTE,
  quoteExpirySec: STEADY_QUOTE_EXPIRY_SEC,
  lookbackSec: 0, // ignores live state entirely -- see the strategy note above
  price: (input) => steadyPrice({ template: input.template, windowSec: input.windowSec }),
};
