"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { takeSignedInFlag, useAuth } from "@/lib/auth-context";

/** Every screen past login needs this: identity lives only in memory for this tab (see the doc
 *  comment on lib/mera.ts), so a direct visit or a refresh with no active session bounces home. */
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();

  // Set while a reload's sign-in is starting, before the status has caught up with it.
  const resuming = useRef(false);

  useEffect(() => {
    if (auth.status === "authenticated" || auth.status === "authenticating") {
      resuming.current = false;
      return;
    }
    if (resuming.current) return;
    // A reload of a signed-in tab: one passkey prompt, and the fan stays on this screen.
    if (auth.status === "idle" && takeSignedInFlag()) {
      resuming.current = true;
      void auth.signIn().finally(() => {
        resuming.current = false;
      });
      return;
    }
    router.replace("/");
  }, [auth.status, auth.signIn, router]);

  return auth;
}
