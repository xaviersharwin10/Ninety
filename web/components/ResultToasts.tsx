"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { useAccount } from "@/lib/account-context";
import type { BetResult } from "@/lib/account-engine";
import { resultText } from "@/lib/result-text";

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
          <Toast key={r.id} result={r} dismiss={dismissResult} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Toast({ result, dismiss }: { result: BetResult; dismiss: (id: string) => void }) {
  const onDone = () => dismiss(result.id);
  useEffect(() => {
    const t = setTimeout(() => dismiss(result.id), SHOW_MS);
    return () => clearTimeout(t);
  }, [dismiss, result.id]);

  const { title, detail } = resultText(result);
  const tone = TONE[result.outcome];
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

const TONE: Record<BetResult["outcome"], string> = {
  Won: "glow-lime border-lime/30",
  Voided: "border-gold/30",
  CashedOut: "glow-lime border-lime/30",
  Lost: "border-border",
};
