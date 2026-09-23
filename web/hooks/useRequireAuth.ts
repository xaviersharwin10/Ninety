"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

/** Every screen past login needs this: identity lives only in memory for this tab (see the doc
 *  comment on lib/mera.ts), so a direct visit or a refresh with no active session bounces home. */
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status !== "authenticated" && auth.status !== "authenticating") {
      router.replace("/");
    }
  }, [auth.status, router]);

  return auth;
}
