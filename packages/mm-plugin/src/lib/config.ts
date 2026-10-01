import type { Address } from "viem";

/** Monad testnet, where Ninety runs. */
export const CHAIN_ID = 10143;

/**
 * The Ninety app every read goes through: matches, markets, prices and bet history. One address to
 * configure; the app forwards to the services behind it.
 */
export function ninetyUrl(): string {
  return (process.env.NINETY_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** The live deployment (deployments/10143.json). Public addresses, not secrets. */
export const CONTRACTS = {
  betRouter: "0xd368165544A427d1d42FCF53846fA84c37cBB387",
  agentRegistry: "0xdbE23698776e12A7e1bf5FFBe5054d6919BcA8df",
  nusd: "0x85fe9D32c8B5c02639767399D7DCA585042ea57b",
} as const satisfies Record<string, Address>;

export const NUSD_DECIMALS = 6;

export const EXPLORER_TX = "https://testnet.monadexplorer.com/tx/";
