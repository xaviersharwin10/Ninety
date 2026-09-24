"use client";

import { useCallback, useEffect, useState } from "react";
import type { Abi, Address } from "viem";
import { publicClient } from "@/lib/chain";
import { AGENT_REGISTRY, AgentRegistryAbi, AgentVaultAbi } from "@/lib/contracts";

export interface AgentSummary {
  agentId: number;
  operator: Address;
  vault: Address;
  enabled: boolean;
  strategyCommit: `0x${string}`;
  metadataURI: string;
  totalAssets: bigint;
  freeCapital: bigint;
  lockedLiability: bigint;
  pricePerShare: bigint;
  performanceFeeBps: number;
  withdrawalCooldownSeconds: number;
}

interface AgentStruct {
  operator: Address;
  quoteSigner: Address;
  vault: Address;
  enabled: boolean;
  strategyCommit: `0x${string}`;
  metadataURI: string;
}

/**
 * The canonical Multicall3 deployment -- confirmed present on Monad testnet (10143) at this same
 * address every EVM chain uses. Batching through it is not an optimization here, it's load-bearing:
 * the public RPC caps at 15 req/sec, and reading N agents' vault fields individually (6 reads each,
 * fired with `Promise.all`) blew past that the moment a 4th agent existed, 429'd, and -- because
 * `Promise.all` rejects the whole batch on one failure -- left the screen stuck loading forever
 * with no error shown. One multicall per phase stays at 1 request regardless of agent count.
 */
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/**
 * `AgentVault.pricePerShare()` at genesis (0 assets, 0 supply): the constructor seeds the
 * high-water mark at `_convertToAssets(1e18, Floor)`, which for a 6-decimal asset with the
 * vault's fixed 6-decimal share offset always works out to 1e18 / 1e6. Every vault this registry
 * deploys starts here, so it's the fixed baseline "return since inception" is measured against.
 */
const GENESIS_PRICE_PER_SHARE = 10n ** 12n;

/** Basis points of price appreciation since the vault's first deposit. 0 if flat or unfunded. */
export function inceptionReturnBps(pricePerShare: bigint): number {
  if (pricePerShare <= GENESIS_PRICE_PER_SHARE) return 0;
  const delta = pricePerShare - GENESIS_PRICE_PER_SHARE;
  return Number((delta * 10_000n) / GENESIS_PRICE_PER_SHARE);
}

/**
 * `metadataURI` is set at registration time as a short human label (e.g. "Steady — conservative
 * house agent"), not a fetchable URI -- see `AgentRegistry.register`'s `metadataURI` param. This
 * pulls just the name fans see on cards and in the leaderboard.
 */
export function agentDisplayName(metadataURI: string): string {
  return metadataURI.split(" — ")[0] || metadataURI;
}

const VAULT_FIELDS = [
  "totalAssets",
  "freeCapital",
  "lockedLiability",
  "pricePerShare",
  "performanceFeeBps",
  "withdrawalCooldownSeconds",
] as const;

/** All registered agents, sorted by vault TVL (highest first) -- the leaderboard's default order. */
export function useAgents() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const count = Number(
        (await publicClient.readContract({
          address: AGENT_REGISTRY,
          abi: AgentRegistryAbi,
          functionName: "agentCount",
        })) as bigint,
      );
      const ids = Array.from({ length: count }, (_, i) => i + 1);
      if (ids.length === 0) {
        setAgents([]);
        return;
      }

      const agentResults = await publicClient.multicall({
        multicallAddress: MULTICALL3_ADDRESS,
        // AgentRegistryAbi is loaded from JSON, not an inline `as const` literal, so its `type`
        // fields come through as plain `string` rather than the literal union viem's Abi type
        // needs for multicall's per-entry inference -- cast once here (same issue and fix as
        // BetSlip.tsx's BetRouterAbi usage).
        contracts: ids.map(
          (id) =>
            ({
              address: AGENT_REGISTRY,
              abi: AgentRegistryAbi as Abi,
              functionName: "getAgent",
              args: [id],
            }) as const,
        ),
      });

      const found = ids
        .map((agentId, i) => ({ agentId, result: agentResults[i] }))
        .filter(
          (
            entry,
          ): entry is { agentId: number; result: { status: "success"; result: AgentStruct } } =>
            entry.result.status === "success",
        );

      const vaultResults = await publicClient.multicall({
        multicallAddress: MULTICALL3_ADDRESS,
        contracts: found.flatMap(({ result }) =>
          VAULT_FIELDS.map(
            (functionName) =>
              ({ address: result.result.vault, abi: AgentVaultAbi as Abi, functionName }) as const,
          ),
        ),
      });

      const summaries: AgentSummary[] = found.map(({ agentId, result }, i) => {
        const fields = vaultResults.slice(i * VAULT_FIELDS.length, (i + 1) * VAULT_FIELDS.length);
        // A vault field genuinely failing (as opposed to the RPC call itself) isn't expected --
        // every vault this registry deploys implements the same interface -- so falling back to 0
        // here is a display fallback for a transient RPC hiccup on one field, not a real state.
        const value = (idx: number) =>
          fields[idx]?.status === "success" ? (fields[idx].result as bigint) : 0n;
        return {
          agentId,
          operator: result.result.operator,
          vault: result.result.vault,
          enabled: result.result.enabled,
          strategyCommit: result.result.strategyCommit,
          metadataURI: result.result.metadataURI,
          totalAssets: value(0),
          freeCapital: value(1),
          lockedLiability: value(2),
          pricePerShare: value(3),
          // viem decodes every Solidity int width (uint16, uint32, ...) as bigint, not number.
          performanceFeeBps: Number(value(4)),
          withdrawalCooldownSeconds: Number(value(5)),
        };
      });

      summaries.sort((a, b) =>
        a.totalAssets < b.totalAssets ? 1 : a.totalAssets > b.totalAssets ? -1 : 0,
      );
      setAgents(summaries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load agents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agents, loading, error, refresh };
}
