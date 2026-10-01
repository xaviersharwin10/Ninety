"use client";

import { isTemplateInDanger } from "@ninety/core";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatNusd } from "@/hooks/useBalances";
import { useMarketQuotes } from "@/hooks/useMarketQuotes";
import { useAccount } from "@/lib/account-context";
import type { Position, PositionSide } from "@/lib/account-engine";
import { useAuth } from "@/lib/auth-context";
import { cashOutOffer } from "@/lib/cash-out";
import { PriceMovedError, placeBet } from "@/lib/place-bet";
import { TEMPLATE_QUESTION } from "@/lib/templates";

/**
 * The fan's open bets, with a live cash-out on each while its market is still open. Everything
 * here is about their own money, in their words: what they backed, what it pays, what they can
 * take now. See lib/cash-out.ts for how a cash-out is made.
 */
export function YourBets({
  liveMarketIds,
  danger,
}: {
  /** Markets still open for betting -- the only ones that can be cashed out. */
  liveMarketIds: Set<string>;
  /** Event types in danger right now: their markets are paused, and so is cashing out. */
  danger: string[];
}) {
  const { state } = useAccount();
  const positions = state?.positions ?? [];
  if (positions.length === 0) return null;

  return (
    <div className="mx-5 mt-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Your bets</p>
      <div className="mt-2 flex flex-col gap-2">
        {positions.map((p) => (
          <PositionRow
            key={p.marketId}
            position={p}
            live={liveMarketIds.has(p.marketId)}
            paused={!!p.template && isTemplateInDanger(p.template, danger as never)}
          />
        ))}
      </div>
    </div>
  );
}

function PositionRow({
  position,
  live,
  paused,
}: {
  position: Position;
  live: boolean;
  paused: boolean;
}) {
  const question = position.template ? TEMPLATE_QUESTION[position.template] : "Your bet";
  const { yes, no } = position;

  // Both sides held: cashed out. They get the smaller payout whichever way it goes.
  if (yes && no) {
    const locked = yes.payout < no.payout ? yes.payout : no.payout;
    return (
      <Row question={question}>
        <p className="text-[13px] text-text">
          Cashed out · <span className="tabular font-semibold text-lime">{formatNusd(locked)}</span>{" "}
          nUSD
        </p>
        <p className="mt-0.5 text-[11px] text-text-faint">Paid when this market settles</p>
      </Row>
    );
  }

  const side: "yes" | "no" = yes ? "yes" : "no";
  const held = (yes ?? no) as PositionSide;
  return (
    <Row question={question}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-text">
          <span className={`font-bold ${side === "yes" ? "text-lime" : "text-coral"}`}>
            {side.toUpperCase()}
          </span>{" "}
          · <span className="tabular">{formatNusd(held.stake)}</span> staked · pays{" "}
          <span className="tabular font-semibold">{formatNusd(held.payout)}</span>
        </p>
        {!live && <span className="shrink-0 text-[11px] text-text-faint">Result coming up</span>}
      </div>
      {live && <CashOut marketId={position.marketId} side={side} held={held} paused={paused} />}
    </Row>
  );
}

function Row({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl px-4 py-3">
      <p className="text-[11px] text-text-muted">{question}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CashOut({
  marketId,
  side,
  held,
  paused,
}: {
  marketId: string;
  side: "yes" | "no";
  held: PositionSide;
  paused: boolean;
}) {
  const { session } = useAuth();
  const { engine } = useAccount();
  const book = useMarketQuotes(marketId);
  const other = side === "yes" ? "no" : "yes";
  const opposite = other === "yes" ? book.yes : book.no;
  const latest = useRef(opposite);
  useEffect(() => {
    latest.current = opposite;
  }, [opposite]);

  // Re-priced on every render: as quotes arrive, and each second as the ones on hand age.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const offer = cashOutOffer(held, side, opposite);

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cashOut() {
    if (!session || !offer) return;
    setBusy(true);
    setError(null);
    try {
      await engine?.whenReady();
      const receipt = await placeBet({
        account: session.account,
        marketId,
        side: other,
        stake: offer.coverStake,
        // The cover must pay (all but a sliver of) what the bet would, or it isn't a cash-out.
        minPayout: (held.payout * 995n) / 1000n,
        quotes: () => latest.current,
      });
      // The account now sees both sides and shows this as cashed out.
      engine?.trackPlaced(receipt);
      setConfirming(false);
    } catch (err) {
      setError(
        err instanceof PriceMovedError
          ? "The price moved before it went through. Nothing was charged."
          : "Couldn't cash out — the market may have just closed. Nothing was charged.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (paused) {
    return <p className="mt-2 text-[11px] text-gold">Cash out paused — big moment coming</p>;
  }
  if (!offer) {
    return <p className="mt-2 text-[11px] text-text-faint">Cash out isn't available right now</p>;
  }
  return (
    <div className="mt-2">
      {confirming ? (
        <div className="rounded-xl bg-white/[0.04] p-3">
          <p className="text-[12px] text-text">
            Get <span className="tabular font-semibold text-lime">{formatNusd(offer.value)}</span>{" "}
            nUSD whatever happens? It's paid when this market settles.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              className="flex-1 py-2 text-[12px]"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Keep bet
            </Button>
            <Button
              variant="primary"
              className="flex-1 py-2 text-[12px]"
              loading={busy}
              onClick={cashOut}
            >
              Cash out
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          fullWidth
          className="py-2 text-[12px]"
          onClick={() => setConfirming(true)}
        >
          Cash out <span className="tabular ml-1 font-semibold">{formatNusd(offer.value)}</span>{" "}
          nUSD
        </Button>
      )}
      {error && <p className="mt-1.5 text-[11px] text-coral">{error}</p>}
    </div>
  );
}
