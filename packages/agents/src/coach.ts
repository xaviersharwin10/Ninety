import {
  type AgentNote,
  agentNoteMessage,
  type NormalizedEvent,
  TEMPLATE_NAMES,
  TEMPLATE_QUALIFYING_EVENTS,
  type TemplateName,
} from "@ninety/core";
import type { LocalAccount } from "viem/accounts";

/**
 * Pulse's match reader: an LLM that looks at the match the way a trader would -- the score, the
 * minute, who has been attacking -- and says how much more or less likely each kind of event is
 * right now than the numbers alone suggest.
 *
 * It is not in the path of a quote. Quotes are re-signed every few seconds and live for five; an
 * LLM call takes a second or two and can fail. So the reader runs beside the agent, a couple of
 * times a minute, and leaves behind a multiplier per market type and team that the pricing model
 * picks up on its next quote (see `rateMultiplier` in pulse.ts, which also bounds it). If the
 * reader is slow, down or talking nonsense, its last read simply ages out and Pulse prices on its
 * own model, exactly as it did before it had one.
 */

/** One OpenAI-compatible chat endpoint. Several can be given; each is tried in turn. */
export interface LlmEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** The endpoints configured in the environment: LLM_* first, then LLM_FALLBACK_*. */
export function llmEndpointsFromEnv(env: Record<string, string | undefined>): LlmEndpoint[] {
  const out: LlmEndpoint[] = [];
  for (const prefix of ["LLM", "LLM_FALLBACK"]) {
    const baseUrl = env[`${prefix}_BASE_URL`];
    const apiKey = env[`${prefix}_API_KEY`];
    const model = env[`${prefix}_MODEL`];
    if (baseUrl && apiKey && model)
      out.push({ baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model });
  }
  return out;
}

export interface MatchSnapshot {
  /** Home first. */
  teams: readonly { id: number; name: string }[];
  clockSec: number;
  /** Everything that has aired so far. */
  events: readonly NormalizedEvent[];
}

export interface MatchRead {
  /** Keyed `${template}:${teamFilter}`; 1 means "as likely as usual". */
  multipliers: Record<string, number>;
  note: string;
  at: number;
}

const SHORT: Record<TemplateName, string> = {
  SHOT_ON_TARGET_NEXT_N: "shot_on_target",
  CORNER_NEXT_N: "corner",
  CARD_NEXT_N: "card",
  GOAL_NEXT_N: "goal",
};
const SCOPES = ["either", "home", "away"] as const;
/** What a typical match produces, both teams together: the baseline the reader adjusts. */
const PER_MATCH: Record<TemplateName, number> = {
  SHOT_ON_TARGET_NEXT_N: 9,
  CORNER_NEXT_N: 10,
  CARD_NEXT_N: 3.5,
  GOAL_NEXT_N: 2.6,
};
/** How far back the reader is shown the match, event by event. */
const RECENT_SEC = 12 * 60;
const MAX_NOTE_CHARS = 160;

const SYSTEM = `You are the match reader for a football in-play market maker. Markets ask whether an event (a shot on target, a corner, a card, a goal) will happen in the next few minutes, for either team or for one named team.

You are given the score, the minute and the recent events. Judge the state of play as an experienced trader would: who is on top, whether the game is open or closed, whether a team is chasing or protecting a lead, whether tempers are rising.

Reply with JSON only, in exactly this shape:
{"shot_on_target":{"either":1,"home":1,"away":1},"corner":{"either":1,"home":1,"away":1},"card":{"either":1,"home":1,"away":1},"goal":{"either":1,"home":1,"away":1},"note":"..."}

Each number multiplies the usual rate of that event over the next few minutes: 1 means as likely as usual, 1.5 means half again as likely, 0.7 means less likely. Stay between 0.5 and 2, and stay near 1 unless the play gives a reason. "note" is one plain sentence, at most 140 characters, naming the teams, saying what you see and what you moved because of it.`;

/** The reader's view of the match, as the user message. */
export function describeMatch(snapshot: MatchSnapshot): string {
  const [home, away] = snapshot.teams;
  const name = (teamId: number) =>
    teamId === home?.id ? home.name : teamId === away?.id ? away.name : "?";
  const goals = (teamId: number | undefined) =>
    snapshot.events.filter((e) => e.type === "goal" && e.teamId === teamId).length;
  const minute = Math.floor(snapshot.clockSec / 60);
  const lines = [
    `Home: ${home?.name ?? "?"}. Away: ${away?.name ?? "?"}.`,
    `Minute ${minute}. Score: ${home?.name ?? "home"} ${goals(home?.id)}-${goals(away?.id)} ${away?.name ?? "away"}.`,
    `A typical match has, both teams together: ${TEMPLATE_NAMES.map((t) => `${PER_MATCH[t]} ${SHORT[t]}s`).join(", ")}.`,
  ];
  const totals = TEMPLATE_NAMES.map((t) => {
    const of = (teamId: number | undefined) =>
      snapshot.events.filter(
        (e) => TEMPLATE_QUALIFYING_EVENTS[t].includes(e.type) && e.teamId === teamId,
      ).length;
    return `${SHORT[t]} ${of(home?.id)}-${of(away?.id)}`;
  });
  lines.push(`So far, home-away: ${totals.join(", ")}.`);
  const recent = snapshot.events.filter(
    (e) => e.type !== "other" && e.matchClockSec > snapshot.clockSec - RECENT_SEC,
  );
  lines.push(
    recent.length === 0
      ? `Nothing of note in the last ${RECENT_SEC / 60} minutes.`
      : `Last ${RECENT_SEC / 60} minutes:\n${recent
          .map((e) => `${Math.floor(e.matchClockSec / 60)}' ${e.type} ${name(e.teamId)}`)
          .join("\n")}`,
  );
  return lines.join("\n");
}

/**
 * Turns the reader's reply into a {@link MatchRead}, or null if it isn't the JSON asked for.
 * Anything missing or out of range reads as 1: a half-usable reply moves only what it clearly says.
 */
export function parseRead(reply: string, at: number): MatchRead | null {
  let raw: unknown;
  try {
    raw = JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const multipliers: Record<string, number> = {};
  let moved = false;
  for (const template of TEMPLATE_NAMES) {
    const scopes = (body[SHORT[template]] ?? {}) as Record<string, unknown>;
    SCOPES.forEach((scope, teamFilter) => {
      const value = Number(scopes[scope]);
      const ok = Number.isFinite(value) && value >= 0.5 && value <= 2;
      multipliers[`${template}:${teamFilter}`] = ok ? value : 1;
      moved ||= ok;
    });
  }
  if (!moved) return null;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE_CHARS) : "";
  return { multipliers, note, at };
}

async function ask(endpoint: LlmEndpoint, user: string, timeoutMs: number): Promise<string> {
  const res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${endpoint.apiKey}` },
    body: JSON.stringify({
      model: endpoint.model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 600,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${endpoint.model}: HTTP ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${endpoint.model}: empty reply`);
  return content;
}

export interface MatchReaderConfig {
  endpoints: LlmEndpoint[];
  /** The match as it stands, or null when nothing is being played. */
  snapshot: () => Promise<MatchSnapshot | null>;
  /** Where the read's note goes, signed (the relay's /agent-notes). Optional. */
  publish?: (note: AgentNote) => Promise<void>;
  agentId: number;
  signer: LocalAccount;
  /** Other agents pricing off this same reading; each signs and publishes the note as its own. */
  cosigners?: { agentId: number; signer: LocalAccount }[];
  intervalMs?: number;
  /** A read older than this is ignored: the match has moved on. */
  maxAgeMs?: number;
  timeoutMs?: number;
  now?: () => number;
  log?: (...args: unknown[]) => void;
}

export class MatchReader {
  private latest: MatchRead | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastClockSec = -1;

  constructor(private readonly config: MatchReaderConfig) {}

  private now(): number {
    return (this.config.now ?? Date.now)();
  }

  /** The current read's multiplier for a market, or undefined when there's no fresh read. */
  multiplier(template: TemplateName, teamFilter: number): number | undefined {
    if (!this.latest || this.now() - this.latest.at > (this.config.maxAgeMs ?? 90_000)) {
      return undefined;
    }
    return this.latest.multipliers[`${template}:${teamFilter}`];
  }

  start(): void {
    const tick = async () => {
      await this.read().catch((err) => this.config.log?.("[reader]", (err as Error).message));
      this.timer = setTimeout(tick, this.config.intervalMs ?? 30_000);
    };
    void tick();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** One read of the match. Skipped when nothing is being played or the clock hasn't moved. */
  async read(): Promise<MatchRead | null> {
    const snapshot = await this.config.snapshot();
    if (!snapshot || snapshot.clockSec === this.lastClockSec) return null;
    this.lastClockSec = snapshot.clockSec;
    const user = describeMatch(snapshot);
    for (const endpoint of this.config.endpoints) {
      try {
        const read = parseRead(
          await ask(endpoint, user, this.config.timeoutMs ?? 8000),
          this.now(),
        );
        if (!read) throw new Error(`${endpoint.model}: reply wasn't the JSON asked for`);
        this.latest = read;
        this.config.log?.(`[reader] ${endpoint.model}: ${read.note}`);
        if (read.note && this.config.publish) {
          const readers = [
            { agentId: this.config.agentId, signer: this.config.signer },
            ...(this.config.cosigners ?? []),
          ];
          for (const { agentId, signer } of readers) {
            const note = { agentId, note: read.note, at: read.at };
            const signature = await signer.signMessage({ message: agentNoteMessage(note) });
            await this.config.publish({ ...note, signature }).catch(() => undefined);
          }
        }
        return read;
      } catch (err) {
        this.config.log?.("[reader]", (err as Error).message);
      }
    }
    return null;
  }
}
