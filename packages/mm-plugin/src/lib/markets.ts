import { CommandError } from "@metamask/agent-wallet/plugin";
import { marketQuestion, TEMPLATE_NAMES } from "@ninety/core";
import { type Fixture, listFixtures, startFixture } from "./api.js";

/**
 * A market's question. `teamFilter` 1 or 2 makes it about the home or away team only, named from
 * `teams` (home first).
 */
export function question(
  templateIdx: number,
  teamFilter = 0,
  teams: readonly { name: string }[] = [],
): string {
  const name = TEMPLATE_NAMES[templateIdx % TEMPLATE_NAMES.length];
  if (!name) return "Market";
  const team =
    teamFilter === 0
      ? null
      : (teams[teamFilter - 1]?.name ?? (teamFilter === 1 ? "Home team" : "Away team"));
  return marketQuestion(name, team);
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
