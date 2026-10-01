import { type CommandIO, PluginCommand } from "@metamask/agent-wallet/plugin";
import { encodeFunctionData } from "viem";
import { requestGas } from "../../lib/api.js";
import { monad, NusdFaucetAbi, nusdBalance } from "../../lib/chain.js";
import { CONTRACTS } from "../../lib/config.js";
import { nusd } from "../../lib/format.js";
import { send, walletAddress } from "../../lib/wallet.js";

interface FaucetResult {
  balance: string;
  claimed: boolean;
  /** When the faucet allows the next claim (ISO time), if it's cooling down. */
  nextClaimAt?: string;
  gasToppedUp: boolean;
  hash?: string;
  explorerUrl?: string;
}

export default class NinetyFaucet extends PluginCommand<FaucetResult> {
  static override description =
    "Get free test nUSD to bet with (and a little testnet MON for gas, if you're low). Testnet only";
  static override examples = ["<%= config.bin %> ninety faucet"];
  protected readonly pluginCommandId = "ninety:faucet";

  async execute(io: CommandIO): Promise<FaucetResult> {
    const me = walletAddress(this.ctx);
    const client = monad(this.ctx);
    const { dripped } = await requestGas(me).catch(() => ({ dripped: false }));

    const next = Number(
      await client.readContract({
        address: CONTRACTS.nusd,
        abi: NusdFaucetAbi,
        functionName: "nextClaimAt",
        args: [me],
      }),
    );
    if (next * 1000 > Date.now()) {
      return {
        balance: nusd(await nusdBalance(client, me)),
        claimed: false,
        nextClaimAt: new Date(next * 1000).toISOString(),
        gasToppedUp: dripped,
      };
    }
    const sent = await send(
      this.ctx,
      io,
      this.pluginCommandId,
      {
        to: CONTRACTS.nusd,
        data: encodeFunctionData({ abi: NusdFaucetAbi, functionName: "claim" }),
      },
      "Claim free test nUSD from Ninety's faucet",
    );
    return {
      balance: nusd(await nusdBalance(client, me)),
      claimed: true,
      gasToppedUp: dripped,
      ...(sent.hash ? { hash: sent.hash } : {}),
      ...(sent.explorerUrl ? { explorerUrl: sent.explorerUrl } : {}),
    };
  }

  override successHint(data: FaucetResult): string {
    return data.claimed
      ? `Balance: ${data.balance} nUSD. See what's on with \`mm ninety markets\`.`
      : `The faucet refills at ${data.nextClaimAt}. Balance: ${data.balance} nUSD.`;
  }
}
