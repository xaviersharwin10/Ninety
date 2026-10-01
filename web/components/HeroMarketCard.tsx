"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LiveBadge } from "@/components/ui/LiveBadge";
import { bestDecimalOdds, type QuoteBook } from "@/lib/quote-relay";

interface HeroMarketCardProps {
  question: string;
  nowMatchClockSec: number;
  windowEnd: number;
  quotes: QuoteBook;
  /** Something that would decide this market is about to happen: betting pauses until it passes. */
  paused?: boolean;
  /** It already happened in this window: the market is a YES, just waiting to settle. */
  decided?: boolean;
  /** A price the fan is holding on this market (see BetSlip), while it lasts. */
  held?: { side: "yes" | "no"; odds: number; secondsLeft: number } | null;
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
  paused = false,
  decided = false,
  held = null,
  onPick,
}: HeroMarketCardProps) {
  const secondsLeft = windowEnd - nowMatchClockSec;
  // While paused, don't offer prices at all -- even one still inside its few seconds of validity.
  const yesOdds = paused ? null : bestDecimalOdds(quotes.yes, "yes");
  const noOdds = paused ? null : bestDecimalOdds(quotes.no, "no");

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={question + windowEnd}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -8 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="glass glow-violet mx-5 rounded-3xl p-5 md:p-7"
      >
        <div className="flex items-center justify-between">
          {decided ? (
            <LiveBadge label="DECIDED" />
          ) : paused ? (
            <LiveBadge label="PAUSED" />
          ) : (
            <LiveBadge />
          )}
          <span className="tabular text-[13px] font-semibold text-text-muted">
            {formatCountdown(secondsLeft)} left
          </span>
        </div>

        <p className="mt-4 font-display text-[26px] leading-[1.05] md:text-[34px]">{question}</p>

        {decided ? (
          <div className="mt-5 rounded-2xl border border-lime/30 bg-lime/8 p-4 text-center md:mt-7">
            <p className="font-display text-3xl text-lime">✓ It's a YES</p>
            <p className="mt-1 text-[12px] text-text-muted">
              Settling now — results land in your balance automatically.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 md:mt-7">
              <OddsButton label="YES" odds={yesOdds} accent="lime" onClick={() => onPick("yes")} />
              <OddsButton label="NO" odds={noOdds} accent="coral" onClick={() => onPick("no")} />
            </div>
            {held && (
              <button
                type="button"
                onClick={() => onPick(held.side)}
                className={`mt-3 flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-[13px] transition-colors ${
                  held.side === "yes"
                    ? "border-lime/40 bg-lime/8 hover:border-lime/70"
                    : "border-coral/40 bg-coral/8 hover:border-coral/70"
                }`}
              >
                <span>
                  You're holding{" "}
                  <span
                    className={`font-semibold ${held.side === "yes" ? "text-lime" : "text-coral"}`}
                  >
                    {held.side.toUpperCase()} at {held.odds.toFixed(2)}x
                  </span>
                </span>
                <span className="tabular text-text-muted">
                  0:{held.secondsLeft.toString().padStart(2, "0")} · Bet
                </span>
              </button>
            )}
            {paused ? (
              <p className="mt-3 text-center text-[12px] text-gold">
                Big moment coming — betting pauses for a few seconds.
              </p>
            ) : (
              yesOdds === null &&
              noOdds === null && (
                <p className="mt-3 text-center text-[12px] text-text-faint">Waiting for prices…</p>
              )
            )}
          </>
        )}
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
      className={`rounded-2xl border ${border} ${bg} py-4 text-center md:py-6 transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <div className={`text-[12px] font-bold tracking-wider ${text}`}>{label}</div>
      <div className={`font-display text-3xl md:text-4xl ${text}`}>
        {odds ? `${odds.toFixed(2)}x` : "—"}
      </div>
    </button>
  );
}
