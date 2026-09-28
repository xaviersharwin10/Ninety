import {
  createPublicClient,
  createWalletClient,
  defineChain,
  type HttpTransport,
  http,
  type LocalAccount,
} from "viem";

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

/** True for the public RPC's "requests limited to 15/sec" rejection (or a plain HTTP 429). */
export function isRateLimited(err: unknown): boolean {
  const text =
    err instanceof Error
      ? `${err.message} ${String((err as { details?: unknown }).details ?? "")} ${String(err.cause ?? "")}`
      : String(err);
  return /429|limited to \d+\/sec|rate limit/i.test(text);
}

const RATE_LIMIT_RETRIES = 4;

/**
 * viem's built-in retry doesn't cover this: Monad's public RPC reports its 15 req/s cap as a
 * generic JSON-RPC error ("RPC Request failed" / "requests limited to 15/sec"), not an HTTP 429 or a
 * known limit-exceeded code. A page that mounts several hooks at once can briefly exceed it, and
 * without this every such burst surfaced as an unhandled error. Backoff: 300ms, 600ms, 1.2s, 2.4s.
 */
function withRateLimitRetry(transport: HttpTransport): HttpTransport {
  return ((config) => {
    const inner = transport(config);
    return {
      ...inner,
      async request(args, options) {
        for (let attempt = 0; ; attempt++) {
          try {
            return await inner.request(args, options);
          } catch (err) {
            if (attempt >= RATE_LIMIT_RETRIES || !isRateLimited(err)) throw err;
            await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
          }
        }
      },
    };
  }) as HttpTransport;
}

const transport = () => withRateLimitRetry(http(RPC_URL));

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
