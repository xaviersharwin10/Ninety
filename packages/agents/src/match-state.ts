import {
  countRecentQualifyingEvents,
  type EventType,
  type LiveWindow,
  liveWindow,
  type NormalizedEvent,
  type TemplateName,
} from "@ninety/core";

/** What a live-state-aware strategy (Tempo, Pulse) needs from the running match. */
export interface MatchStateProvider {
  /** Qualifying events for `template` in the last `lookbackSec`, ending now. */
  recentQualifyingCount(template: TemplateName, lookbackSec: number): Promise<number>;
  /**
   * Event types imminent or just happened (match-data's `danger`), so the agent can stop quoting
   * markets they would decide. Optional: a provider without it never pauses quoting.
   */
  dangerTypes?(): Promise<EventType[]>;
  /**
   * Where a market's window stands right now: already decided, and how much of it is left to price
   * (see `liveWindow` in @ninety/core). Optional: without it, an agent prices the whole window.
   */
  liveWindow?(template: TemplateName, windowStart: number, windowEnd: number): Promise<LiveWindow>;
  /** Match seconds per real second: 1 live, more in a fast replay. Optional: without it, 1. */
  speed?(): Promise<number>;
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
  ) {}

  async recentQualifyingCount(template: TemplateName, lookbackSec: number): Promise<number> {
    const url = `${this.matchDataBaseUrl.replace(/\/$/, "")}/matches/${this.matchId}/events`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`match-data /events fetch failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { events: NormalizedEvent[] };
    if (body.events.length === 0) return 0;

    const asOfSec = Math.max(...body.events.map((e) => e.matchClockSec));
    return countRecentQualifyingEvents(body.events, template, asOfSec, lookbackSec);
  }

  async liveWindow(
    template: TemplateName,
    windowStart: number,
    windowEnd: number,
  ): Promise<LiveWindow> {
    const base = this.matchDataBaseUrl.replace(/\/$/, "");
    const [stateRes, eventsRes] = await Promise.all([
      fetch(`${base}/matches/${this.matchId}/state`),
      fetch(`${base}/matches/${this.matchId}/events`),
    ]);
    if (!stateRes.ok || !eventsRes.ok) {
      throw new Error(`match-data fetch failed: HTTP ${stateRes.status}/${eventsRes.status}`);
    }
    const { matchClockSec } = (await stateRes.json()) as { matchClockSec: number };
    const { events } = (await eventsRes.json()) as { events: NormalizedEvent[] };
    return liveWindow(events, template, windowStart, windowEnd, matchClockSec);
  }

  async dangerTypes(): Promise<EventType[]> {
    return (await this.state()).danger;
  }

  async speed(): Promise<number> {
    return (await this.state()).speed ?? 1;
  }

  private async state(): Promise<{ danger: EventType[]; speed?: number }> {
    const url = `${this.matchDataBaseUrl.replace(/\/$/, "")}/matches/${this.matchId}/state`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`match-data /state fetch failed: HTTP ${res.status}`);
    return (await res.json()) as { danger: EventType[]; speed?: number };
  }
}
