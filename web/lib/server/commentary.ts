import { COMMENTARY_SYSTEM_PROMPT, cleanCommentary, commentaryFacts } from "@/lib/commentary";
import { fetchEvents, listMatches } from "@/lib/match-data";

/**
 * Live commentary, written by Kimi (Moonshot AI) from the match's own events. Server-side, so the
 * key never reaches a browser. Without `KIMI_API_KEY` the feature is simply off: the route returns
 * no line and the match screen shows none.
 *
 * One line per match is shared by every viewer and refreshed only when there's something new -- a
 * notable event since the last line -- and no more often than {@link MIN_REFRESH_MS}; a quiet
 * spell still gets a fresh line every {@link MAX_AGE_MS}. So a match costs a handful of calls a
 * minute however many people are watching.
 */

const KIMI_URL = process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1";
const KIMI_MODEL = process.env.KIMI_MODEL ?? "kimi-k2.6";
const MIN_REFRESH_MS = 8_000;
const MAX_AGE_MS = 45_000;
const TIMEOUT_MS = 10_000;

interface Cached {
  line: string | null;
  notable: number;
  at: number;
}

const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<void>>();

export function commentaryEnabled(): boolean {
  return !!process.env.KIMI_API_KEY;
}

/** The latest line for `matchId`, refreshing it first if it's due. Never throws. */
export async function latestCommentary(matchId: string): Promise<string | null> {
  if (!commentaryEnabled()) return null;
  const cached = cache.get(matchId);
  const age = cached ? Date.now() - cached.at : Number.POSITIVE_INFINITY;
  if (age >= MIN_REFRESH_MS) {
    let running = inflight.get(matchId);
    if (!running) {
      running = refresh(matchId, cached, age).finally(() => inflight.delete(matchId));
      inflight.set(matchId, running);
    }
    // A first line is worth waiting for; after that, serve the current one and let it update.
    if (!cached) await running;
  }
  return cache.get(matchId)?.line ?? null;
}

async function refresh(matchId: string, cached: Cached | undefined, age: number): Promise<void> {
  try {
    const [events, matches] = await Promise.all([fetchEvents(matchId), listMatches()]);
    const teams = matches.find((m) => m.matchId === matchId)?.teams ?? [];
    const nowSec = events.reduce((max, e) => Math.max(max, e.matchClockSec), 0);
    const { facts, notable } = commentaryFacts(events, teams, nowSec);
    if (cached && notable === cached.notable && age < MAX_AGE_MS) return;

    const line = cleanCommentary(await askKimi(facts));
    // Keep the last good line rather than blanking the screen on a bad or failed reply.
    cache.set(matchId, { line: line ?? cached?.line ?? null, notable, at: Date.now() });
  } catch (err) {
    console.warn("[commentary] refresh failed:", (err as Error).message);
    if (cached) cache.set(matchId, { ...cached, at: Date.now() });
  }
}

async function askKimi(facts: string): Promise<string | null> {
  const res = await fetch(`${KIMI_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.KIMI_API_KEY}`,
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      messages: [
        { role: "system", content: COMMENTARY_SYSTEM_PROMPT },
        { role: "user", content: facts },
      ],
      temperature: 0.8,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Kimi HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? null;
}
