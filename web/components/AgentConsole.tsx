"use client";

import { type AgentMemory, freshMemory, learn, TEMPLATE_NAMES } from "@ninety/core";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { VaultSheet } from "@/components/VaultSheet";
import type { AgentSummary } from "@/hooks/useAgents";
import { formatNusd } from "@/hooks/useBalances";
import { openAgentSigner } from "@/lib/agent-identity";
import {
  decryptMemory,
  encryptMemory,
  fetchMemoryStatus,
  fetchSettledBets,
  type StoredMemory,
} from "@/lib/agent-memory";
import { useAuth } from "@/lib/auth-context";
import { BrowserAgent, type BrowserAgentStatus } from "@/lib/browser-agent";
import { publicClient, walletClientFor } from "@/lib/chain";
import { AGENT_MEMORY, AGENT_REGISTRY, AgentMemoryAbi, AgentRegistryAbi } from "@/lib/contracts";
import { ensureGas } from "@/lib/gas";
import { isMeraError } from "@/lib/mera";
import type { AgentStrategy } from "@/lib/strategy-vault";
import { TEMPLATE_QUESTION } from "@/lib/templates";
import { confirmTx } from "@/lib/tx";

function friendly(err: unknown): string {
  if (isMeraError(err)) {
    if (err.code === "PASSKEY_OPERATION_FAILED")
      return "Passkey prompt was cancelled or timed out.";
    if (err.code === "DECRYPT_FAILED") return "This memory was sealed by a different passkey.";
    return err.message;
  }
  return err instanceof Error ? err.message.split("\n")[0]! : "Something went wrong.";
}

/**
 * Run an agent live from this tab, and manage its memory. Shown once the operator has revealed
 * the agent's strategy -- running needs it (the pricing parameters, and the slug its signing key
 * is derived under).
 */
export function AgentConsole({
  rpId,
  agent,
  strategy,
  onVaultChanged,
}: {
  rpId: string;
  agent: AgentSummary;
  strategy: AgentStrategy;
  onVaultChanged: () => void;
}) {
  const { session } = useAuth();
  const [stored, setStored] = useState<StoredMemory | null | undefined>(undefined);
  /** Saves the chain has recorded; ahead of `stored` while the indexer catches up. */
  const [chainVersion, setChainVersion] = useState(0);
  const [memory, setMemory] = useState<AgentMemory | null>(null);
  const [status, setStatus] = useState<BrowserAgentStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const runner = useRef<BrowserAgent | null>(null);

  // Poll until the indexer has caught up with every save the chain has recorded.
  const syncing = chainVersion > (stored?.version ?? 0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      try {
        const status = await fetchMemoryStatus(agent.agentId);
        if (cancelled) return;
        setChainVersion(status.chainVersion);
        setStored(status.stored);
        if (status.chainVersion > (status.stored?.version ?? 0)) timer = setTimeout(check, 5000);
      } catch {
        if (!cancelled) setStored((prev) => prev ?? null);
      }
    }
    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [agent.agentId]);

  // Leaving the page must not leave a signing key alive.
  useEffect(() => () => runner.current?.stop(), []);

  /** The memory to run with: the sealed one opened with the passkey, or a blank one. */
  async function openMemory(): Promise<AgentMemory> {
    if (memory) return memory;
    if (syncing) throw new Error("Its memory is still syncing -- try again in a few seconds.");
    if (!stored) {
      const blank = freshMemory(agent.agentId);
      setMemory(blank);
      return blank;
    }
    if (!stored.commitOk) throw new Error("Stored memory doesn't match its on-chain commitment.");
    const opened = await decryptMemory(rpId, stored.blob);
    setMemory(opened);
    return opened;
  }

  async function revealMemory() {
    setBusy("Opening memory with your passkey…");
    setError(null);
    try {
      await openMemory();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    if (!strategy.slug) return;
    setError(null);
    setSaved(null);
    try {
      setBusy("Opening memory…");
      const mem = await openMemory();
      setBusy("Unlocking the agent's signing key with your passkey…");
      const signer = await openAgentSigner(rpId, strategy.slug);
      const onChain = (await publicClient.readContract({
        address: AGENT_REGISTRY,
        abi: AgentRegistryAbi,
        functionName: "getAgent",
        args: [agent.agentId],
      })) as { quoteSigner: string };
      if (onChain.quoteSigner.toLowerCase() !== signer.address.toLowerCase()) {
        signer.end();
        throw new Error("This passkey doesn't derive this agent's registered signing key.");
      }
      runner.current = new BrowserAgent(
        agent.agentId,
        agent.vault,
        signer,
        strategy,
        mem,
        setStatus,
      );
      runner.current.start();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(null);
    }
  }

  /** Stops quoting, learns from the bets settled since the last save, and seals the result on chain. */
  async function stopAndRemember() {
    runner.current?.stop();
    runner.current = null;
    if (!session || !memory) return;
    setError(null);
    try {
      setBusy("Learning from settled bets…");
      const next = learn(memory, await fetchSettledBets(agent.agentId));
      if (next === memory) {
        setSaved("Nothing new to remember: no bets have settled since the last save.");
        return;
      }
      setBusy("Sealing memory with your passkey…");
      const blob = await encryptMemory(rpId, next);
      setBusy("Saving to Monad…");
      await ensureGas(session.address, "agent");
      const wallet = walletClientFor(session.account);
      const hash = await wallet.writeContract({
        address: AGENT_MEMORY,
        abi: AgentMemoryAbi,
        functionName: "save",
        args: [agent.agentId, blob],
      });
      await confirmTx(hash);
      setMemory(next);
      setStored({ version: chainVersion + 1, blob, commitOk: true });
      setChainVersion((v) => v + 1);
      setSaved(`Memory saved (session ${next.sessions}).`);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(null);
    }
  }

  const running = status?.running ?? false;

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-text-muted">
          Vault{" "}
          <span className="tabular font-semibold text-text">
            {formatNusd(agent.totalAssets)} nUSD
          </span>
        </span>
        <button type="button" onClick={() => setFunding(true)} className="text-violet underline">
          Fund
        </button>
      </div>

      {/* Memory */}
      <div className="rounded-xl bg-white/[0.03] p-3">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-semibold text-text">Memory</p>
          <p className="text-[11px] text-text-faint">
            {stored === undefined
              ? "…"
              : syncing
                ? `v${chainVersion} on chain · syncing…`
                : stored === null
                  ? "none saved yet"
                  : `v${stored.version} on chain ${stored.commitOk ? "✓" : "✗ mismatch"}`}
          </p>
        </div>
        {memory ? (
          <div className="mt-2 space-y-1.5 text-[11px]">
            <p className="text-text-faint">
              {memory.sessions} session{memory.sessions === 1 ? "" : "s"} learned from
            </p>
            <div className="tabular grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5">
              {TEMPLATE_NAMES.map((t) => (
                <div key={t} className="contents">
                  <span className="truncate text-text-muted">{TEMPLATE_QUESTION[t]}</span>
                  <span className="text-right text-text-faint">
                    {memory.templates[t].bets} bets
                  </span>
                  <span
                    className={`text-right font-semibold ${memory.templates[t].marginAdjBps > 0 ? "text-gold" : memory.templates[t].marginAdjBps < 0 ? "text-lime" : "text-text-faint"}`}
                  >
                    {memory.templates[t].marginAdjBps > 0 ? "+" : ""}
                    {memory.templates[t].marginAdjBps}bps
                  </span>
                </div>
              ))}
            </div>
            {memory.lessons.slice(0, 3).map((l) => (
              <p key={l} className="text-text-muted">
                {l}
              </p>
            ))}
          </div>
        ) : (
          stored &&
          !syncing && (
            <Button
              variant="secondary"
              className="mt-2 px-3 py-1.5 text-[12px]"
              disabled={!!busy}
              onClick={revealMemory}
            >
              Open memory
            </Button>
          )
        )}
      </div>

      {/* Run live */}
      {!strategy.slug ? (
        <p className="text-[11px] text-text-faint">
          Registered before live running existed: its signing key can't be re-derived. Register a
          new agent to run one live.
        </p>
      ) : running ? (
        <div className="rounded-xl border border-lime/25 bg-lime/5 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-lime">Running in this tab</p>
            <p className="tabular text-[11px] text-text-muted">
              {status?.quotesPublished ?? 0} quotes sent
            </p>
          </div>
          <p className="tabular mt-1 text-[11px] text-text-muted">
            Pricing {status?.quoting ?? 0} market{status?.quoting === 1 ? "" : "s"}
            {status?.paused ? ` · ${status.paused} paused` : ""}
          </p>
          {status?.note && <p className="mt-1 text-[11px] text-gold">{status.note}</p>}
          <Button
            variant="secondary"
            fullWidth
            className="mt-3 py-2 text-[12px]"
            loading={!!busy}
            onClick={stopAndRemember}
          >
            Stop & save what it learned
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          fullWidth
          className="py-2.5 text-[13px]"
          loading={!!busy}
          onClick={start}
        >
          Run live from this tab
        </Button>
      )}

      {busy && <p className="text-[11px] text-text-muted">{busy}</p>}
      {saved && <p className="text-[11px] text-lime">{saved}</p>}
      {error && <p className="text-[11px] text-coral">{error}</p>}

      {funding && (
        <VaultSheet agent={agent} onClose={() => setFunding(false)} onChanged={onVaultChanged} />
      )}
    </div>
  );
}
