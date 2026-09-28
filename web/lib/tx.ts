import { BaseError, ContractFunctionRevertedError, type Hex } from "viem";
import { publicClient } from "./chain";

/** A transaction that was mined but reverted. Nothing it tried to do happened. */
export class TxRevertedError extends Error {}

/**
 * Waits for `hash` to be mined and throws `TxRevertedError` if it reverted. `writeContract`
 * resolves as soon as a transaction is *sent*; treating that as success showed "done" for
 * transactions that later failed on-chain.
 */
export async function confirmTx(hash: Hex): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new TxRevertedError();
}

/** The custom error a failed contract call reverted with, if viem could decode one. */
export function revertErrorName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
}
