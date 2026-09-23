import { TEMPLATE_NAMES, type TemplateName } from "@ninety/core";

/** Typical window length per template (CLAUDE.md §6.4). */
export const TEMPLATE_WINDOW_SEC: Record<TemplateName, number> = {
  SHOT_ON_TARGET_NEXT_N: 2 * 60,
  CORNER_NEXT_N: 3 * 60,
  CARD_NEXT_N: 5 * 60,
  GOAL_NEXT_N: 5 * 60,
};

export interface ScheduledMarket {
  id: string;
  template: TemplateName;
  windowStart: number;
  windowEnd: number;
}

export interface ScheduleOptions {
  /** Don't schedule anything whose window would run past this (typically the match's last event). */
  matchEndSec: number;
  /** How often a new market opens (CLAUDE.md §6.4: "every ~2 minutes of match time"). Default 120s. */
  cadenceSec?: number;
  /** Cap on concurrently open markets (CLAUDE.md §6.4: "max 3-5 concurrent"). Default 4. */
  maxConcurrent?: number;
  startSec?: number;
}

/**
 * The platform-side scheduler: rotates through the four CORE templates on a fixed cadence,
 * skipping a tick when the concurrency cap is already full or when the template due next wouldn't
 * finish before the match's data runs out. Deterministic and pure -- same inputs, same schedule,
 * every time, which is what makes a simulator run reproducible.
 */
export function scheduleMarkets(options: ScheduleOptions): ScheduledMarket[] {
  const cadenceSec = options.cadenceSec ?? 120;
  const maxConcurrent = options.maxConcurrent ?? 4;
  const startSec = options.startSec ?? 0;

  const scheduled: ScheduledMarket[] = [];
  let templateIdx = 0;
  let nextId = 1;

  for (let t = startSec; t < options.matchEndSec; t += cadenceSec) {
    const openAtT = scheduled.filter((m) => m.windowStart <= t && m.windowEnd > t).length;
    if (openAtT >= maxConcurrent) continue;

    const template = TEMPLATE_NAMES[templateIdx % TEMPLATE_NAMES.length]!;
    templateIdx++;

    const windowEnd = t + TEMPLATE_WINDOW_SEC[template];
    if (windowEnd > options.matchEndSec) continue; // wouldn't fully play out against known data

    scheduled.push({ id: `m${nextId++}`, template, windowStart: t, windowEnd });
  }

  return scheduled;
}
