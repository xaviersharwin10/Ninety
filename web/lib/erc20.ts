import type { Address } from "viem";
import { publicClient, type walletClientFor } from "./chain";
import { AUSD_ADDRESS, Erc20Abi } from "./contracts";

/**
 * Approves `spender` for exactly `amount` AUSD if the current allowance is insufficient.
 * Sets a fresh allowance sized to what's about to be spent, rather than a standing max approval,
 * so nothing is left behind once the transaction that needed it is done.
 */
export async function ensureAllowance(
  wallet: ReturnType<typeof walletClientFor>,
  owner: Address,
  spender: Address,
  amount: bigint,
): Promise<void> {
  const current = await publicClient.readContract({
    address: AUSD_ADDRESS,
    abi: Erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (current >= amount) return;

  const hash = await wallet.writeContract({
    address: AUSD_ADDRESS,
    abi: Erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}
