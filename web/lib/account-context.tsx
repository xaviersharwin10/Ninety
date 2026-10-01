"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AccountEngine, type AccountState, type BetResult } from "./account-engine";
import { alertResult, prepareAlerts } from "./alerts";
import { useAuth } from "./auth-context";
import type { Hold } from "./odds-lock";

interface AccountContextValue {
  engine: AccountEngine | null;
  state: AccountState | null;
  /** Results not yet dismissed, newest last. */
  results: BetResult[];
  /**
   * Every result announced this session, by market id. The indexer can trail the chain by ~45s;
   * screens use this to show a result the moment it's known rather than "Live" until it catches up.
   */
  outcomes: ReadonlyMap<string, BetResult>;
  dismissResult: (id: string) => void;
  /** Prices the fan is holding, by market id. A hold lasts seconds, so this session is plenty. */
  holds: ReadonlyMap<string, Hold>;
  addHold: (hold: Hold) => void;
  endHold: (marketId: string) => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

/** Runs the signed-in account's background work (see account-engine.ts) for as long as it's signed in. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [engine, setEngine] = useState<AccountEngine | null>(null);
  const [state, setState] = useState<AccountState | null>(null);
  const [results, setResults] = useState<BetResult[]>([]);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, BetResult>>(new Map());
  const [holds, setHolds] = useState<ReadonlyMap<string, Hold>>(new Map());
  const shown = useRef(new Set<string>());

  useEffect(() => {
    if (!session) return;
    prepareAlerts();
    const next = new AccountEngine(session.account, setState, (result) => {
      // A market is announced once, but an engine restarted mid-session could see it again.
      const key = `${result.id}:${result.stake}`;
      if (shown.current.has(key)) return;
      shown.current.add(key);
      setResults((prev) => [...prev, result]);
      void alertResult(result);
      setOutcomes((prev) => new Map(prev).set(result.id, result));
    });
    setEngine(next);
    next.start();
    return () => {
      next.stop();
      setEngine(null);
      setState(null);
      setResults([]);
      setOutcomes(new Map());
      setHolds(new Map());
    };
  }, [session]);

  const dismissResult = useCallback(
    (id: string) => setResults((prev) => prev.filter((r) => r.id !== id)),
    [],
  );

  const addHold = useCallback(
    (hold: Hold) => setHolds((prev) => new Map(prev).set(hold.marketId, hold)),
    [],
  );
  const endHold = useCallback(
    (marketId: string) =>
      setHolds((prev) => {
        const next = new Map(prev);
        next.delete(marketId);
        return next;
      }),
    [],
  );

  return (
    <AccountContext.Provider
      value={{ engine, state, results, outcomes, dismissResult, holds, addHold, endHold }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}
