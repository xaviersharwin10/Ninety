import { CommandError } from "@metamask/agent-wallet/plugin";
import { TEMPLATE_NAMES, type TemplateName } from "@ninety/core";
import { type Fixture, listFixtures, startFixture } from "./api.js";

const QUESTION: Record<TemplateName, string> = {
  SHOT_ON_TARGET_NEXT_N: "Shot on target in the next 2 min?",
  CORNER_NEXT_N: "Corner in the next 3 min?",
  CARD_NEXT_N: "Card shown in the next 5 min?",
  GOAL_NEXT_N: "Goal in the next 5 min?",
};

export function question(templateIdx: number): string {
  const name = TEMPLATE_NAMES[templateIdx % TEMPLATE_NAMES.length];
  return name ? QUESTION[name] : "Market";
}

export function fixtureName(f: Fixture): string {
  return f.teams.map((t) => t.name).join(" vs ") || `Match ${f.matchId}`;
}

/**
 * The fixture to trade: the one asked for (kicked off if it isn't playing), else the one playing
 * now. With nothing playing and nothing asked for, says how to start one.
 */
export async function liveFixture(requested: string | undefined): Promise<Fixture> {
  const fixtures = await listFixtures();
  if (requested) {
    const f = fixtures.find((x) => x.matchId === requested);
    if (!f) {
      throw new CommandError(
        "NINETY_UNKNOWN_MATCH",
        `There's no match ${requested}.`,
        "Run `mm ninety matches` to see the ones on offer.",
      );
    }
    if (!f.isReplaying || f.finished) await startFixture(f.matchId);
    return f;
  }
  const playing = fixtures.find((f) => f.isReplaying && !f.finished);
  if (!playing) {
    throw new CommandError(
      "NINETY_NO_LIVE_MATCH",
      "No match is being played right now.",
      "Start one with `mm ninety markets --match <id>` (see `mm ninety matches`).",
    );
  }
  return playing;
}
