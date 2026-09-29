import { type HttpTransport, type HttpTransportConfig, http } from "viem";

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
