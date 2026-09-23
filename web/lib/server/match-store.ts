/**
 * Maps a Wyscout match id to the on-chain `matchId` `MarketManager.createMatch` assigns it (an
 * auto-incrementing counter with no way to request a specific value), and tracks which markets the
 * scheduler has opened for it. `MarketManager` itself exposes only `matchExists[id] -> bool` --
 * nothing enumerable, no metadata getter -- so without a live indexer (Envio's HyperSync needs an
 * API token this project doesn't have configured yet) there is no way to *discover* this mapping
 * from chain state alone. A small local JSON file is the honest stand-in: it works for exactly
 * what's actually running today (one local match-data + one local chain, someone watching), and is
 * the first thing to delete once indexer/schema.graphql's `Match` entity is live and queryable.
 *
 * Not committed, not multi-instance-safe, not meant to be. See docs/ once the indexer replaces it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface OpenMarketRecord {
  marketId: string;
  templateIdx: number;
  windowStart: number;
  windowEnd: number;
}

export interface MatchRecord {
  onchainMatchId: string;
  nextTemplateIdx: number;
  openMarkets: OpenMarketRecord[];
}

const STORE_PATH = join(process.cwd(), ".data", "match-store.json");

async function readStore(): Promise<Record<string, MatchRecord>> {
  try {
    return JSON.parse(await readFile(STORE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function writeStore(store: Record<string, MatchRecord>): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

export async function getMatchRecord(wyscoutId: string): Promise<MatchRecord | undefined> {
  const store = await readStore();
  return store[wyscoutId];
}

export async function setMatchRecord(wyscoutId: string, record: MatchRecord): Promise<void> {
  const store = await readStore();
  store[wyscoutId] = record;
  await writeStore(store);
}
