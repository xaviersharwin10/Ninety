import {
  CommandError,
  type CommandIO,
  type PluginCommandContext,
} from "@metamask/agent-wallet/plugin";
import { type Address, type Hex, isAddress } from "viem";
import { monad } from "./chain.js";
import { CHAIN_ID, EXPLORER_TX } from "./config.js";

interface WalletRef {
  id?: string;
  name?: string;
  address?: string;
}
interface WalletState {
  selectedWallet?: { ref: WalletRef };
  remoteWallets: { id?: string; name?: string; address: string }[];
  byokWallets: { id?: string; name?: string; address: string }[];
}

/** The Agent Wallet's selected EVM address, the one every Ninety transaction is sent from. */
export function walletAddress(ctx: PluginCommandContext): Address {
  const state = ctx.walletStateManager.read() as unknown as WalletState;
  const all = [...state.remoteWallets, ...state.byokWallets];
  const ref = state.selectedWallet?.ref;
  const selected = ref
    ? (all.find(
        (w) =>
          (ref.id !== undefined && w.id === ref.id) ||
          (ref.address !== undefined && w.address.toLowerCase() === ref.address.toLowerCase()) ||
          (ref.name !== undefined && w.name === ref.name),
      )?.address ?? ref.address)
    : all[0]?.address;
  if (!selected || !isAddress(selected)) {
    throw new CommandError(
      "NINETY_NO_WALLET",
      "No Agent Wallet is set up yet.",
      "Run `mm init`, then try again.",
    );
  }
  return selected;
}

/** What `ctx.walletExecutor` hands back for a transaction (the subset Ninety reads). */
interface ExecutorResult {
  kind: string;
  status: string;
  hash?: Hex;
  failureDescription?: string;
  pendingJob?: { pollingId?: string };
}

export interface Sent {
  status: string;
  hash?: Hex;
  explorerUrl?: string;
  pollingId?: string;
}

/**
 * Submits one transaction through the Agent Wallet: MetaMask simulates it, scans it and applies the
 * wallet's policy (and 2FA, if the policy asks for it) before it's signed. Ninety never touches a
 * key. `summary` is the plain-English line shown wherever the request is reviewed. Throws unless the
 * transaction was confirmed, or is waiting on the owner's approval.
 */
export async function send(
  ctx: PluginCommandContext,
  io: CommandIO,
  source: string,
  tx: { to: Address; data: Hex },
  summary: string,
): Promise<Sent> {
  // Gas and fees are worked out here, from Monad's RPC, and handed to the wallet with the
  // transaction: the Agent Wallet's own estimator asks its gateway, which doesn't serve Monad
  // testnet. Estimating first also stops a transaction that would revert before it's sent; on
  // Monad a reverted transaction is billed its whole gas limit.
  const client = monad(ctx);
  const from = walletAddress(ctx);
  const [gas, fees] = await Promise.all([
    client.estimateGas({ account: from, to: tx.to, data: tx.data }).catch((err: unknown) => {
      throw new CommandError(
        "NINETY_TX_WOULD_FAIL",
        `${summary}: it would fail onchain, so it wasn't sent (${shortReason(err)}).`,
        "Nothing was sent or charged. Check the details and try again.",
      );
    }),
    client.estimateFeesPerGas(),
  ]);
  const execute = await ctx.walletExecutor(io, source);
  const result = (await execute(
    {
      kind: "transaction",
      chainId: CHAIN_ID,
      transaction: {
        to: tx.to,
        data: tx.data,
        value: 0n,
        // Bigints: the executor hex-encodes them itself. A little headroom over the estimate; Monad
        // bills the limit, so not much.
        gas: (gas * 12n) / 10n,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      },
      intent: { action: "custom", summary },
    } as never,
    { signal: io.signal } as never,
  )) as unknown as ExecutorResult;
  const sent: Sent = {
    status: result.status,
    ...(result.hash ? { hash: result.hash, explorerUrl: `${EXPLORER_TX}${result.hash}` } : {}),
    ...(result.pendingJob?.pollingId ? { pollingId: result.pendingJob.pollingId } : {}),
  };
  if (result.status === "CONFIRMED" || result.status === "AWAITING_MFA") return sent;
  // On Monad testnet the wallet broadcasts but doesn't track confirmations, so its job ends at
  // BROADCASTED. The receipt, read here, is what says whether it worked.
  if (result.status === "BROADCASTED" && result.hash) {
    const receipt = await client.waitForTransactionReceipt({ hash: result.hash, timeout: 60_000 });
    if (receipt.status === "success") return { ...sent, status: "CONFIRMED" };
    throw new CommandError(
      "NINETY_TX_FAILED",
      `${summary}: reverted onchain (${sent.explorerUrl}).`,
      "Check the details and try again.",
    );
  }
  throw new CommandError(
    "NINETY_TX_FAILED",
    `${summary}: not completed (${result.status}${result.failureDescription ? `: ${result.failureDescription}` : ""}).`,
    "Nothing further was sent. Check `mm wallet requests list`, then try again.",
  );
}

/** The revert reason from a failed estimate, without viem's request dump. */
function shortReason(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return (e.shortMessage ?? e.message ?? "unknown").split("\n")[0]!;
}
