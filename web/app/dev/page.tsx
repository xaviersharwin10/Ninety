"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { BottomNav } from "@/components/BottomNav";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { type AgentSummary, useAgents } from "@/hooks/useAgents";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { deriveAgentQuoteSigner } from "@/lib/agent-identity";
import { useAuth } from "@/lib/auth-context";
import { publicClient, walletClientFor } from "@/lib/chain";
import { AGENT_REGISTRY, AgentRegistryAbi } from "@/lib/contracts";
import { isMeraError } from "@/lib/mera";
import {
  type AgentStrategy,
  decryptStrategy,
  encryptStrategy,
  verifyStrategyCommit,
} from "@/lib/strategy-vault";

const AUSD_UNITS = 10n ** 6n;

function parseAusdInput(value: string): bigint {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.round(n * 1_000_000));
}

function friendlyError(err: unknown): string {
  if (isMeraError(err)) {
    if (err.code === "PRF_UNAVAILABLE") {
      return "This browser/passkey doesn't support the PRF extension needed to encrypt a strategy. Try a phone with Google Password Manager or iCloud Keychain.";
    }
    if (err.code === "PASSKEY_OPERATION_FAILED")
      return "Passkey prompt was cancelled or timed out.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export default function DevPage() {
  const { session, rpId } = useRequireAuth();
  const { agents, loading, refresh } = useAgents();

  const myAgents = agents?.filter(
    (a) => session && a.operator.toLowerCase() === session.address.toLowerCase(),
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <h1 className="px-5 font-display text-2xl">Dev</h1>
      <p className="mt-1 px-5 text-[12px] text-text-muted">
        Register an agent under your own passkey. Its strategy is encrypted in your browser before
        it ever reaches the chain -- see{" "}
        <a
          href="https://github.com/xaviersharwin10/Ninety/blob/main/docs/many-keys.md"
          target="_blank"
          rel="noreferrer"
          className="text-violet underline"
        >
          how
        </a>
        .
      </p>

      <div className="mt-4 px-5">
        <RegisterAgentCard rpId={rpId} onRegistered={refresh} />
      </div>

      <div className="mt-6 flex flex-1 flex-col gap-2.5 px-5">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-text-faint">
          Your agents
        </p>
        {loading && <div className="shimmer h-[70px] rounded-2xl" />}
        {!loading && myAgents?.length === 0 && (
          <div className="glass rounded-2xl p-6 text-center">
            <p className="text-[13px] text-text-muted">
              You don't operate any agents yet. Register one above.
            </p>
          </div>
        )}
        {myAgents?.map((agent) => (
          <MyAgentCard key={agent.agentId} rpId={rpId} agent={agent} onUpdated={refresh} />
        ))}
      </div>

      <BottomNav />
    </div>
  );
}

function RegisterAgentCard({ rpId, onRegistered }: { rpId: string; onRegistered: () => void }) {
  const { session } = useAuth();
  const [name, setName] = useState("");
  const [style, setStyle] = useState("");
  const [marginBps, setMarginBps] = useState("300");
  const [maxStake, setMaxStake] = useState("25");
  const [quoteExpirySec, setQuoteExpirySec] = useState("5");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const canSubmit = name.trim().length > 0 && style.trim().length > 0 && !busy;

  async function register() {
    if (!session) return;
    setBusy(true);
    setError(null);
    setTxHash(null);
    try {
      const slug = `${name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;

      setStep("Deriving quote-signing identity from your passkey…");
      const quoteSigner = await deriveAgentQuoteSigner(rpId, slug);

      const strategy: AgentStrategy = {
        name: name.trim(),
        style: style.trim(),
        marginBps: Number.parseInt(marginBps, 10) || 0,
        maxStakePerQuote: parseAusdInput(maxStake).toString(),
        quoteExpirySec: Number.parseInt(quoteExpirySec, 10) || 0,
        notes: notes.trim() || undefined,
      };

      setStep("Encrypting strategy with your passkey…");
      const blob = await encryptStrategy(rpId, strategy);

      setStep("Submitting registration…");
      const wallet = walletClientFor(session.account);
      const hash = await wallet.writeContract({
        address: AGENT_REGISTRY,
        abi: AgentRegistryAbi,
        functionName: "register",
        args: [quoteSigner, blob, `${strategy.name} — ${strategy.style}`],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setTxHash(hash);

      setName("");
      setStyle("");
      setNotes("");
      onRegistered();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[13px] font-semibold text-text">Register a new agent</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input
          className="glass col-span-2 rounded-xl px-3 py-2.5 text-[13px]"
          placeholder="Name (e.g. Ledger)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="glass col-span-2 rounded-xl px-3 py-2.5 text-[13px]"
          placeholder="Style (e.g. momentum-driven)"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
        />
        <LabeledInput label="Margin (bps)" value={marginBps} onChange={setMarginBps} />
        <LabeledInput label="Max stake/quote (AUSD)" value={maxStake} onChange={setMaxStake} />
        <LabeledInput
          label="Quote expiry (sec)"
          value={quoteExpirySec}
          onChange={setQuoteExpirySec}
        />
        <input
          className="glass col-span-2 rounded-xl px-3 py-2.5 text-[13px]"
          placeholder="Notes (optional, private)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {step && <p className="mt-3 text-[12px] text-text-muted">{step}</p>}
      {error && <p className="mt-3 text-[12px] text-coral">{error}</p>}
      {txHash && (
        <a
          href={`https://testnet.monadexplorer.com/tx/${txHash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block text-[12px] text-lime underline"
        >
          Registered — view on explorer
        </a>
      )}

      <Button
        variant="primary"
        fullWidth
        className="mt-4"
        loading={busy}
        disabled={!canSubmit}
        onClick={register}
      >
        Encrypt & register
      </Button>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="text-[11px] text-text-faint">
      {label}
      <input
        className="glass mt-1 w-full rounded-xl px-3 py-2.5 text-[13px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
      />
    </label>
  );
}

function MyAgentCard({
  rpId,
  agent,
  onUpdated,
}: {
  rpId: string;
  agent: AgentSummary;
  onUpdated: () => void;
}) {
  const { session } = useAuth();
  const [revealed, setRevealed] = useState<AgentStrategy | null>(null);
  const [commitOk, setCommitOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const blob = (await publicClient.readContract({
        address: AGENT_REGISTRY,
        abi: AgentRegistryAbi,
        functionName: "strategyBlobOf",
        args: [agent.agentId],
      })) as Hex;
      setCommitOk(verifyStrategyCommit(blob, agent.strategyCommit));
      const strategy = await decryptStrategy(rpId, blob);
      setRevealed(strategy);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function reseal(next: AgentStrategy) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await encryptStrategy(rpId, next);
      const wallet = walletClientFor(session.account);
      const hash = await wallet.writeContract({
        address: AGENT_REGISTRY,
        abi: AgentRegistryAbi,
        functionName: "setStrategy",
        args: [agent.agentId, blob],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setRevealed(next);
      setCommitOk(true);
      onUpdated();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-text">
          {agent.metadataURI} <span className="text-text-faint">#{agent.agentId}</span>
        </p>
        {!revealed && (
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-[12px]"
            loading={busy}
            onClick={reveal}
          >
            Reveal
          </Button>
        )}
      </div>

      {error && <p className="mt-2 text-[12px] text-coral">{error}</p>}

      {revealed && (
        <div className="mt-3 space-y-2">
          <p className={`text-[11px] ${commitOk ? "text-lime" : "text-coral"}`}>
            {commitOk ? "✓ on-chain commitment matches" : "✗ commitment mismatch"}
          </p>
          <div className="tabular grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-text-muted">
            <span>Margin</span>
            <span className="text-text">{revealed.marginBps} bps</span>
            <span>Max stake/quote</span>
            <span className="text-text">
              {(Number(revealed.maxStakePerQuote) / Number(AUSD_UNITS)).toFixed(2)} AUSD
            </span>
            <span>Quote expiry</span>
            <span className="text-text">{revealed.quoteExpirySec}s</span>
            {revealed.notes && (
              <>
                <span>Notes</span>
                <span className="text-text">{revealed.notes}</span>
              </>
            )}
          </div>
          <Button
            variant="secondary"
            className="mt-1 px-3 py-1.5 text-[12px]"
            loading={busy}
            onClick={() => reseal({ ...revealed, marginBps: revealed.marginBps })}
          >
            Re-seal (rotate ciphertext)
          </Button>
        </div>
      )}
    </div>
  );
}
