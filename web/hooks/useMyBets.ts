"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { BALANCE_CHANGED_EVENT } from "@/lib/account-engine";
import { queryIndexer } from "@/lib/indexer";

export interface MyBet {
  betId: string;
  marketId: bigint;
  /** The market's template id (keccak of its name); see TEMPLATE_NAME_BY_ID. */
  templateId: string;
  side: "Yes" | "No";
  probBps: number;
  stake: bigint;
  payout: bigint;
  status: "Open" | "Won" | "Lost" | "Voided";
}

interface IndexedBet {
  id: string;
  market: { id: string; templateId: string };
  side: string;
  probBps: number;
  stake: string;
  payout: string;
  status: string;
}

const MY_BETS_QUERY = `
  query MyBets($addr: String!) {
    Bet(where: { bettor: { _eq: $addr } }, order_by: { placedAt: desc }) {
      id
      market { id templateId }
      side
      probBps
      stake
      payout
      status
    }
  }
`;

/**
 * Backed entirely by the Envio indexer's `Bet.bettor`, not client-tracked bet ids -- so "my bets"
 * reconstructs correctly on a fresh device/browser profile, same as the passkey account itself.
 */
export function useMyBets(address: Address | null) {
  const [bets, setBets] = useState<MyBet[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const { Bet } = await queryIndexer<{ Bet: IndexedBet[] }>(MY_BETS_QUERY, {
        addr: address.toLowerCase(),
      });
      setBets(
        Bet.map((b) => ({
          betId: b.id,
          marketId: BigInt(b.market.id),
          templateId: b.market.templateId,
          side: b.side === "Yes" ? ("Yes" as const) : ("No" as const),
          probBps: b.probBps,
          stake: BigInt(b.stake),
          payout: BigInt(b.payout),
          status: b.status as MyBet["status"],
        })),
      );
    } catch {
      // Indexer briefly unreachable: keep the list already shown; the next refresh recovers.
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Kept fresh while open: results settle on their own (see account-engine.ts), so the list must
  // too, and at once when the account moves money.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    window.addEventListener(BALANCE_CHANGED_EVENT, refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener(BALANCE_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  return { bets, loading, refresh };
}
