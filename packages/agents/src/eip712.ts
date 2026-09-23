import type { Address, Hex, LocalAccount } from "viem";

/**
 * Mirrors `BetRouter`'s EIP-712 domain and `Quote` struct exactly (`EIP712("Ninety", "1")` in the
 * contract's constructor, `QUOTE_TYPEHASH` for the struct). A signature computed here and one
 * computed in Solidity for the same inputs must be byte-identical — verified directly in
 * `test/eip712.test.ts` against a reference value printed by
 * `contracts/script/smoke/PrintQuoteSignature.s.sol`, not merely checked against itself.
 */
export const QUOTE_DOMAIN_NAME = "Ninety";
export const QUOTE_DOMAIN_VERSION = "1";

export const QUOTE_TYPES = {
  Quote: [
    { name: "marketId", type: "uint256" },
    { name: "agentId", type: "uint32" },
    { name: "probYesBps", type: "uint16" },
    { name: "probNoBps", type: "uint16" },
    { name: "maxStake", type: "uint128" },
    { name: "expiry", type: "uint64" },
    { name: "salt", type: "uint256" },
  ],
} as const;

export interface Quote {
  marketId: bigint;
  agentId: number;
  probYesBps: number;
  probNoBps: number;
  maxStake: bigint;
  expiry: bigint;
  salt: bigint;
}

export function quoteDomain(chainId: number, verifyingContract: Address) {
  return {
    name: QUOTE_DOMAIN_NAME,
    version: QUOTE_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const;
}

/** Signs a quote with the given account, producing exactly what `BetRouter.placeBet` expects. */
export function signQuote(
  account: LocalAccount,
  chainId: number,
  betRouter: Address,
  quote: Quote,
): Promise<Hex> {
  return account.signTypedData({
    domain: quoteDomain(chainId, betRouter),
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message: quote,
  });
}
