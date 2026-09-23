import { countRecentQualifyingEvents, type NormalizedEvent, type TemplateName } from "@ninety/core";

/** What a live-state-aware strategy (Tempo, Pulse) needs from the running match. */
export interface MatchStateProvider {
  /** Qualifying events for `template` in the last `lookbackSec`, ending now. */
  recentQualifyingCount(template: TemplateName, lookbackSec: number): Promise<number>;
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
}
