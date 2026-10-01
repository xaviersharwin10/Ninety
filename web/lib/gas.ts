import { type Address, parseEther } from "viem";
import { publicClient } from "./chain";

/**
 * Gas sponsorship for passkey accounts. A brand-new Mera account holds 0 MON and can't send a
 * transaction, so /api/gas-drip tops it up -- and does so again whenever it runs low, so a fan never
 * hits "insufficient funds" three bets in. MON is a testnet stand-in for gas the product would
 * sponsor; it never reaches the betting UI.
 *
 * Sized from measured costs at Monad testnet's fixed ~102 gwei: a new account's setup and first bet
 * (claim nUSD, approve, placeBet) cost 0.098 MON; each later bet ~0.04. The fan target covers that
 * first bet with a little room, then tops up 0.06 or so at a time as they keep betting: most of
 * what a drive-by visitor is given, they use. At 0.2 MON a one-bet visit stranded ~0.1 MON. Monad bills gas on the limit, not gas used, so what
 * matters is the balance *reserved* per tx, which is why registering an agent (deploys a vault,
 * reserves ~0.39 MON on its own) gets a bigger target than betting.
 */
export type GasPurpose = "fan" | "agent";

export const GAS_TARGET_WEI: Record<GasPurpose, bigint> = {
  fan: parseEther("0.12"),
  // register() carries a ~2.3M gas limit: ~0.28 MON reserved at ~120 gwei max fee (it actually
  // costs ~0.24). 0.45 covers it, the vault deposit and a memory save, without stranding much.
  agent: parseEther("0.45"),
};

/** Top up only once the balance has fallen below half the target, not after every transaction. */
export function needsTopUp(balanceWei: bigint, purpose: GasPurpose): boolean {
  return balanceWei < GAS_TARGET_WEI[purpose] / 2n;
}

/**
 * Makes sure `address` can afford the transaction it's about to send. For routine fan writes it
 * checks the balance locally first, so the common case costs one read and no server round trip.
 * The local check may only ever *skip* a top-up when it positively knows the balance is fine: if it
 * can't read the balance, it asks the server, and agent-sized requests (registration, the priciest
 * thing anyone does here) always go to the server, which checks for itself. Failures are logged,
 * never thrown: the write still goes ahead and fails with its own error if gas really is short.
 */
export async function ensureGas(address: Address, purpose: GasPurpose = "fan"): Promise<void> {
  if (purpose === "fan") {
    try {
      const balance = await publicClient.getBalance({ address });
      if (!needsTopUp(balance, purpose)) return;
    } catch {
      // Couldn't tell locally: let the server decide.
    }
  }
  try {
    const res = await fetch("/api/gas-drip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, purpose }),
    });
    if (!res.ok) console.warn(`gas top-up failed: HTTP ${res.status}`, await res.text());
  } catch (err) {
    console.warn("gas top-up failed:", err);
  }
}
