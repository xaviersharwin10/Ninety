import { formatUnits, parseUnits } from "viem";
import { NUSD_DECIMALS } from "./config.js";

/** "12.5" for 12_500_000n: nUSD with no trailing zeros, at most two decimals. */
export function nusd(amount: bigint): string {
  const [whole, frac = ""] = formatUnits(amount, NUSD_DECIMALS).split(".");
  const cents = frac.slice(0, 2).replace(/0+$/, "");
  return cents ? `${whole}.${cents}` : (whole ?? "0");
}

/** Parses a human nUSD amount ("5", "2.50"), or null if it isn't a positive amount. */
export function parseNusd(raw: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(raw.trim())) return null;
  const value = parseUnits(raw.trim(), NUSD_DECIMALS);
  return value > 0n ? value : null;
}

/** Decimal odds for an implied probability in basis points: 4762 -> "2.10x". */
export function odds(probBps: number): string {
  return `${(10_000 / probBps).toFixed(2)}x`;
}
