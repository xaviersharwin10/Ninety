import { type CommandIO, PluginCommand } from "@metamask/agent-wallet/plugin";
import { monad, nusdBalance } from "../../lib/chain.js";
import { nusd } from "../../lib/format.js";
import { recentBets } from "../../lib/history.js";
import { walletAddress } from "../../lib/wallet.js";

interface BetRow {
  marketId: string;
  question: string;
  side: "yes" | "no";
  stake: string;
  payout: string;
  status: "open" | "won" | "lost" | "refunded";
  uncollected: boolean;
}

interface BetsResult {
  address: string;
  balance: string;
  /** Winnings and refunds settled but not collected yet. */
  toCollect: string;
  bets: BetRow[];
}

export default class NinetyBets extends PluginCommand<BetsResult> {
  static override description =
    "Your Ninety balance and recent bets: open, won, lost, and winnings waiting to be collected";
  static override examples = [
    "<%= config.bin %> ninety bets",
    "<%= config.bin %> ninety bets --json",
  ];
  protected readonly pluginCommandId = "ninety:bets";

  async execute(_io: CommandIO): Promise<BetsResult> {
    const me = walletAddress(this.ctx);
    const [balance, bets] = await Promise.all([nusdBalance(monad(this.ctx), me), recentBets(me)]);
    const toCollect = bets
      .filter((b) => b.uncollected)
      .reduce((sum, b) => sum + (b.status === "won" ? b.payout : b.stake), 0n);
    return {
      address: me,
      balance: nusd(balance),
      toCollect: nusd(toCollect),
      bets: bets.slice(0, 20).map((b) => ({
        marketId: b.marketId,
        question: b.question,
        side: b.side,
        stake: nusd(b.stake),
        payout: nusd(b.payout),
        status: b.status,
        uncollected: b.uncollected,
      })),
    };
  }

  override successHint(data: BetsResult): string {
    const lines = data.bets.map(
      (b) =>
        `#${b.marketId}  ${b.question}  ${b.side.toUpperCase()} ${b.stake} nUSD → ${b.status}${b.status === "won" ? ` (${b.payout})` : ""}`,
    );
    const collect =
      data.toCollect !== "0"
        ? `\n${data.toCollect} nUSD to collect: run \`mm ninety collect\`.`
        : "";
    return [`Balance: ${data.balance} nUSD`, ...lines].join("\n") + collect;
  }
}
