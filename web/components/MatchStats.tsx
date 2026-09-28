"use client";

import type { NormalizedEvent } from "@ninety/core";
import type { MatchListEntry } from "@/lib/match-data";

const ROWS: { type: NormalizedEvent["type"]; label: string }[] = [
  { type: "goal", label: "Goals" },
  { type: "shot_on_target", label: "Shots on target" },
  { type: "shot_off_target", label: "Shots off target" },
  { type: "corner", label: "Corners" },
  { type: "card", label: "Cards" },
];

export function countByTeam(
  events: NormalizedEvent[],
  type: NormalizedEvent["type"],
  teamId: number | undefined,
): number {
  if (teamId === undefined) return 0;
  return events.filter((e) => e.type === type && e.teamId === teamId).length;
}

/** Head-to-head bars built from the same event stream the ticker shows -- nothing extra fetched. */
export function MatchStats({
  events,
  teams,
}: {
  events: NormalizedEvent[];
  teams: MatchListEntry["teams"];
}) {
  const [home, away] = teams;

  return (
    <div className="rounded-3xl border border-border bg-bg-elevated/80 p-6">
      <div className="flex items-center justify-between text-[12px] font-semibold text-text-muted">
        <span>{home?.name ?? "Home"}</span>
        <span className="text-[11px] uppercase tracking-wide text-text-faint">Match stats</span>
        <span>{away?.name ?? "Away"}</span>
      </div>
      <div className="mt-5 flex flex-col gap-4">
        {ROWS.map(({ type, label }) => {
          const h = countByTeam(events, type, home?.id);
          const a = countByTeam(events, type, away?.id);
          const total = h + a;
          const homePct = total === 0 ? 50 : (h / total) * 100;
          return (
            <div key={type}>
              <div className="tabular flex items-center justify-between text-[13px]">
                <span className="font-semibold text-text">{h}</span>
                <span className="text-text-muted">{label}</span>
                <span className="font-semibold text-text">{a}</span>
              </div>
              <div className="mt-1.5 flex h-1.5 gap-1 overflow-hidden rounded-full">
                <div
                  className="rounded-full bg-lime transition-all"
                  style={{ width: `${homePct}%`, opacity: total === 0 ? 0.15 : 1 }}
                />
                <div
                  className="flex-1 rounded-full bg-violet transition-all"
                  style={{ opacity: total === 0 ? 0.15 : 1 }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
