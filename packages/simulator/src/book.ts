import type { ScheduledMarket } from "./scheduler.js";

export interface AgentQuote {
  agentName: string;
  probYesBps: number;
  probNoBps: number;
  /** `min(strategy.maxStakePerQuote, vault.quotableBudget(market.id))` at the moment this quote
   *  was priced -- the cap actually available to fill against, same as `AgentRunner` computes. */
  maxStake: bigint;
}

/**
 * One market's full set of agent quotes, priced once when the market opens (a documented
 * simplification -- see the note on `priceMarket` in `engine.ts` for why, and what it costs).
 */
export interface MarketBook {
  market: ScheduledMarket;
  quotes: AgentQuote[];
}

/** Ascending `probBps` is best-price-first for a buyer of that side, matching `BetRouter`'s own
 *  fill ordering (a lower implied probability is a lower price, i.e. a bigger payout). */
export function rankedForSide(book: MarketBook, side: "yes" | "no"): AgentQuote[] {
  const key = side === "yes" ? "probYesBps" : "probNoBps";
  return [...book.quotes].filter((q) => q.maxStake > 0n).sort((a, b) => a[key] - b[key]);
}

/** The best (lowest) probBps available on `side` across every agent still quoting it, or
 *  `undefined` if nobody has capacity left. */
export function bestProbBps(book: MarketBook, side: "yes" | "no"): number | undefined {
  return rankedForSide(book, side)[0]?.[side === "yes" ? "probYesBps" : "probNoBps"];
}
