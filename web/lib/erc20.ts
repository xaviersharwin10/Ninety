import type { Address } from "viem";
import { publicClient, type walletClientFor } from "./chain";
import { NUSD_ADDRESS, NusdAbi } from "./contracts";

/**
 * Approves `spender` for exactly `amount` nUSD if the current allowance is insufficient.
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
    address: NUSD_ADDRESS,
    abi: NusdAbi,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (current >= amount) return;

  const hash = await wallet.writeContract({
    address: NUSD_ADDRESS,
    abi: NusdAbi,
    functionName: "approve",
    args: [spender, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}
