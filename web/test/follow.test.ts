import { describe, expect, it } from "vitest";
import { orderForTeam, teamsOnOffer } from "@/lib/follow";
import type { MatchListEntry } from "@/lib/match-data";

const fra = { id: 1, name: "France" };
const rou = { id: 2, name: "Romania" };
const sui = { id: 3, name: "Switzerland" };
const alb = { id: 4, name: "Albania" };
const match = (matchId: string, teams: MatchListEntry["teams"]): MatchListEntry => ({
  matchId,
  teams,
  isReplaying: false,
});
const matches = [match("a", [fra, rou]), match("b", [sui, alb]), match("c", [sui, rou])];

describe("following a team", () => {
  it("lists each team once, in order", () => {
    expect(teamsOnOffer(matches).map((t) => t.name)).toEqual([
      "France",
      "Romania",
      "Switzerland",
      "Albania",
    ]);
  });

  it("puts the team's matches first and keeps the rest in order", () => {
    expect(orderForTeam(matches, sui.id).map((m) => m.matchId)).toEqual(["b", "c", "a"]);
    expect(orderForTeam(matches, rou.id).map((m) => m.matchId)).toEqual(["a", "c", "b"]);
  });

  it("leaves the order alone with no team followed", () => {
    expect(orderForTeam(matches, null).map((m) => m.matchId)).toEqual(["a", "b", "c"]);
  });
});
