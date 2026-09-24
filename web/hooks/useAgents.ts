"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { publicClient } from "@/lib/chain";
import { AGENT_REGISTRY, AgentRegistryAbi, AgentVaultAbi } from "@/lib/contracts";

export interface AgentSummary {
  agentId: number;
  operator: Address;
  vault: Address;
  enabled: boolean;
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

async function loadAgent(agentId: number): Promise<AgentSummary> {
  const agent = (await publicClient.readContract({
    address: AGENT_REGISTRY,
    abi: AgentRegistryAbi,
    functionName: "getAgent",
    args: [agentId],
  })) as AgentStruct;

  const [
    totalAssets,
    freeCapital,
    lockedLiability,
    pricePerShare,
    performanceFeeBpsRaw,
    withdrawalCooldownSecondsRaw,
  ] = (await Promise.all([
    publicClient.readContract({
      address: agent.vault,
      abi: AgentVaultAbi,
      functionName: "totalAssets",
    }),
    publicClient.readContract({
      address: agent.vault,
      abi: AgentVaultAbi,
      functionName: "freeCapital",
    }),
    publicClient.readContract({
      address: agent.vault,
      abi: AgentVaultAbi,
      functionName: "lockedLiability",
    }),
    publicClient.readContract({
      address: agent.vault,
      abi: AgentVaultAbi,
      functionName: "pricePerShare",
    }),
    publicClient.readContract({
      address: agent.vault,
      abi: AgentVaultAbi,
      functionName: "performanceFeeBps",
    }),
    publicClient.readContract({
      address: agent.vault,
      abi: AgentVaultAbi,
      functionName: "withdrawalCooldownSeconds",
    }),
    // viem decodes every Solidity int width (uint16, uint32, uint256, ...) as bigint, so the
    // last two reads (uint16, uint32) come back as bigint too, not number -- convert below.
  ])) as [bigint, bigint, bigint, bigint, bigint, bigint];

  return {
    agentId,
    operator: agent.operator,
    vault: agent.vault,
    enabled: agent.enabled,
    metadataURI: agent.metadataURI,
    totalAssets,
    freeCapital,
    lockedLiability,
    pricePerShare,
    performanceFeeBps: Number(performanceFeeBpsRaw),
    withdrawalCooldownSeconds: Number(withdrawalCooldownSecondsRaw),
  };
}

/** All registered agents, sorted by vault TVL (highest first) -- the leaderboard's default order. */
export function useAgents() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const count = Number(
      (await publicClient.readContract({
        address: AGENT_REGISTRY,
        abi: AgentRegistryAbi,
        functionName: "agentCount",
      })) as bigint,
    );

    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const results = await Promise.all(ids.map(loadAgent));
    results.sort((a, b) =>
      a.totalAssets < b.totalAssets ? 1 : a.totalAssets > b.totalAssets ? -1 : 0,
    );

    setAgents(results);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agents, loading, refresh };
}
