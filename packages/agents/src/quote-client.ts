import type { LockOffer, Quote } from "@ninety/core";
import { lockOfferToWire, toWire } from "@ninety/core";
import type { Address, Hex } from "viem";

export interface QuotePublisher {
  publish(quote: Quote, signature: Hex): Promise<void>;
  /** An Odds Lock offer, shown to fans alongside the price it holds. */
  publishLockOffer?(offer: LockOffer, signature: Hex): Promise<void>;
  /** The quote honouring a hold, for the relay to hand only to the fan who bought it. */
  publishHold?(lockId: bigint, fan: Address, quote: Quote, signature: Hex): Promise<void>;
}

/** Posts signed quotes to a running quote-relay instance. */
export class HttpQuotePublisher implements QuotePublisher {
  constructor(private readonly relayUrl: string) {}

  async publish(quote: Quote, signature: Hex): Promise<void> {
    await this.post("/quotes", toWire(quote, signature));
  }

  async publishLockOffer(offer: LockOffer, signature: Hex): Promise<void> {
    await this.post("/lock-offers", lockOfferToWire(offer, signature));
  }

  async publishHold(lockId: bigint, fan: Address, quote: Quote, signature: Hex): Promise<void> {
    await this.post("/holds", { lockId: lockId.toString(), fan, quote: toWire(quote, signature) });
  }

  private async post(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${this.relayUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`quote-relay rejected ${path}: HTTP ${res.status} ${await res.text()}`);
    }
  }
}
