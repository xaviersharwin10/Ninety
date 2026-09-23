import { createPublicClient, createWalletClient, defineChain, http, type LocalAccount } from "viem";

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
  testnet: true,
});

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC_URL),
});

/** A fresh wallet client bound to a Mera-derived account, for exactly one write. */
export function walletClientFor(account: LocalAccount) {
  return createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) });
}
