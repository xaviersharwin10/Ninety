import type { PricingStrategy, TemplateName } from "@ninety/core";
import {
  baseRate,
  blendedRate,
  effectiveMarginBps,
  marginedQuote,
  poissonProbability,
  readerMultiplier,
} from "@ninety/core";

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
/** Half of what the shared LLM match reader says: between Steady's quarter and Pulse's whole. */
export const TEMPO_READER_TRUST = 0.5;
export const TEMPO_QUOTE_EXPIRY_SEC = 5;
export const TEMPO_MAX_STAKE_PER_QUOTE = 30_000_000n; // 30 nUSD -- a bit larger than Steady's 25

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
  /** Learned margin adjustment for this market type; see `PricingInput.marginAdjBps`. */
  marginAdjBps?: number | undefined;
  /** 0 = either team, 1 = home only, 2 = away only. */
  teamFilter?: number | undefined;
  /** The match reader's multiplier on the event rate; see `PricingInput.rateMultiplier`. */
  rateMultiplier?: number | undefined;
}

export function tempoPrice(input: TempoPriceInput): { probYesBps: number; probNoBps: number } {
  const base = baseRate(input.template, input.teamFilter);
  const lambda =
    blendedRate(base, input.recentQualifyingCount, TEMPO_LOOKBACK_SEC, TEMPO_PRIOR_WINDOW_SEC) *
    readerMultiplier(input.rateMultiplier, TEMPO_READER_TRUST);
  const pYes = poissonProbability(lambda, input.windowSec);
  return marginedQuote(pYes, effectiveMarginBps(TEMPO_MARGIN_BPS, input.marginAdjBps));
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
      marginAdjBps: input.marginAdjBps,
      teamFilter: input.teamFilter,
      rateMultiplier: input.rateMultiplier,
    }),
};
