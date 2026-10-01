import type { NormalizedEvent } from "@ninety/core";

/** An event placed on one shared pitch, home attacking left to right, 0-100 on both axes. */
export interface PitchPoint {
  id: number;
  type: NormalizedEvent["type"];
  isHome: boolean;
  x: number;
  y: number;
}

/** How many touches the trail to the ball shows. */
const TRAIL = 8;
/** How long a big moment stays marked, in match seconds. */
const MOMENT_SEC = 60;

/**
 * Where `event` happened on a pitch drawn with the home side attacking to the right. Event
 * coordinates are from the acting team's point of view (it always attacks x=100), so an away
 * team's event is turned round: both axes mirrored. Null for an event with no position.
 */
export function pitchPoint(event: NormalizedEvent, homeId: number | undefined): PitchPoint | null {
  if (!event.position) return null;
  const isHome = event.teamId === homeId;
  return {
    id: event.source.eventId,
    type: event.type,
    isHome,
    x: isHome ? event.position.x : 100 - event.position.x,
    y: isHome ? event.position.y : 100 - event.position.y,
  };
}

/** The last few touches up to `nowSec`, oldest first; the last one is where the ball is. */
export function recentPlay(
  events: readonly NormalizedEvent[],
  homeId: number | undefined,
  nowSec: number,
): PitchPoint[] {
  const out: PitchPoint[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < TRAIL; i--) {
    const e = events[i]!;
    if (e.matchClockSec > nowSec) continue;
    const p = pitchPoint(e, homeId);
    if (p) out.push(p);
  }
  return out.reverse();
}

/** Shots, goals, corners and cards from the last minute of play, to mark on the pitch. */
export function recentMoments(
  events: readonly NormalizedEvent[],
  homeId: number | undefined,
  nowSec: number,
): PitchPoint[] {
  return events
    .filter(
      (e) =>
        e.type !== "other" && e.matchClockSec <= nowSec && e.matchClockSec > nowSec - MOMENT_SEC,
    )
    .map((e) => pitchPoint(e, homeId))
    .filter((p): p is PitchPoint => p !== null);
}
