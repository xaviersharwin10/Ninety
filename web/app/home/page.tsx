"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { BottomNav } from "@/components/BottomNav";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { LiveBadge } from "@/components/ui/LiveBadge";
import { formatMon, useBalances } from "@/hooks/useBalances";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { publicClient, walletClientFor } from "@/lib/chain";
import { NUSD_ADDRESS, NusdAbi } from "@/lib/contracts";
import { ensureGas } from "@/lib/gas";
import { listMatches, type MatchListEntry, REPLAY_SPEED, startReplay } from "@/lib/match-data";

function faucetErrorMessage(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (
      reverted instanceof ContractFunctionRevertedError &&
      reverted.data?.errorName === "ClaimTooSoon"
    ) {
      const availableAt = Number(reverted.data.args?.[0] ?? 0n) * 1000;
      const time = new Date(availableAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `You've claimed recently -- you can claim again at ${time}.`;
    }
  }
  return "Couldn't claim nUSD -- try again.";
}

export default function HomePage() {
  const { address, session } = useRequireAuth();
  const router = useRouter();
  const balances = useBalances(address);
  const [matches, setMatches] = useState<MatchListEntry[] | null>(null);
  const [matchesError, setMatchesError] = useState(false);
  const [dripping, setDripping] = useState(false);
  const [claimingFaucet, setClaimingFaucet] = useState(false);
  const [faucetError, setFaucetError] = useState<string | null>(null);
  const [startingMatch, setStartingMatch] = useState<string | null>(null);

  // A brand-new passkey wallet holds 0 MON and can't submit a single transaction -- top it up the
  // moment we know the address, so "get testnet nUSD" below actually works on first visit.
  useEffect(() => {
    if (!address) return;
    setDripping(true);
    ensureGas(address).finally(() => {
      setDripping(false);
      balances.refresh();
    });
    // Deliberately keyed on `address` alone -- this should run exactly once per sign-in, not
    // every time `balances` (a fresh object each render) changes.
  }, [address]);

  useEffect(() => {
    listMatches()
      .then(setMatches)
      .catch(() => setMatchesError(true));
  }, []);

  async function claimFaucet() {
    if (!session) return;
    setClaimingFaucet(true);
    setFaucetError(null);
    try {
      await ensureGas(session.address);
      const wallet = walletClientFor(session.account);
      const hash = await wallet.writeContract({
        address: NUSD_ADDRESS,
        abi: NusdAbi,
        functionName: "claim",
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await balances.refresh();
    } catch (err) {
      setFaucetError(faucetErrorMessage(err));
    } finally {
      setClaimingFaucet(false);
    }
  }

  async function watchMatch(matchId: string) {
    setStartingMatch(matchId);
    try {
      await startReplay(matchId, REPLAY_SPEED);
      router.push(`/match/${matchId}`);
    } finally {
      setStartingMatch(null);
    }
  }

  const lowBalance = !balances.loading && balances.nusdUnits < 5_000_000n;

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />

      {lowBalance && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-5 mb-2 flex items-center justify-between gap-3 rounded-2xl border border-lime/25 bg-lime/8 px-4 py-3"
        >
          <div>
            <p className="text-[13px] font-semibold text-text">Get testnet nUSD</p>
            <p className={`text-[11px] ${faucetError ? "text-coral" : "text-text-muted"}`}>
              {faucetError ?? (dripping ? "Setting up your wallet…" : "1,000 nUSD, free, instant")}
            </p>
          </div>
          <Button
            variant="primary"
            className="px-4 py-2 text-[13px]"
            loading={claimingFaucet || dripping}
            onClick={claimFaucet}
          >
            Claim
          </Button>
        </motion.div>
      )}

      <div className="mt-4 flex items-center justify-between px-5">
        <h1 className="font-display text-2xl md:text-4xl">Matches</h1>
        <span className="tabular text-[11px] text-text-faint">
          {formatMon(balances.monWei)} MON
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 px-5 md:mt-5 md:grid-cols-[repeat(auto-fit,minmax(300px,1fr))] md:gap-4">
        {matchesError && (
          <EmptyState
            className="md:col-span-full"
            title="Can't reach the match feed"
            body="The replay service isn't running. Start it locally and refresh."
          />
        )}
        {!matchesError && matches === null && (
          <>
            <div className="shimmer h-[92px] rounded-2xl" />
            <div className="shimmer h-[92px] rounded-2xl" />
          </>
        )}
        {matches?.length === 0 && (
          <EmptyState
            className="md:col-span-full"
            title="No matches loaded"
            body="No fixtures found on the replay service."
          />
        )}
        {matches?.map((m) => (
          <MatchCard
            key={m.matchId}
            match={m}
            loading={startingMatch === m.matchId}
            onWatch={() => watchMatch(m.matchId)}
          />
        ))}
      </div>

      <BottomNav />
    </div>
  );
}

function MatchCard({
  match,
  loading,
  onWatch,
}: {
  match: MatchListEntry;
  loading: boolean;
  onWatch: () => void;
}) {
  const [home, away] = match.teams;
  return (
    <button
      type="button"
      onClick={onWatch}
      disabled={loading}
      className="glass flex items-center justify-between rounded-2xl p-4 text-left transition-transform active:scale-[0.99] disabled:opacity-60"
    >
      <div>
        {match.isReplaying ? (
          <LiveBadge />
        ) : (
          <span className="text-[11px] font-semibold tracking-wider text-text-faint">
            {match.finished ? "FULL TIME · WATCH AGAIN" : "REPLAY"}
          </span>
        )}
        <p className="mt-2 font-display text-xl">
          {home?.name ?? "Team A"} <span className="text-text-faint">vs</span>{" "}
          {away?.name ?? "Team B"}
        </p>
      </div>
      <div className="glow-lime flex h-10 w-10 items-center justify-center rounded-full bg-lime text-[#06070a]">
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          "▶"
        )}
      </div>
    </button>
  );
}

function EmptyState({
  title,
  body,
  className = "",
}: {
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div className={`glass rounded-2xl p-5 text-center ${className}`}>
      <p className="text-[14px] font-semibold text-text">{title}</p>
      <p className="mt-1 text-[12px] text-text-muted">{body}</p>
    </div>
  );
}
