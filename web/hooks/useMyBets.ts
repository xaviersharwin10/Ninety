"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { getTrackedBetIds } from "@/lib/bet-tracking";
import { publicClient } from "@/lib/chain";
import { BET_ROUTER, BetRouterAbi } from "@/lib/contracts";

export interface MyBet {
  betId: string;
  marketId: bigint;
  side: "Yes" | "No";
  probBps: number;
  stake: bigint;
  payout: bigint;
  status: "Open" | "Won" | "Lost" | "Voided";
  claimableAmount: bigint;
}

const STATUS_NAMES = ["None", "Open", "Won", "Lost", "Voided"] as const;

export function useMyBets(address: Address | null) {
  const [bets, setBets] = useState<MyBet[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address) return;
    const ids = getTrackedBetIds(address);
    const results = await Promise.all(
      ids.map(async (betId) => {
        try {
          const [bet, claimableAmount] = await Promise.all([
            publicClient.readContract({
              address: BET_ROUTER,
              abi: BetRouterAbi,
              functionName: "getBet",
              args: [BigInt(betId)],
            }),
            publicClient.readContract({
              address: BET_ROUTER,
              abi: BetRouterAbi,
              functionName: "claimableAmount",
              args: [BigInt(betId)],
            }),
          ]);
          const b = bet as {
            marketId: bigint;
            side: number;
            probBps: number;
            stake: bigint;
            payout: bigint;
            status: number;
          };
          return {
            betId,
            marketId: b.marketId,
            side: b.side === 0 ? ("Yes" as const) : ("No" as const),
            probBps: b.probBps,
            stake: b.stake,
            payout: b.payout,
            status: STATUS_NAMES[b.status] as MyBet["status"],
            claimableAmount: claimableAmount as bigint,
          };
        } catch {
          return null;
        }
      }),
    );
    setBets(results.filter((b): b is MyBet => b !== null).reverse());
    setLoading(false);
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { bets, loading, refresh };
}
