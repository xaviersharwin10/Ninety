import { createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet, publicClient, RPC_URL } from "@/lib/chain";
import { GAS_TARGET_WEI, type GasPurpose, needsTopUp } from "@/lib/gas";

/**
 * Tops a passkey address up to a target MON balance so it can transact. This is a gas relayer, not
 * custody: it never sees the recipient's key, never holds user funds, and only ever moves its own
 * MON one way, to the address given (the caller gains nothing by naming someone else's). See
 * CLAUDE.md's "Best Mera-Powered UX" section: a fresh passkey account with zero MON cannot submit a
 * single transaction, which would otherwise make "time to first transaction" infinite.
 *
 * It tops up to a target rather than sending a flat amount, and only once the balance is below half
 * that target (see lib/gas.ts for how the targets were sized). A flat 0.5 MON to every sign-in
 * drained the shared deployer key within a day of testing.
 */
export async function POST(request: Request) {
  const privateKey = process.env.GAS_DRIP_PRIVATE_KEY;
  if (!privateKey) {
    return Response.json({ error: "gas_drip_not_configured" }, { status: 503 });
  }

  let address: string;
  let purpose: GasPurpose;
  try {
    const body = await request.json();
    address = body.address;
    purpose = body.purpose === "agent" ? "agent" : "fan";
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!isAddress(address)) {
    return Response.json({ error: "invalid_address" }, { status: 400 });
  }

  const current = await publicClient.getBalance({ address });
  if (!needsTopUp(current, purpose)) {
    return Response.json({
      dripped: false,
      reason: "already_funded",
      balanceWei: current.toString(),
    });
  }

  const amount = GAS_TARGET_WEI[purpose] - current;
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) });
  const hash = await wallet.sendTransaction({ to: address, value: amount });
  // Wait here rather than in the client: the caller's very next step is its own transaction, which
  // would fail if it raced this one.
  await publicClient.waitForTransactionReceipt({ hash });
  return Response.json({ dripped: true, hash, amountWei: amount.toString() });
}
