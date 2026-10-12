import type { NormalizedEvent } from "@ninety/core";
import { describe, expect, it } from "vitest";
import { pickNextMarket } from "@/lib/server/market-picker";

const teams = [{ id: 1 }, { id: 2 }];
const SHOT = 0;
const CORNER = 1;
const CARD = 2;
const GOAL = 3;
const at = (type: NormalizedEvent["type"], teamId: number, minute: number) =>
  ({ type, teamId, matchClockSec: minute * 60 }) as NormalizedEvent;
const pick = (over: Partial<Parameters<typeof pickNextMarket>[0]>) =>
  pickNextMarket({
    events: [],
    teams,
    nowMatchClockSec: 30 * 60,
    open: [],
    recentTemplateIdx: [],
    ...over,
  });

describe("pickNextMarket", () => {
  it("falls back to the plain rotation, either team, when nothing is happening", () => {
    const order: number[] = [];
    for (let i = 0; i < 6; i++) {
      const next = pick({ recentTemplateIdx: order.slice().reverse().slice(0, 3) });
      expect(next.teamFilter).toBe(0);
      order.push(next.templateIdx);
    }
    expect(order).toEqual([SHOT, CORNER, CARD, GOAL, SHOT, CORNER]);
  });

  it("asks about the team that is doing the pressing", () => {
    const events = [at("corner", 1, 26), at("corner", 1, 28), at("shot_off_target", 1, 29)];
    expect(pick({ events })).toEqual({ templateIdx: CORNER, teamFilter: 1 });
    // The same pressure from the away side picks the away team.
    expect(pick({ events: events.map((e) => ({ ...e, teamId: 2 })) }).teamFilter).toBe(2);
  });

  it("keeps the question about either team when both sides are at it", () => {
    const events = [at("corner", 1, 27), at("corner", 2, 28), at("shot_on_target", 2, 29)];
    expect(pick({ events }).teamFilter).toBe(0);
  });

  it("turns to cards when the game gets rough, more readily late on", () => {
    const events = [at("card", 1, 27), at("card", 2, 29)];
    expect(pick({ events }).templateIdx).toBe(CARD);
    // One booking late in the game is enough; in the first half it isn't.
    expect(pick({ events: [at("card", 2, 74)], nowMatchClockSec: 75 * 60 }).templateIdx).toBe(CARD);
  });

  it("doesn't repeat the question it just asked, or one that's still open", () => {
    const events = [at("corner", 1, 26), at("corner", 1, 28), at("corner", 1, 29)];
    const again = pick({
      events,
      recentTemplateIdx: [CORNER],
      open: [{ templateIdx: CORNER, teamFilter: 1 }],
    });
    expect(again).not.toEqual({ templateIdx: CORNER, teamFilter: 1 });
    expect(again.templateIdx).not.toBe(CORNER);
  });

  it("ignores play older than its lookback, and never looks ahead", () => {
    const events = [at("corner", 1, 10), at("corner", 1, 12), at("goal", 2, 45)];
    expect(pick({ events })).toEqual({ templateIdx: SHOT, teamFilter: 0 });
  });

  it("only asks about either team when it doesn't know the teams", () => {
    const events = [at("corner", 1, 26), at("corner", 1, 28)];
    expect(pick({ events, teams: [] }).teamFilter).toBe(0);
  });
});
