import {
  CommandError,
  type CommandIO,
  type PluginCommandContext,
} from "@metamask/agent-wallet/plugin";
import { type Address, type Hex, isAddress } from "viem";
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
  const execute = await ctx.walletExecutor(io, source);
  const result = (await execute(
    {
      kind: "transaction",
      chainId: CHAIN_ID,
      transaction: { to: tx.to, data: tx.data, value: "0x0" },
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
  throw new CommandError(
    "NINETY_TX_FAILED",
    `${summary}: not completed (${result.status}${result.failureDescription ? `: ${result.failureDescription}` : ""}).`,
    "Nothing further was sent. Check `mm wallet requests list`, then try again.",
  );
}
