import type { PricingStrategy, TemplateName } from "@ninety/core";
import { BASE_RATE_PER_SEC, blendedRate, marginedQuote, poissonProbability } from "@ninety/core";

/**
 * "Pulse": aggressive pricing (CLAUDE.md §6.10) -- tighter margin, higher exposure, reacts fastest
 * to momentum. Same Poisson-Gamma blend as Tempo, but tuned at both ends: a much shorter lookback
 * (90s instead of 5min) so a burst of play moves its price sooner, and a prior window only
 * slightly larger than that lookback, so it trusts what it just saw more than Tempo does and
 * shrinks toward the base rate less. The margin sits at `BetRouter.MIN_MARGIN_BPS`, the tightest
 * legal overround, rather than at some smaller-but-still-comfortable number -- "aggressive" here
 * means literally as tight as the contract allows, not merely "tighter than the others".
 *
 * CLAUDE.md also floats Pulse optionally using an LLM (KIMI) for parameter nudges or live
 * commentary, as a credits bounty. That is explicitly IF-TIME-PERMITS (§9.2) and not built here;
 * Pulse's aggressiveness comes entirely from the quantitative tuning below.
 */
export const PULSE_MARGIN_BPS = 200; // BetRouter.MIN_MARGIN_BPS -- the tightest legal overround
export const PULSE_QUOTE_EXPIRY_SEC = 5;
export const PULSE_MAX_STAKE_PER_QUOTE = 50_000_000n; // 50 AUSD -- highest of the three

export const PULSE_LOOKBACK_SEC = 90;
export const PULSE_PRIOR_WINDOW_SEC = 4 * 60;

export interface PulsePriceInput {
  template: TemplateName;
  windowSec: number;
  /** Qualifying events for `template` in the last {@link PULSE_LOOKBACK_SEC}. */
  recentQualifyingCount: number;
}

export function pulsePrice(input: PulsePriceInput): { probYesBps: number; probNoBps: number } {
  const base = BASE_RATE_PER_SEC[input.template];
  const lambda = blendedRate(
    base,
    input.recentQualifyingCount,
    PULSE_LOOKBACK_SEC,
    PULSE_PRIOR_WINDOW_SEC,
  );
  const pYes = poissonProbability(lambda, input.windowSec);
  return marginedQuote(pYes, PULSE_MARGIN_BPS);
}

export const pulseStrategy: PricingStrategy = {
  name: "Pulse",
  maxStakePerQuote: PULSE_MAX_STAKE_PER_QUOTE,
  quoteExpirySec: PULSE_QUOTE_EXPIRY_SEC,
  lookbackSec: PULSE_LOOKBACK_SEC,
  price: (input) =>
    pulsePrice({
      template: input.template,
      windowSec: input.windowSec,
      recentQualifyingCount: input.recentQualifyingCount,
    }),
};
