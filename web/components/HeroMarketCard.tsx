"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LiveBadge } from "@/components/ui/LiveBadge";
import { bestDecimalOdds, type QuoteBook } from "@/lib/quote-relay";

interface HeroMarketCardProps {
  question: string;
  nowMatchClockSec: number;
  windowEnd: number;
  quotes: QuoteBook;
  onPick: (side: "yes" | "no") => void;
}

function formatCountdown(secondsLeft: number): string {
  const clamped = Math.max(0, Math.floor(secondsLeft));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function HeroMarketCard({
  question,
  nowMatchClockSec,
  windowEnd,
  quotes,
  onPick,
}: HeroMarketCardProps) {
  const secondsLeft = windowEnd - nowMatchClockSec;
  const yesOdds = bestDecimalOdds(quotes.yes, "yes");
  const noOdds = bestDecimalOdds(quotes.no, "no");

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={question + windowEnd}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -8 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="glass glow-violet mx-5 rounded-3xl p-5"
      >
        <div className="flex items-center justify-between">
          <LiveBadge />
          <span className="tabular text-[13px] font-semibold text-text-muted">
            {formatCountdown(secondsLeft)} left
          </span>
        </div>

        <p className="mt-4 font-display text-[26px] leading-[1.05]">{question}</p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <OddsButton label="YES" odds={yesOdds} accent="lime" onClick={() => onPick("yes")} />
          <OddsButton label="NO" odds={noOdds} accent="coral" onClick={() => onPick("no")} />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function OddsButton({
  label,
  odds,
  accent,
  onClick,
}: {
  label: string;
  odds: number | null;
  accent: "lime" | "coral";
  onClick: () => void;
}) {
  const border =
    accent === "lime"
      ? "border-lime/30 hover:border-lime/60"
      : "border-coral/30 hover:border-coral/60";
  const bg = accent === "lime" ? "bg-lime/8" : "bg-coral/8";
  const text = accent === "lime" ? "text-lime" : "text-coral";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={odds === null}
      className={`rounded-2xl border ${border} ${bg} py-4 text-center transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <div className={`text-[12px] font-bold tracking-wider ${text}`}>{label}</div>
      <div className={`font-display text-3xl ${text}`}>{odds ? `${odds.toFixed(2)}x` : "—"}</div>
    </button>
  );
}
