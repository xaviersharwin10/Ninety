"use client";

import { useState } from "react";
import { BottomNav } from "@/components/BottomNav";
import { TopBar } from "@/components/TopBar";
import { VaultSheet } from "@/components/VaultSheet";
import {
  type AgentSummary,
  agentDisplayName,
  inceptionReturnBps,
  useAgents,
} from "@/hooks/useAgents";
import { formatAusd } from "@/hooks/useBalances";
import { useRequireAuth } from "@/hooks/useRequireAuth";

export default function AgentsPage() {
  useRequireAuth();
  const { agents, loading, refresh } = useAgents();
  const [selected, setSelected] = useState<AgentSummary | null>(null);

  const totalTvl = agents?.reduce((sum, a) => sum + a.totalAssets, 0n) ?? 0n;

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <h1 className="px-5 font-display text-2xl">Agents</h1>
      <p className="mt-1 px-5 text-[12px] text-text-muted">
        Every market's odds are set by these agents competing on price. Back one and share its
        margin.
      </p>

      {!loading && agents && agents.length > 0 && (
        <div className="glass mx-5 mt-4 flex items-center justify-between rounded-2xl px-4 py-3">
          <span className="text-[12px] text-text-muted">Total value locked</span>
          <span className="tabular font-display text-lg text-lime">
            {formatAusd(totalTvl)} AUSD
          </span>
        </div>
      )}

      <div className="mt-3 flex flex-1 flex-col gap-2.5 px-5">
        {loading && (
          <>
            <div className="shimmer h-[104px] rounded-2xl" />
            <div className="shimmer h-[104px] rounded-2xl" />
            <div className="shimmer h-[104px] rounded-2xl" />
          </>
        )}
        {!loading && agents?.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center">
            <p className="text-[14px] font-semibold text-text">No agents registered yet</p>
            <p className="mt-1 text-[12px] text-text-muted">
              Check back once house agents are live.
            </p>
          </div>
        )}
        {agents?.map((agent, i) => (
          <AgentCard
            key={agent.agentId}
            rank={i + 1}
            agent={agent}
            onSelect={() => setSelected(agent)}
          />
        ))}
      </div>

      <BottomNav />

      {selected && (
        <VaultSheet agent={selected} onClose={() => setSelected(null)} onChanged={refresh} />
      )}
    </div>
  );
}

function AgentCard({
  rank,
  agent,
  onSelect,
}: {
  rank: number;
  agent: AgentSummary;
  onSelect: () => void;
}) {
  const name = agentDisplayName(agent.metadataURI);
  const style = agent.metadataURI.split(" — ")[1] ?? "";
  const returnBps = inceptionReturnBps(agent.pricePerShare);
  const utilizationBps =
    agent.totalAssets > 0n ? Number((agent.lockedLiability * 10_000n) / agent.totalAssets) : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!agent.enabled}
      className="glass flex items-center gap-3 rounded-2xl p-4 text-left transition-transform active:scale-[0.99] disabled:opacity-50"
    >
      <div className="glow-lime flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lime text-[13px] font-bold text-[#06070a]">
        #{rank}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg">{name}</p>
          <p
            className={`tabular text-[13px] font-semibold ${returnBps >= 0 ? "text-lime" : "text-coral"}`}
          >
            {returnBps >= 0 ? "+" : ""}
            {(returnBps / 100).toFixed(2)}%
          </p>
        </div>
        <p className="truncate text-[11px] text-text-faint">{style || "House agent"}</p>
        <div className="mt-2 flex items-center justify-between">
          <p className="tabular text-[13px] font-semibold text-text">
            {formatAusd(agent.totalAssets)}{" "}
            <span className="font-normal text-text-faint">AUSD TVL</span>
          </p>
          <p className="tabular text-[11px] text-text-faint">
            {(utilizationBps / 100).toFixed(0)}% at risk
          </p>
        </div>
        {!agent.enabled && <p className="mt-1 text-[11px] text-coral">Disabled</p>}
      </div>
    </button>
  );
}
