import type { NormalizedEvent } from "@ninety/core";

export const MATCH_DATA_URL = process.env.NEXT_PUBLIC_MATCH_DATA_URL ?? "http://localhost:8080";
export const MATCH_DATA_WS_URL =
  process.env.NEXT_PUBLIC_MATCH_DATA_WS_URL ?? "ws://localhost:8080/ws";

export interface MatchListEntry {
  matchId: string;
  teams: { id: number; name: string }[];
  isReplaying: boolean;
}

export async function listMatches(): Promise<MatchListEntry[]> {
  const res = await fetch(`${MATCH_DATA_URL}/matches`);
  if (!res.ok) throw new Error(`match-data /matches failed: HTTP ${res.status}`);
  const body = (await res.json()) as { matches: MatchListEntry[] };
  return body.matches;
}

export async function startReplay(matchId: string, speed?: number): Promise<void> {
  const url = new URL(`${MATCH_DATA_URL}/matches/${matchId}/replay/start`);
  if (speed) url.searchParams.set("speed", String(speed));
  const res = await fetch(url, { method: "POST" });
  // 409 = already replaying, which is exactly what we want -- not an error from the caller's POV.
  if (!res.ok && res.status !== 409) {
    throw new Error(`failed to start replay for ${matchId}: HTTP ${res.status}`);
  }
}

export interface DeliveredEvent extends NormalizedEvent {
  revealedAtMs: number;
}

export async function fetchEvents(matchId: string): Promise<DeliveredEvent[]> {
  const res = await fetch(`${MATCH_DATA_URL}/matches/${matchId}/events`);
  if (!res.ok) return [];
  const body = (await res.json()) as { events: DeliveredEvent[] };
  return body.events;
}

export type MatchWsMessage =
  | { type: "backfill"; events: DeliveredEvent[] }
  | { type: "event"; event: DeliveredEvent }
  | { type: "end" };

/** Opens a live event stream for one match. Returns a cleanup function. */
export function subscribeToMatch(
  matchId: string,
  onMessage: (msg: MatchWsMessage) => void,
): () => void {
  const ws = new WebSocket(`${MATCH_DATA_WS_URL}?matchId=${encodeURIComponent(matchId)}`);
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data as string) as MatchWsMessage);
    } catch {
      // A malformed frame shouldn't take down the whole subscription.
    }
  };
  return () => ws.close();
}
