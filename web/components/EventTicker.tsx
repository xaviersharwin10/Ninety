"use client";

import type { NormalizedEvent } from "@ninety/core";
import { motion } from "framer-motion";

const EVENT_LABEL: Record<NormalizedEvent["type"], string> = {
  shot_on_target: "Shot on target",
  shot_off_target: "Shot off target",
  goal: "GOAL",
  corner: "Corner",
  card: "Card",
  other: "",
};

function minuteOf(matchClockSec: number): string {
  return `${Math.floor(matchClockSec / 60)}'`;
}

export function EventTicker({ events }: { events: NormalizedEvent[] }) {
  const notable = events
    .filter((e) => e.type !== "other")
    .slice(-12)
    .reverse();

  if (notable.length === 0) {
    return (
      <div className="mx-5 mt-4 flex items-center gap-2 text-[12px] text-text-faint">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-coral" />
        Waiting for the first event…
      </div>
    );
  }

  return (
    <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
      {notable.map((e, i) => (
        <motion.div
          key={`${e.source.eventId}-${e.matchClockSec}`}
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i === 0 ? 0 : 0, duration: 0.25 }}
          className={`glass flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] ${
            e.type === "goal" ? "border-lime/40 text-lime" : "text-text-muted"
          }`}
        >
          <span className="tabular font-semibold">{minuteOf(e.matchClockSec)}</span>
          <span>{EVENT_LABEL[e.type]}</span>
        </motion.div>
      ))}
    </div>
  );
}
