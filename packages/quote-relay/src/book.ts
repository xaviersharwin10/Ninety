import type { Quote } from "@ninety/core";

export interface StoredQuote {
  quote: Quote;
  signature: `0x${string}`;
  signer: `0x${string}`;
  receivedAt: number;
}

const MAX_FILLS = 3; // matches BetRouter.MAX_FILLS

/**
 * The relay's entire state: the latest quote from each agent, per market. A new quote from an
 * agent replaces its previous one for that market outright — an agent re-quotes on a fixed
 * cadence specifically so its old, possibly-stale price stops being offered, so keeping history
 * around would only ever serve worse prices to a fan.
 */
export class QuoteBook {
  // marketId -> agentId -> latest quote
  private readonly byMarket = new Map<string, Map<number, StoredQuote>>();

  accept(stored: StoredQuote): void {
    const marketKey = stored.quote.marketId.toString();
    let byAgent = this.byMarket.get(marketKey);
    if (!byAgent) {
      byAgent = new Map();
      this.byMarket.set(marketKey, byAgent);
    }
    byAgent.set(stored.quote.agentId, stored);
  }

  /**
   * Best (up to) {@link MAX_FILLS} live quotes for `marketId` on `side`, ordered best price
   * first — ready to hand straight to `BetRouter.placeBet`, which requires exactly this order.
   * "Best" for Yes means lowest `probYesBps` (cheapest odds for the buyer); symmetrically for No.
   */
  best(marketId: bigint, side: "yes" | "no"): StoredQuote[] {
    const byAgent = this.byMarket.get(marketId.toString());
    if (!byAgent) return [];

    const now = Math.floor(Date.now() / 1000);
    const live = [...byAgent.values()].filter((s) => s.quote.expiry > BigInt(now));

    live.sort((a, b) => {
      const pa = side === "yes" ? a.quote.probYesBps : a.quote.probNoBps;
      const pb = side === "yes" ? b.quote.probYesBps : b.quote.probNoBps;
      return pa - pb;
    });

    return live.slice(0, MAX_FILLS);
  }

  /** Drops expired quotes across every market. Call periodically so the book doesn't grow forever
   *  across a long-running match with many agents cycling through markets. */
  sweepExpired(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [marketKey, byAgent] of this.byMarket) {
      for (const [agentId, stored] of byAgent) {
        if (stored.quote.expiry <= BigInt(now)) byAgent.delete(agentId);
      }
      if (byAgent.size === 0) this.byMarket.delete(marketKey);
    }
  }
}
