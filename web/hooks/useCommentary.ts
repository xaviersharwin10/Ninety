"use client";

import { useEffect, useState } from "react";

const POLL_MS = 8_000;

/** The match's live commentary line, or null when there's none (or no commentary at all). */
export function useCommentary(matchId: string, live: boolean): string | null {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    if (!live) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`/api/matches/${matchId}/commentary`);
        const body = (await res.json()) as { enabled: boolean; line: string | null };
        if (!stopped && body.line) setLine(body.line);
        // Not configured: stop asking.
        if (!body.enabled) return;
      } catch {
        // Keep the last line; try again next round.
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [matchId, live]);
  return line;
}
