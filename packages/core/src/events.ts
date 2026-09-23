/**
 * The normalised event model every match-data adapter produces, and the only shape
 * {@link resolveMarket} and the replay engine ever see. Adapter-specific fields (Wyscout tag IDs,
 * StatsBomb-shaped payloads, a future live-feed's schema) stop at the adapter boundary.
 */

export type MatchPeriod = "1H" | "2H" | "E1" | "E2" | "P";

/**
 * The four qualifying event kinds CORE market templates resolve against, plus a catch-all for
 * everything an adapter parses but no market cares about (passes, duels, ...). Keeping `other`
 * events in the stream (rather than dropping them at the adapter) lets the event ticker show real
 * match texture, not just the handful of seconds that happen to matter for settlement.
 */
export type EventType = "shot_on_target" | "shot_off_target" | "goal" | "corner" | "card" | "other";

/**
 * Nominal seconds-since-kickoff at which each period is conventionally understood to start, used
 * to build a single monotonic match clock out of Wyscout's per-period `eventSec`.
 *
 * This is a deliberate simplification: stoppage time pushes real events past these boundaries (a
 * 1H event at 47:30 has a larger raw `periodSec` than a 2H kickoff event), so events very late in
 * stoppage time can carry a `matchClockSec` that overlaps with the start of the next period. CORE
 * markets never span a half-time boundary in practice (they are opened live during a specific
 * half), so this has not needed a more careful treatment; see `docs/match-clock.md` before relying
 * on it near a period boundary.
 */
export const PERIOD_OFFSET_SEC: Record<MatchPeriod, number> = {
  "1H": 0,
  "2H": 45 * 60,
  E1: 90 * 60,
  E2: 105 * 60,
  P: 120 * 60,
};

export interface NormalizedEvent {
  matchId: string;
  type: EventType;
  /** Raw provider team id. CORE templates never filter by team; carried through for the ticker. */
  teamId: number;
  period: MatchPeriod;
  /** Seconds into `period`, as the source data reports it. */
  periodSec: number;
  /** `PERIOD_OFFSET_SEC[period] + periodSec` — the single increasing clock markets are windowed against. */
  matchClockSec: number;
  playerId?: number;
  /** Where this event came from, for the evidence hash and for debugging a surprising resolution. */
  source: { provider: "wyscout"; eventId: number };
}

export function toMatchClockSec(period: MatchPeriod, periodSec: number): number {
  return PERIOD_OFFSET_SEC[period] + periodSec;
}
