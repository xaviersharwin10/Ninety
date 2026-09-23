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

export interface MatchSummary {
  matchId: string;
  teams: MatchTeam[];
}

export interface MatchDataAdapter {
  readonly provider: string;
  loadMatch(matchId: string): Promise<RawMatchData>;
  /** Every match this adapter can serve, without loading each one's full event list. Optional --
   *  an adapter with no fixed catalogue (e.g. a future live-feed adapter) can leave it unset. */
  listMatches?(): Promise<MatchSummary[]>;
}
