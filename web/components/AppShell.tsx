"use client";

import type { ReactNode } from "react";
import { DesktopNav } from "@/components/DesktopNav";
import { ResultToasts } from "@/components/ResultToasts";
import { useAuth } from "@/lib/auth-context";

/**
 * Signed out, the landing page owns the whole viewport. Signed in: on a phone, one 480px column
 * with the bottom tab bar; from `md` up, a full-height sidebar plus a content area that uses every
 * pixel of the remaining width -- no max-width cap, so a 1920px screen isn't a centred column.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { address } = useAuth();

  if (!address) return <div className="min-h-dvh w-full">{children}</div>;

  return (
    <div className="flex min-h-dvh w-full flex-col md:flex-row">
      <DesktopNav />
      <ResultToasts />
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-1 flex-col md:mx-0 md:max-w-none md:min-w-0 md:px-4 md:py-6 lg:px-8 xl:px-12">
        {children}
      </main>
    </div>
  );
}
