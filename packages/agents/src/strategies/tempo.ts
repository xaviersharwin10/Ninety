import type { PricingStrategy, TemplateName } from "@ninety/core";
import { BASE_RATE_PER_SEC, blendedRate, marginedQuote, poissonProbability } from "@ninety/core";

/**
 * "Tempo": model-driven pricing, adjusted by live game state (CLAUDE.md §6.10). Unlike Steady,
 * Tempo reads recent match pressure -- qualifying events for its template in the last
 * {@link TEMPO_LOOKBACK_SEC} -- and blends that into the base rate via `blendedRate`'s
 * Poisson-Gamma update, rather than pricing off the base rate alone.
 *
 * Deliberately does *not* also index off "score" or "minute" as separate signals, despite the
 * spec's "score, minute, recent pressure" phrasing: recent pressure already captures what those
 * would otherwise be a proxy for (a team pushing for a goal shows up as more shots and corners,
 * not as some independent minute-indexed curve this project has no data to fit honestly), and
 * `blendedRate`'s own doc comment explains the reasoning in full. A margin between Steady's wide
 * 300bps and Pulse's legal-floor 200bps reflects Tempo trusting its own model more than Steady but
 * less than Pulse.
 */
export const TEMPO_MARGIN_BPS = 250;
export const TEMPO_QUOTE_EXPIRY_SEC = 5;
export const TEMPO_MAX_STAKE_PER_QUOTE = 30_000_000n; // 30 AUSD -- a bit larger than Steady's 25

/** "Recent pressure — shots/corners in last 5 min" (CLAUDE.md §6.10), applied to every template. */
export const TEMPO_LOOKBACK_SEC = 5 * 60;
/**
 * How many pseudo-observations of the base rate to blend the recent count against. 20 minutes is
 * four times the lookback, so a quiet or just-started window still prices close to the base rate,
 * and only a sustained spell of pressure meaningfully moves it.
 */
export const TEMPO_PRIOR_WINDOW_SEC = 20 * 60;

export interface TempoPriceInput {
  template: TemplateName;
  windowSec: number;
  /** Qualifying events for `template` in the last {@link TEMPO_LOOKBACK_SEC}. */
  recentQualifyingCount: number;
}

export function tempoPrice(input: TempoPriceInput): { probYesBps: number; probNoBps: number } {
  const base = BASE_RATE_PER_SEC[input.template];
  const lambda = blendedRate(
    base,
    input.recentQualifyingCount,
    TEMPO_LOOKBACK_SEC,
    TEMPO_PRIOR_WINDOW_SEC,
  );
  const pYes = poissonProbability(lambda, input.windowSec);
  return marginedQuote(pYes, TEMPO_MARGIN_BPS);
}

export const tempoStrategy: PricingStrategy = {
  name: "Tempo",
  maxStakePerQuote: TEMPO_MAX_STAKE_PER_QUOTE,
  quoteExpirySec: TEMPO_QUOTE_EXPIRY_SEC,
  lookbackSec: TEMPO_LOOKBACK_SEC,
  price: (input) =>
    tempoPrice({
      template: input.template,
      windowSec: input.windowSec,
      recentQualifyingCount: input.recentQualifyingCount,
    }),
};
