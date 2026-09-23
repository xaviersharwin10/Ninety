import type { Quote } from "@ninety/core";
import { toWire } from "@ninety/core";
import type { Hex } from "viem";

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
