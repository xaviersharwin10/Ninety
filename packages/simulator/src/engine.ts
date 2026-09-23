import {
  countRecentQualifyingEvents,
  ladderAllocate,
  liabilityFor,
  type NormalizedEvent,
  type PricingStrategy,
  resolveMarket,
} from "@ninety/core";
import type { BettorArrival, BettorPopulation } from "./bettors.js";
import type { AgentQuote, MarketBook } from "./book.js";
import {
  DELAY_SECONDS,
  INITIAL_VAULT_BALANCE,
  LADDER_BPS,
  MAX_MARKET_EXPOSURE_BPS,
} from "./constants.js";
import { type ScheduledMarket, scheduleMarkets } from "./scheduler.js";
import { SimVault } from "./vault.js";

export interface HouseAgent {
  name: string;
  strategy: PricingStrategy;
}

export interface SettledBet {
  marketId: string;
  agentName: string;
  bettorType: string;
  side: "yes" | "no";
  stake: bigint;
  probBps: number;
  liability: bigint;
  atSec: number;
  outcome: "won" | "lost" | "voided"; // from the bettor's perspective
  payout: bigint; // what the bettor actually received (stake back on a void, stake+liability on a win, 0 on a loss)
}

export interface MatchSimulationResult {
  matchId: string;
  matchEndSec: number;
  markets: ScheduledMarket[];
  bets: SettledBet[];
  agents: {
    name: string;
    startingBalance: bigint;
    endingBalance: bigint;
    pnl: bigint;
    volume: bigint;
    betsWon: number; // agent won (bettor lost)
    betsLost: number; // agent lost (bettor won)
    betsVoided: number;
  }[];
}

export interface RunMatchOptions {
  matchId: string;
  events: readonly NormalizedEvent[];
  agents: HouseAgent[];
  populations: BettorPopulation[];
  rng: () => number;
  cadenceSec?: number;
  maxConcurrent?: number;
}

/**
 * Prices every agent's quote for a market once, at the moment the market opens, using only events
 * that have happened by `market.windowStart`. Production re-quotes continuously (every ~3s, per
 * `AgentRunner`'s poll loop); pricing once here is a deliberate simplification that keeps the
 * engine's timeline simple and easy to audit, at the cost of not modelling a quote moving mid-window
 * as fresh pressure arrives. Documented in docs/simulator-results.md, not hidden.
 */
function priceMarket(
  market: ScheduledMarket,
  events: readonly NormalizedEvent[],
  agents: HouseAgent[],
  vaults: Map<string, SimVault>,
): MarketBook {
  const quotes: AgentQuote[] = agents.map(({ name, strategy }) => {
    const recentQualifyingCount =
      strategy.lookbackSec > 0
        ? countRecentQualifyingEvents(
            events,
            market.template,
            market.windowStart,
            strategy.lookbackSec,
          )
        : 0;
    const windowSec = market.windowEnd - market.windowStart;
    const { probYesBps, probNoBps } = strategy.price({
      template: market.template,
      windowSec,
      recentQualifyingCount,
    });

    const vault = vaults.get(name)!;
    const cap =
      strategy.maxStakePerQuote < vault.quotableBudget(market.id)
        ? strategy.maxStakePerQuote
        : vault.quotableBudget(market.id);

    return { agentName: name, probYesBps, probNoBps, maxStake: cap };
  });

  return { market, quotes };
}

/**
 * Fills one bettor arrival against the best-priced agents on its side, ladder-allocated exactly as
 * `BetRouter.placeBet` would, then locks each agent's liability. Live-checks each agent's *current*
 * `quotableBudget` (not the book's market-open snapshot) before allocating, since vault capacity is
 * shared across every concurrently open market -- a fill against one market can leave less room
 * than the snapshot promised for another. If the arrival's stake exceeds what's actually fillable
 * right now, it is clipped down to what is (mirroring a relay only ever offering a fillable size);
 * if nothing is fillable at all, the arrival is silently dropped.
 */
function fillArrival(
  arrival: BettorArrival,
  book: MarketBook,
  vaults: Map<string, SimVault>,
): { agentName: string; stake: bigint; probBps: number; liability: bigint }[] {
  const key = arrival.side === "yes" ? ("probYesBps" as const) : ("probNoBps" as const);
  const ranked = [...book.quotes].sort((a, b) => a[key] - b[key]).slice(0, LADDER_BPS.length);

  const liveCaps = ranked.map((q) => {
    const vault = vaults.get(q.agentName)!;
    const live = vault.quotableBudget(book.market.id);
    return q.maxStake < live ? q.maxStake : live;
  });

  const available = liveCaps.reduce((a, b) => a + b, 0n);
  if (available === 0n) return [];

  const stakeToFill = arrival.stake < available ? arrival.stake : available;
  const weights = LADDER_BPS.slice(0, ranked.length);
  const stakes = ladderAllocate(stakeToFill, liveCaps, [...weights]);

  const fills: { agentName: string; stake: bigint; probBps: number; liability: bigint }[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const stake = stakes[i]!;
    if (stake === 0n) continue;
    const quote = ranked[i]!;
    const probBps = quote[key];
    const liability = liabilityFor(stake, BigInt(probBps));
    vaults.get(quote.agentName)!.lockLiability(book.market.id, liability);
    fills.push({ agentName: quote.agentName, stake, probBps, liability });
  }
  return fills;
}

/** Runs the full pipeline for one match: schedule, price, populate, fill, resolve, settle. */
export function runMatch(options: RunMatchOptions): MatchSimulationResult {
  const { events, agents, populations, rng } = options;
  const matchEndSec = events.reduce((max, e) => Math.max(max, e.matchClockSec), 0);

  const markets = scheduleMarkets({
    matchEndSec,
    ...(options.cadenceSec !== undefined ? { cadenceSec: options.cadenceSec } : {}),
    ...(options.maxConcurrent !== undefined ? { maxConcurrent: options.maxConcurrent } : {}),
  });

  const vaults = new Map<string, SimVault>(
    agents.map(({ name }) => [
      name,
      new SimVault(name, INITIAL_VAULT_BALANCE, MAX_MARKET_EXPOSURE_BPS),
    ]),
  );

  const bets: SettledBet[] = [];

  for (const market of markets) {
    const book = priceMarket(market, events, agents, vaults);

    const arrivals: BettorArrival[] = populations
      .flatMap((pop) => pop({ book, allEvents: events }, rng))
      .sort((a, b) => a.atSec - b.atSec);

    const resolution = resolveMarket(events, market.template, market.windowStart, market.windowEnd);
    const outcomeSide: "yes" | "no" = resolution.outcome === "Yes" ? "yes" : "no";

    for (const arrival of arrivals) {
      const fills = fillArrival(arrival, book, vaults);

      const voided =
        resolution.outcome === "Yes" &&
        resolution.qualifyingEventTs !== 0 &&
        arrival.atSec + DELAY_SECONDS > resolution.qualifyingEventTs;

      for (const fill of fills) {
        const vault = vaults.get(fill.agentName)!;
        let outcome: SettledBet["outcome"];
        let payout: bigint;

        if (voided) {
          vault.releaseVoided(market.id, fill.liability);
          outcome = "voided";
          payout = fill.stake;
        } else if (arrival.side === outcomeSide) {
          // The bettor's side matches the real outcome -- the agent loses, the bettor wins.
          vault.settleLost(market.id, fill.liability);
          outcome = "won";
          payout = fill.stake + fill.liability;
        } else {
          vault.settleWon(market.id, fill.liability, fill.stake);
          outcome = "lost";
          payout = 0n;
        }

        bets.push({
          marketId: market.id,
          agentName: fill.agentName,
          bettorType: arrival.bettorType,
          side: arrival.side,
          stake: fill.stake,
          probBps: fill.probBps,
          liability: fill.liability,
          atSec: arrival.atSec,
          outcome,
          payout,
        });
      }
    }
  }

  const agentSummaries = agents.map(({ name }) => {
    const vault = vaults.get(name)!;
    const agentBets = bets.filter((b) => b.agentName === name);
    return {
      name,
      startingBalance: INITIAL_VAULT_BALANCE,
      endingBalance: vault.totalAssets,
      pnl: vault.totalAssets - INITIAL_VAULT_BALANCE,
      volume: agentBets.reduce((sum, b) => sum + b.stake, 0n),
      betsWon: agentBets.filter((b) => b.outcome === "lost").length, // bettor lost = agent won
      betsLost: agentBets.filter((b) => b.outcome === "won").length, // bettor won = agent lost
      betsVoided: agentBets.filter((b) => b.outcome === "voided").length,
    };
  });

  return { matchId: options.matchId, matchEndSec, markets, bets, agents: agentSummaries };
}
