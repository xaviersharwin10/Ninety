import {
  BaseError,
  ContractFunctionRevertedError,
  type Hex,
  type LocalAccount,
  type TransactionReceipt,
} from "viem";
import { publicClient, walletClientFor } from "./chain";
import { ensureGas, type GasPurpose } from "./gas";

/** A transaction that was mined but reverted. Nothing it tried to do happened. */
export class TxRevertedError extends Error {}

/**
 * Waits for `hash` to be mined and throws `TxRevertedError` if it reverted. `writeContract`
 * resolves as soon as a transaction is *sent*; treating that as success showed "done" for
 * transactions that later failed on-chain.
 */
export async function confirmTx(hash: Hex): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new TxRevertedError();
  return receipt;
}

/** The custom error a failed contract call reverted with, if viem could decode one. */
export function revertErrorName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
}

/** The tail of each account's queue: every write waits for the one before it to be mined. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Every transaction a passkey account sends goes through here: tops up gas if it's low, sends,
 * and waits for a successful receipt -- one at a time per account. The account also writes in the
 * background (collecting winnings, its starting balance, see account-engine.ts), and two sends
 * racing from one account pick the same nonce, so the second is silently dropped. Queuing costs a
 * second at most; Monad mines in well under one.
 */
export function sendTx(
  account: LocalAccount,
  write: (wallet: ReturnType<typeof walletClientFor>) => Promise<Hex>,
  opts: { gas?: GasPurpose } = {},
): Promise<TransactionReceipt> {
  const key = account.address.toLowerCase();
  const run = async () => {
    await ensureGas(account.address, opts.gas ?? "fan");
    return confirmTx(await write(walletClientFor(account)));
  };
  const result = (queues.get(key) ?? Promise.resolve()).then(run, run);
  // The queue carries on whether this write succeeded or not.
  const tail = result.catch(() => {});
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return result;
}
