import { CommandError } from "@metamask/agent-wallet/plugin";
import { fromWire, type SignedQuote, type SignedQuoteWire } from "@ninety/core";
import { ninetyUrl } from "./config.js";

export interface Fixture {
  matchId: string;
  teams: { id: number; name: string }[];
  isReplaying: boolean;
  finished?: boolean;
}

export interface OpenMarket {
  marketId: string;
  templateIdx: number;
  windowStart: number;
  windowEnd: number;
}

export interface MarketSchedule {
  onchainMatchId: string;
  openMarkets: OpenMarket[];
  matchClockSec: number;
  speed: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${ninetyUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new CommandError(
      "NINETY_UNREACHABLE",
      `Couldn't reach Ninety at ${ninetyUrl()}.`,
      "Set NINETY_URL to the Ninety app's address, e.g. export NINETY_URL=https://<app>.",
    );
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new CommandError(
      "NINETY_API_ERROR",
      `Ninety answered ${res.status}${body.error ? ` (${body.error})` : ""} for ${path}.`,
      "Try again in a moment.",
    );
  }
  return body;
}

export async function listFixtures(): Promise<Fixture[]> {
  return (await call<{ matches: Fixture[] }>("/api/matches")).matches;
}

export async function startFixture(matchId: string): Promise<void> {
  await call(`/api/matches/${matchId}/start`, { method: "POST" });
}

/**
 * The match's open markets. Asking is also what keeps them coming: like an open match screen, each
 * call lets the scheduler close finished windows and open the next one.
 */
export async function marketSchedule(matchId: string): Promise<MarketSchedule> {
  await call(`/api/matches/${matchId}/ensure`, { method: "POST" });
  return call<MarketSchedule>(`/api/matches/${matchId}/schedule-tick`, { method: "POST" });
}

/** The best signed prices on each side of a market, best first. */
export async function quoteBook(
  marketId: string,
): Promise<{ yes: SignedQuote[]; no: SignedQuote[] }> {
  const book = await call<{ yes: SignedQuoteWire[]; no: SignedQuoteWire[] }>(
    `/api/quotes/${marketId}`,
  );
  return { yes: book.yes.map(fromWire), no: book.no.map(fromWire) };
}

/** A read-only query against Ninety's indexer. */
export async function indexer<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const body = await call<{ data?: T; errors?: { message: string }[] }>("/api/indexer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!body.data) {
    throw new CommandError(
      "NINETY_INDEXER_ERROR",
      `Ninety's bet history is unavailable${body.errors?.[0] ? ` (${body.errors[0].message})` : ""}.`,
      "Try again in a moment.",
    );
  }
  return body.data;
}

/** Tops the address up with a little testnet MON for gas, if it's low. Free, testnet only. */
export async function requestGas(address: string): Promise<{ dripped: boolean }> {
  return call<{ dripped: boolean }>("/api/gas-drip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, purpose: "fan" }),
  });
}
