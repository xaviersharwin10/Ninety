import type { NormalizedEvent } from "@ninety/core";
import { describe, expect, it } from "vitest";
import { pitchPoint, recentMoments, recentPlay } from "@/lib/pitch";

const HOME = 1;
const AWAY = 2;

function ev(
  id: number,
  type: NormalizedEvent["type"],
  teamId: number,
  sec: number,
  x: number,
  y: number,
): NormalizedEvent {
  return {
    matchId: "m",
    type,
    teamId,
    period: "1H",
    periodSec: sec,
    matchClockSec: sec,
    position: { x, y },
    source: { provider: "wyscout", eventId: id },
  };
}

describe("pitchPoint", () => {
  it("keeps the home side attacking right and turns the away side round", () => {
    expect(pitchPoint(ev(1, "corner", HOME, 0, 100, 0), HOME)).toMatchObject({
      x: 100,
      y: 0,
      isHome: true,
    });
    // An away corner is taken at the far end of *its* attack: the home goal, on the left.
    expect(pitchPoint(ev(2, "corner", AWAY, 0, 100, 0), HOME)).toMatchObject({
      x: 0,
      y: 100,
      isHome: false,
    });
  });

  it("is null for an event with no position", () => {
    const { position: _, ...noPosition } = ev(3, "other", HOME, 0, 50, 50);
    expect(pitchPoint(noPosition, HOME)).toBeNull();
  });
});

describe("recentPlay / recentMoments", () => {
  const events = [
    ev(1, "other", HOME, 10, 40, 50),
    ev(2, "shot_on_target", HOME, 20, 90, 45),
    ev(3, "other", AWAY, 30, 20, 50),
    ev(4, "corner", AWAY, 200, 100, 100), // still to come
  ];

  it("ends the trail where the ball is now, and never shows what hasn't happened", () => {
    const play = recentPlay(events, HOME, 30);
    expect(play.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(play.at(-1)).toMatchObject({ x: 80, y: 50 });
  });

  it("marks only the last minute's big moments", () => {
    expect(recentMoments(events, HOME, 30).map((m) => m.id)).toEqual([2]);
    expect(recentMoments(events, HOME, 100)).toEqual([]);
  });
});
