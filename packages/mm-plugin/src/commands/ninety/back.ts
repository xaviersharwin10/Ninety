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
import { type Abi, encodeFunctionData, erc20Abi } from "viem";
import { marketMakers, monad, nusdAllowance, nusdBalance } from "../../lib/chain.js";
import { CONTRACTS } from "../../lib/config.js";
import { nusd, parseNusd } from "../../lib/format.js";
import { makerField, resolveMaker } from "../../lib/maker-input.js";
import { send, walletAddress } from "../../lib/wallet.js";

const inputs = {
  agent: makerField,
  amount: {
    type: InputFieldType.Text,
    flag: "amount",
    message: "nUSD to put behind it, e.g. 100",
    required: true,
    index: 1,
    validate: (v: string) =>
      parseNusd(v) !== null || "Amount must be a positive nUSD amount, e.g. 100.",
  },
} satisfies InputSchema;

interface BackResult {
  agent: string;
  amount: string;
  /** Your whole stake in it now. */
  yours: string;
  /** Withdrawals reopen this long after a deposit. */
  lockedForSec: number;
  status: string;
  hash?: string;
  explorerUrl?: string;
  pollingId?: string;
}

export default class NinetyBack extends PluginCommand<BackResult> {
  static override description =
    "Back an AI market maker: your nUSD joins its vault, funds the prices it offers, and earns its trading margin";
  static override examples = ["<%= config.bin %> ninety back Tempo 100"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "ninety:back";

  async execute(io: CommandIO): Promise<BackResult> {
    const input = await io.resolveInputs(inputs);
    const amount = parseNusd(input.amount)!;
    const me = walletAddress(this.ctx);
    const client = monad(this.ctx);
    const maker = resolveMaker(await marketMakers(client, me), input.agent);

    const balance = await nusdBalance(client, me);
    if (balance < amount) {
      throw new CommandError(
        "NINETY_INSUFFICIENT_NUSD",
        `You have ${nusd(balance)} nUSD; backing ${maker.name} with ${nusd(amount)} needs more.`,
        "Get free test nUSD with `mm ninety faucet`, or back with less.",
      );
    }
    if ((await nusdAllowance(client, me, maker.vault)) < amount) {
      await send(
        this.ctx,
        io,
        this.pluginCommandId,
        {
          to: CONTRACTS.nusd,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [maker.vault, amount],
          }),
        },
        `Allow ${maker.name}'s Ninety vault to take ${nusd(amount)} nUSD`,
      );
    }
    const sent = await send(
      this.ctx,
      io,
      this.pluginCommandId,
      {
        to: maker.vault,
        data: encodeFunctionData({
          abi: AgentVaultAbi as Abi,
          functionName: "deposit",
          args: [amount, me],
        }),
      },
      `Back Ninety market maker ${maker.name} with ${nusd(amount)} nUSD`,
    );
    return {
      agent: maker.name,
      amount: nusd(amount),
      yours: nusd(maker.yours + amount),
      lockedForSec: maker.cooldownSec,
      ...sent,
    };
  }

  override successHint(data: BackResult): string {
    const lock =
      data.lockedForSec > 0
        ? ` You can withdraw again in ${Math.ceil(data.lockedForSec / 60)} min.`
        : "";
    return `You're backing ${data.agent} with ${data.yours} nUSD.${lock}`;
  }
}
