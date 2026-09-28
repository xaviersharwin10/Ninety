import { type Address, parseEther } from "viem";
import { publicClient } from "./chain";

/**
 * Gas sponsorship for passkey accounts. A brand-new Mera account holds 0 MON and can't send a
 * transaction, so /api/gas-drip tops it up -- and does so again whenever it runs low, so a fan never
 * hits "insufficient funds" three bets in. MON is a testnet stand-in for gas the product would
 * sponsor; it never reaches the betting UI.
 *
 * Sized from measured costs at ~102 gwei: a new account's first bet (claim nUSD, approve, placeBet)
 * cost 0.104 MON; each later bet ~0.05-0.07. Monad bills gas on the limit, not gas used, so what
 * matters is the balance *reserved* per tx, which is why registering an agent (deploys a vault,
 * reserves ~0.39 MON on its own) gets a bigger target than betting.
 */
export type GasPurpose = "fan" | "agent";

export const GAS_TARGET_WEI: Record<GasPurpose, bigint> = {
  fan: parseEther("0.2"),
  agent: parseEther("0.6"),
};

/** Top up only once the balance has fallen below half the target, not after every transaction. */
export function needsTopUp(balanceWei: bigint, purpose: GasPurpose): boolean {
  return balanceWei < GAS_TARGET_WEI[purpose] / 2n;
}

/**
 * Makes sure `address` can afford the transaction it's about to send. Checks the balance locally
 * first, so the common case costs one (batched) read and no server round trip. Best effort: if the
 * drip is unavailable the transaction still goes ahead and fails with its own error.
 */
export async function ensureGas(address: Address, purpose: GasPurpose = "fan"): Promise<void> {
  try {
    const balance = await publicClient.getBalance({ address });
    if (!needsTopUp(balance, purpose)) return;
    await fetch("/api/gas-drip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, purpose }),
    });
  } catch {
    // Fall through: the write itself will surface a clear error if gas really is short.
  }
}
