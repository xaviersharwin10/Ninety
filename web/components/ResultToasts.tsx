"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { formatNusd } from "@/hooks/useBalances";
import { useAccount } from "@/lib/account-context";
import type { BetResult } from "@/lib/account-engine";

const SHOW_MS = 7000;

/**
 * A bet's result, wherever the fan is in the app -- usually still watching the match. Winnings are
 * already in the balance by the time this shows; there is nothing to collect.
 */
export function ResultToasts() {
  const { results, dismissResult } = useAccount();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-40 flex flex-col items-center gap-2 px-4 md:left-auto md:right-6 md:top-6 md:w-[360px] md:px-0">
      <AnimatePresence>
        {results.slice(-3).map((r) => (
          <Toast key={r.betId} result={r} dismiss={dismissResult} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Toast({ result, dismiss }: { result: BetResult; dismiss: (betId: string) => void }) {
  const onDone = () => dismiss(result.betId);
  useEffect(() => {
    const t = setTimeout(() => dismiss(result.betId), SHOW_MS);
    return () => clearTimeout(t);
  }, [dismiss, result.betId]);

  const { title, detail, tone } = describe(result);
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: -16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12 }}
      onClick={onDone}
      className={`glass pointer-events-auto w-full max-w-[440px] rounded-2xl border px-4 py-3 text-left ${tone}`}
    >
      <p className="text-[14px] font-semibold text-text">{title}</p>
      <p className="mt-0.5 text-[12px] text-text-muted">
        {result.question ? `${result.question} · ` : ""}
        {detail}
      </p>
    </motion.button>
  );
}

function describe(r: BetResult) {
  switch (r.outcome) {
    case "Won":
      return {
        title: `You won ${formatNusd(r.amount)} nUSD`,
        detail: "Added to your balance",
        tone: "glow-lime border-lime/30",
      };
    case "Voided":
      return {
        title: `${formatNusd(r.amount)} nUSD refunded`,
        detail: "This bet didn't count, so your stake is back",
        tone: "border-gold/30",
      };
    case "Lost":
      return {
        title: "Not this time",
        detail: `${formatNusd(r.stake)} nUSD stake`,
        tone: "border-border",
      };
  }
}
