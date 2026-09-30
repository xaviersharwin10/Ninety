"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatNusd } from "@/hooks/useBalances";
import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import { type BetPreview, freshQuotes, previewBet } from "@/lib/bet-preview";
import { BET_ROUTER, BetRouterAbi } from "@/lib/contracts";
import { ensureAllowance } from "@/lib/erc20";
import type { SignedQuote } from "@/lib/quote-relay";
import { revertErrorName, sendTx, TxRevertedError } from "@/lib/tx";

/** The book moved, or dried up, between the tap and the send. Nothing was sent. */
class PriceMovedError extends Error {}

/** How long to wait for agents' next round of quotes when none on hand would outlive the trip. */
const FRESH_QUOTE_WAIT_MS = 4000;

/**
 * The bet re-priced from quotes that will still be valid when it lands. Agents re-quote every few
 * seconds, so if every quote on hand is about to expire, the next round is at most a moment away.
 */
async function freshFills(
  current: () => SignedQuote[],
  side: "yes" | "no",
  shown: BetPreview,
): Promise<BetPreview> {
  const deadline = Date.now() + FRESH_QUOTE_WAIT_MS;
  for (;;) {
    const fills = previewBet(freshQuotes(current()), side, shown.requestedStake);
    // Never stake more than the fan agreed to, and never quietly stake less.
    if (fills.fillableStake === shown.fillableStake) return fills;
    if (Date.now() > deadline) throw new PriceMovedError();
    await new Promise((r) => setTimeout(r, 250));
  }
}

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

/**
 * What the fan reads when a bet doesn't go through. Every case below reverts before the stake is
 * pulled, so each can honestly say nothing was charged. Raw viem errors (addresses, calldata, ABI
 * dumps) never reach the screen.
 */
function betErrorMessage(err: unknown): string {
  const nothingCharged = "Nothing was charged.";
  if (err instanceof PriceMovedError) {
    return `The price moved before your bet went out. ${nothingCharged} Try again.`;
  }
  if (err instanceof TxRevertedError) {
    return `Your bet didn't go through -- the market may have just closed. ${nothingCharged}`;
  }
  {
    switch (revertErrorName(err)) {
      case "QuoteExpired":
      case "QuoteOverfilled":
      case "PayoutBelowMinimum":
      case "FillsNotBestPriceFirst":
        return `The price moved before your bet landed. ${nothingCharged} Try again.`;
      case "MarketNotBettable":
        return `This market just closed. ${nothingCharged}`;
      case "InsufficientFreeCapital":
      case "MarketExposureExceeded":
        return `Not enough liquidity for that stake right now -- try a smaller amount. ${nothingCharged}`;
    }
  }
  return `The bet couldn't be placed. ${nothingCharged}`;
}

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
      const sideEnum = side === "yes" ? 0 : 1;
      const shown = preview;

      // Normally a no-op: only if setup couldn't approve does this bet approve first.
      await ensureAllowance(session.account, BET_ROUTER, shown.fillableStake);

      // Only a mined, successful transaction is a placed bet. Showing "Bet placed" on submission
      // meant a bet that reverted (a quote expiring or the market closing mid-flight, easy at replay
      // speed) still looked placed, and simply never appeared in My Bets.
      const receipt = await sendTx(session.account, async (wallet) => {
        // Priced here, after any gas top-up and queued write, from quotes that will outlive the
        // trip -- the prices on screen when the fan tapped may be seconds from expiring by now.
        const fills = await freshFills(() => latestQuotes.current, side, shown);
        // A tight but real buffer against the price the fan saw: 1% absorbs normal repricing and
        // still means something. The contract enforces it too; checking here costs no gas.
        const minPayout = (shown.totalPayout * 99n) / 100n;
        if (fills.totalPayout < minPayout) throw new PriceMovedError();
        return wallet.writeContract({
          address: BET_ROUTER,
          abi: BetRouterAbi,
          functionName: "placeBet",
          args: [
            BigInt(marketId),
            sideEnum,
            fills.fillableStake,
            minPayout,
            fills.fills
              .filter((f) => f.stake > 0n)
              .map((f) => ({ quote: f.quote.quote, signature: f.quote.signature })),
          ],
        });
      });
      // From here the account pays the result into the balance on its own.
      engine?.trackPlaced(receipt);
      setTxHash(receipt.transactionHash);
      setState("confirmed");

      onPlaced();
    } catch (err) {
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
                <span className="text-text-muted">Blended odds</span>
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
                No agent is quoting this side right now.
              </p>
            )}
            {!noLiquidity && partiallyFillable && (
              <p className="mt-3 text-center text-[12px] text-gold">
                Only {formatNusd(preview.fillableStake)} nUSD of liquidity available at this price.
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
