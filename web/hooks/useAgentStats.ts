"use client";

import { useCallback, useEffect, useState } from "react";
import { queryIndexer } from "@/lib/indexer";

/** One point on an agent's cumulative realised P&L curve. */
export interface PnlPoint {
  /** Unix seconds of the settlement that moved P&L. */
  t: number;
  /** Cumulative realised P&L after it, in nUSD base units. */
  pnl: bigint;
}

/**
 * An agent's track record, entirely from the Envio indexer. None of this is readable from the chain
 * directly: Monad's public RPC caps eth_getLogs at a 100-block range, so history older than ~40s
 * can't be reconstructed by querying it.
 */
export interface AgentStats {
  /** Total stake the agent has taken on, across every bet it priced. */
  volume: bigint;
  /** Bets the agent won (the bettor lost) / lost (the bettor won) / had voided. */
  betsWon: number;
  betsLost: number;
  betsVoided: number;
  /** Net trading P&L across every settled bet: stakes kept minus payouts made. */
  realizedPnl: bigint;
  /** Performance fees paid out of the vault to the agent's operator. */
  feesPaid: bigint;
  /** Fees earned holding prices for fans (Odds Lock); already part of `realizedPnl`. */
  holdFees: bigint;
  holdsSold: number;
  pnlSeries: PnlPoint[];
  /** Largest peak-to-trough fall in cumulative P&L, in nUSD base units (0 if it never fell). */
  maxDrawdown: bigint;
}

interface IndexedAgent {
  id: string;
  volume: string;
  betsWon: number;
  betsLost: number;
  betsVoided: number;
  holdsSold: number;
  holdFees: string;
  vault: { id: string; realizedPnl: string; performanceFeeAssets: string };
}

interface IndexedSnapshot {
  vault_id: string;
  pnlDelta: string;
  timestamp: string;
}

const STATS_QUERY = `
  query AgentStats {
    Agent {
      id
      volume
      betsWon
      betsLost
      betsVoided
      holdsSold
      holdFees
      vault { id realizedPnl performanceFeeAssets }
    }
    VaultSnapshot(order_by: { timestamp: asc }) {
      vault_id
      pnlDelta
      timestamp
    }
  }
`;

/** How often the leaderboard re-reads the indexer while it's on screen. */
const REFRESH_MS = 30_000;

export function buildPnlSeries(deltas: { pnlDelta: bigint; t: number }[]): {
  series: PnlPoint[];
  maxDrawdown: bigint;
} {
  const series: PnlPoint[] = [];
  let cum = 0n;
  let peak = 0n;
  let maxDrawdown = 0n;
  for (const d of deltas) {
    cum += d.pnlDelta;
    series.push({ t: d.t, pnl: cum });
    if (cum > peak) peak = cum;
    if (peak - cum > maxDrawdown) maxDrawdown = peak - cum;
  }
  return { series, maxDrawdown };
}

/** Every agent's indexed track record, keyed by agentId. `stats` is null until the first load. */
export function useAgentStats() {
  const [stats, setStats] = useState<Map<number, AgentStats> | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { Agent, VaultSnapshot } = await queryIndexer<{
        Agent: IndexedAgent[];
        VaultSnapshot: IndexedSnapshot[];
      }>(STATS_QUERY);

      const deltasByVault = new Map<string, { pnlDelta: bigint; t: number }[]>();
      for (const s of VaultSnapshot) {
        const list = deltasByVault.get(s.vault_id) ?? [];
        list.push({ pnlDelta: BigInt(s.pnlDelta), t: Number(s.timestamp) });
        deltasByVault.set(s.vault_id, list);
      }

      const next = new Map<number, AgentStats>();
      for (const a of Agent) {
        const { series, maxDrawdown } = buildPnlSeries(deltasByVault.get(a.vault.id) ?? []);
        next.set(Number(a.id), {
          volume: BigInt(a.volume),
          betsWon: a.betsWon,
          betsLost: a.betsLost,
          betsVoided: a.betsVoided,
          realizedPnl: BigInt(a.vault.realizedPnl),
          feesPaid: BigInt(a.vault.performanceFeeAssets),
          holdFees: BigInt(a.holdFees),
          holdsSold: a.holdsSold,
          pnlSeries: series,
          maxDrawdown,
        });
      }
      setStats(next);
      setError(false);
    } catch {
      // Keep the last stats on screen; the page falls back to chain-only cards if there are none.
      setError(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { stats, error, refresh };
}

/** Share of decided bets the agent came out ahead on, 0-1; null before any bet has settled. */
export function winRate(s: AgentStats): number | null {
  const decided = s.betsWon + s.betsLost;
  return decided === 0 ? null : s.betsWon / decided;
}

/** Realised P&L as a fraction of volume: the margin the agent actually kept. null with no volume. */
export function marginKept(s: AgentStats): number | null {
  return s.volume === 0n ? null : Number((s.realizedPnl * 1_000_000n) / s.volume) / 1_000_000;
}
