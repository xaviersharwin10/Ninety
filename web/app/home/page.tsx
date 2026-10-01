"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/BottomNav";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { LiveBadge } from "@/components/ui/LiveBadge";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAccount } from "@/lib/account-context";
import type { AccountState } from "@/lib/account-engine";
import { listMatches, type MatchListEntry, REPLAY_SPEED, startReplay } from "@/lib/match-data";

export default function HomePage() {
  useRequireAuth();
  const router = useRouter();
  // Gas, the starting 1,000 nUSD and the betting approval all happen on their own at sign-in
  // (lib/account-engine.ts). This page only says so while it's underway.
  const { engine, state } = useAccount();
  const [matches, setMatches] = useState<MatchListEntry[] | null>(null);
  const [matchesError, setMatchesError] = useState(false);
  const [startingMatch, setStartingMatch] = useState<string | null>(null);

  useEffect(() => {
    listMatches()
      .then(setMatches)
      .catch(() => setMatchesError(true));
  }, []);

  async function watchMatch(matchId: string) {
    setStartingMatch(matchId);
    setMatchesError(false);
    try {
      await startReplay(matchId, REPLAY_SPEED);
      router.push(`/match/${matchId}`);
    } catch {
      // The feed is unreachable: say so rather than leave the tap looking ignored.
      setMatchesError(true);
    } finally {
      setStartingMatch(null);
    }
  }

  const notice = accountNotice(state);

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />

      {notice && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mx-5 mb-2 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${notice.failed ? "border-coral/25 bg-coral/8" : "border-lime/25 bg-lime/8"}`}
        >
          <div>
            <p className="text-[13px] font-semibold text-text">{notice.title}</p>
            <p className="text-[11px] text-text-muted">{notice.body}</p>
          </div>
          {notice.failed ? (
            <Button
              variant="primary"
              className="px-4 py-2 text-[13px]"
              onClick={() => engine?.retrySetup()}
            >
              Retry
            </Button>
          ) : (
            notice.working && (
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-lime border-t-transparent" />
            )
          )}
        </motion.div>
      )}

      <div className="mt-4 px-5">
        <h1 className="font-display text-2xl md:text-4xl">Matches</h1>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 px-5 md:mt-5 md:grid-cols-[repeat(auto-fit,minmax(300px,1fr))] md:gap-4">
        {matchesError && (
          <EmptyState
            className="md:col-span-full"
            title="Matches are unavailable right now"
            body="Try again in a moment."
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

function accountNotice(state: AccountState | null) {
  if (!state || state.setup === "working") {
    return {
      title: "Setting up your account",
      body: "Adding your 1,000 free nUSD -- a few seconds.",
      working: true,
      failed: false,
    };
  }
  if (state.setup === "failed") {
    return {
      title: "Couldn't finish setting up",
      body: "Your account is fine — we just couldn't add your nUSD yet.",
      working: false,
      failed: true,
    };
  }
  if (state.refillAt !== null) {
    const time = new Date(state.refillAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      title: "Out of nUSD",
      body: `1,000 more arrive on their own at ${time}.`,
      working: false,
      failed: false,
    };
  }
  return null;
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
