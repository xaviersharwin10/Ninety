import type { LockOffer, Quote } from "@ninety/core";

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

export interface StoredLockOffer {
  offer: LockOffer;
  signature: `0x${string}`;
  signer: `0x${string}`;
}

/**
 * Odds Lock offers, kept exactly like quotes: each agent's latest per market and side, replaced
 * outright by its next one. The best is the one holding the best price for the fan -- the lowest
 * implied probability on that side -- with the cheaper fee breaking a tie.
 */
export class LockOfferBook {
  // `${marketId}:${side}` -> agentId -> latest offer
  private readonly offers = new Map<string, Map<number, StoredLockOffer>>();

  accept(stored: StoredLockOffer): void {
    const key = `${stored.offer.marketId}:${stored.offer.side}`;
    let byAgent = this.offers.get(key);
    if (!byAgent) {
      byAgent = new Map();
      this.offers.set(key, byAgent);
    }
    byAgent.set(stored.offer.agentId, stored);
  }

  best(marketId: bigint, side: "yes" | "no"): StoredLockOffer | null {
    const byAgent = this.offers.get(`${marketId}:${side === "yes" ? 0 : 1}`);
    if (!byAgent) return null;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const live = [...byAgent.values()].filter((s) => s.offer.expiry > now);
    live.sort((a, b) => a.offer.probBps - b.offer.probBps || a.offer.feeBps - b.offer.feeBps);
    return live[0] ?? null;
  }

  sweepExpired(): void {
    const now = BigInt(Math.floor(Date.now() / 1000));
    for (const [key, byAgent] of this.offers) {
      for (const [agentId, stored] of byAgent) {
        if (stored.offer.expiry <= now) byAgent.delete(agentId);
      }
      if (byAgent.size === 0) this.offers.delete(key);
    }
  }
}

export interface StoredHold {
  /** The fan who bought the hold, as the agent read it from `OddsLock`. */
  fan: `0x${string}`;
  quote: Quote;
  signature: `0x${string}`;
}

/**
 * The quotes agents sign to honour holds, one per hold, each handed only to the fan who bought it.
 * Never broadcast: anyone holding one could bet the held price.
 */
export class HoldBook {
  private readonly holds = new Map<string, StoredHold>();

  accept(lockId: bigint, stored: StoredHold): void {
    this.holds.set(lockId.toString(), stored);
  }

  get(lockId: bigint): StoredHold | null {
    const stored = this.holds.get(lockId.toString());
    if (!stored || stored.quote.expiry <= BigInt(Math.floor(Date.now() / 1000))) return null;
    return stored;
  }

  sweepExpired(): void {
    const now = BigInt(Math.floor(Date.now() / 1000));
    for (const [id, stored] of this.holds) if (stored.quote.expiry <= now) this.holds.delete(id);
  }
}
