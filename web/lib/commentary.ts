import type { NormalizedEvent } from "@ninety/core";

/**
 * Live commentary for fans following a match with no video: one short line, written by Kimi from the
 * match's own events (see lib/server/commentary.ts). This file is the part that decides what Kimi is
 * told and what it's allowed to say back -- pure, so it's tested directly.
 */

const NOTABLE: Partial<Record<NormalizedEvent["type"], string>> = {
  goal: "GOAL",
  shot_on_target: "shot on target",
  shot_off_target: "shot off target",
  corner: "corner",
  card: "card",
};

/** How far back the recent-events list reaches, in match seconds. */
const RECENT_SEC = 10 * 60;
/** The pressure summary's window, in match seconds. */
const PRESSURE_SEC = 5 * 60;

export interface Team {
  id: number;
  name: string;
}

/**
 * What Kimi is told: the score, the minute, the last ten minutes' notable events, and who has been
 * pressing. Only what has already happened by `nowSec` -- the replay never reveals the future, and
 * nor does this. `notable` counts every notable event so far, so the caller can tell when there's
 * something new to talk about.
 */
export function commentaryFacts(
  events: readonly NormalizedEvent[],
  teams: readonly Team[],
  nowSec: number,
): { facts: string; notable: number } {
  const shown = events.filter((e) => e.matchClockSec <= nowSec);
  const name = (id: number) => teams.find((t) => t.id === id)?.name ?? "One side";
  const [home, away] = teams;
  const goals = (id: number | undefined) =>
    shown.filter((e) => e.type === "goal" && e.teamId === id).length;

  const notableEvents = shown.filter((e) => NOTABLE[e.type]);
  const recent = notableEvents.filter((e) => e.matchClockSec > nowSec - RECENT_SEC);
  const pressing = teams.map((t) => {
    const last = notableEvents.filter(
      (e) => e.teamId === t.id && e.matchClockSec > nowSec - PRESSURE_SEC,
    );
    const shots = last.filter((e) => e.type.startsWith("shot") || e.type === "goal").length;
    const corners = last.filter((e) => e.type === "corner").length;
    return `${t.name} ${shots} shot${shots === 1 ? "" : "s"}, ${corners} corner${corners === 1 ? "" : "s"}`;
  });

  const lines = [
    `Match: ${home?.name ?? "Home"} v ${away?.name ?? "Away"}.`,
    `Score: ${home?.name ?? "Home"} ${goals(home?.id)}, ${away?.name ?? "Away"} ${goals(away?.id)}.`,
    `Minute: ${Math.floor(nowSec / 60)}.`,
    recent.length > 0
      ? `Last 10 minutes, oldest first:\n${recent
          .map(
            (e) => `- ${Math.floor(e.matchClockSec / 60)}' ${name(e.teamId)}: ${NOTABLE[e.type]}`,
          )
          .join("\n")}`
      : "Nothing notable in the last 10 minutes.",
    `Last 5 minutes: ${pressing.join("; ")}.`,
  ];
  return { facts: lines.join("\n"), notable: notableEvents.length };
}

export const COMMENTARY_SYSTEM_PROMPT = [
  "You are a football commentator writing for fans following a live match with no video.",
  "Write ONE short line, at most 20 words, about what is happening right now: momentum, pressure, a big moment.",
  "Use only the facts given. Never invent players, scores or events.",
  "Never mention betting, odds, prices, markets, predictions, AI or yourself.",
  "Plain text only: no quotes, no emoji, no hashtags.",
].join(" ");

/** Words a commentary line must never contain on a screen where fans bet. */
const OFF_LIMITS =
  /\b(odds|bets?|betting|wager\w*|markets?|prices?|predict\w*|agents?|AI|models?|bookmakers?)\b/i;
const MAX_CHARS = 160;

/**
 * What Kimi said, made fit for the screen -- or null if it isn't. First line only, trimmed of
 * quotes and stray whitespace, cut at a word boundary if long. Anything touching betting or the
 * machinery behind it is dropped rather than edited: the fan's screen never talks about either.
 */
export function cleanCommentary(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let line = raw.trim().split("\n")[0] ?? "";
  line = line
    .replace(/^["'“‘\s]+|["'”’\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length === 0 || OFF_LIMITS.test(line)) return null;
  if (line.length > MAX_CHARS) {
    const cut = line.slice(0, MAX_CHARS);
    line = `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:—–-]+$/, "")}…`;
  }
  return line;
}
