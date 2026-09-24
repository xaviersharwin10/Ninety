"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { queryIndexer } from "@/lib/indexer";

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

interface IndexedBet {
  id: string;
  market: { id: string };
  side: string;
  probBps: number;
  stake: string;
  payout: string;
  status: string;
  claimedAt: string | null;
}

const MY_BETS_QUERY = `
  query MyBets($addr: String!) {
    Bet(where: { bettor: { _eq: $addr } }, order_by: { placedAt: desc }) {
      id
      market { id }
      side
      probBps
      stake
      payout
      status
      claimedAt
    }
  }
`;

/** Mirrors `BetRouter._owed`: payout if Won, stake if Voided, 0 otherwise or if already claimed. */
function claimableAmountOf(bet: IndexedBet): bigint {
  if (bet.claimedAt) return 0n;
  if (bet.status === "Won") return BigInt(bet.payout);
  if (bet.status === "Voided") return BigInt(bet.stake);
  return 0n;
}

/**
 * Backed entirely by the Envio indexer's `Bet.bettor`, not client-tracked bet ids -- so "my bets"
 * reconstructs correctly on a fresh device/browser profile, same as the passkey account itself.
 */
export function useMyBets(address: Address | null) {
  const [bets, setBets] = useState<MyBet[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const { Bet } = await queryIndexer<{ Bet: IndexedBet[] }>(MY_BETS_QUERY, {
        addr: address.toLowerCase(),
      });
      setBets(
        Bet.map((b) => ({
          betId: b.id,
          marketId: BigInt(b.market.id),
          side: b.side === "Yes" ? ("Yes" as const) : ("No" as const),
          probBps: b.probBps,
          stake: BigInt(b.stake),
          payout: BigInt(b.payout),
          status: b.status as MyBet["status"],
          claimableAmount: claimableAmountOf(b),
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { bets, loading, refresh };
}
