"use client";

import { useEffect, useState } from "react";

export interface ScheduledMarket {
  marketId: string;
  templateIdx: number;
  windowStart: number;
  windowEnd: number;
}

const TICK_MS = 10_000;

/** Ensures an on-chain match exists for this fixture, then polls the scheduler every ~10s while
 *  the screen is open. See lib/server/scheduler.ts for what each tick actually does. */
export function useMarketScheduler(wyscoutId: string) {
  const [onchainMatchId, setOnchainMatchId] = useState<string | null>(null);
  const [markets, setMarkets] = useState<ScheduledMarket[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    async function tick() {
      const res = await fetch(`/api/matches/${wyscoutId}/schedule-tick`, { method: "POST" });
      const body = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(body.error ?? "scheduler tick failed");
        return;
      }
      setOnchainMatchId(body.onchainMatchId);
      setMarkets(body.openMarkets);
    }

    async function start() {
      const res = await fetch(`/api/matches/${wyscoutId}/ensure`, { method: "POST" });
      const body = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(body.error ?? "could not create the on-chain match");
        return;
      }
      setOnchainMatchId(body.onchainMatchId);
      await tick();
      interval = setInterval(tick, TICK_MS);
    }

    start();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [wyscoutId]);

  return { onchainMatchId, markets, error };
}
