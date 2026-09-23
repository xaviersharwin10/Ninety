"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { Address } from "viem";
import {
  isMeraError,
  signIn as meraSignIn,
  signUp as meraSignUp,
  type NinetySession,
} from "./mera";

export type AuthStatus = "idle" | "authenticating" | "authenticated" | "prf-unavailable" | "error";

interface AuthContextValue {
  status: AuthStatus;
  address: Address | null;
  session: NinetySession | null;
  errorMessage: string | null;
  rpId: string;
  signIn: () => Promise<void>;
  signUp: () => Promise<void>;
  signOut: () => void;
  dismissError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveRpId(): string {
  const configured = process.env.NEXT_PUBLIC_RP_ID;
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.hostname;
  return "localhost";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [session, setSession] = useState<NinetySession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rpId = useMemo(resolveRpId, []);

  const runCeremony = useCallback(
    async (ceremony: (rpId: string) => Promise<NinetySession>) => {
      setStatus("authenticating");
      setErrorMessage(null);
      try {
        const next = await ceremony(rpId);
        setSession(next);
        setStatus("authenticated");
      } catch (err) {
        if (isMeraError(err)) {
          if (err.code === "PRF_UNAVAILABLE") {
            setStatus("prf-unavailable");
            return;
          }
          if (err.code === "PASSKEY_OPERATION_FAILED") {
            // Usually the user dismissed the prompt or the ceremony timed out -- not an error
            // worth alarming over, just back out so they can try again.
            setStatus("idle");
            return;
          }
          setErrorMessage(err.message);
          setStatus("error");
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
        setStatus("error");
      }
    },
    [rpId],
  );

  const signIn = useCallback(() => runCeremony(meraSignIn), [runCeremony]);
  const signUp = useCallback(() => runCeremony(meraSignUp), [runCeremony]);

  const signOut = useCallback(() => {
    session?.end();
    setSession(null);
    setStatus("idle");
  }, [session]);

  const dismissError = useCallback(() => setStatus("idle"), []);

  const value: AuthContextValue = {
    status,
    address: session?.address ?? null,
    session,
    errorMessage,
    rpId,
    signIn,
    signUp,
    signOut,
    dismissError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
