import { type Address, type LocalAccount, maxUint256 } from "viem";
import { publicClient } from "./chain";
import { NUSD_ADDRESS, NusdAbi } from "./contracts";
import { sendTx } from "./tx";

/**
 * Makes sure `spender` may pull at least `amount` nUSD from `account`, approving once, for good,
 * if not. A standing approval of the betting contract is what makes every bet a single
 * transaction; the account setup (account-engine.ts) grants it at sign-in, so this is only the
 * fallback for when that hasn't finished.
 */
export async function ensureAllowance(
  account: LocalAccount,
  spender: Address,
  amount: bigint,
): Promise<void> {
  if ((await allowanceOf(account.address, spender)) >= amount) return;
  await sendTx(account, (wallet) =>
    wallet.writeContract({
      address: NUSD_ADDRESS,
      abi: NusdAbi,
      functionName: "approve",
      args: [spender, maxUint256],
    }),
  );
}

export function allowanceOf(owner: Address, spender: Address): Promise<bigint> {
  return publicClient.readContract({
    address: NUSD_ADDRESS,
    abi: NusdAbi,
    functionName: "allowance",
    args: [owner, spender],
  });
}
