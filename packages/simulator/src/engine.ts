import {
  type AgentMemory,
  countRecentQualifyingEvents,
  freshMemory,
  type SettledBet as LearnableBet,
  ladderAllocate,
  learn,
  liabilityFor,
  liveWindow,
  maxStakeForLiability,
  type NormalizedEvent,
  type PricingStrategy,
  quoteMaxStake,
  resolveMarket,
  TEMPLATE_QUALIFYING_EVENTS,
} from "@ninety/core";
import type { BettorArrival, BettorPopulation } from "./bettors.js";
import type { AgentQuote, MarketBook } from "./book.js";
import {
  DANGER_COOLDOWN_SEC,
  DANGER_LEAD_SEC,
  DELAY_SECONDS,
  INITIAL_VAULT_BALANCE,
  LADDER_BPS,
  LEARN_EVERY_SEC,
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
  /**
   * Each agent's memory going in, by name. Updated in place as the agents learn, so passing the
   * same map to consecutive matches carries what they learned from one to the next. Omit it and
   * agents start blank and nothing carries over.
   */
  memories?: Map<string, AgentMemory>;
}

/**
 * Whether agents would be holding back on this market at `atSec`: an event that would decide it is
 * due within `DANGER_LEAD_SEC`, or happened within `DANGER_COOLDOWN_SEC`. Live, match-data raises
 * this from the feed; here it's read off the fixture, which is what a live dangerous-attack signal
 * stands in for.
 */
export function inDanger(
  events: readonly NormalizedEvent[],
  template: ScheduledMarket["template"],
  atSec: number,
): boolean {
  const qualifying = TEMPLATE_QUALIFYING_EVENTS[template];
  return events.some(
    (e) =>
      qualifying.includes(e.type) &&
      e.matchClockSec > atSec - DANGER_COOLDOWN_SEC &&
      e.matchClockSec <= atSec + DANGER_LEAD_SEC,
  );
}

/**
 * Every agent's quote for a market as it stands at match-clock `atSec`, the way a live agent
 * re-quoting every ~3s (`AgentRunner`) would have it: priced over what is left of the window, from
 * the pressure observed up to `atSec`, and pulled entirely once a qualifying event has decided the
 * window. Only events at or before `atSec` are looked at.
 */
function priceMarket(
  market: ScheduledMarket,
  events: readonly NormalizedEvent[],
  agents: HouseAgent[],
  vaults: Map<string, SimVault>,
  atSec: number,
  memories: Map<string, AgentMemory>,
): MarketBook {
  if (inDanger(events, market.template, atSec)) return { market, quotes: [] };
  const { decided, remainingSec } = liveWindow(
    events,
    market.template,
    market.windowStart,
    market.windowEnd,
    atSec,
  );
  if (decided || remainingSec === 0) return { market, quotes: [] };

  const quotes: AgentQuote[] = agents.map(({ name, strategy }) => {
    const recentQualifyingCount =
      strategy.lookbackSec > 0
        ? countRecentQualifyingEvents(events, market.template, atSec, strategy.lookbackSec)
        : 0;
    const { probYesBps, probNoBps } = strategy.price({
      template: market.template,
      windowSec: remainingSec,
      recentQualifyingCount,
      marginAdjBps: memories.get(name)?.templates[market.template].marginAdjBps ?? 0,
    });

    const vault = vaults.get(name)!;
    const maxStake = quoteMaxStake(
      vault.quotableBudget(market.id),
      BigInt(probYesBps),
      BigInt(probNoBps),
      strategy.maxStakePerQuote,
    );

    return { agentName: name, probYesBps, probNoBps, maxStake };
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
    // The vault's budget is for liability; what it allows in stake depends on the price.
    const live = maxStakeForLiability(
      vaults.get(q.agentName)!.quotableBudget(book.market.id),
      BigInt(q[key]),
    );
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
  const memories =
    options.memories ?? new Map(agents.map(({ name }, i) => [name, freshMemory(i + 1)]));
  for (const { name } of agents) if (!memories.has(name)) memories.set(name, freshMemory(0));
  // Bets waiting to be learned from, by agent, each with when its market settles.
  const toLearn = new Map<string, { bet: LearnableBet; settlesAt: number }[]>(
    agents.map(({ name }) => [name, []]),
  );
  let nextBetId = 1;
  let lastLearnAt = 0;

  for (const market of markets) {
    // Every LEARN_EVERY_SEC, each agent learns from whatever has settled by now -- the same `learn`
    // an operator's agent runs when it's stopped (see web/components/AgentConsole.tsx).
    if (market.windowStart - lastLearnAt >= LEARN_EVERY_SEC) {
      lastLearnAt = market.windowStart;
      for (const { name } of agents) {
        const pending = toLearn.get(name)!;
        const due = pending.filter((p) => p.settlesAt <= market.windowStart);
        if (due.length === 0) continue;
        memories.set(
          name,
          learn(
            memories.get(name)!,
            due.map((p) => p.bet),
          ),
        );
        toLearn.set(
          name,
          pending.filter((p) => p.settlesAt > market.windowStart),
        );
      }
    }
    const bookAt = (atSec: number) => priceMarket(market, events, agents, vaults, atSec, memories);
    const book = bookAt(market.windowStart);

    const arrivals: BettorArrival[] = populations
      .flatMap((pop) => pop({ book, bookAt, allEvents: events }, rng))
      .sort((a, b) => a.atSec - b.atSec);

    const resolution = resolveMarket(events, market.template, market.windowStart, market.windowEnd);
    const outcomeSide: "yes" | "no" = resolution.outcome === "Yes" ? "yes" : "no";

    for (const arrival of arrivals) {
      // Each bettor meets the book as it stands when they arrive, not as it opened.
      const fills = fillArrival(arrival, bookAt(arrival.atSec), vaults);

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

        const agentPnl = outcome === "lost" ? fill.stake : outcome === "won" ? -fill.liability : 0n;
        toLearn.get(fill.agentName)!.push({
          bet: { id: nextBetId++, template: market.template, agentPnl },
          settlesAt: market.windowEnd,
        });

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
