import type { Hex } from "viem";
import type { Quote } from "./eip712.js";

/**
 * Wire format for a signed quote. bigint fields are transmitted as decimal strings — JSON has no
 * bigint, and this is exactly what viem's `readContract`/`writeContract` accept for uint256-class
 * ABI inputs when passed as a string, so no extra conversion is needed on the receiving end.
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

export interface QuotePublisher {
  publish(quote: Quote, signature: Hex): Promise<void>;
}

/** Posts signed quotes to a running quote-relay instance. */
export class HttpQuotePublisher implements QuotePublisher {
  constructor(private readonly relayUrl: string) {}

  async publish(quote: Quote, signature: Hex): Promise<void> {
    const res = await fetch(`${this.relayUrl.replace(/\/$/, "")}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toWire(quote, signature)),
    });
    if (!res.ok) {
      throw new Error(`quote-relay rejected quote: HTTP ${res.status} ${await res.text()}`);
    }
  }
}
