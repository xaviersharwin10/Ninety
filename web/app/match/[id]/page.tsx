"use client";

import { isTemplateInDanger, type TemplateName } from "@ninety/core";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BetSlip } from "@/components/BetSlip";
import { EventTicker } from "@/components/EventTicker";
import { HeroMarketCard } from "@/components/HeroMarketCard";
import { countByTeam, MatchStats } from "@/components/MatchStats";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { LiveBadge } from "@/components/ui/LiveBadge";
import { useLiveMatch } from "@/hooks/useLiveMatch";
import { useMarketQuotes } from "@/hooks/useMarketQuotes";
import { type ScheduledMarket, useMarketScheduler } from "@/hooks/useMarketScheduler";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { listMatches, type MatchListEntry, REPLAY_SPEED, startReplay } from "@/lib/match-data";
import { TEMPLATE_ORDER, TEMPLATE_QUESTION } from "@/lib/templates";

function templateOf(market: ScheduledMarket): TemplateName {
  return TEMPLATE_ORDER[market.templateIdx % TEMPLATE_ORDER.length]!;
}

function questionFor(market: ScheduledMarket): string {
  return TEMPLATE_QUESTION[templateOf(market)];
}

function formatCountdown(secondsLeft: number): string {
  const clamped = Math.max(0, Math.floor(secondsLeft));
  return `${Math.floor(clamped / 60)}:${(clamped % 60).toString().padStart(2, "0")}`;
}

function FullTimeBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-bold tracking-wider text-text-muted">
      FULL TIME
    </span>
  );
}

export default function MatchPage() {
  useRequireAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const wyscoutId = params.id;

  const { events, nowMatchClockSec, ended, danger } = useLiveMatch(wyscoutId);
  const { markets, error: schedulerError } = useMarketScheduler(wyscoutId);
  const [teams, setTeams] = useState<MatchListEntry["teams"]>([]);
  const [pickedSide, setPickedSide] = useState<"yes" | "no" | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  async function watchAgain() {
    setRestarting(true);
    try {
      await startReplay(wyscoutId, REPLAY_SPEED);
    } finally {
      setRestarting(false);
    }
  }

  useEffect(() => {
    listMatches().then((all) => {
      const match = all.find((m) => m.matchId === wyscoutId);
      if (match) setTeams(match.teams);
    });
  }, [wyscoutId]);

  // Only markets whose window contains "now". A window starting in the future can only be a
  // leftover from an earlier run of this replay (the scheduler closes those on its next tick).
  // Nothing is bettable at full time: the scheduler closes whatever was still open.
  const liveMarkets = (ended ? [] : markets)
    .filter((m) => m.windowStart <= nowMatchClockSec && m.windowEnd > nowMatchClockSec)
    .sort((a, b) => a.windowEnd - b.windowEnd);
  const currentMarket = liveMarkets.find((m) => m.marketId === selectedMarketId) ?? liveMarkets[0];
  const otherMarkets = liveMarkets.filter((m) => m !== currentMarket);
  const question = currentMarket ? questionFor(currentMarket) : "";

  const quotes = useMarketQuotes(currentMarket?.marketId ?? null);
  const [home, away] = teams;
  const minute = Math.floor(nowMatchClockSec / 60);
  const homeGoals = countByTeam(events, "goal", home?.id);
  const awayGoals = countByTeam(events, "goal", away?.id);

  return (
    <div className="flex min-h-dvh flex-col pb-10 md:pb-0">
      <TopBar />

      {/* Phone: scoreboard, ticker strip, market. md-xl: scoreboard, market, stats + feed (stacked,
          so nothing is squeezed next to a fixed-width column). xl+: scoreboard and stats/feed on
          the left, the market card pinned in a right-hand column. */}
      <div className="flex flex-col md:gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start xl:gap-x-10 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="flex min-w-0 items-center gap-3 px-5 md:order-1 md:px-0 xl:col-start-1 xl:row-start-1">
          <button
            type="button"
            onClick={() => router.push("/home")}
            className="text-text-faint hover:text-text md:hidden"
          >
            ←
          </button>
          <div className="md:mx-5 md:flex md:w-full md:items-center md:justify-between md:gap-6 md:rounded-3xl md:border md:border-border md:bg-bg-elevated/80 md:p-6 2xl:p-8">
            <div>
              <button
                type="button"
                onClick={() => router.push("/home")}
                className="mb-4 hidden text-[13px] text-text-faint hover:text-text md:block"
              >
                ← All matches
              </button>
              <div className="hidden md:block">{ended ? <FullTimeBadge /> : <LiveBadge />}</div>
              <p className="font-display text-lg leading-none md:mt-3 md:text-4xl lg:text-5xl xl:text-4xl 2xl:text-6xl">
                {home?.name ?? "…"}{" "}
                <span className="tabular text-lime">
                  {homeGoals}–{awayGoals}
                </span>{" "}
                {away?.name ?? "…"}
              </p>
              <p className="tabular mt-1 text-[12px] text-text-faint md:hidden">
                {ended ? "Full time" : `${minute}' match clock`}
              </p>
            </div>
            <div className="hidden text-right md:block">
              <p className="tabular font-display text-5xl leading-none text-lime lg:text-6xl xl:text-5xl 2xl:text-7xl">
                {minute}'
              </p>
              <p className="mt-1 text-[12px] text-text-faint">match clock</p>
            </div>
          </div>
        </div>

        <div className="md:order-3 md:mx-5 md:grid md:gap-6 lg:grid-cols-2 lg:items-start xl:col-start-1 xl:row-start-2 xl:grid-cols-1 2xl:grid-cols-2">
          <div className="hidden md:block lg:order-2 xl:order-none 2xl:order-2">
            <MatchStats events={events} teams={teams} />
          </div>
          <EventTicker events={events} teams={teams} />
        </div>

        <div className="mt-5 md:order-2 md:mt-0 xl:sticky xl:top-6 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          {ended ? (
            <div className="glass mx-5 rounded-3xl p-8 text-center">
              <p className="font-display text-2xl">Full time</p>
              <p className="tabular mt-2 text-[13px] text-text-muted">
                {home?.name ?? "…"} {homeGoals}–{awayGoals} {away?.name ?? "…"}. Every market from
                this match settles automatically -- check My Bets for results.
              </p>
              <Button
                variant="primary"
                fullWidth
                className="mt-5"
                loading={restarting}
                onClick={watchAgain}
              >
                Watch again
              </Button>
            </div>
          ) : currentMarket ? (
            <HeroMarketCard
              question={question}
              nowMatchClockSec={nowMatchClockSec}
              windowEnd={currentMarket.windowEnd}
              quotes={quotes}
              paused={isTemplateInDanger(templateOf(currentMarket), danger)}
              onPick={setPickedSide}
            />
          ) : (
            <div className="glass mx-5 rounded-3xl p-8 text-center">
              <p className="font-display text-xl">Next market opening soon</p>
              <p className="mt-2 text-[13px] text-text-muted">
                {schedulerError
                  ? "Couldn't reach the scheduler. Is the chain reachable?"
                  : "A new market opens roughly every 2 minutes of match time."}
              </p>
            </div>
          )}

          {otherMarkets.length > 0 && (
            <div className="mx-5 mt-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                More markets
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {otherMarkets.map((m) => (
                  <button
                    type="button"
                    key={m.marketId}
                    onClick={() => {
                      setSelectedMarketId(m.marketId);
                      setPickedSide(null);
                    }}
                    className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:border-border-strong"
                  >
                    <span className="text-[13px] text-text">{questionFor(m)}</span>
                    <span className="tabular shrink-0 text-[12px] text-text-faint">
                      {formatCountdown(m.windowEnd - nowMatchClockSec)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {pickedSide && currentMarket && (
        <BetSlip
          marketId={currentMarket.marketId}
          question={question}
          side={pickedSide}
          quotes={pickedSide === "yes" ? quotes.yes : quotes.no}
          onClose={() => setPickedSide(null)}
          onPlaced={() => {}}
        />
      )}
    </div>
  );
}
