"use client";

import { useState } from "react";
import { BottomNav } from "@/components/BottomNav";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { formatNusd } from "@/hooks/useBalances";
import { type MyBet, useMyBets } from "@/hooks/useMyBets";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { walletClientFor } from "@/lib/chain";
import { BET_ROUTER, BetRouterAbi } from "@/lib/contracts";
import { ensureGas } from "@/lib/gas";
import { confirmTx } from "@/lib/tx";

const STATUS_STYLE: Record<MyBet["status"], string> = {
  Open: "text-text-muted",
  Won: "text-lime",
  Lost: "text-text-faint",
  Voided: "text-gold",
};

export default function BetsPage() {
  const { address, session } = useRequireAuth();
  const { bets, loading, refresh } = useMyBets(address);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  // Claimed on-chain but not yet reflected by the indexer (it can trail by ~45s): hide them here so
  // the "You won" banner doesn't offer the same payout twice.
  const [justClaimed, setJustClaimed] = useState<Set<string>>(new Set());

  const claimableBets = bets.filter((b) => b.claimableAmount > 0n && !justClaimed.has(b.betId));
  const totalClaimable = claimableBets.reduce((sum, b) => sum + b.claimableAmount, 0n);

  async function claimAll() {
    if (!session || claimableBets.length === 0) return;
    setClaiming(true);
    setClaimError(null);
    try {
      await ensureGas(session.address);
      const wallet = walletClientFor(session.account);
      const hash = await wallet.writeContract({
        address: BET_ROUTER,
        abi: BetRouterAbi,
        functionName: "claim",
        args: [claimableBets.map((b) => BigInt(b.betId))],
      });
      await confirmTx(hash);
      setJustClaimed((prev) => new Set([...prev, ...claimableBets.map((b) => b.betId)]));
      await refresh();
    } catch {
      setClaimError("Couldn't collect your winnings -- try again.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <h1 className="px-5 font-display text-2xl md:text-4xl">My Bets</h1>

      {totalClaimable > 0n && (
        <div className="glow-lime mx-5 mt-3 flex items-center justify-between rounded-2xl border border-lime/25 bg-lime/8 px-4 py-3">
          <div>
            <p className="text-[13px] font-semibold text-text">You won!</p>
            <p className="tabular text-[12px] text-lime">
              {formatNusd(totalClaimable)} nUSD to claim
            </p>
          </div>
          <Button
            variant="primary"
            className="px-4 py-2 text-[13px]"
            loading={claiming}
            onClick={claimAll}
          >
            Claim all
          </Button>
        </div>
      )}
      {claimError && <p className="mx-5 mt-2 text-[12px] text-coral">{claimError}</p>}

      <div className="mt-3 flex flex-1 flex-col px-5">
        {!loading && bets.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center">
            <p className="text-[14px] font-semibold text-text">No bets yet</p>
            <p className="mt-1 text-[12px] text-text-muted">
              Bets you place show up here, on any device.
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] md:gap-3">
          {loading && (
            <>
              <div className="shimmer h-[70px] rounded-2xl" />
              <div className="shimmer h-[70px] rounded-2xl" />
            </>
          )}
          {bets.map((bet) => (
            <BetRow key={bet.betId} bet={bet} />
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}

function BetRow({ bet }: { bet: MyBet }) {
  const decimalOdds = 10_000 / bet.probBps;
  return (
    <div className="glass flex items-center justify-between rounded-2xl p-4">
      <div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[12px] font-bold ${bet.side === "Yes" ? "text-lime" : "text-coral"}`}
          >
            {bet.side.toUpperCase()}
          </span>
          <span className="tabular text-[11px] text-text-faint">{decimalOdds.toFixed(2)}x</span>
        </div>
        <p className="tabular mt-1 text-[13px] font-semibold">
          {formatNusd(bet.stake)} nUSD staked
        </p>
      </div>
      <div className="text-right">
        <p className={`text-[12px] font-semibold ${STATUS_STYLE[bet.status]}`}>{bet.status}</p>
        {bet.claimableAmount > 0n && (
          <p className="tabular text-[13px] font-semibold text-lime">
            +{formatNusd(bet.claimableAmount)} nUSD
          </p>
        )}
      </div>
    </div>
  );
}
