/**
 * Constants mirrored from the Solidity contracts, so the simulator's market microstructure matches
 * what's actually deployed rather than a plausible-looking guess. Each has a named source; if the
 * contract changes, this file needs to change with it.
 */

/** `BetRouter.DELAY_SECONDS` -- a bet placed within this many seconds before a qualifying event is
 *  voided at settlement, regardless of side. */
export const DELAY_SECONDS = 8;

/** `BetRouter`'s ladder weights (`w[0..2] = 5000, 3000, 2000`), best price first. */
export const LADDER_BPS = [5000n, 3000n, 2000n] as const;

/** `Deploy.s.sol`'s `MAX_MARKET_EXPOSURE_BPS` -- 30% of a vault per market. */
export const MAX_MARKET_EXPOSURE_BPS = 3000n;

export const nUSD = 1_000_000n; // 6 decimals

/** Starting balance per house agent vault, matching the rehearsal's own funding amount. */
export const INITIAL_VAULT_BALANCE = 5000n * nUSD;

/**
 * match-data's `DANGER_LEAD_REAL_SEC` / `DANGER_COOLDOWN_REAL_SEC`: agents pull quotes on a market
 * from this long before an event that would decide it until this long after (the stand-in for a
 * live feed's dangerous-attack signal). The simulator runs at 1x, so real and match seconds agree.
 */
export const DANGER_LEAD_SEC = 14;
export const DANGER_COOLDOWN_SEC = 3;

/** How often, in match seconds, each house agent learns from its settled bets (`learn`). */
export const LEARN_EVERY_SEC = 600;
