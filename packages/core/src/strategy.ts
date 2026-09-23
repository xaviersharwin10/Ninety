import type { MarginedQuote } from "./pricing.js";
import type { TemplateName } from "./templates.js";

export interface PricingInput {
  template: TemplateName;
  /** `windowEnd - windowStart`, in seconds. */
  windowSec: number;
  /**
   * Qualifying events for `template` in the strategy's own lookback window, ending now. Always
   * `0` for a strategy whose `lookbackSec` is `0` (it never reads live state, so nothing needs to
   * compute this) and may be `0` for one that does, if nothing has happened recently.
   */
  recentQualifyingCount: number;
}

/**
 * One house agent's pricing behaviour, in the shape both `AgentRunner` (live, on chain) and the
 * simulator (offline, replayed) drive identically — the whole point being that neither can
 * silently diverge from what the other actually prices.
 */
export interface PricingStrategy {
  readonly name: string;
  /** Hard per-quote ceiling, independent of vault size. */
  readonly maxStakePerQuote: bigint;
  readonly quoteExpirySec: number;
  /**
   * How far back this strategy wants `recentQualifyingCount` computed from. `0` means "ignores
   * live state entirely" — a caller must not bother computing it, and may safely pass `0`.
   */
  readonly lookbackSec: number;
  price(input: PricingInput): MarginedQuote;
}
