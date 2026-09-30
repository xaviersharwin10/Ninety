"use client";

import { BottomNav } from "@/components/BottomNav";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { formatNusd } from "@/hooks/useBalances";
import { useMyBets } from "@/hooks/useMyBets";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAccount } from "@/lib/account-context";
import { type BetGroup, groupBets } from "@/lib/bet-groups";
import { TEMPLATE_QUESTION } from "@/lib/templates";

const STATUS_STYLE: Record<BetGroup["status"], string> = {
  Open: "text-text-muted",
  Won: "text-lime",
  Lost: "text-text-faint",
  Voided: "text-gold",
  CashedOut: "text-lime",
};

const STATUS_LABEL: Record<BetGroup["status"], string> = {
  Open: "Live",
  Won: "Won",
  Lost: "Lost",
  Voided: "Refunded",
  CashedOut: "Cashed out",
};

export default function BetsPage() {
  const { address } = useRequireAuth();
  const { bets, loading } = useMyBets(address);
  // Winnings are collected by the account on its own (lib/account-engine.ts); this page only says so.
  const { engine, state } = useAccount();
  const collecting = state?.collecting ?? 0n;

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <h1 className="px-5 font-display text-2xl md:text-4xl">My Bets</h1>

      {collecting > 0n && (
        <div className="glow-lime mx-5 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-lime/25 bg-lime/8 px-4 py-3">
          <div>
            <p className="text-[13px] font-semibold text-text">You won!</p>
            <p className="tabular text-[12px] text-lime">
              {state?.collectError ?? `Paying ${formatNusd(collecting)} nUSD into your balance…`}
            </p>
          </div>
          {state?.collectError && (
            <Button
              variant="primary"
              className="px-4 py-2 text-[13px]"
              onClick={() => engine?.collectNow()}
            >
              Retry now
            </Button>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-1 flex-col px-5">
        {!loading && bets.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center">
            <p className="text-[14px] font-semibold text-text">No bets yet</p>
            <p className="mt-1 text-[12px] text-text-muted">
              Bets you place show up here, on any device.
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] md:gap-3">
          {loading && (
            <>
              <div className="shimmer h-[70px] rounded-2xl" />
              <div className="shimmer h-[70px] rounded-2xl" />
            </>
          )}
          {groupBets(bets).map((group) => (
            <BetRow key={group.marketId} group={group} />
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}

function BetRow({ group }: { group: BetGroup }) {
  const cashedOut = group.side === null;
  const status: keyof typeof STATUS_LABEL = cashedOut ? "CashedOut" : group.status;
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[11px] text-text-muted">
        {group.template ? TEMPLATE_QUESTION[group.template] : "Market"}
      </p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {cashedOut ? (
              <span className="text-[12px] font-bold text-lime">CASHED OUT</span>
            ) : (
              <>
                <span
                  className={`text-[12px] font-bold ${group.side === "Yes" ? "text-lime" : "text-coral"}`}
                >
                  {group.side!.toUpperCase()}
                </span>
                <span className="tabular text-[11px] text-text-faint">
                  {group.odds.toFixed(2)}x
                </span>
              </>
            )}
          </div>
          <p className="tabular mt-1 text-[13px] font-semibold">
            {formatNusd(group.stake)} nUSD staked
          </p>
        </div>
        <div className="text-right">
          <p className={`text-[12px] font-semibold ${STATUS_STYLE[status]}`}>
            {group.status === "Open" && cashedOut ? "Settling" : STATUS_LABEL[status]}
          </p>
          {group.status === "Open" ? (
            <p className="tabular text-[12px] text-text-muted">
              {cashedOut ? "gets" : "pays"} {formatNusd(group.payout)}
            </p>
          ) : (
            group.received > 0n && (
              <p className="tabular text-[13px] font-semibold text-lime">
                +{formatNusd(group.received)} nUSD
              </p>
            )
          )}
        </div>
      </div>
    </div>
  );
}
