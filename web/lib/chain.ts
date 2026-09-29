import { rateLimitedHttp } from "@ninety/core";
import { createPublicClient, createWalletClient, defineChain, type LocalAccount } from "viem";

export { isRateLimited } from "@ninety/core";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://testnet-rpc.monad.xyz";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 10143);

export const monadTestnet = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  // Canonical Multicall3 -- confirmed deployed on Monad testnet. Declaring it here is what lets
  // `batch.multicall` below fold concurrent reads into one eth_call.
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

// Shared with the agents: see rateLimitedHttp in @ninety/core for why viem's own retry isn't enough.
const transport = () => rateLimitedHttp(RPC_URL);

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: transport(),
  // Every readContract issued in the same tick (a page mounting balances + vault position +
  // agents together) becomes one Multicall3 eth_call instead of one request each.
  batch: { multicall: true },
});

/** A fresh wallet client bound to a Mera-derived account, for exactly one write. */
export function walletClientFor(account: LocalAccount) {
  return createWalletClient({ account, chain: monadTestnet, transport: transport() });
}
