import {
  CommandError,
  type CommandIO,
  InputFieldType,
  type InputSchema,
  PluginCommand,
  schemaToArgs,
  schemaToFlags,
} from "@metamask/agent-wallet/plugin";
import { quoteBook } from "../../lib/api.js";
import { planBet } from "../../lib/bet.js";
import { nusd, parseNusd } from "../../lib/format.js";

const inputs = {
  market: {
    type: InputFieldType.Text,
    flag: "market",
    message: "Market id, from `mm ninety markets`",
    required: true,
    index: 0,
    validate: (v: string) => /^\d+$/.test(v) || "A market id is a number, e.g. 412.",
  },
  side: {
    type: InputFieldType.Select,
    flag: "side",
    message: "YES (it happens) or NO (it doesn't)",
    required: true,
    index: 1,
    options: [
      { value: "yes", label: "YES" },
      { value: "no", label: "NO" },
    ],
  },
  stake: {
    type: InputFieldType.Text,
    flag: "stake",
    message: "Stake in nUSD, e.g. 5",
    required: true,
    index: 2,
    validate: (v: string) =>
      parseNusd(v) !== null || "Stake must be a positive nUSD amount, e.g. 5 or 2.50.",
  },
} satisfies InputSchema;

interface QuoteResult {
  marketId: string;
  side: "yes" | "no";
  stake: string;
  /** The odds this stake gets, blended across the prices it's split over. */
  odds: string;
  payout: string;
}

export default class NinetyQuote extends PluginCommand<QuoteResult> {
  static override description =
    "Preview a bet without placing it: the exact odds and payout this stake gets right now, after it's split across the best prices";
  static override examples = ["<%= config.bin %> ninety quote 412 yes 5"];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "ninety:quote";

  async execute(io: CommandIO): Promise<QuoteResult> {
    const input = await io.resolveInputs(inputs);
    const side = input.side as "yes" | "no";
    const stake = parseNusd(input.stake)!;
    const book = await quoteBook(input.market);
    const plan = planBet(side === "yes" ? book.yes : book.no, side, stake);
    if (typeof plan === "string") {
      throw new CommandError(
        plan === "too_big" ? "NINETY_STAKE_TOO_BIG" : "NINETY_NO_PRICES",
        plan === "too_big"
          ? `${nusd(stake)} nUSD is more than market #${input.market} can take at the moment.`
          : `Market #${input.market} isn't priced right now.`,
        plan === "too_big" ? "Try a smaller stake." : "Check `mm ninety markets` and try again.",
      );
    }
    return {
      marketId: input.market,
      side,
      stake: nusd(stake),
      odds: `${plan.blendedOdds.toFixed(2)}x`,
      payout: nusd(plan.payout),
    };
  }

  override successHint(d: QuoteResult): string {
    return `${d.stake} nUSD on ${d.side.toUpperCase()} in #${d.marketId}: ${d.odds}, pays ${d.payout} nUSD if it wins. Prices move every few seconds; place it with \`mm ninety bet ${d.marketId} ${d.side} ${d.stake}\`.`;
  }
}
