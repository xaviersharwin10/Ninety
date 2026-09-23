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

export const AUSD = 1_000_000n; // 6 decimals

/** Starting balance per house agent vault, matching the rehearsal's own funding amount. */
export const INITIAL_VAULT_BALANCE = 5000n * AUSD;
