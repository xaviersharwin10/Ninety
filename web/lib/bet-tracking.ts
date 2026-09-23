/**
 * Which bet ids belong to which address, tracked client-side in localStorage. This is exactly the
 * kind of per-viewer convenience the artifact/browser-storage guidance calls for, not identity or
 * state that needs to be shared or durable: `BetRouter.getBet` is the source of truth for what a
 * tracked id actually resolved to, this is only "which ids to even ask about". A fresh browser
 * profile shows no history -- correct, not a bug, and unrelated to the passkey's own statelessness
 * (the account itself still reconstructs perfectly; only this convenience list doesn't follow it).
 */
const STORAGE_KEY_PREFIX = "ninety.myBets.";

function key(address: string): string {
  return `${STORAGE_KEY_PREFIX}${address.toLowerCase()}`;
}

export function getTrackedBetIds(address: string): string[] {
  try {
    const raw = localStorage.getItem(key(address));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function trackBetIds(address: string, betIds: string[]): void {
  try {
    const existing = new Set(getTrackedBetIds(address));
    for (const id of betIds) existing.add(id);
    localStorage.setItem(key(address), JSON.stringify([...existing]));
  } catch {
    // A private window or blocked storage just means this convenience doesn't persist -- the bet
    // itself already went through on chain regardless.
  }
}
