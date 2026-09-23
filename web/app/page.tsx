"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Wordmark } from "@/components/ui/Logo";
import { MarketPreviewCard } from "@/components/ui/MarketPreviewCard";
import { QrCode } from "@/components/ui/QrCode";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const { status, signIn, signUp, dismissError, errorMessage } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/home");
  }, [status, router]);

  if (status === "prf-unavailable") {
    return <PrfUnavailable onBack={dismissError} />;
  }

  const busy = status === "authenticating";

  return (
    <div className="flex min-h-dvh flex-col px-6 pb-10 pt-8">
      <Wordmark />

      <div className="relative mt-10 flex flex-1 items-center justify-center">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 24, rotate: -6 }}
            animate={{ opacity: 1, y: -54, rotate: -8 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="absolute"
          >
            <MarketPreviewCard
              question="Corner in the next 3 min?"
              minute="61'"
              yesOdds="2.4"
              noOdds="1.6"
            />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 24, rotate: 4 }}
            animate={{ opacity: 1, y: 68, rotate: 6 }}
            transition={{ duration: 0.7, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="absolute opacity-60 blur-[0.3px]"
          >
            <MarketPreviewCard
              question="Shot on target — next 2 min?"
              minute="34'"
              yesOdds="2.1"
              noOdds="1.8"
            />
          </motion.div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="mt-6"
      >
        <h1 className="font-display text-[42px] leading-[0.95] tracking-tight">
          Every minute
          <br />
          is a market.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-text-muted">
          Live football, priced by AI agents competing for every bet — settled onchain, in seconds.
        </p>
      </motion.div>

      <div className="mt-8 flex flex-col gap-3">
        {errorMessage && (
          <div className="rounded-xl border border-coral/30 bg-coral/10 px-4 py-3 text-[13px] text-coral">
            {errorMessage}
          </div>
        )}
        <Button variant="primary" fullWidth loading={busy} onClick={() => signUp()}>
          Create account with Passkey
        </Button>
        <Button variant="secondary" fullWidth loading={busy} onClick={() => signIn()}>
          I already have an account
        </Button>
        <p className="mt-1 text-center text-[12px] text-text-faint">
          No seed phrase. No extension. Just Face ID or your fingerprint.
        </p>
      </div>
    </div>
  );
}

function PrfUnavailable({ onBack }: { onBack: () => void }) {
  const url = typeof window !== "undefined" ? window.location.href : "";
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex min-h-dvh flex-col items-center justify-center px-8 text-center"
      >
        <Wordmark className="mb-8" />
        <div className="glass rounded-2xl p-6">
          <QrCode value={url} />
        </div>
        <h2 className="mt-6 font-display text-2xl">Open this on your phone</h2>
        <p className="mt-2 max-w-[280px] text-[14px] leading-relaxed text-text-muted">
          This browser's passkey manager doesn't support the security feature Ninety needs. Scan the
          code with your phone's camera, or switch to Chrome with Google Password Manager.
        </p>
        <Button variant="ghost" className="mt-6" onClick={onBack}>
          ← Back
        </Button>
      </motion.div>
    </AnimatePresence>
  );
}
