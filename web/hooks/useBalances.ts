"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { publicClient } from "@/lib/chain";
import { AUSD_ADDRESS, AUSD_DECIMALS, Erc20Abi } from "@/lib/contracts";

export interface Balances {
  monWei: bigint;
  ausdUnits: bigint;
  loading: boolean;
  refresh: () => Promise<void>;
}

const POLL_MS = 6000;

export function useBalances(address: Address | null): Balances {
  const [monWei, setMonWei] = useState(0n);
  const [ausdUnits, setAusdUnits] = useState(0n);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address) return;
    const [mon, ausd] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.readContract({
        address: AUSD_ADDRESS,
        abi: Erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);
    setMonWei(mon);
    setAusdUnits(ausd);
    setLoading(false);
  }, [address]);

  useEffect(() => {
    if (!address) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [address, refresh]);

  return { monWei, ausdUnits, loading, refresh };
}

export function formatAusd(units: bigint): string {
  const whole = units / 10n ** BigInt(AUSD_DECIMALS);
  const frac = units % 10n ** BigInt(AUSD_DECIMALS);
  const fracStr = frac.toString().padStart(AUSD_DECIMALS, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

export function formatMon(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 3);
  return `${whole}.${fracStr}`;
}
