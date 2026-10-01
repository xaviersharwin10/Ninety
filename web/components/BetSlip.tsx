"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatNusd } from "@/hooks/useBalances";
import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import { previewBet } from "@/lib/bet-preview";
import { betErrorMessage, placeBet } from "@/lib/place-bet";
import type { SignedQuote } from "@/lib/quote-relay";

const STAKE_PRESETS = [5_000_000n, 10_000_000n, 25_000_000n, 50_000_000n]; // 5 / 10 / 25 / 50 nUSD

interface BetSlipProps {
  marketId: string;
  question: string;
  side: "yes" | "no";
  quotes: SignedQuote[];
  onClose: () => void;
  onPlaced: () => void;
}

type SubmitState = "idle" | "submitting" | "confirmed" | "error";

export function BetSlip({ marketId, question, side, quotes, onClose, onPlaced }: BetSlipProps) {
  const { session } = useAuth();
  const { engine } = useAccount();
  const [stake, setStake] = useState(10_000_000n);
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const preview = useMemo(() => previewBet(quotes, side, stake), [quotes, side, stake]);
  // The live book, for pricing the bet at the moment it's sent rather than when it was tapped.
  const latestQuotes = useRef(quotes);
  useEffect(() => {
    latestQuotes.current = quotes;
  }, [quotes]);
  const noLiquidity = quotes.length === 0;
  const partiallyFillable = preview.fillableStake > 0n && preview.fillableStake < stake;

  async function confirm() {
    if (!session || preview.fillableStake === 0n) return;
    setState("submitting");
    setErrorMessage(null);
    try {
      // Setup grants the betting contract its allowance at sign-in; a fan who taps a price in the
      // first few seconds waits for it here rather than racing it with a second approval.
      await engine?.whenReady();
      // A tight but real buffer against the price the fan saw: 1% absorbs normal repricing and
      // still means something.
      const receipt = await placeBet({
        account: session.account,
        marketId,
        side,
        stake: preview.fillableStake,
        minPayout: (preview.totalPayout * 99n) / 100n,
        quotes: () => latestQuotes.current,
      });
      // From here the account pays the result into the balance on its own.
      engine?.trackPlaced(receipt);
      setTxHash(receipt.transactionHash);
      setState("confirmed");

      onPlaced();
    } catch (err) {
      console.warn("bet failed:", err);
      setErrorMessage(betErrorMessage(err));
      setState("error");
    }
  }

  const accentColor = side === "yes" ? "text-lime" : "text-coral";
  const accentBg = side === "yes" ? "bg-lime" : "bg-coral";

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 340 }}
        className="glass w-full max-w-[480px] rounded-t-[28px] p-6 pb-8"
      >
        {state === "confirmed" ? (
          <div className="py-6 text-center">
            <div className="glow-lime mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-lime text-2xl text-[#06070a]">
              ✓
            </div>
            <p className="mt-4 font-display text-xl">Bet placed</p>
            <p className="mt-1 text-[13px] text-text-muted">
              {formatNusd(preview.fillableStake)} nUSD on{" "}
              <span className={accentColor}>{side.toUpperCase()}</span>
            </p>
            <p className="mt-3 text-[12px] text-text-faint">
              If it wins, the payout goes straight to your balance.
            </p>
            {txHash && (
              <a
                href={`https://testnet.monadexplorer.com/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block text-[11px] text-violet underline"
              >
                View on explorer
              </a>
            )}
            <Button variant="secondary" fullWidth className="mt-6" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[12px] text-text-muted">{question}</p>
                <p className={`font-display text-2xl ${accentColor}`}>{side.toUpperCase()}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-text-faint"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="flex gap-2">
              {STAKE_PRESETS.map((amount) => (
                <button
                  type="button"
                  key={amount.toString()}
                  onClick={() => setStake(amount)}
                  className={`flex-1 rounded-xl border px-2 py-2.5 text-[13px] font-semibold transition-colors ${
                    stake === amount
                      ? `${accentBg} border-transparent text-[#06070a]`
                      : "border-border text-text-muted hover:border-border-strong"
                  }`}
                >
                  {formatNusd(amount)}
                </button>
              ))}
            </div>

            <div className="glass mt-4 rounded-2xl p-4">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-text-muted">Stake</span>
                <span className="tabular font-semibold">
                  {formatNusd(preview.fillableStake)} nUSD
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[13px]">
                <span className="text-text-muted">Odds</span>
                <span className="tabular font-semibold">{preview.blendedOdds.toFixed(2)}x</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[15px]">
                <span className="font-semibold text-text">Payout if you win</span>
                <span className={`tabular font-display text-lg ${accentColor}`}>
                  {formatNusd(preview.totalPayout)} nUSD
                </span>
              </div>
            </div>

            {noLiquidity && (
              <p className="mt-3 text-center text-[12px] text-coral">
                No price on this side right now. Try again in a moment.
              </p>
            )}
            {!noLiquidity && partiallyFillable && (
              <p className="mt-3 text-center text-[12px] text-gold">
                You can bet up to {formatNusd(preview.fillableStake)} nUSD at this price right now.
              </p>
            )}
            {errorMessage && (
              <p className="mt-3 text-center text-[12px] text-coral">{errorMessage}</p>
            )}

            <Button
              variant="primary"
              fullWidth
              className="mt-4"
              loading={state === "submitting"}
              disabled={preview.fillableStake === 0n}
              onClick={confirm}
            >
              Confirm bet
            </Button>
          </>
        )}
      </motion.div>
    </div>
  );
}
