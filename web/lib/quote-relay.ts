import {
  fromWire,
  type LockOffer,
  lockOfferFromWire,
  type Quote,
  type SignedLockOfferWire,
  type SignedQuoteWire,
} from "@ninety/core";
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

export interface SignedLockOffer {
  offer: LockOffer;
  signature: Hex;
}

export interface QuoteBook {
  yes: SignedQuote[];
  no: SignedQuote[];
  /** The best offer to hold each side's price, if any agent is selling one. */
  holds: { yes: SignedLockOffer | null; no: SignedLockOffer | null };
}

const NO_HOLDS = { yes: null, no: null };

export async function fetchBestQuotes(marketId: bigint): Promise<QuoteBook> {
  const [yesRes, noRes] = await Promise.all([
    fetch(`${RELAY_HTTP_URL}/quotes/${marketId}?side=yes`),
    fetch(`${RELAY_HTTP_URL}/quotes/${marketId}?side=no`),
  ]);
  const yes = yesRes.ok ? ((await yesRes.json()) as { quotes: SignedQuoteWire[] }).quotes : [];
  const no = noRes.ok ? ((await noRes.json()) as { quotes: SignedQuoteWire[] }).quotes : [];
  return { yes: yes.map(fromWire), no: no.map(fromWire), holds: NO_HOLDS };
}

/** Best (highest-payout) decimal odds currently available on one side, or null with no liquidity. */
export function bestDecimalOdds(quotes: SignedQuote[], side: "yes" | "no"): number | null {
  if (quotes.length === 0) return null;
  const probs = quotes.map((q) => (side === "yes" ? q.quote.probYesBps : q.quote.probNoBps));
  return 10_000 / Math.min(...probs);
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
        holds?: { yes: SignedLockOfferWire | null; no: SignedLockOfferWire | null };
      };
      if (msg.type === "quotes_updated") {
        onUpdate({
          yes: msg.yes.map(fromWire),
          no: msg.no.map(fromWire),
          holds: {
            yes: msg.holds?.yes ? lockOfferFromWire(msg.holds.yes) : null,
            no: msg.holds?.no ? lockOfferFromWire(msg.holds.no) : null,
          },
        });
      }
    } catch {
      // A malformed frame shouldn't take down the whole subscription.
    }
  };
  return () => ws.close();
}
