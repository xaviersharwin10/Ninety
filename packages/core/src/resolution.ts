import type { NormalizedEvent } from "./events.js";
import { TEMPLATE_QUALIFYING_EVENTS, type TemplateName } from "./templates.js";

export type Outcome = "Yes" | "No";

export interface MarketResolution {
  outcome: Outcome;
  /** `matchClockSec` of the first qualifying event, for the on-chain bet-delay rule. `0` if none. */
  qualifyingEventTs: number;
  /** keccak256 over the ids of every event this resolution actually looked at, for later audit. */
  evidenceEventIds: number[];
}

/**
 * The single function CORE settlement outcomes come from — called by the match-data service's
 * settlement endpoint today, and by the Chainlink CRE workflow once it exists (per the
 * architecture notes, CRE fetches events over HTTP and computes the outcome itself; this is that
 * computation, shared rather than re-implemented in the workflow's own language).
 *
 * Pure and total: same events and window in, same {@link MarketResolution} out, every time. That
 * is what makes it safe to call from a settlement workflow that must be independently
 * re-derivable by anyone auditing a report against the match data.
 *
 * @param windowStart Inclusive, in `matchClockSec`.
 * @param windowEnd Exclusive, in `matchClockSec` — matches the on-chain `Market.windowEnd` semantics.
 */
export function resolveMarket(
  events: readonly NormalizedEvent[],
  template: TemplateName,
  windowStart: number,
  windowEnd: number,
): MarketResolution {
  const qualifying = TEMPLATE_QUALIFYING_EVENTS[template];

  const inWindow = events.filter(
    (e) => e.matchClockSec >= windowStart && e.matchClockSec < windowEnd,
  );
  const hits = inWindow.filter((e) => qualifying.includes(e.type));
  // Evidence is always the full in-window scan, win or lose: an auditor needs to see that
  // nothing was skipped, not just the events that happened to matter.
  const evidenceEventIds = inWindow.map((e) => e.source.eventId);

  if (hits.length === 0) {
    return { outcome: "No", qualifyingEventTs: 0, evidenceEventIds };
  }

  const first = hits.reduce((a, b) => (a.matchClockSec <= b.matchClockSec ? a : b));
  return { outcome: "Yes", qualifyingEventTs: first.matchClockSec, evidenceEventIds };
}
