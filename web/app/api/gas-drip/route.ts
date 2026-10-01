import { createWalletClient, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "@/lib/chain";
import { GAS_TARGET_WEI, type GasPurpose, needsTopUp } from "@/lib/gas";
import { clientIp, DripBudget } from "@/lib/server/gas-budget";
import { serverPublicClient as publicClient, serverTransport } from "@/lib/server/rpc";

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
/**
 * Monad's consensus checks a sender's gas against its balance as of k = 3 blocks ago (the Reserve
 * Balance rule, docs.monad.xyz/developer-essentials/reserve-balance), so MON received in the last 3
 * blocks can't pay for gas yet. Replying the moment the top-up was mined let the caller's very next
 * transaction -- registering an agent, placing a bet -- be rejected by the RPC ("Missing or invalid
 * parameters") intermittently, depending on timing. One block of margin on top.
 */
const RESERVE_BALANCE_LAG_BLOCKS = 4n;

/**
 * Top-ups in flight, per address. A page can ask twice at once (React runs effects twice in
 * development, and a sign-in and a write can overlap); both saw the same low balance and both paid.
 */
const inFlight = new Map<string, Promise<Response>>();

/** What the sponsor may give away (see lib/server/gas-budget.ts). The ceiling is configurable. */
const budget = new DripBudget({
  newAccountsPerIp: 3,
  dailyCapWei: parseEther(process.env.GAS_DRIP_DAILY_CAP_MON || "1.5"),
});

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

  const key = `${address.toLowerCase()}:${purpose}`;
  const pending = inFlight.get(key);
  if (pending) return (await pending).clone();
  const work = drip(address as `0x${string}`, purpose, privateKey, clientIp(request.headers));
  inFlight.set(key, work);
  try {
    return (await work).clone();
  } finally {
    inFlight.delete(key);
  }
}

async function drip(
  address: `0x${string}`,
  purpose: GasPurpose,
  privateKey: string,
  ip: string,
): Promise<Response> {
  const current = await publicClient.getBalance({ address });
  if (!needsTopUp(current, purpose)) {
    return Response.json({
      dripped: false,
      reason: "already_funded",
      balanceWei: current.toString(),
    });
  }

  const amount = GAS_TARGET_WEI[purpose] - current;
  // A new account: nothing sent from it yet. Those are what a script would mint in a loop.
  const newAccount = (await publicClient.getTransactionCount({ address })) === 0;
  const denied = budget.check(ip, newAccount, amount);
  if (denied) {
    console.warn(`[gas-drip] refused ${address} from ${ip}: ${denied}`);
    return Response.json({ error: denied }, { status: 429 });
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  // Check we can actually pay it. On Monad an over-balance transfer isn't rejected up front: it's
  // included and reverts, so without this the drip "succeeded" while sending nothing, and the
  // caller's next transaction failed for lack of gas with no hint as to why.
  const reserve = parseEther("0.05");
  if ((await publicClient.getBalance({ address: account.address })) < amount + reserve) {
    console.error(`[gas-drip] sponsor ${account.address} can't cover ${amount} wei -- refill it`);
    return Response.json({ error: "gas_sponsorship_empty" }, { status: 503 });
  }
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: serverTransport() });
  // Counted before sending, so two requests at once can't both slip under a limit.
  budget.record(ip, newAccount, amount);
  const hash = await wallet.sendTransaction({ to: address, value: amount });
  // Wait here rather than in the client: the caller's very next step is its own transaction, which
  // would fail if it raced this one.
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    return Response.json({ error: "gas_drip_reverted", hash }, { status: 502 });
  }
  const spendableAt = receipt.blockNumber + RESERVE_BALANCE_LAG_BLOCKS;
  while ((await publicClient.getBlockNumber()) < spendableAt) {
    await new Promise((r) => setTimeout(r, 250));
  }
  return Response.json({ dripped: true, hash, amountWei: amount.toString() });
}
