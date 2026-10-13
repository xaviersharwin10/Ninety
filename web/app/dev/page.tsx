"use client";

import { useState } from "react";
import { BaseError, type Hex } from "viem";
import { AgentConsole } from "@/components/AgentConsole";
import { BottomNav } from "@/components/BottomNav";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { type AgentStats, useAgentStats } from "@/hooks/useAgentStats";
import { type AgentSummary, useAgents } from "@/hooks/useAgents";
import { formatNusd } from "@/hooks/useBalances";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { deriveAgentQuoteSigner } from "@/lib/agent-identity";
import { useAuth } from "@/lib/auth-context";
import { publicClient } from "@/lib/chain";
import { AGENT_REGISTRY, AgentRegistryAbi } from "@/lib/contracts";
import { isMeraError } from "@/lib/mera";
import {
  type AgentStrategy,
  decryptStrategy,
  encryptStrategy,
  verifyStrategyCommit,
} from "@/lib/strategy-vault";
import { revertErrorName, sendTx, TxRevertedError } from "@/lib/tx";

const NUSD_UNITS = 10n ** 6n;

function parseNusdInput(value: string): bigint {
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
  if (err instanceof TxRevertedError) return "The transaction didn't go through.";
  const reverted = revertErrorName(err);
  if (reverted) return `The registry refused it (${reverted}).`;
  // viem's shortMessage, never its full message: that one dumps the call's every argument.
  if (err instanceof BaseError) return err.shortMessage;
  return err instanceof Error ? err.message.split("\n")[0]! : "Something went wrong.";
}

/** BetRouter.MIN_MARGIN_BPS: the contract refuses a quote with less. */
const MIN_MARGIN_BPS = 200;
const MARGIN_HELP =
  "Margin is your edge on each bet. Every bet goes to the three best prices only, and the house agents run 2% to 3%, so a wider margin wins few bets. The minimum is 200.";

export default function DevPage() {
  const { session, rpId } = useRequireAuth();
  const { agents, loading, error, refresh } = useAgents();
  const { stats } = useAgentStats();

  const myAgents = agents?.filter(
    (a) => session && a.operator.toLowerCase() === session.address.toLowerCase(),
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <h1 className="px-5 font-display text-2xl md:text-4xl">Dev</h1>
      <p className="mt-1 px-5 text-[12px] text-text-muted md:max-w-xl">
        Register an agent under your own passkey. Its strategy is encrypted in your browser before
        it ever reaches the chain — see{" "}
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

      <div className="flex flex-1 flex-col xl:mt-6 xl:grid xl:grid-cols-[minmax(0,480px)_minmax(0,1fr)] xl:items-start xl:gap-8">
        <div className="mt-4 px-5 md:max-w-xl xl:sticky xl:top-6 xl:mt-0 xl:max-w-none">
          <RegisterAgentCard rpId={rpId} onRegistered={refresh} />
        </div>

        <div className="mt-6 flex flex-col gap-2.5 px-5 xl:mt-0">
          <p
            id="mine"
            className="scroll-mt-4 text-[12px] font-semibold uppercase tracking-wide text-text-faint"
          >
            Your agents
          </p>
          {!loading && error && (
            <div className="glass rounded-2xl p-6 text-center">
              <p className="text-[13px] font-semibold text-coral">Couldn't load agents</p>
              <p className="mt-1 text-[12px] text-text-muted">{error}</p>
              <Button variant="secondary" className="mt-3 px-4 py-2 text-[12px]" onClick={refresh}>
                Retry
              </Button>
            </div>
          )}
          {!loading && !error && myAgents?.length === 0 && (
            <div className="glass rounded-2xl p-6 text-center">
              <p className="text-[13px] text-text-muted">
                You don't operate any agents yet. Register one to get started.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] md:gap-4">
            {loading && <div className="shimmer h-[70px] rounded-2xl" />}
            {myAgents?.map((agent) => (
              <MyAgentCard
                key={agent.agentId}
                rpId={rpId}
                agent={agent}
                earned={stats?.get(agent.agentId)}
                onUpdated={refresh}
              />
            ))}
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}

/** How an operator describes their agent. A public label only: it doesn't change the pricing. */
const AGENT_STYLES = [
  "Conservative",
  "Balanced",
  "Aggressive",
  "Momentum-driven",
  "Contrarian",
] as const;

function RegisterAgentCard({ rpId, onRegistered }: { rpId: string; onRegistered: () => void }) {
  const { session } = useAuth();
  const [name, setName] = useState("");
  const [style, setStyle] = useState("");
  const [marginBps, setMarginBps] = useState("200");
  const [maxStake, setMaxStake] = useState("25");
  const [quoteExpirySec, setQuoteExpirySec] = useState("5");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const marginOk = (Number.parseInt(marginBps, 10) || 0) >= MIN_MARGIN_BPS;
  const canSubmit = name.trim().length > 0 && style.trim().length > 0 && marginOk && !busy;

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
        maxStakePerQuote: parseNusdInput(maxStake).toString(),
        quoteExpirySec: Number.parseInt(quoteExpirySec, 10) || 0,
        notes: notes.trim() || undefined,
        slug,
      };

      setStep("Encrypting strategy with your passkey…");
      const blob = await encryptStrategy(rpId, strategy);

      setStep("Submitting registration…");
      const { transactionHash } = await sendTx(
        session.account,
        (wallet) =>
          wallet.writeContract({
            address: AGENT_REGISTRY,
            abi: AgentRegistryAbi,
            functionName: "register",
            args: [quoteSigner, blob, `${strategy.name} — ${strategy.style}`],
          }),
        { gas: "agent" },
      );
      setTxHash(transactionHash);

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
        <select
          aria-label="Style"
          className={`glass col-span-2 rounded-xl px-3 py-2.5 text-[13px] ${style ? "text-text" : "text-text-muted"}`}
          value={style}
          onChange={(e) => setStyle(e.target.value)}
        >
          <option value="" disabled>
            Style
          </option>
          {AGENT_STYLES.map((option) => (
            <option key={option} value={option} className="bg-[#0b0c10] text-text">
              {option}
            </option>
          ))}
        </select>
        <p className="col-span-2 -mt-1 text-[11px] text-text-faint">
          A label shown beside your agent's name. Its prices come from the numbers below.
        </p>
        <LabeledInput label="Margin (bps, 200 = 2%)" value={marginBps} onChange={setMarginBps} />
        <LabeledInput label="Max stake/quote (nUSD)" value={maxStake} onChange={setMaxStake} />
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

      <p className={`mt-3 text-[11px] ${marginOk ? "text-text-faint" : "text-coral"}`}>
        {MARGIN_HELP}
      </p>

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
  earned,
  onUpdated,
}: {
  rpId: string;
  agent: AgentSummary;
  /** Its track record from the indexer, for what it has paid this operator. */
  earned?: AgentStats | undefined;
  onUpdated: () => void;
}) {
  const { session } = useAuth();
  const [revealed, setRevealed] = useState<AgentStrategy | null>(null);
  const [commitOk, setCommitOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The settings as being edited; null while just viewing them. */
  const [draft, setDraft] = useState<{ marginBps: string; maxStake: string } | null>(null);

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
      await sendTx(session.account, (wallet) =>
        wallet.writeContract({
          address: AGENT_REGISTRY,
          abi: AgentRegistryAbi,
          functionName: "setStrategy",
          args: [agent.agentId, blob],
        }),
      );
      setRevealed(next);
      setCommitOk(true);
      setDraft(null);
      onUpdated();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const draftMargin = Number.parseInt(draft?.marginBps ?? "", 10) || 0;

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

      {earned && (
        <p className="tabular mt-1 text-[12px] text-text-muted">
          Paid to you:{" "}
          <span className="font-semibold text-lime">{formatNusd(earned.feesPaid)} nUSD</span> in
          performance fees — 20% of its profit above the vault's previous peak, paid automatically
          as vault shares.
        </p>
      )}

      {error && <p className="mt-2 text-[12px] text-coral">{error}</p>}

      {revealed && (
        <div className="mt-3 space-y-2">
          <p className={`text-[11px] ${commitOk ? "text-lime" : "text-coral"}`}>
            {commitOk ? "✓ on-chain commitment matches" : "✗ commitment mismatch"}
          </p>
          {draft ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <LabeledInput
                  label="Margin (bps, 200 = 2%)"
                  value={draft.marginBps}
                  onChange={(v) => setDraft({ ...draft, marginBps: v })}
                />
                <LabeledInput
                  label="Max stake/quote (nUSD)"
                  value={draft.maxStake}
                  onChange={(v) => setDraft({ ...draft, maxStake: v })}
                />
              </div>
              <p
                className={`text-[11px] ${draftMargin >= MIN_MARGIN_BPS ? "text-text-faint" : "text-coral"}`}
              >
                {MARGIN_HELP} Changes apply the next time it runs.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  className="px-3 py-1.5 text-[12px]"
                  loading={busy}
                  disabled={draftMargin < MIN_MARGIN_BPS || parseNusdInput(draft.maxStake) === 0n}
                  onClick={() =>
                    reseal({
                      ...revealed,
                      marginBps: draftMargin,
                      maxStakePerQuote: parseNusdInput(draft.maxStake).toString(),
                    })
                  }
                >
                  Encrypt & save
                </Button>
                <Button
                  variant="ghost"
                  className="px-3 py-1.5 text-[12px]"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="tabular grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-text-muted">
                <span>Margin</span>
                <span className="text-text">
                  {revealed.marginBps} bps ({(revealed.marginBps / 100).toFixed(1)}%)
                </span>
                <span>Max stake/quote</span>
                <span className="text-text">
                  {formatNusd(BigInt(revealed.maxStakePerQuote))} nUSD
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
                disabled={busy}
                onClick={() =>
                  setDraft({
                    marginBps: String(revealed.marginBps),
                    maxStake: String(Number(revealed.maxStakePerQuote) / Number(NUSD_UNITS)),
                  })
                }
              >
                Change settings
              </Button>
            </>
          )}
          <AgentConsole rpId={rpId} agent={agent} strategy={revealed} onVaultChanged={onUpdated} />
        </div>
      )}
    </div>
  );
}
