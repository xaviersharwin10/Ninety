import type { NormalizedEvent } from "@ninety/core";
import { describe, expect, it } from "vitest";
import { cleanCommentary, commentaryFacts } from "@/lib/commentary";

const TEAMS = [
  { id: 1, name: "France" },
  { id: 2, name: "Romania" },
];

function ev(type: NormalizedEvent["type"], teamId: number, minute: number): NormalizedEvent {
  return {
    matchId: "m",
    type,
    teamId,
    period: "1H",
    periodSec: minute * 60,
    matchClockSec: minute * 60,
    source: { provider: "wyscout", eventId: minute },
  };
}

describe("commentaryFacts", () => {
  const events = [
    ev("goal", 1, 12),
    ev("corner", 2, 27),
    ev("shot_on_target", 2, 29),
    ev("other", 1, 30),
    ev("card", 1, 31),
    ev("corner", 2, 40), // after "now": must never be told
  ];

  it("gives the score, the minute and the recent notable events -- nothing from the future", () => {
    const { facts, notable } = commentaryFacts(events, TEAMS, 32 * 60);
    expect(facts).toContain("Score: France 1, Romania 0.");
    expect(facts).toContain("Minute: 32.");
    expect(facts).toContain("27' Romania: corner");
    expect(facts).toContain("31' France: card");
    expect(facts).not.toContain("40'");
    expect(facts).not.toContain("12'"); // more than 10 minutes ago
    expect(facts).toContain("Romania 1 shot, 0 corners"); // last 5 minutes: the 27th-minute corner is just outside
    expect(notable).toBe(4);
  });
});

describe("cleanCommentary", () => {
  it("keeps one clean line", () => {
    expect(cleanCommentary('"Romania are camped in France\'s half."\nMore text')).toBe(
      "Romania are camped in France's half.",
    );
  });

  it("drops anything about betting or the machinery behind it", () => {
    expect(cleanCommentary("The odds are shifting towards a corner.")).toBeNull();
    expect(cleanCommentary("Great time to bet on Romania!")).toBeNull();
    expect(cleanCommentary("As an AI, I think France look tired.")).toBeNull();
    expect(cleanCommentary("")).toBeNull();
    expect(cleanCommentary(null)).toBeNull();
  });

  it("cuts a long line at a word boundary", () => {
    const line = cleanCommentary(`${"France press again and again ".repeat(10)}until it breaks`);
    expect(line?.length).toBeLessThanOrEqual(161);
    expect(line?.endsWith("…")).toBe(true);
  });
});
