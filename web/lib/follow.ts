"use client";

import { useCallback, useEffect, useState } from "react";
import type { MatchListEntry } from "./match-data";

/**
 * The fan's team. Kept on this device only: it's a preference, not part of the account, so it
 * doesn't need to follow the passkey to a new device.
 */
const KEY = "ninety:team";

function read(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function useFollowedTeam() {
  const [team, setTeam] = useState<number | null>(null);
  useEffect(() => setTeam(read()), []);
  const follow = useCallback((id: number | null) => {
    setTeam(id);
    try {
      if (id === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, String(id));
    } catch {
      // Blocked storage: it holds for this visit only.
    }
  }, []);
  return { team, follow };
}

/** Every team on offer, once each, in the order they first appear. */
export function teamsOnOffer(matches: readonly MatchListEntry[]): MatchListEntry["teams"] {
  const seen = new Map<number, MatchListEntry["teams"][number]>();
  for (const m of matches) for (const t of m.teams) if (!seen.has(t.id)) seen.set(t.id, t);
  return [...seen.values()];
}

/** The followed team's matches first; otherwise the order is kept. */
export function orderForTeam<T extends MatchListEntry>(
  matches: readonly T[],
  team: number | null,
): T[] {
  if (team === null) return [...matches];
  const plays = (m: T) => m.teams.some((t) => t.id === team);
  return [...matches.filter(plays), ...matches.filter((m) => !plays(m))];
}
