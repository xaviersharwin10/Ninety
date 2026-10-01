import {
  CommandError,
  type CommandIO,
  InputFieldType,
  type InputSchema,
  PluginCommand,
  schemaToArgs,
  schemaToFlags,
} from "@metamask/agent-wallet/plugin";
import { BetRouterAbi } from "@ninety/core";
import { type Abi, encodeFunctionData, erc20Abi } from "viem";
import { quoteBook } from "../../lib/api.js";
import { planBet } from "../../lib/bet.js";
import { monad, nusdAllowance, nusdBalance } from "../../lib/chain.js";
import { CONTRACTS } from "../../lib/config.js";
import { nusd, parseNusd } from "../../lib/format.js";
import { send, walletAddress } from "../../lib/wallet.js";

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
  minOdds: {
    type: InputFieldType.Text,
    flag: "min-odds",
    message: "Worst odds you'll accept, e.g. 1.8 (default: whatever the best prices are)",
    required: false,
    prompt: false,
    validate: (v: string) => Number(v) > 1 || "Odds are decimal and above 1, e.g. 1.8.",
  },
} satisfies InputSchema;

interface BetResult {
  marketId: string;
  side: "yes" | "no";
  stake: string;
  odds: string;
  /** What it pays if it wins, stake included. */
  payout: string;
  status: string;
  hash?: string;
  explorerUrl?: string;
  pollingId?: string;
}

export default class NinetyBet extends PluginCommand<BetResult> {
  static override description =
    "Bet nUSD on a live micro-market. Your stake is split across the best three prices, and you see the exact payout before it's sent";
  static override examples = [
    "<%= config.bin %> ninety bet 412 yes 5",
    "<%= config.bin %> ninety bet --market 412 --side no --stake 10 --min-odds 1.5",
  ];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "ninety:bet";

  async execute(io: CommandIO): Promise<BetResult> {
    const input = await io.resolveInputs(inputs);
    const side = input.side as "yes" | "no";
    const stake = parseNusd(input.stake)!;
    const minOdds = input.minOdds ? Number(input.minOdds) : undefined;
    const client = monad(this.ctx);
    const me = walletAddress(this.ctx);

    const balance = await nusdBalance(client, me);
    if (balance < stake) {
      throw new CommandError(
        "NINETY_INSUFFICIENT_NUSD",
        `You have ${nusd(balance)} nUSD; this bet needs ${nusd(stake)}.`,
        "Get free test nUSD with `mm ninety faucet`.",
      );
    }

    // Allow the bet router exactly this stake, if it can't already take it. Done before pricing:
    // prices live for seconds, and this may wait on the wallet's own checks.
    if ((await nusdAllowance(client, me, CONTRACTS.betRouter)) < stake) {
      await send(
        this.ctx,
        io,
        this.pluginCommandId,
        {
          to: CONTRACTS.nusd,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [CONTRACTS.betRouter, stake],
          }),
        },
        `Allow Ninety's bet router to take this ${nusd(stake)} nUSD stake`,
      );
    }

    const book = await quoteBook(input.market);
    const plan = planBet(
      side === "yes" ? book.yes : book.no,
      side,
      stake,
      minOdds === undefined ? {} : { minOdds },
    );
    if (plan === "no_prices") {
      throw new CommandError(
        "NINETY_NO_PRICES",
        `Market #${input.market} isn't priced right now: it may have closed, or be paused around a big moment.`,
        "Check `mm ninety markets` and try again in a few seconds.",
      );
    }
    if (plan === "too_big") {
      throw new CommandError(
        "NINETY_STAKE_TOO_BIG",
        `${nusd(stake)} nUSD is more than market #${input.market} can take at the moment.`,
        "Try a smaller stake.",
      );
    }
    if (plan === "below_min_odds") {
      throw new CommandError(
        "NINETY_ODDS_TOO_LOW",
        `The best odds on ${side.toUpperCase()} are below your ${minOdds}x.`,
        "Lower --min-odds, or wait for the price to move.",
      );
    }

    const oddsText = `${plan.blendedOdds.toFixed(2)}x`;
    const sent = await send(
      this.ctx,
      io,
      this.pluginCommandId,
      {
        to: CONTRACTS.betRouter,
        data: encodeFunctionData({
          abi: BetRouterAbi as Abi,
          functionName: "placeBet",
          args: [
            BigInt(input.market),
            side === "yes" ? 0 : 1,
            plan.stake,
            plan.minPayout,
            plan.fills,
          ],
        }),
      },
      `Bet ${nusd(stake)} nUSD on ${side.toUpperCase()} in Ninety market #${input.market} at ${oddsText}; pays ${nusd(plan.payout)} nUSD if it wins`,
    );
    return {
      marketId: input.market,
      side,
      stake: nusd(stake),
      odds: oddsText,
      payout: nusd(plan.payout),
      ...sent,
    };
  }

  override successHint(data: BetResult): string {
    if (data.status === "AWAITING_MFA") {
      return `Waiting for your approval of the bet (${data.pollingId}). Prices last seconds, so it may expire before you approve.`;
    }
    return `Bet placed: ${data.stake} nUSD on ${data.side.toUpperCase()} at ${data.odds}, pays ${data.payout} nUSD if it wins. It settles within minutes; collect with \`mm ninety collect\`.`;
  }
}
