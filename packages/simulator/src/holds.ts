import {
  countRecentQualifyingEvents,
  LOCK_HOLD_SEC,
  liveWindow,
  lockFeeBps,
  type NormalizedEvent,
  resolveMarket,
} from "@ninety/core";
import { DELAY_SECONDS } from "./constants.js";
import { type HouseAgent, inDanger } from "./engine.js";
import type { ScheduledMarket } from "./scheduler.js";

/**
 * Odds Lock under pressure: every hold an agent would have sold, bought by a fan who then uses it
 * one of two ways, and what the agent made on it -- the fee, plus or minus the bet it was then
 * made to take at the held price.
 *
 * - **Patient:** holds, waits out the whole hold, and bets at the held price at its last moment
 *   only if that's worth it -- for NO, if the window is still quiet; never for YES, whose price only
 *   gets better by waiting. The best anyone can do with a hold, and what the fee is priced against
 *   (`lockFeeBps`).
 * - **Casual:** holds, then bets at the held price at the end of the hold regardless.
 *
 * Either way the bet can only be placed while the agent honours the hold: not while an event that
 * would decide the market is coming (the same pause as betting), and not once one already has.
 */
export interface HoldRow {
  population: "Patient" | "Casual";
  side: "yes" | "no";
  holds: number;
  exercised: number;
  /** In units of stake: per hold, stake = 1. */
  fees: number;
  betPnl: number;
}

export function simulateHolds(
  events: readonly NormalizedEvent[],
  markets: readonly ScheduledMarket[],
  agent: HouseAgent,
  buyEverySec = 10,
  /** How much of the match a hold covers, in match seconds. */
  holdSec = LOCK_HOLD_SEC,
): HoldRow[] {
  const rows: HoldRow[] = [];
  for (const population of ["Patient", "Casual"] as const) {
    for (const side of ["yes", "no"] as const) {
      const row: HoldRow = { population, side, holds: 0, exercised: 0, fees: 0, betPnl: 0 };
      for (const market of markets) {
        const resolution = resolveMarket(
          events,
          market.template,
          market.windowStart,
          market.windowEnd,
        );
        for (let t0 = market.windowStart; t0 < market.windowEnd; t0 += buyEverySec) {
          const sold = sellHold(events, market, agent, side, t0, holdSec);
          if (!sold) continue;
          row.holds++;
          row.fees += sold.feeBps / 10_000;

          const at = t0 + holdSec;
          const honoured =
            !inDanger(events, market.template, at) &&
            !liveWindow(events, market.template, market.windowStart, market.windowEnd, at).decided;
          if (!honoured) continue;
          if (population === "Patient" && side === "yes") continue;

          row.exercised++;
          const q = sold.probBps / 10_000;
          const voided =
            resolution.outcome === "Yes" && at + DELAY_SECONDS > resolution.qualifyingEventTs;
          if (voided) continue;
          const fanWins = (resolution.outcome === "Yes") === (side === "yes");
          row.betPnl += fanWins ? -(1 / q - 1) : 1;
        }
      }
      rows.push(row);
    }
  }
  return rows;
}

/** The hold `agent` would sell on `side` at `atSec`, if any: its price then, and the fee. */
function sellHold(
  events: readonly NormalizedEvent[],
  market: ScheduledMarket,
  { strategy }: HouseAgent,
  side: "yes" | "no",
  atSec: number,
  holdSec: number,
): { probBps: number; feeBps: number } | null {
  if (inDanger(events, market.template, atSec)) return null;
  const { decided, remainingSec } = liveWindow(
    events,
    market.template,
    market.windowStart,
    market.windowEnd,
    atSec,
  );
  if (decided || remainingSec === 0) return null;
  const quote = strategy.price({
    template: market.template,
    windowSec: remainingSec,
    recentQualifyingCount:
      strategy.lookbackSec > 0
        ? countRecentQualifyingEvents(events, market.template, atSec, strategy.lookbackSec)
        : 0,
  });
  const feeBps = lockFeeBps({ side, ...quote, remainingSec, holdSec });
  if (feeBps === null) return null;
  return { probBps: side === "yes" ? quote.probYesBps : quote.probNoBps, feeBps };
}
