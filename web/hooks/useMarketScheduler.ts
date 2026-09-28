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
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const res = await fetch(`/api/matches/${wyscoutId}/schedule-tick`, { method: "POST" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? "scheduler tick failed");
        } else {
          setError(null);
          setOnchainMatchId(body.onchainMatchId);
          setMarkets(body.openMarkets);
        }
      } catch {
        if (!cancelled) setError("scheduler tick failed");
      }
      // The next tick is scheduled only once this one has finished, never on a fixed interval: a
      // tick can outlast TICK_MS, and overlapping ticks raced each other on the stored record.
      if (!cancelled) timer = setTimeout(tick, TICK_MS);
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
    }

    start();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [wyscoutId]);

  return { onchainMatchId, markets, error };
}
