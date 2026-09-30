import { createPublicClient } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  failoverTransport,
  isRateLimited,
  PUBLIC_RPC_URL,
  serverRpcUrls,
} from "../src/transport.js";

describe("isRateLimited", () => {
  it("recognises Monad's public-RPC cap, which arrives as a generic JSON-RPC error", () => {
    const err = Object.assign(new Error("RPC Request failed."), {
      details: "requests limited to 15/sec",
    });
    expect(isRateLimited(err)).toBe(true);
  });

  it("recognises a plain HTTP 429", () => {
    expect(isRateLimited(new Error("HTTP request failed. Status: 429"))).toBe(true);
  });

  it("leaves real failures alone, so they surface instead of being retried", () => {
    expect(isRateLimited(new Error("execution reverted: MarketNotBettable"))).toBe(false);
  });
});

describe("serverRpcUrls", () => {
  it("puts the dedicated server RPC first and always ends on the public one", () => {
    expect(serverRpcUrls({ SERVER_RPC_URL: "https://a", MONAD_RPC_URL: "https://b" })).toEqual([
      "https://a",
      "https://b",
      PUBLIC_RPC_URL,
    ]);
  });

  it("drops duplicates and unset entries", () => {
    expect(serverRpcUrls({ MONAD_RPC_URL: PUBLIC_RPC_URL })).toEqual([PUBLIC_RPC_URL]);
  });
});

describe("failoverTransport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls through to the next RPC at once when the first is rate-limited", async () => {
    const hits: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const host = new URL(String(url)).host;
        hits.push(host);
        if (host === "primary") return new Response("Too Many Requests", { status: 429 });
        const { id } = JSON.parse(String(init.body));
        return Response.json({ jsonrpc: "2.0", id, result: "0x2a" });
      }),
    );
    const client = createPublicClient({
      transport: failoverTransport(["https://primary", "https://backup"]),
    });
    expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(42n);
    // One try at the primary, no retry ladder, then the backup.
    expect(hits).toEqual(["primary", "backup"]);
  });
});
