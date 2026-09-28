"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { publicClient } from "@/lib/chain";
import { AgentVaultAbi, NUSD_ADDRESS, NusdAbi } from "@/lib/contracts";

export interface VaultPosition {
  shares: bigint;
  /** `shares` converted to nUSD at the vault's current price -- what this backer's stake is worth now. */
  assetsValue: bigint;
  maxWithdraw: bigint;
  /** Unix seconds the withdrawal cooldown lifts; 0 if never deposited. */
  cooldownEndsAt: number;
  allowance: bigint;
  loading: boolean;
  refresh: () => Promise<void>;
}

/** A backer's position in one agent's vault: shares, their nUSD value, and withdrawal eligibility. */
export function useVaultPosition(
  vault: Address | null,
  owner: Address | null,
  withdrawalCooldownSeconds: number,
): VaultPosition {
  const [shares, setShares] = useState(0n);
  const [assetsValue, setAssetsValue] = useState(0n);
  const [maxWithdraw, setMaxWithdraw] = useState(0n);
  const [cooldownEndsAt, setCooldownEndsAt] = useState(0);
  const [allowance, setAllowance] = useState(0n);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!vault || !owner) return;
    try {
      const [sharesBal, maxW, lastDepositAt, allow] = (await Promise.all([
        publicClient.readContract({
          address: vault,
          abi: AgentVaultAbi,
          functionName: "balanceOf",
          args: [owner],
        }),
        publicClient.readContract({
          address: vault,
          abi: AgentVaultAbi,
          functionName: "maxWithdraw",
          args: [owner],
        }),
        publicClient.readContract({
          address: vault,
          abi: AgentVaultAbi,
          functionName: "lastDepositAt",
          args: [owner],
        }),
        publicClient.readContract({
          address: NUSD_ADDRESS,
          abi: NusdAbi,
          functionName: "allowance",
          args: [owner, vault],
        }),
      ])) as [bigint, bigint, bigint, bigint];

      const assets =
        sharesBal > 0n
          ? ((await publicClient.readContract({
              address: vault,
              abi: AgentVaultAbi,
              functionName: "convertToAssets",
              args: [sharesBal],
            })) as bigint)
          : 0n;

      setShares(sharesBal);
      setAssetsValue(assets);
      setMaxWithdraw(maxW);
      setCooldownEndsAt(lastDepositAt > 0n ? Number(lastDepositAt) + withdrawalCooldownSeconds : 0);
      setAllowance(allow);
    } catch {
      // The RPC transport already retried rate limits; anything left is transient. Keep the last
      // known position on screen rather than blanking it or throwing out of an effect.
    } finally {
      setLoading(false);
    }
  }, [vault, owner, withdrawalCooldownSeconds]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { shares, assetsValue, maxWithdraw, cooldownEndsAt, allowance, loading, refresh };
}
