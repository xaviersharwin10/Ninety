import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type EventType,
  type MatchPeriod,
  type NormalizedEvent,
  toMatchClockSec,
} from "@ninety/core";
import type { MatchDataAdapter, MatchTeam, RawMatchData } from "./types.js";

/** Minimal shape of a `processed-v2` Wyscout match file — only the fields this adapter reads. */
interface WyscoutEvent {
  id: number;
  eventName: string;
  subEventName?: string;
  tags: { id: number }[];
  teamId: number;
  playerId?: number;
  matchPeriod: string;
  eventSec: number;
}

interface WyscoutFile {
  events: WyscoutEvent[];
  teams: Record<string, { team: { wyId: number; name: string; officialName?: string } }>;
}

// Wyscout tag ids this adapter cares about. See docs/wyscout-fixtures.md for how these were
// confirmed against the vendored fixtures (there is no public tag-id reference bundled with the
// dataset, so these are pinned by example rather than by spec).
const TAG_ACCURATE = 1801;
const TAG_GOAL = 101;
const CARD_TAGS = new Set([1701, 1702, 1703]); // yellow, second yellow, red

function classify(e: WyscoutEvent): EventType {
  const tagIds = new Set(e.tags.map((t) => t.id));

  if (e.eventName === "Shot") {
    if (tagIds.has(TAG_GOAL)) return "goal";
    if (tagIds.has(TAG_ACCURATE)) return "shot_on_target";
    return "shot_off_target";
  }
  if (e.eventName === "Free Kick" && e.subEventName === "Corner") return "corner";
  if (e.eventName === "Foul" && [...tagIds].some((id) => CARD_TAGS.has(id))) return "card";
  return "other";
}

function isMatchPeriod(p: string): p is MatchPeriod {
  return p === "1H" || p === "2H" || p === "E1" || p === "E2" || p === "P";
}

export function parseWyscoutMatch(matchId: string, raw: WyscoutFile): RawMatchData {
  const events: NormalizedEvent[] = raw.events.map((e) => {
    if (!isMatchPeriod(e.matchPeriod)) {
      // Fail loud rather than silently drop or mis-clock an event from a period value this
      // adapter has never seen (the fixtures only ever carry "1H"/"2H").
      throw new Error(`Unrecognised matchPeriod "${e.matchPeriod}" on event ${e.id}`);
    }
    return {
      matchId,
      type: classify(e),
      teamId: e.teamId,
      period: e.matchPeriod,
      periodSec: e.eventSec,
      matchClockSec: toMatchClockSec(e.matchPeriod, e.eventSec),
      // exactOptionalPropertyTypes rejects `playerId: undefined` for an optional field -- it
      // wants the key absent, not present-with-undefined -- so this only sets it when real.
      ...(e.playerId !== undefined ? { playerId: e.playerId } : {}),
      source: { provider: "wyscout", eventId: e.id },
    };
  });

  events.sort((a, b) => a.matchClockSec - b.matchClockSec);

  const teams: MatchTeam[] = Object.values(raw.teams).map((t) => ({
    id: t.team.wyId,
    name: t.team.officialName ?? t.team.name,
  }));

  return { matchId, events, teams };
}

export interface WyscoutAdapterOptions {
  /** Checked first. Where the vendored CC BY 4.0 fixtures in `fixtures/` live. */
  fixturesDir?: string;
  /** Fallback: `${mirrorBase}/${matchId}.json`, fetched at runtime and never cached to disk. */
  mirrorBase?: string;
}

/**
 * Loads a Wyscout `processed-v2` match file, either from the vendored fixtures (fast, reliable,
 * demo-safe — no network dependency at showtime) or from the public mirror as a fallback for
 * matches not bundled in the repo. See `docs/wyscout-fixtures.md` for the fixtures' provenance
 * and why StatsBomb was ruled out as the primary source.
 */
export class WyscoutAdapter implements MatchDataAdapter {
  readonly provider = "wyscout";

  constructor(private readonly options: WyscoutAdapterOptions = {}) {}

  async loadMatch(matchId: string): Promise<RawMatchData> {
    const raw = await this.fetchRaw(matchId);
    return parseWyscoutMatch(matchId, raw);
  }

  private async fetchRaw(matchId: string): Promise<WyscoutFile> {
    if (this.options.fixturesDir) {
      try {
        const text = await readFile(join(this.options.fixturesDir, `${matchId}.json`), "utf8");
        return JSON.parse(text) as WyscoutFile;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        // Not vendored — fall through to the mirror.
      }
    }

    if (this.options.mirrorBase) {
      const url = `${this.options.mirrorBase.replace(/\/$/, "")}/${matchId}.json`;
      const res = await fetch(url);
      if (!res.ok)
        throw new Error(`Wyscout mirror fetch failed for ${matchId}: HTTP ${res.status}`);
      return (await res.json()) as WyscoutFile;
    }

    throw new Error(
      `No source configured for match ${matchId}: not in fixturesDir and no mirrorBase set`,
    );
  }
}
