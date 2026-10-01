import { type CommandIO, PluginCommand } from "@metamask/agent-wallet/plugin";
import { marketMakers, monad } from "../../lib/chain.js";
import { nusd } from "../../lib/format.js";
import { walletAddress } from "../../lib/wallet.js";

interface MakerRow {
  agentId: number;
  name: string;
  /** nUSD backing its prices. */
  vault: string;
  /** Return to backers since the vault opened, after its developer's fee. */
  returnPct: string;
  developerFeePct: string;
  yours: string;
  canWithdraw: string;
}

export default class NinetyAgents extends PluginCommand<{ marketMakers: MakerRow[] }> {
  static override description =
    "The AI market makers that price every Ninety market: vault size, return to backers, and your stake in each";
  static override examples = ["<%= config.bin %> ninety agents"];
  protected readonly pluginCommandId = "ninety:agents";

  async execute(_io: CommandIO) {
    const makers = await marketMakers(monad(this.ctx), walletAddress(this.ctx));
    return {
      marketMakers: makers
        .filter((m) => m.enabled)
        .sort((a, b) => (b.totalAssets > a.totalAssets ? 1 : -1))
        .map((m) => ({
          agentId: m.agentId,
          name: m.name,
          vault: nusd(m.totalAssets),
          returnPct: `${(m.returnBps / 100).toFixed(2)}%`,
          developerFeePct: `${m.performanceFeeBps / 100}%`,
          yours: nusd(m.yours),
          canWithdraw: nusd(m.withdrawable),
        })),
    };
  }

  override successHint(data: { marketMakers: MakerRow[] }): string {
    const lines = data.marketMakers.map(
      (m) =>
        `${m.name.padEnd(12)} vault ${m.vault.padStart(9)} nUSD  return ${m.returnPct.padStart(7)}${m.yours !== "0" ? `  yours ${m.yours}` : ""}`,
    );
    return [...lines, "Back one with `mm ninety back <name> <nUSD>`."].join("\n");
  }
}
