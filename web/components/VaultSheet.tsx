"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { PnlChart } from "@/components/PnlChart";
import { Button } from "@/components/ui/Button";
import type { AgentStats } from "@/hooks/useAgentStats";
import { type AgentSummary, agentDisplayName, inceptionReturnBps } from "@/hooks/useAgents";
import { formatNusd, useBalances } from "@/hooks/useBalances";
import { useVaultPosition } from "@/hooks/useVaultPosition";
import { useAuth } from "@/lib/auth-context";
import { AgentVaultAbi } from "@/lib/contracts";
import { ensureAllowance } from "@/lib/erc20";
import { revertErrorName, sendTx, TxRevertedError } from "@/lib/tx";

const DEPOSIT_PRESETS = [25_000_000n, 50_000_000n, 100_000_000n, 250_000_000n]; // 25/50/100/250 nUSD

type Tab = "deposit" | "withdraw";
type TxState = "idle" | "submitting" | "confirmed" | "error";

/** Readable reason a deposit or withdrawal failed; raw viem errors never reach the screen. */
function vaultErrorMessage(err: unknown, action: "deposit" | "withdrawal"): string {
  if (err instanceof TxRevertedError) return `The ${action} didn't go through. Nothing moved.`;
  switch (revertErrorName(err)) {
    case "ERC4626ExceededMaxWithdraw":
    case "ERC4626ExceededMaxRedeem":
      return "That much can't be withdrawn yet: part of the vault is backing open bets, or your deposit is still in its cooldown.";
    case "ERC20InsufficientBalance":
      return "Not enough nUSD in your balance.";
  }
  return `The ${action} couldn't be completed. Nothing moved.`;
}

export function VaultSheet({
  agent,
  stats,
  onClose,
  onChanged,
}: {
  agent: AgentSummary;
  /** The agent's indexed track record; absent if the indexer couldn't be reached. */
  stats?: AgentStats | undefined;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { session } = useAuth();
  const balances = useBalances(session?.address ?? null);
  const position = useVaultPosition(
    agent.vault,
    session?.address ?? null,
    agent.withdrawalCooldownSeconds,
  );
  const [tab, setTab] = useState<Tab>("deposit");
  const [depositAmount, setDepositAmount] = useState(DEPOSIT_PRESETS[0]);
  const [state, setState] = useState<TxState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const name = agentDisplayName(agent.metadataURI);
  const returnBps = inceptionReturnBps(agent.pricePerShare);
  const nowSec = Date.now() / 1000;
  const cooldownActive = position.cooldownEndsAt > nowSec;
  const cooldownMinutesLeft = cooldownActive
    ? Math.ceil((position.cooldownEndsAt - nowSec) / 60)
    : 0;
  const capitalLocked = !cooldownActive && position.shares > 0n && position.maxWithdraw === 0n;
  const depositExceedsBalance = depositAmount > balances.nusdUnits;

  async function reset() {
    await Promise.all([position.refresh(), onChanged()]);
  }

  async function deposit() {
    if (!session) return;
    setState("submitting");
    setErrorMessage(null);
    try {
      await ensureAllowance(session.account, agent.vault, depositAmount);
      const { transactionHash } = await sendTx(session.account, (wallet) =>
        wallet.writeContract({
          address: agent.vault,
          abi: AgentVaultAbi,
          functionName: "deposit",
          args: [depositAmount, session.address],
        }),
      );
      setTxHash(transactionHash);
      setState("confirmed");
      await reset();
      balances.refresh();
    } catch (err) {
      setErrorMessage(vaultErrorMessage(err, "deposit"));
      setState("error");
    }
  }

  async function withdraw() {
    if (!session || position.maxWithdraw === 0n) return;
    setState("submitting");
    setErrorMessage(null);
    try {
      const { transactionHash } = await sendTx(session.account, (wallet) =>
        wallet.writeContract({
          address: agent.vault,
          abi: AgentVaultAbi,
          functionName: "withdraw",
          args: [position.maxWithdraw, session.address, session.address],
        }),
      );
      setTxHash(transactionHash);
      setState("confirmed");
      await reset();
      balances.refresh();
    } catch (err) {
      setErrorMessage(vaultErrorMessage(err, "withdrawal"));
      setState("error");
    }
  }

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
            <p className="mt-4 font-display text-xl">
              {tab === "deposit" ? "Deposit confirmed" : "Withdrawal confirmed"}
            </p>
            <p className="mt-1 text-[13px] text-text-muted">{name}'s vault</p>
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
                <p className="text-[12px] text-text-muted">Backing</p>
                <p className="font-display text-2xl text-lime">{name}</p>
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

            <div className="glass flex items-center justify-between rounded-2xl p-4">
              <div>
                <p className="text-[11px] text-text-muted">Your position</p>
                <p className="tabular font-display text-lg">
                  {formatNusd(position.assetsValue)} nUSD
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-text-muted">Vault return</p>
                <p
                  className={`tabular text-[13px] font-semibold ${returnBps >= 0 ? "text-lime" : "text-coral"}`}
                >
                  {returnBps >= 0 ? "+" : ""}
                  {(returnBps / 100).toFixed(2)}%
                </p>
              </div>
            </div>

            {stats && (
              <div className="glass mt-3 rounded-2xl p-4">
                <div className="flex items-baseline justify-between">
                  <p className="text-[11px] text-text-muted">Track record</p>
                  <p
                    className={`tabular text-[13px] font-semibold ${stats.realizedPnl >= 0n ? "text-lime" : "text-coral"}`}
                  >
                    {stats.realizedPnl >= 0n ? "+" : "−"}
                    {formatNusd(stats.realizedPnl >= 0n ? stats.realizedPnl : -stats.realizedPnl)}{" "}
                    nUSD earned
                  </p>
                </div>
                <PnlChart series={stats.pnlSeries} height={72} className="mt-3" />
                <p className="tabular mt-2 text-[11px] text-text-faint">
                  {formatNusd(stats.volume)} nUSD priced ·{" "}
                  {stats.betsWon + stats.betsLost + stats.betsVoided} bets settled · max drawdown{" "}
                  {formatNusd(stats.maxDrawdown)} nUSD
                </p>
              </div>
            )}

            <div className="mt-4 flex gap-1.5 rounded-full bg-white/[0.04] p-1">
              {(["deposit", "withdraw"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-full py-2 text-[13px] font-semibold capitalize transition-colors ${
                    tab === t ? "bg-lime text-[#06070a]" : "text-text-muted"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === "deposit" ? (
              <>
                <div className="mt-4 flex gap-2">
                  {DEPOSIT_PRESETS.map((amount) => (
                    <button
                      type="button"
                      key={amount.toString()}
                      onClick={() => setDepositAmount(amount)}
                      className={`flex-1 rounded-xl border px-2 py-2.5 text-[13px] font-semibold transition-colors ${
                        depositAmount === amount
                          ? "border-transparent bg-lime text-[#06070a]"
                          : "border-border text-text-muted hover:border-border-strong"
                      }`}
                    >
                      {formatNusd(amount)}
                    </button>
                  ))}
                </div>
                {depositExceedsBalance && (
                  <p className="mt-3 text-center text-[12px] text-coral">
                    You have {formatNusd(balances.nusdUnits)} nUSD available.
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
                  disabled={depositExceedsBalance || depositAmount === 0n}
                  onClick={deposit}
                >
                  Deposit {formatNusd(depositAmount)} nUSD
                </Button>
              </>
            ) : (
              <>
                <div className="mt-4 glass rounded-2xl p-4 text-center">
                  <p className="text-[11px] text-text-muted">Available to withdraw</p>
                  <p className="tabular mt-1 font-display text-xl text-lime">
                    {formatNusd(position.maxWithdraw)} nUSD
                  </p>
                </div>
                {cooldownActive && (
                  <p className="mt-3 text-center text-[12px] text-gold">
                    Withdrawals unlock {cooldownMinutesLeft} min after your last deposit — this
                    stops a backer buying in on a stale price and exiting before it settles.
                  </p>
                )}
                {capitalLocked && (
                  <p className="mt-3 text-center text-[12px] text-gold">
                    This vault's capital is currently backing open bets. Check back once its markets
                    close.
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
                  disabled={position.maxWithdraw === 0n}
                  onClick={withdraw}
                >
                  Withdraw all
                </Button>
              </>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
