import { TEMPLATE_NAMES } from "@ninety/core";
import { describe, expect, it } from "vitest";
import { scheduleMarkets, TEMPLATE_WINDOW_SEC } from "../src/scheduler.js";

describe("scheduleMarkets", () => {
  it("every scheduled market's window fits fully inside [0, matchEndSec]", () => {
    const schedule = scheduleMarkets({ matchEndSec: 5700 });
    expect(schedule.length).toBeGreaterThan(0);
    for (const m of schedule) {
      expect(m.windowStart).toBeGreaterThanOrEqual(0);
      expect(m.windowEnd).toBeLessThanOrEqual(5700);
      expect(m.windowEnd - m.windowStart).toBe(TEMPLATE_WINDOW_SEC[m.template]);
    }
  });

  it("never exceeds maxConcurrent markets open at any scheduled market's own start time", () => {
    const maxConcurrent = 3;
    const schedule = scheduleMarkets({ matchEndSec: 5700, cadenceSec: 60, maxConcurrent });
    for (const m of schedule) {
      const openAtStart = schedule.filter(
        (other) => other.windowStart <= m.windowStart && other.windowEnd > m.windowStart,
      ).length;
      expect(openAtStart).toBeLessThanOrEqual(maxConcurrent);
    }
  });

  it("rotates through all four CORE templates, not just one", () => {
    const schedule = scheduleMarkets({ matchEndSec: 5700, cadenceSec: 120, maxConcurrent: 4 });
    const templatesSeen = new Set(schedule.map((m) => m.template));
    for (const t of TEMPLATE_NAMES) expect(templatesSeen).toContain(t);
  });

  it("produces unique, stable ids", () => {
    const schedule = scheduleMarkets({ matchEndSec: 5700 });
    expect(new Set(schedule.map((m) => m.id)).size).toBe(schedule.length);
  });

  it("is deterministic: identical options produce an identical schedule", () => {
    const a = scheduleMarkets({ matchEndSec: 5700, cadenceSec: 120, maxConcurrent: 4 });
    const b = scheduleMarkets({ matchEndSec: 5700, cadenceSec: 120, maxConcurrent: 4 });
    expect(a).toEqual(b);
  });

  it("schedules nothing when the match is shorter than every template's window", () => {
    const schedule = scheduleMarkets({ matchEndSec: 60 }); // shorter than even the 2-minute template
    expect(schedule).toEqual([]);
  });
});
