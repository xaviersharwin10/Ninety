import { type Address, parseEther } from "viem";
import { publicClient } from "./chain";

/**
 * Gas sponsorship for passkey accounts. A brand-new Mera account holds 0 MON and can't send a
 * transaction, so /api/gas-drip tops it up -- and does so again whenever it runs low, so a fan never
 * hits "insufficient funds" three bets in. MON is a testnet stand-in for gas the product would
 * sponsor; it never reaches the betting UI.
 *
 * Sized from what a transaction *reserves*, not what it costs: Monad bills gas on the limit, and
 * an account must hold limit x max fee to send at all. At testnet's ~102 gwei base fee (~122 gwei
 * max fee):
 *
 * - a bet split three ways reserves ~0.072 MON from the app and ~0.086 through the MetaMask plugin,
 *   which pads its gas limit by 20%. A new account's setup and first bet cost 0.098 in all;
 * - registering an agent deploys a vault: a ~2.3M gas limit, ~0.28 MON reserved;
 * - saving an agent's memory or re-sealing its strategy reserves less than a bet does, so those
 *   are sized as fan writes.
 *
 * Each purpose has a floor, the most its next transaction can reserve, and a target to refill to.
 * The floor used to be half the target (0.06 for fans): an account holding 0.06 to 0.086 MON got
 * no top-up and couldn't afford a bet either. The fan target leaves room for about one more bet
 * after the first; at 0.2 a one-bet visitor stranded ~0.1 MON.
 */
export type GasPurpose = "fan" | "agent";

export const GAS_FLOOR_WEI: Record<GasPurpose, bigint> = {
  fan: parseEther("0.09"),
  agent: parseEther("0.4"),
};

export const GAS_TARGET_WEI: Record<GasPurpose, bigint> = {
  fan: parseEther("0.15"),
  // Registration only. It actually costs ~0.24; what's left covers funding the new vault.
  agent: parseEther("0.45"),
};

/** Top up once the balance can no longer cover the next transaction of this kind. */
export function needsTopUp(balanceWei: bigint, purpose: GasPurpose): boolean {
  return balanceWei < GAS_FLOOR_WEI[purpose];
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
