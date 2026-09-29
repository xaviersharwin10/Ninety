import { describe, expect, it } from "vitest";
import { isRateLimited } from "../src/transport.js";

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
