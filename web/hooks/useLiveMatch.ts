"use client";

import { useEffect, useState } from "react";
import { type DeliveredEvent, fetchEvents, subscribeToMatch } from "@/lib/match-data";

export function useLiveMatch(matchId: string) {
  const [events, setEvents] = useState<DeliveredEvent[]>([]);
  // Full time: the replay has emitted every event. A restart (someone taps "Watch again") arrives as
  // an empty backfill, which clears it.
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchEvents(matchId).then((initial) => {
      if (!cancelled) setEvents(initial);
    });
    const unsubscribe = subscribeToMatch(matchId, (msg) => {
      if (cancelled) return;
      if (msg.type === "backfill") {
        setEvents(msg.events);
        setEnded(false);
      }
      if (msg.type === "end") setEnded(true);
      if (msg.type === "event") setEvents((prev) => [...prev, msg.event]);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [matchId]);

  // Wyscout's eventSec carries fractional seconds; floor for display and for comparisons against
  // MarketManager's integer window bounds.
  const nowMatchClockSec = Math.floor(events.reduce((max, e) => Math.max(max, e.matchClockSec), 0));
  return { events, nowMatchClockSec, ended };
}
