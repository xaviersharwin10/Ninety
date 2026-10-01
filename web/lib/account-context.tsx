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
import { useAuth } from "./auth-context";

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
}

const AccountContext = createContext<AccountContextValue | null>(null);

/** Runs the signed-in account's background work (see account-engine.ts) for as long as it's signed in. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [engine, setEngine] = useState<AccountEngine | null>(null);
  const [state, setState] = useState<AccountState | null>(null);
  const [results, setResults] = useState<BetResult[]>([]);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, BetResult>>(new Map());
  const shown = useRef(new Set<string>());

  useEffect(() => {
    if (!session) return;
    const next = new AccountEngine(session.account, setState, (result) => {
      // A market is announced once, but an engine restarted mid-session could see it again.
      const key = `${result.id}:${result.stake}`;
      if (shown.current.has(key)) return;
      shown.current.add(key);
      setResults((prev) => [...prev, result]);
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
    };
  }, [session]);

  const dismissResult = useCallback(
    (id: string) => setResults((prev) => prev.filter((r) => r.id !== id)),
    [],
  );

  return (
    <AccountContext.Provider value={{ engine, state, results, outcomes, dismissResult }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}
