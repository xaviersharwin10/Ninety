"use client";

import { lockFeeFor, payoutFor } from "@ninety/core";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatNusd } from "@/hooks/useBalances";
import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import { previewBet } from "@/lib/bet-preview";
import { betHeld, buyHold, heldOdds, holdErrorMessage, holdSecondsLeft } from "@/lib/odds-lock";
import { betErrorMessage, placeBet } from "@/lib/place-bet";
import type { SignedLockOffer, SignedQuote } from "@/lib/quote-relay";

const STAKE_PRESETS = [5_000_000n, 10_000_000n, 25_000_000n, 50_000_000n]; // 5 / 10 / 25 / 50 nUSD

interface BetSlipProps {
  marketId: string;
  question: string;
  side: "yes" | "no";
  quotes: SignedQuote[];
  /** The best offer to hold this side's price, if one is on sale. */
  holdOffer: SignedLockOffer | null;
  /** A big moment has paused the market, and with it any held price. */
  paused: boolean;
  onClose: () => void;
  onPlaced: () => void;
}

type SubmitState = "idle" | "submitting" | "holding" | "confirmed" | "error";

export function BetSlip({
  marketId,
  question,
  side,
  quotes,
  holdOffer,
  paused,
  onClose,
  onPlaced,
}: BetSlipProps) {
  const { session } = useAuth();
  const { engine, holds, addHold, endHold } = useAccount();
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
  const latestOffer = useRef(holdOffer);
  useEffect(() => {
    latestOffer.current = holdOffer;
  }, [holdOffer]);

  // A price this fan is holding on this side, while it lasts.
  const [, setTick] = useState(0);
  const hold = holds.get(marketId);
  const held = hold && hold.side === side && holdSecondsLeft(hold) > 0 ? hold : null;
  useEffect(() => {
    if (!held) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [held]);
  const [placedStake, setPlacedStake] = useState<bigint | null>(null);

  const tappable = holdOffer && holdOffer.offer.maxStake >= stake ? holdOffer : null;
  const offer = tappable?.offer ?? null;
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
      setPlacedStake(preview.fillableStake);
      setState("confirmed");

      onPlaced();
    } catch (err) {
      console.warn("bet failed:", err);
      setErrorMessage(betErrorMessage(err));
      setState("error");
    }
  }

  async function holdPrice() {
    if (!session || !tappable) return;
    const shown = tappable;
    setState("holding");
    setErrorMessage(null);
    try {
      await engine?.whenReady();
      addHold(
        await buyHold({
          account: session.account,
          marketId,
          side,
          stake,
          shown,
          offer: () => latestOffer.current,
        }),
      );
      setState("idle");
    } catch (err) {
      console.warn("hold failed:", err);
      setErrorMessage(holdErrorMessage(err));
      setState("error");
    }
  }

  async function betAtHeldPrice() {
    if (!session || !held) return;
    setState("submitting");
    setErrorMessage(null);
    try {
      const receipt = await betHeld(session.account, held);
      engine?.trackPlaced(receipt);
      endHold(marketId);
      setTxHash(receipt.transactionHash);
      setPlacedStake(held.stake);
      setState("confirmed");
      onPlaced();
    } catch (err) {
      console.warn("held bet failed:", err);
      setErrorMessage(holdErrorMessage(err));
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
              {formatNusd(placedStake ?? preview.fillableStake)} nUSD on{" "}
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
        ) : held ? (
          <HeldPrice
            question={question}
            side={side}
            stake={held.stake}
            probBps={held.probBps}
            secondsLeft={holdSecondsLeft(held)}
            paused={paused}
            busy={state === "submitting"}
            errorMessage={errorMessage}
            onBet={betAtHeldPrice}
            onClose={onClose}
          />
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
            {offer && !paused && (
              <button
                type="button"
                onClick={holdPrice}
                disabled={state === "holding" || state === "submitting"}
                className="mt-3 w-full text-center text-[12px] text-text-muted transition-colors hover:text-text disabled:opacity-50"
              >
                {state === "holding" ? (
                  "Holding your price…"
                ) : (
                  <>
                    Not sure yet? Hold{" "}
                    <span className={`tabular font-semibold ${accentColor}`}>
                      {heldOdds(offer.probBps).toFixed(2)}x
                    </span>{" "}
                    for {offer.holdSeconds}s ·{" "}
                    <span className="tabular">{formatNusd(lockFeeFor(stake, offer.feeBps))}</span>{" "}
                    nUSD
                  </>
                )}
              </button>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

/** A price the fan is holding: theirs to bet, whatever the market does, until the hold runs out. */
function HeldPrice({
  question,
  side,
  stake,
  probBps,
  secondsLeft,
  paused,
  busy,
  errorMessage,
  onBet,
  onClose,
}: {
  question: string;
  side: "yes" | "no";
  stake: bigint;
  probBps: number;
  secondsLeft: number;
  paused: boolean;
  busy: boolean;
  errorMessage: string | null;
  onBet: () => void;
  onClose: () => void;
}) {
  const accentColor = side === "yes" ? "text-lime" : "text-coral";
  const odds = heldOdds(probBps).toFixed(2);
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[12px] text-text-muted">{question}</p>
          <p className={`font-display text-2xl ${accentColor}`}>
            {side.toUpperCase()} at {odds}x
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-text-faint" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-text-muted">Your price is held for</span>
          <span className="tabular font-semibold">0:{secondsLeft.toString().padStart(2, "0")}</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[15px]">
          <span className="font-semibold text-text">{formatNusd(stake)} nUSD pays if you win</span>
          <span className={`tabular font-display text-lg ${accentColor}`}>
            {formatNusd(payoutFor(stake, BigInt(probBps)))} nUSD
          </span>
        </div>
      </div>
      {paused && (
        <p className="mt-3 text-center text-[12px] text-gold">
          Big moment coming — your price is back in a few seconds.
        </p>
      )}
      {errorMessage && <p className="mt-3 text-center text-[12px] text-coral">{errorMessage}</p>}
      <Button
        variant="primary"
        fullWidth
        className="mt-4"
        loading={busy}
        disabled={paused}
        onClick={onBet}
      >
        Bet {formatNusd(stake)} nUSD at {odds}x
      </Button>
      <Button variant="secondary" fullWidth className="mt-2" disabled={busy} onClick={onClose}>
        Keep watching
      </Button>
    </>
  );
}
