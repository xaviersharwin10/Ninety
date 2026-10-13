"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
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
  /** Worth offering "open on your phone": no built-in passkey here, or an attempt just failed. */
  phoneOffered: boolean;
  openOnPhone: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveRpId(): string {
  const configured = process.env.NEXT_PUBLIC_RP_ID;
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.hostname;
  return "localhost";
}

const SIGNED_IN_FLAG = "ninety.signedIn";

/**
 * Whether this tab was signed in before it was reloaded. A bare flag, never a key: the account
 * still comes only from the passkey. It lets a reload go straight to the passkey prompt and back to
 * the same screen, where it used to drop the fan on the landing page to start over. Reading it
 * clears it, so one failed or cancelled prompt doesn't ask again.
 */
export function takeSignedInFlag(): boolean {
  try {
    const was = window.sessionStorage.getItem(SIGNED_IN_FLAG) === "1";
    window.sessionStorage.removeItem(SIGNED_IN_FLAG);
    return was;
  } catch {
    return false; // storage blocked: the landing page still works
  }
}

function setSignedInFlag(on: boolean) {
  try {
    if (on) window.sessionStorage.setItem(SIGNED_IN_FLAG, "1");
    else window.sessionStorage.removeItem(SIGNED_IN_FLAG);
  } catch {
    // storage blocked: a reload asks to sign in from the landing page, as before
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [session, setSession] = useState<NinetySession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [phoneOffered, setPhoneOffered] = useState(false);
  const rpId = useMemo(resolveRpId, []);

  const runCeremony = useCallback(
    async (ceremony: (rpId: string) => Promise<NinetySession>) => {
      setStatus("authenticating");
      setErrorMessage(null);
      try {
        const next = await ceremony(rpId);
        setSession(next);
        setStatus("authenticated");
        setSignedInFlag(true);
      } catch (err) {
        if (isMeraError(err)) {
          if (err.code === "PRF_UNAVAILABLE") {
            setStatus("prf-unavailable");
            return;
          }
          if (err.code === "PASSKEY_OPERATION_FAILED") {
            // This code covers a real cancellation *and* a browser that can't do it at all: Mera
            // can't tell those apart. Firefox on a laptop, for one, has no passkey of its own and
            // asks for a USB security key; cancelling that lands here. The browser's own wording
            // ("NotAllowedError: The request is not allowed by the user agent...") told a fan
            // nothing, so it goes to the console and they're offered their phone instead.
            console.warn("passkey ceremony failed:", err.message, err.cause);
            setErrorMessage("That didn't go through. Try again, or open Ninety on your phone.");
            setPhoneOffered(true);
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
    setSignedInFlag(false);
    setStatus("idle");
  }, [session]);

  const dismissError = useCallback(() => setStatus("idle"), []);
  const openOnPhone = useCallback(() => setStatus("prf-unavailable"), []);

  // No built-in passkey (fingerprint, face, screen lock) on this device. Some such browsers still
  // work, through a password manager's synced passkeys; others can only ask for a security key. So
  // this doesn't block anything, it just puts the phone option in view from the start.
  useEffect(() => {
    const check = window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable;
    if (!check) return setPhoneOffered(true);
    check.call(window.PublicKeyCredential).then(
      (available) => available || setPhoneOffered(true),
      () => {},
    );
  }, []);

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
    phoneOffered,
    openOnPhone,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
