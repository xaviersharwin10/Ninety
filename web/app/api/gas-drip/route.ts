import { createWalletClient, http, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet, publicClient, RPC_URL } from "@/lib/chain";

/**
 * Funds a brand-new passkey address with a little MON so it can actually transact. This is a gas
 * relayer, not custody: it never sees the recipient's key, never holds user funds, and only ever
 * moves its own MON one way, to an address the caller already controls (or claims to -- the
 * recipient gains nothing by lying about whose address it is, since the drip only ever lands in
 * that same address). See CLAUDE.md's "Best Mera-Powered UX" section for why this exists: a fresh
 * passkey account with zero MON cannot submit a single transaction, which would otherwise make
 * "time to first transaction" infinite.
 */
// 0.5 MON default, not less: Monad bills gas on a tx's gas_limit, not gas actually used, so an
// account needs gas_limit * maxFeePerGas available before a tx lands, not just its real cost.
// AgentRegistry.register() (deploys a new AgentVault) alone reserves ~0.39 MON on testnet.
const DRIP_AMOUNT_WEI = BigInt(process.env.GAS_DRIP_AMOUNT_WEI ?? parseEther("0.5").toString());
// Only top up an account that's genuinely empty-ish -- this is a demo convenience, not a faucet
// to be drained repeatedly by the same address.
const TOP_UP_BELOW_WEI = DRIP_AMOUNT_WEI / 4n;

export async function POST(request: Request) {
  const privateKey = process.env.GAS_DRIP_PRIVATE_KEY;
  if (!privateKey) {
    return Response.json({ error: "gas_drip_not_configured" }, { status: 503 });
  }

  let address: string;
  try {
    ({ address } = await request.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!isAddress(address)) {
    return Response.json({ error: "invalid_address" }, { status: 400 });
  }

  const current = await publicClient.getBalance({ address });
  if (current >= TOP_UP_BELOW_WEI) {
    return Response.json({
      dripped: false,
      reason: "already_funded",
      balanceWei: current.toString(),
    });
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) });

  const hash = await wallet.sendTransaction({ to: address, value: DRIP_AMOUNT_WEI });
  return Response.json({ dripped: true, hash, amountWei: DRIP_AMOUNT_WEI.toString() });
}
