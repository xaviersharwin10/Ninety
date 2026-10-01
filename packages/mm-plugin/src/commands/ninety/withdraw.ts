import {
  CommandError,
  type CommandIO,
  InputFieldType,
  type InputSchema,
  PluginCommand,
  schemaToArgs,
  schemaToFlags,
} from "@metamask/agent-wallet/plugin";
import { AgentVaultAbi } from "@ninety/core";
import { type Abi, encodeFunctionData } from "viem";
import { marketMakers, monad } from "../../lib/chain.js";
import { nusd, parseNusd } from "../../lib/format.js";
import { makerField, resolveMaker } from "../../lib/maker-input.js";
import { send, walletAddress } from "../../lib/wallet.js";

const inputs = {
  agent: makerField,
  amount: {
    type: InputFieldType.Text,
    flag: "amount",
    message: 'nUSD to take out, or "all"',
    required: true,
    index: 1,
    validate: (v: string) =>
      v === "all" || parseNusd(v) !== null || 'Amount must be nUSD, e.g. 50, or "all".',
  },
} satisfies InputSchema;

interface WithdrawResult {
  agent: string;
  amount: string;
  status: string;
  hash?: string;
  explorerUrl?: string;
  pollingId?: string;
}

export default class NinetyWithdraw extends PluginCommand<WithdrawResult> {
  static override description = "Take nUSD back out of a market maker you back";
  static override examples = [
    "<%= config.bin %> ninety withdraw Tempo 50",
    "<%= config.bin %> ninety withdraw Tempo all",
  ];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "ninety:withdraw";

  async execute(io: CommandIO): Promise<WithdrawResult> {
    const input = await io.resolveInputs(inputs);
    const me = walletAddress(this.ctx);
    const maker = resolveMaker(await marketMakers(monad(this.ctx), me), input.agent);

    if (maker.yourShares === 0n) {
      throw new CommandError(
        "NINETY_NOT_BACKING",
        `You aren't backing ${maker.name}.`,
        "See your stakes with `mm ninety agents`.",
      );
    }
    if (maker.withdrawable === 0n) {
      const reopens = maker.lastDepositAt + maker.cooldownSec;
      const cooling = reopens * 1000 > Date.now();
      throw new CommandError(
        "NINETY_WITHDRAW_LOCKED",
        cooling
          ? `Your stake in ${maker.name} unlocks at ${new Date(reopens * 1000).toISOString()}, a while after your last deposit.`
          : `${maker.name}'s capital is all backing open bets right now.`,
        cooling ? "Try again after that." : "Try again once its markets settle, in a few minutes.",
      );
    }

    const all = input.amount === "all";
    const amount = all ? maker.withdrawable : parseNusd(input.amount)!;
    if (amount > maker.withdrawable) {
      throw new CommandError(
        "NINETY_WITHDRAW_TOO_MUCH",
        `You can take out up to ${nusd(maker.withdrawable)} nUSD from ${maker.name} right now.`,
        `Withdraw that or less, or "all".`,
      );
    }
    // "all" redeems shares, so not a dust of value is left behind to rounding.
    const data = all
      ? encodeFunctionData({
          abi: AgentVaultAbi as Abi,
          functionName: "redeem",
          args: [maker.withdrawableShares, me, me],
        })
      : encodeFunctionData({
          abi: AgentVaultAbi as Abi,
          functionName: "withdraw",
          args: [amount, me, me],
        });
    const sent = await send(
      this.ctx,
      io,
      this.pluginCommandId,
      { to: maker.vault, data },
      `Withdraw ${nusd(amount)} nUSD from Ninety market maker ${maker.name}`,
    );
    return { agent: maker.name, amount: nusd(amount), ...sent };
  }

  override successHint(data: WithdrawResult): string {
    return `Withdrew ${data.amount} nUSD from ${data.agent}.`;
  }
}
