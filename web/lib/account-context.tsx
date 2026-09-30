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
  dismissResult: (betId: string) => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

/** Runs the signed-in account's background work (see account-engine.ts) for as long as it's signed in. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [engine, setEngine] = useState<AccountEngine | null>(null);
  const [state, setState] = useState<AccountState | null>(null);
  const [results, setResults] = useState<BetResult[]>([]);
  const shown = useRef(new Set<string>());

  useEffect(() => {
    if (!session) return;
    const next = new AccountEngine(session.account, setState, (result) => {
      if (shown.current.has(result.betId)) return;
      shown.current.add(result.betId);
      setResults((prev) => [...prev, result]);
    });
    setEngine(next);
    next.start();
    return () => {
      next.stop();
      setEngine(null);
      setState(null);
      setResults([]);
    };
  }, [session]);

  const dismissResult = useCallback(
    (betId: string) => setResults((prev) => prev.filter((r) => r.betId !== betId)),
    [],
  );

  return (
    <AccountContext.Provider value={{ engine, state, results, dismissResult }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}
