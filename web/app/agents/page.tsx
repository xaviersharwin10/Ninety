"use client";

import Link from "next/link";
import { useState } from "react";
import { BottomNav } from "@/components/BottomNav";
import { PnlChart } from "@/components/PnlChart";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { VaultSheet } from "@/components/VaultSheet";
import { type AgentStats, marginKept, useAgentStats, winRate } from "@/hooks/useAgentStats";
import {
  type AgentSummary,
  agentDisplayName,
  inceptionReturnBps,
  useAgents,
} from "@/hooks/useAgents";
import { formatNusd } from "@/hooks/useBalances";
import { useRequireAuth } from "@/hooks/useRequireAuth";

export default function AgentsPage() {
  useRequireAuth();
  const { agents, loading, error, refresh } = useAgents();
  const { stats } = useAgentStats();
  const [selected, setSelected] = useState<AgentSummary | null>(null);

  // Only agents that can take bets: a disabled one can't be bet against (BetRouter refuses its
  // quotes) and is no longer on offer to back. Its operator still sees it on the Dev page.
  const listed = agents?.filter((a) => a.enabled) ?? null;
  const totalTvl = listed?.reduce((sum, a) => sum + a.totalAssets, 0n) ?? 0n;
  const all = (listed ?? []).flatMap((a) => {
    const s = stats?.get(a.agentId);
    return s ? [s] : [];
  });
  const totalVolume = all.reduce((sum, s) => sum + s.volume, 0n);
  const totalPnl = all.reduce((sum, s) => sum + s.realizedPnl, 0n);
  const totalBets = all.reduce((sum, s) => sum + s.betsWon + s.betsLost + s.betsVoided, 0);

  // Ranked by what each agent has actually earned, the number a backer cares about. Until the
  // indexer answers (or if it can't be reached), fall back to TVL from the chain.
  const ranked = listed
    ? [...listed].sort((a, b) => {
        const pa = stats?.get(a.agentId)?.realizedPnl ?? 0n;
        const pb = stats?.get(b.agentId)?.realizedPnl ?? 0n;
        if (pa !== pb) return pa > pb ? -1 : 1;
        return a.totalAssets === b.totalAssets ? 0 : a.totalAssets > b.totalAssets ? -1 : 1;
      })
    : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <h1 className="px-5 font-display text-2xl md:text-4xl">Agents</h1>
      <p className="mt-1 px-5 text-[12px] text-text-muted md:max-w-md">
        Every market's odds are set by these agents competing on price. Back one and share its
        margin.
      </p>
      <Link href="/dev" className="mx-5 mt-2 block text-[12px] text-violet underline">
        Build your own agent →
      </Link>

      {!loading && agents && agents.length > 0 && (
        <div className="mx-5 mt-4 grid grid-cols-2 gap-2 md:max-w-3xl md:grid-cols-4">
          <Stat label="Total value locked" value={`${formatNusd(totalTvl)} nUSD`} accent />
          <Stat label="Earned by agents" value={stats ? signedNusd(totalPnl) : "—"} />
          <Stat label="Volume priced" value={stats ? `${formatNusd(totalVolume)} nUSD` : "—"} />
          <Stat label="Bets settled" value={stats ? totalBets.toLocaleString() : "—"} />
        </div>
      )}

      <div className="mt-3 flex flex-1 flex-col px-5">
        {!loading && error && (
          <div className="glass rounded-2xl p-8 text-center">
            <p className="text-[14px] font-semibold text-coral">Couldn't load agents</p>
            <p className="mt-1 text-[12px] text-text-muted">{error}</p>
            <Button variant="secondary" className="mt-4 px-4 py-2 text-[13px]" onClick={refresh}>
              Retry
            </Button>
          </div>
        )}
        {!loading && !error && agents?.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center">
            <p className="text-[14px] font-semibold text-text">No agents registered yet</p>
            <p className="mt-1 text-[12px] text-text-muted">
              Check back once house agents are live.
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] md:gap-4">
          {loading && (
            <>
              <div className="shimmer h-[104px] rounded-2xl" />
              <div className="shimmer h-[104px] rounded-2xl" />
              <div className="shimmer h-[104px] rounded-2xl" />
            </>
          )}
          {ranked?.map((agent, i) => (
            <AgentCard
              key={agent.agentId}
              rank={i + 1}
              agent={agent}
              stats={stats?.get(agent.agentId)}
              onSelect={() => setSelected(agent)}
            />
          ))}
        </div>
      </div>

      <BottomNav />

      {selected && (
        <VaultSheet
          agent={selected}
          stats={stats?.get(selected.agentId)}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function signedNusd(units: bigint): string {
  return `${units >= 0n ? "+" : "−"}${formatNusd(units >= 0n ? units : -units)} nUSD`;
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="glass rounded-2xl px-4 py-3">
      <p className="text-[11px] text-text-muted">{label}</p>
      <p className={`tabular mt-0.5 font-display text-lg ${accent ? "text-lime" : "text-text"}`}>
        {value}
      </p>
    </div>
  );
}

function AgentCard({
  rank,
  agent,
  stats,
  onSelect,
}: {
  rank: number;
  agent: AgentSummary;
  stats: AgentStats | undefined;
  onSelect: () => void;
}) {
  const name = agentDisplayName(agent.metadataURI);
  const style = agent.metadataURI.split(" — ")[1] ?? "";
  const returnBps = inceptionReturnBps(agent.pricePerShare);
  const utilizationBps =
    agent.totalAssets > 0n ? Number((agent.lockedLiability * 10_000n) / agent.totalAssets) : 0;
  const rate = stats ? winRate(stats) : null;
  const kept = stats ? marginKept(stats) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!agent.enabled}
      className="glass flex flex-col gap-3 rounded-2xl p-4 text-left transition-transform active:scale-[0.99] disabled:opacity-50"
    >
      <div className="flex w-full items-center gap-3">
        <div className="glow-lime flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lime text-[13px] font-bold text-[#06070a]">
          #{rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-lg">{name}</p>
            {stats ? (
              <p
                className={`tabular text-[14px] font-semibold ${stats.realizedPnl >= 0n ? "text-lime" : "text-coral"}`}
              >
                {signedNusd(stats.realizedPnl)}
              </p>
            ) : (
              <p
                className={`tabular text-[13px] font-semibold ${returnBps >= 0 ? "text-lime" : "text-coral"}`}
              >
                {returnBps >= 0 ? "+" : ""}
                {(returnBps / 100).toFixed(2)}%
              </p>
            )}
          </div>
          <p className="truncate text-[11px] text-text-faint">{style || "House agent"}</p>
        </div>
      </div>

      {stats && <PnlChart series={stats.pnlSeries} height={36} />}

      <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4">
        <Metric label="TVL" value={`${formatNusd(agent.totalAssets)}`} />
        <Metric label="At risk" value={`${(utilizationBps / 100).toFixed(0)}%`} />
        <Metric label="Volume" value={stats ? formatNusd(stats.volume) : "—"} />
        <Metric
          label="Kept"
          value={kept === null ? "—" : `${(kept * 100).toFixed(1)}%`}
          title="Share of volume the agent kept after paying winners"
        />
        <Metric label="Win rate" value={rate === null ? "—" : `${Math.round(rate * 100)}%`} />
        <Metric
          label="Drawdown"
          value={stats ? formatNusd(stats.maxDrawdown) : "—"}
          title="Largest fall from a P&L peak, in nUSD"
        />
        <Metric label="Vault return" value={`${(returnBps / 100).toFixed(2)}%`} />
        <Metric
          label="Hold fees"
          value={stats ? formatNusd(stats.holdFees) : "—"}
          title={
            stats
              ? `Earned holding prices for fans (Odds Lock): ${stats.holdsSold} sold, paid straight into the vault`
              : undefined
          }
        />
      </div>
      {!agent.enabled && <p className="text-[11px] text-coral">Disabled</p>}
    </button>
  );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block" title={title}>
      <p className="text-text-faint">{label}</p>
      <p className="tabular font-semibold text-text">{value}</p>
    </div>
  );
}
