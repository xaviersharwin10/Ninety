"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { LiveBadge } from "@/components/ui/LiveBadge";
import { formatMon, useBalances } from "@/hooks/useBalances";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { walletClientFor } from "@/lib/chain";
import { AUSD_FAUCET_ADDRESS, AusdFaucetAbi } from "@/lib/contracts";
import { listMatches, type MatchListEntry, startReplay } from "@/lib/match-data";

export default function HomePage() {
  const { address, session } = useRequireAuth();
  const router = useRouter();
  const balances = useBalances(address);
  const [matches, setMatches] = useState<MatchListEntry[] | null>(null);
  const [matchesError, setMatchesError] = useState(false);
  const [dripping, setDripping] = useState(false);
  const [claimingFaucet, setClaimingFaucet] = useState(false);
  const [startingMatch, setStartingMatch] = useState<string | null>(null);

  // A brand-new passkey wallet holds 0 MON and can't submit a single transaction -- top it up the
  // moment we know the address, so "get testnet AUSD" below actually works on first visit.
  useEffect(() => {
    if (!address) return;
    setDripping(true);
    fetch("/api/gas-drip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .catch(() => {})
      .finally(() => {
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
    try {
      const wallet = walletClientFor(session.account);
      await wallet.writeContract({
        address: AUSD_FAUCET_ADDRESS,
        abi: AusdFaucetAbi,
        functionName: "requestFunds",
        args: [session.address],
      });
      await balances.refresh();
    } finally {
      setClaimingFaucet(false);
    }
  }

  async function watchMatch(matchId: string) {
    setStartingMatch(matchId);
    try {
      await startReplay(matchId, 20);
      router.push(`/match/${matchId}`);
    } finally {
      setStartingMatch(null);
    }
  }

  const lowBalance = !balances.loading && balances.ausdUnits < 5_000_000n;

  return (
    <div className="flex min-h-dvh flex-col pb-10">
      <TopBar />

      {lowBalance && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-5 mb-2 flex items-center justify-between gap-3 rounded-2xl border border-lime/25 bg-lime/8 px-4 py-3"
        >
          <div>
            <p className="text-[13px] font-semibold text-text">Get testnet AUSD</p>
            <p className="text-[11px] text-text-muted">
              {dripping ? "Setting up your wallet…" : "10,000 AUSD, free, instant"}
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
        <h1 className="font-display text-2xl">Matches</h1>
        <span className="tabular text-[11px] text-text-faint">
          {formatMon(balances.monWei)} MON
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-3 px-5">
        {matchesError && (
          <EmptyState
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
          <EmptyState title="No matches loaded" body="No fixtures found on the replay service." />
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
          <span className="text-[11px] font-semibold tracking-wider text-text-faint">REPLAY</span>
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="glass rounded-2xl p-5 text-center">
      <p className="text-[14px] font-semibold text-text">{title}</p>
      <p className="mt-1 text-[12px] text-text-muted">{body}</p>
    </div>
  );
}
