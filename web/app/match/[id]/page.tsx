"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BetSlip } from "@/components/BetSlip";
import { EventTicker } from "@/components/EventTicker";
import { HeroMarketCard } from "@/components/HeroMarketCard";
import { TopBar } from "@/components/TopBar";
import { useLiveMatch } from "@/hooks/useLiveMatch";
import { useMarketQuotes } from "@/hooks/useMarketQuotes";
import { useMarketScheduler } from "@/hooks/useMarketScheduler";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { listMatches, type MatchListEntry } from "@/lib/match-data";
import { TEMPLATE_ORDER, TEMPLATE_QUESTION } from "@/lib/templates";

export default function MatchPage() {
  useRequireAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const wyscoutId = params.id;

  const { events, nowMatchClockSec } = useLiveMatch(wyscoutId);
  const { markets, error: schedulerError } = useMarketScheduler(wyscoutId);
  const [teams, setTeams] = useState<MatchListEntry["teams"]>([]);
  const [pickedSide, setPickedSide] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    listMatches().then((all) => {
      const match = all.find((m) => m.matchId === wyscoutId);
      if (match) setTeams(match.teams);
    });
  }, [wyscoutId]);

  const currentMarket = markets
    .filter((m) => m.windowEnd > nowMatchClockSec)
    .sort((a, b) => a.windowEnd - b.windowEnd)[0];
  const templateName = currentMarket
    ? TEMPLATE_ORDER[currentMarket.templateIdx % TEMPLATE_ORDER.length]
    : undefined;
  const question = templateName ? TEMPLATE_QUESTION[templateName] : "";

  const quotes = useMarketQuotes(currentMarket?.marketId ?? null);
  const [home, away] = teams;

  return (
    <div className="flex min-h-dvh flex-col pb-10">
      <TopBar />

      <div className="flex items-center gap-3 px-5">
        <button type="button" onClick={() => router.push("/home")} className="text-text-faint">
          ←
        </button>
        <div>
          <p className="font-display text-lg leading-none">
            {home?.name ?? "…"} <span className="text-text-faint">vs</span> {away?.name ?? "…"}
          </p>
          <p className="tabular mt-1 text-[12px] text-text-faint">
            {Math.floor(nowMatchClockSec / 60)}' match clock
          </p>
        </div>
      </div>

      <EventTicker events={events} />

      <div className="mt-5 flex-1">
        {currentMarket && templateName ? (
          <HeroMarketCard
            question={question}
            nowMatchClockSec={nowMatchClockSec}
            windowEnd={currentMarket.windowEnd}
            quotes={quotes}
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
