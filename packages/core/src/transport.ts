import { fallback, type HttpTransport, type HttpTransportConfig, http, type Transport } from "viem";

/** True for Monad's public RPC rejecting a request over its 15 req/s cap (or a plain HTTP 429). */
export function isRateLimited(err: unknown): boolean {
  const text =
    err instanceof Error
      ? `${err.message} ${String((err as { details?: unknown }).details ?? "")} ${String(err.cause ?? "")}`
      : String(err);
  return /429|limited to \d+\/sec|rate limit/i.test(text);
}

const RATE_LIMIT_RETRIES = 4;

/**
 * viem's `http` transport, plus retries for the one failure viem's own retry doesn't cover: Monad's
 * public RPC reports its 15 req/s cap as a generic JSON-RPC error ("RPC Request failed" / "requests
 * limited to 15/sec"), not an HTTP 429 or a known limit-exceeded code. Every service here shares
 * that one cap -- the web app, three agents, the scheduler, the settlement watcher -- so brief
 * bursts over it are routine, and without this each one surfaced as a failed read.
 * Backoff: 300ms, 600ms, 1.2s, 2.4s.
 */
export function rateLimitedHttp(url?: string, config?: HttpTransportConfig): HttpTransport {
  const transport = http(url, config);
  return ((transportConfig) => {
    const inner = transport(transportConfig);
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

export const PUBLIC_RPC_URL = "https://testnet-rpc.monad.xyz";

/** Alchemy's Monad testnet endpoint for an API key. Server-side only: the key is in the URL. */
export function alchemyRpcUrl(apiKey: string): string {
  return `https://monad-testnet.g.alchemy.com/v2/${apiKey}`;
}

/**
 * The RPCs a server-side service (agents, scheduler, gas sponsor, settlement watcher) should use,
 * best first: Alchemy when `ALCHEMY_API_KEY` is set, then `SERVER_RPC_URL` -- e.g. Tenderly's keyless
 * Monad testnet gateway, which holds a steady load but turns bursts away -- then `MONAD_RPC_URL`,
 * then the public endpoint. Keeping servers off the public RPC leaves its 15 req/s cap to the fans'
 * browsers, which can't use anything else.
 */
export function serverRpcUrls(env: Record<string, string | undefined> = process.env): string[] {
  const urls = [
    env.ALCHEMY_API_KEY ? alchemyRpcUrl(env.ALCHEMY_API_KEY) : undefined,
    env.SERVER_RPC_URL,
    env.MONAD_RPC_URL,
    PUBLIC_RPC_URL,
  ].filter((u): u is string => !!u);
  return [...new Set(urls)];
}

/**
 * A transport over several RPCs that falls through to the next on any failure. Every provider but
 * the last is tried once, with no retries, so a rate-limited primary costs one round trip rather
 * than a backoff ladder; the last keeps the full rate-limit retries of `rateLimitedHttp`.
 */
export function failoverTransport(urls: string[]): Transport {
  if (urls.length === 0) throw new Error("failoverTransport needs at least one URL");
  if (urls.length === 1) return rateLimitedHttp(urls[0]);
  const last = urls.length - 1;
  return fallback(
    urls.map((u, i) => (i === last ? rateLimitedHttp(u) : http(u, { retryCount: 0 }))),
    { retryCount: 0 },
  );
}
