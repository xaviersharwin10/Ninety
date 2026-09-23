import { fromWire, type Quote, type SignedQuoteWire } from "@ninety/core";
import type { Hex } from "viem";

// The env var is the relay's bare origin (e.g. "ws://localhost:8081"); the server itself only
// accepts WebSocket upgrades at "/ws" (see QuoteRelay's constructor).
const RELAY_ORIGIN = process.env.NEXT_PUBLIC_RELAY_WS_URL ?? "ws://localhost:8081";
export const RELAY_HTTP_URL = RELAY_ORIGIN.replace(/^ws/, "http");
export const RELAY_WS_ENDPOINT = `${RELAY_ORIGIN}/ws`;

export interface SignedQuote {
  quote: Quote;
  signature: Hex;
}

export interface QuoteBook {
  yes: SignedQuote[];
  no: SignedQuote[];
}

export async function fetchBestQuotes(marketId: bigint): Promise<QuoteBook> {
  const [yesRes, noRes] = await Promise.all([
    fetch(`${RELAY_HTTP_URL}/quotes/${marketId}?side=yes`),
    fetch(`${RELAY_HTTP_URL}/quotes/${marketId}?side=no`),
  ]);
  const yes = yesRes.ok ? ((await yesRes.json()) as { quotes: SignedQuoteWire[] }).quotes : [];
  const no = noRes.ok ? ((await noRes.json()) as { quotes: SignedQuoteWire[] }).quotes : [];
  return { yes: yes.map(fromWire), no: no.map(fromWire) };
}

/** Subscribes to live quote updates for one market. Returns a cleanup function. */
export function subscribeToMarketQuotes(
  marketId: bigint,
  onUpdate: (book: QuoteBook) => void,
): () => void {
  const ws = new WebSocket(`${RELAY_WS_ENDPOINT}?marketId=${marketId}`);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as {
        type: string;
        yes: SignedQuoteWire[];
        no: SignedQuoteWire[];
      };
      if (msg.type === "quotes_updated") {
        onUpdate({ yes: msg.yes.map(fromWire), no: msg.no.map(fromWire) });
      }
    } catch {
      // A malformed frame shouldn't take down the whole subscription.
    }
  };
  return () => ws.close();
}
