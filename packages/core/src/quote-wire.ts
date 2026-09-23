import type { Hex } from "viem";
import type { Quote } from "./eip712.js";

/**
 * Wire format for a signed quote, shared by whoever produces one (the agent runner) and whoever
 * consumes one (the quote relay, eventually the web app). `bigint` fields travel as decimal
 * strings — JSON has no bigint, and a decimal string is exactly what viem accepts for a
 * uint256-class ABI input, so `BetRouter.placeBet` can take the relay's response with no further
 * conversion.
 */
export interface SignedQuoteWire {
  quote: {
    marketId: string;
    agentId: number;
    probYesBps: number;
    probNoBps: number;
    maxStake: string;
    expiry: string;
    salt: string;
  };
  signature: Hex;
}

export function toWire(quote: Quote, signature: Hex): SignedQuoteWire {
  return {
    quote: {
      marketId: quote.marketId.toString(),
      agentId: quote.agentId,
      probYesBps: quote.probYesBps,
      probNoBps: quote.probNoBps,
      maxStake: quote.maxStake.toString(),
      expiry: quote.expiry.toString(),
      salt: quote.salt.toString(),
    },
    signature,
  };
}

export function fromWire(wire: SignedQuoteWire): { quote: Quote; signature: Hex } {
  return {
    quote: {
      marketId: BigInt(wire.quote.marketId),
      agentId: wire.quote.agentId,
      probYesBps: wire.quote.probYesBps,
      probNoBps: wire.quote.probNoBps,
      maxStake: BigInt(wire.quote.maxStake),
      expiry: BigInt(wire.quote.expiry),
      salt: BigInt(wire.quote.salt),
    },
    signature: wire.signature,
  };
}
