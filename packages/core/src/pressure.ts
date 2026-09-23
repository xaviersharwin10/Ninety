import type { NormalizedEvent } from "./events.js";
import { TEMPLATE_QUALIFYING_EVENTS, type TemplateName } from "./templates.js";

/**
 * Counts events that qualify `template` within `(asOfSec - lookbackSec, asOfSec]` of match clock
 * time — the "recent pressure" figure `blendedRate` (in pricing.ts) turns into an adjusted event
 * rate for the live-state-aware house agents.
 *
 * Only ever looks backward from `asOfSec`: called with `events` that have actually been revealed
 * by that point (the live match-data feed, or a simulator's own progressive reveal), this can never
 * leak a qualifying event that hasn't happened yet. Callers are responsible for not passing future
 * events in — this function does not itself filter by "already revealed", only by match clock.
 */
export function countRecentQualifyingEvents(
  events: readonly NormalizedEvent[],
  template: TemplateName,
  asOfSec: number,
  lookbackSec: number,
): number {
  if (lookbackSec < 0) throw new Error(`lookbackSec must be >= 0, got ${lookbackSec}`);
  const qualifying = TEMPLATE_QUALIFYING_EVENTS[template];
  const from = asOfSec - lookbackSec;
  let count = 0;
  for (const e of events) {
    if (e.matchClockSec > from && e.matchClockSec <= asOfSec && qualifying.includes(e.type)) {
      count++;
    }
  }
  return count;
}
