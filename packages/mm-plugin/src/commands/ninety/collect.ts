import { type CommandIO, PluginCommand } from "@metamask/agent-wallet/plugin";
import { BetRouterAbi } from "@ninety/core";
import { type Abi, encodeFunctionData } from "viem";
import { MULTICALL3, monad } from "../../lib/chain.js";
import { CONTRACTS } from "../../lib/config.js";
import { nusd } from "../../lib/format.js";
import { recentBets } from "../../lib/history.js";
import { type Sent, send, walletAddress } from "../../lib/wallet.js";

interface CollectResult {
  collected: string;
  bets: number;
  status: string;
  hash?: string;
  explorerUrl?: string;
  pollingId?: string;
}

export default class NinetyCollect extends PluginCommand<CollectResult> {
  static override description =
    "Collect your settled winnings and refunds into your wallet, in one transaction";
  static override examples = ["<%= config.bin %> ninety collect"];
  protected readonly pluginCommandId = "ninety:collect";

  async execute(io: CommandIO): Promise<CollectResult> {
    const me = walletAddress(this.ctx);
    const client = monad(this.ctx);
    const ids = (await recentBets(me, 200)).filter((b) => b.uncollected).flatMap((b) => b.betIds);
    if (ids.length === 0) return { collected: "0", bets: 0, status: "NOTHING_TO_COLLECT" };

    // The chain has the last word on what's owed; the history can lag a block or two.
    const owed = (await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: false,
      contracts: ids.map((id) => ({
        address: CONTRACTS.betRouter,
        abi: BetRouterAbi as Abi,
        functionName: "claimableAmount",
        args: [id],
      })),
    })) as bigint[];
    const payable = ids.filter((_, i) => owed[i]! > 0n);
    const total = owed.reduce((a, b) => a + b, 0n);
    if (payable.length === 0) return { collected: "0", bets: 0, status: "NOTHING_TO_COLLECT" };

    const sent: Sent = await send(
      this.ctx,
      io,
      this.pluginCommandId,
      {
        to: CONTRACTS.betRouter,
        data: encodeFunctionData({
          abi: BetRouterAbi as Abi,
          functionName: "claim",
          args: [payable],
        }),
      },
      `Collect ${nusd(total)} nUSD of Ninety winnings and refunds`,
    );
    return { collected: nusd(total), bets: payable.length, ...sent };
  }

  override successHint(data: CollectResult): string {
    if (data.status === "NOTHING_TO_COLLECT")
      return "Nothing to collect yet. Bets settle a minute or two after their market closes.";
    return `Collected ${data.collected} nUSD.`;
  }
}
