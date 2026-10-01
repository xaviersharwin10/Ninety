import { type CommandIO, PluginCommand } from "@metamask/agent-wallet/plugin";
import { listFixtures } from "../../lib/api.js";
import { fixtureName } from "../../lib/markets.js";

interface MatchRow {
  matchId: string;
  name: string;
  live: boolean;
}

export default class NinetyMatches extends PluginCommand<{ matches: MatchRow[] }> {
  static override description =
    "List the football matches on Ninety, and which one is being played now";
  static override examples = ["<%= config.bin %> ninety matches"];
  static override requiresAuth = false;
  static override requiresInit = false;
  protected readonly pluginCommandId = "ninety:matches";

  async execute(_io: CommandIO) {
    const fixtures = await listFixtures();
    return {
      matches: fixtures.map((f) => ({
        matchId: f.matchId,
        name: fixtureName(f),
        live: f.isReplaying && !f.finished,
      })),
    };
  }

  override successHint(data: { matches: MatchRow[] }): string {
    const live = data.matches.find((m) => m.live);
    return live
      ? `${live.name} is live. See its markets with \`mm ninety markets\`.`
      : "Nothing live. Start a match with `mm ninety markets --match <matchId>`.";
  }
}
