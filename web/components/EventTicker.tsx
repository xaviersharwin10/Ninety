"use client";

import type { NormalizedEvent } from "@ninety/core";
import { motion } from "framer-motion";
import type { MatchListEntry } from "@/lib/match-data";

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

/** Phone: a horizontal strip of the last 12 events. Desktop: a vertical match feed with more history. */
export function EventTicker({
  events,
  teams = [],
}: {
  events: NormalizedEvent[];
  teams?: MatchListEntry["teams"];
}) {
  const teamName = (id: number) => teams.find((t) => t.id === id)?.name ?? "";
  const notable = events
    .filter((e) => e.type !== "other")
    .slice(-40)
    .reverse();

  if (notable.length === 0) {
    return (
      <div className="mx-5 mt-4 flex items-center gap-2 text-[12px] text-text-faint md:mx-0 md:mt-0">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-coral" />
        Waiting for the first event…
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <p className="hidden text-[11px] font-semibold uppercase tracking-wide text-text-faint md:block">
        Match feed
      </p>
      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto px-5 pb-1 md:mt-3 md:flex-col md:overflow-visible md:px-0">
        {notable.map((e, i) => (
          <motion.div
            key={`${e.source.eventId}-${e.matchClockSec}`}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            className={`glass shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] md:gap-4 md:rounded-2xl md:px-5 md:py-3.5 md:text-[14px] ${
              i >= 12 ? "hidden md:flex" : "flex"
            } ${e.type === "goal" ? "border-lime/40 text-lime" : "text-text-muted"}`}
          >
            <span className="tabular font-semibold md:w-10 md:text-text">
              {minuteOf(e.matchClockSec)}
            </span>
            <span className={e.type === "goal" ? "md:font-display md:text-xl" : ""}>
              {EVENT_LABEL[e.type]}
            </span>
            <span className="ml-auto hidden text-[12px] text-text-faint md:inline">
              {teamName(e.teamId)}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
