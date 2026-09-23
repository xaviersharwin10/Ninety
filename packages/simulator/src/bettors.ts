import {
  BASE_RATE_PER_SEC,
  blendedRate,
  type NormalizedEvent,
  poissonProbability,
  resolveMarket,
  TEMPLATE_QUALIFYING_EVENTS,
} from "@ninety/core";
import { bestProbBps, type MarketBook } from "./book.js";
import { randInt, randStake } from "./rng.js";

export interface BettorArrival {
  marketId: string;
  side: "yes" | "no";
  stake: bigint;
  /** Match-clock seconds. This simulator treats wall clock and match clock as the same axis (see
   *  the note on `engine.ts`), so this doubles as the "placedAt" the delay rule checks against. */
  atSec: number;
  bettorType: string;
}

export interface BettorContext {
  book: MarketBook;
  /** The *entire* match's events, not just what's been "revealed" -- a population is responsible
   *  for not looking past `atSec` itself. Casual and Sharp never do; Sniper's whole point is that
   *  it deliberately does, which is exactly the exploit the bet-delay rule exists to defend against. */
  allEvents: readonly NormalizedEvent[];
}

export type BettorPopulation = (ctx: BettorContext, rng: () => number) => BettorArrival[];

// ------------------------------------------------------------------
// Casual: random bets, slight favourite bias, small stakes.
// ------------------------------------------------------------------

export interface CasualOptions {
  minArrivals?: number;
  maxArrivals?: number;
  minStakeAusdUnits?: bigint;
  maxStakeAusdUnits?: bigint;
  /** Probability of betting the modelled favourite (best price > 50% implied) rather than the
   *  underdog. 0.5 would be no bias at all. */
  favouriteBiasProb?: number;
}

export function casualPopulation(options: CasualOptions = {}): BettorPopulation {
  const minArrivals = options.minArrivals ?? 0;
  const maxArrivals = options.maxArrivals ?? 4;
  const minStake = options.minStakeAusdUnits ?? 5_000_000n; // 5 AUSD
  const maxStake = options.maxStakeAusdUnits ?? 25_000_000n; // 25 AUSD
  const favouriteBiasProb = options.favouriteBiasProb ?? 0.65;

  return (ctx, rng) => {
    const { book } = ctx;
    const { market } = book;
    const count = randInt(rng, minArrivals, maxArrivals);
    const arrivals: BettorArrival[] = [];

    for (let i = 0; i < count; i++) {
      const bestYes = bestProbBps(book, "yes");
      const bestNo = bestProbBps(book, "no");
      if (bestYes === undefined && bestNo === undefined) continue; // no liquidity to bet into

      let side: "yes" | "no";
      if (bestYes === undefined) side = "no";
      else if (bestNo === undefined) side = "yes";
      else {
        const favourite: "yes" | "no" = bestYes > 5000 ? "yes" : "no";
        const underdog: "yes" | "no" = favourite === "yes" ? "no" : "yes";
        side = rng() < favouriteBiasProb ? favourite : underdog;
      }

      const atSec = randInt(rng, market.windowStart, market.windowEnd - 1);
      const stake = randStake(rng, minStake, maxStake);
      arrivals.push({ marketId: market.id, side, stake, atSec, bettorType: "casual" });
    }

    return arrivals;
  };
}

// ------------------------------------------------------------------
// Sharp: bets only when a better model sees edge > threshold.
// ------------------------------------------------------------------

/**
 * Sharp's "better model" is deliberately not omniscient (that's the sniper) -- it is a bettor with
 * two legitimate advantages a house agent that only prices at market-open lacks: a faster-reacting
 * pressure model (shorter lookback, thinner prior than even Pulse), and simply noticing that a
 * qualifying event already happened earlier in *this exact window*, which a stale quote hasn't
 * repriced for. Both are real, publicly-observable edges over a quote that hasn't moved since it
 * was set -- not inside information. The assumed edge threshold below is what makes Sharp's
 * results a real, checkable number rather than an unfalsifiable "sharp bettors are dangerous"
 * claim; docs/simulator-results.md states it plainly, per the plan's honesty guard.
 */
export const SHARP_LOOKBACK_SEC = 45;
export const SHARP_PRIOR_WINDOW_SEC = 90;
export const SHARP_EDGE_THRESHOLD = 0.04; // 4 percentage points of probability

export interface SharpOptions {
  edgeThreshold?: number;
  stakeMinAusdUnits?: bigint;
  stakeMaxAusdUnits?: bigint;
  /** Not every market gets a sharp bettor's attention in the same tick. */
  scanProbability?: number;
}

export function sharpPopulation(options: SharpOptions = {}): BettorPopulation {
  const edgeThreshold = options.edgeThreshold ?? SHARP_EDGE_THRESHOLD;
  const stakeMin = options.stakeMinAusdUnits ?? 40_000_000n; // 40 AUSD
  const stakeMax = options.stakeMaxAusdUnits ?? 80_000_000n; // 80 AUSD
  const scanProbability = options.scanProbability ?? 0.6;

  return (ctx, rng) => {
    if (rng() > scanProbability) return [];

    const { book, allEvents } = ctx;
    const { market } = book;
    const atSec = randInt(rng, market.windowStart, market.windowEnd - 1);

    const qualifying = TEMPLATE_QUALIFYING_EVENTS[market.template];
    const alreadyQualified = allEvents.some(
      (e) =>
        e.matchClockSec >= market.windowStart &&
        e.matchClockSec < atSec &&
        qualifying.includes(e.type),
    );

    let trueP: number;
    if (alreadyQualified) {
      trueP = 1; // the window has already qualified; a stale quote hasn't caught up
    } else {
      const base = BASE_RATE_PER_SEC[market.template];
      const recentCount = allEvents.filter(
        (e) =>
          e.matchClockSec > atSec - SHARP_LOOKBACK_SEC &&
          e.matchClockSec <= atSec &&
          qualifying.includes(e.type),
      ).length;
      const lambda = blendedRate(base, recentCount, SHARP_LOOKBACK_SEC, SHARP_PRIOR_WINDOW_SEC);
      trueP = poissonProbability(lambda, market.windowEnd - atSec);
    }

    const bestYes = bestProbBps(book, "yes");
    const bestNo = bestProbBps(book, "no");
    const yesEdge = bestYes !== undefined ? trueP - bestYes / 10_000 : Number.NEGATIVE_INFINITY;
    const noEdge = bestNo !== undefined ? 1 - trueP - bestNo / 10_000 : Number.NEGATIVE_INFINITY;

    const side: "yes" | "no" = yesEdge >= noEdge ? "yes" : "no";
    const edge = side === "yes" ? yesEdge : noEdge;
    if (edge < edgeThreshold) return [];

    const stake = randStake(rng, stakeMin, stakeMax);
    return [{ marketId: market.id, side, stake, atSec, bettorType: "sharp" }];
  };
}

// ------------------------------------------------------------------
// Sniper: sees a qualifying event `leadSec` before the feed would reveal it.
// ------------------------------------------------------------------

export interface SniperOptions {
  /** How many seconds before the qualifying event this sniper places its bet. */
  leadSec: number;
  stakeAusdUnits?: bigint;
  label?: string;
}

/**
 * The one population that is allowed to look at events after `atSec` -- simulating a fan on a
 * faster stream who already knows what just happened. Compare a run with `leadSec` inside
 * `BetRouter.DELAY_SECONDS` (should be voided at settlement) against one with `leadSec` well
 * outside it (should not be, and should win for free) -- exactly the "with vs without the delay
 * rule" comparison the product spec's simulator section asks for, reframed as "caught vs evasive"
 * since the delay rule is always on in this project's design, not optional.
 */
export function sniperPopulation(options: SniperOptions): BettorPopulation {
  const stake = options.stakeAusdUnits ?? 100_000_000n; // 100 AUSD -- confident, sized to the max
  const label = options.label ?? `sniper-lead${options.leadSec}`;

  return (ctx) => {
    const { book, allEvents } = ctx;
    const { market } = book;
    const resolution = resolveMarket(
      allEvents,
      market.template,
      market.windowStart,
      market.windowEnd,
    );
    if (resolution.outcome !== "Yes") return [];

    let atSec = resolution.qualifyingEventTs - options.leadSec;
    if (atSec < market.windowStart) atSec = market.windowStart;
    if (atSec >= market.windowEnd) return [];

    const bestYes = bestProbBps(book, "yes");
    if (bestYes === undefined) return [];

    return [{ marketId: market.id, side: "yes", stake, atSec, bettorType: label }];
  };
}
