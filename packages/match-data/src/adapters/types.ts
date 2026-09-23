import type { NormalizedEvent } from "@ninety/core";

export interface MatchTeam {
  id: number;
  name: string;
}

export interface RawMatchData {
  matchId: string;
  /** Sorted ascending by `matchClockSec` — every consumer (replay clock, resolution, ticker) relies on this. */
  events: NormalizedEvent[];
  teams: MatchTeam[];
}

export interface MatchDataAdapter {
  readonly provider: string;
  loadMatch(matchId: string): Promise<RawMatchData>;
}
