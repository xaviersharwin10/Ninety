"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { BALANCE_CHANGED_EVENT } from "@/lib/account-engine";
import { publicClient } from "@/lib/chain";
import { NUSD_ADDRESS, NUSD_DECIMALS, NusdAbi } from "@/lib/contracts";

export interface Balances {
  monWei: bigint;
  nusdUnits: bigint;
  loading: boolean;
  refresh: () => Promise<void>;
}

const POLL_MS = 6000;

export function useBalances(address: Address | null): Balances {
  const [monWei, setMonWei] = useState(0n);
  const [nusdUnits, setNusdUnits] = useState(0n);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const [mon, nusd] = await Promise.all([
        publicClient.getBalance({ address }),
        publicClient.readContract({
          address: NUSD_ADDRESS,
          abi: NusdAbi,
          functionName: "balanceOf",
          args: [address],
        }),
      ]);
      setMonWei(mon);
      setNusdUnits(nusd);
      setLoading(false);
    } catch {
      // Monad's public RPC 429s above 15 req/s. Keep showing the last known balance; the next
      // poll retries.
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    window.addEventListener(BALANCE_CHANGED_EVENT, refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener(BALANCE_CHANGED_EVENT, refresh);
    };
  }, [address, refresh]);

  return { monWei, nusdUnits, loading, refresh };
}

export function formatNusd(units: bigint): string {
  const whole = units / 10n ** BigInt(NUSD_DECIMALS);
  const frac = units % 10n ** BigInt(NUSD_DECIMALS);
  const fracStr = frac.toString().padStart(NUSD_DECIMALS, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

export function formatMon(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 3);
  return `${whole}.${fracStr}`;
}
