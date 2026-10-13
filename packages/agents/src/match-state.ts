import {
  countRecentQualifyingEvents,
  type EventType,
  type LiveWindow,
  liveWindow,
  type NormalizedEvent,
  type TemplateName,
  teamIdFor,
} from "@ninety/core";

/** What a live-state-aware strategy (Tempo, Pulse) needs from the running match. */
export interface MatchStateProvider {
  /** Qualifying events for `template` in the last `lookbackSec`, ending now. */
  recentQualifyingCount(
    template: TemplateName,
    lookbackSec: number,
    teamFilter?: number,
  ): Promise<number>;
  /**
   * Event types imminent or just happened (match-data's `danger`), so the agent can stop quoting
   * markets they would decide. Optional: a provider without it never pauses quoting.
   */
  dangerTypes?(): Promise<EventType[]>;
  /**
   * Where a market's window stands right now: already decided, and how much of it is left to price
   * (see `liveWindow` in @ninety/core). Optional: without it, an agent prices the whole window.
   */
  liveWindow?(
    template: TemplateName,
    windowStart: number,
    windowEnd: number,
    teamFilter?: number,
  ): Promise<LiveWindow>;
  /** Match seconds per real second: 1 live, more in a fast replay. Optional: without it, 1. */
  speed?(): Promise<number>;
}

const MATCH_DATA_TTL_MS = 1000;
const matchDataCache = new Map<string, { at: number; body: Promise<unknown> }>();

/**
 * A match-data read, shared for a second. Pricing one market asks for the match's state and its
 * events several times over, and three agents price several markets each cycle: uncached, that was
 * dozens of requests a cycle, each carrying every event aired so far. On a small host that work
 * alone used the whole CPU, and prices arrived late or not at all. A second is well inside the
 * lead time quotes are pulled ahead of a big moment.
 */
export function matchDataJson<T>(url: string): Promise<T> {
  const now = Date.now();
  const hit = matchDataCache.get(url);
  if (hit && now - hit.at < MATCH_DATA_TTL_MS) return hit.body as Promise<T>;
  const body = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`match-data fetch failed: HTTP ${res.status} ${url}`);
    return res.json();
  });
  // A failed read isn't kept: the next caller tries again.
  body.catch(() => {
    if (matchDataCache.get(url)?.body === body) matchDataCache.delete(url);
  });
  matchDataCache.set(url, { at: now, body });
  return body as Promise<T>;
}

/** For tests, which change what match-data answers between calls. */
export function clearMatchDataCache(): void {
  matchDataCache.clear();
}

/**
 * Reads recent pressure from a running `match-data` replay server over HTTP. The server has no
 * notion of "now" other than what it has already revealed, so "now" here is simply the latest
 * `matchClockSec` among the events it has emitted so far -- fetching `/matches/:id/events` with no
 * bounds already returns only what has actually aired, so this can never leak a future event.
 *
 * One instance is scoped to a single match, matching the rest of this codebase's stance that a
 * live deployment runs one match at a time (see `AgentRegistry`'s doc comment on why `eth_getLogs`
 * range limits already rule out a more general multi-match discovery path for the runner).
 */
export class HttpMatchStateProvider implements MatchStateProvider {
  constructor(
    private readonly matchDataBaseUrl: string,
    private readonly matchId: string,
    /** The match's teams, home first: what a market's team filter (1 = home, 2 = away) selects. */
    private readonly teams: readonly { id: number }[] = [],
  ) {}

  async recentQualifyingCount(
    template: TemplateName,
    lookbackSec: number,
    teamFilter = 0,
  ): Promise<number> {
    const url = `${this.matchDataBaseUrl.replace(/\/$/, "")}/matches/${this.matchId}/events`;
    const body = await matchDataJson<{ events: NormalizedEvent[] }>(url);
    if (body.events.length === 0) return 0;

    const asOfSec = Math.max(...body.events.map((e) => e.matchClockSec));
    return countRecentQualifyingEvents(
      body.events,
      template,
      asOfSec,
      lookbackSec,
      teamIdFor(teamFilter, this.teams),
    );
  }

  async liveWindow(
    template: TemplateName,
    windowStart: number,
    windowEnd: number,
    teamFilter = 0,
  ): Promise<LiveWindow> {
    const base = this.matchDataBaseUrl.replace(/\/$/, "");
    const [{ matchClockSec }, { events }] = await Promise.all([
      matchDataJson<{ matchClockSec: number }>(`${base}/matches/${this.matchId}/state`),
      matchDataJson<{ events: NormalizedEvent[] }>(`${base}/matches/${this.matchId}/events`),
    ]);
    return liveWindow(
      events,
      template,
      windowStart,
      windowEnd,
      matchClockSec,
      teamIdFor(teamFilter, this.teams),
    );
  }

  async dangerTypes(): Promise<EventType[]> {
    return (await this.state()).danger;
  }

  async speed(): Promise<number> {
    return (await this.state()).speed ?? 1;
  }

  private async state(): Promise<{ danger: EventType[]; speed?: number }> {
    const url = `${this.matchDataBaseUrl.replace(/\/$/, "")}/matches/${this.matchId}/state`;
    return matchDataJson<{ danger: EventType[]; speed?: number }>(url);
  }
}
