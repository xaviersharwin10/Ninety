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

export interface LiveWindow {
  /** A qualifying event has already happened in the window: the market is effectively over. */
  decided: boolean;
  /** Seconds of the window still to play from `nowSec` -- what a quote should actually price. */
  remainingSec: number;
}

/**
 * Where a market's window stands at match-clock `nowSec`. A quote priced over the whole window no
 * matter how much of it has already played is wrong in a way informed bettors exploit: with 20s
 * left of a 3-minute corner market, YES is priced far too high and NO far too cheap. And once a
 * qualifying event has happened, there is nothing left to price: a YES bet from then on is voided
 * by the bet-delay rule, and a NO bet is a certain loss for whoever places it.
 *
 * Like `countRecentQualifyingEvents`, only looks at events up to `nowSec`; callers pass what has
 * actually been revealed.
 */
export function liveWindow(
  events: readonly NormalizedEvent[],
  template: TemplateName,
  windowStart: number,
  windowEnd: number,
  nowSec: number,
): LiveWindow {
  const qualifying = TEMPLATE_QUALIFYING_EVENTS[template];
  const decided = events.some(
    (e) =>
      e.matchClockSec >= windowStart &&
      e.matchClockSec < windowEnd &&
      e.matchClockSec <= nowSec &&
      qualifying.includes(e.type),
  );
  const remainingSec = Math.max(0, windowEnd - Math.max(nowSec, windowStart));
  return { decided, remainingSec };
}
