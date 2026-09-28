"use client";

import { usePathname, useRouter } from "next/navigation";
import { BalancePill } from "@/components/ui/BalancePill";
import { Wordmark } from "@/components/ui/Logo";
import { formatAusd, useBalances } from "@/hooks/useBalances";
import { useAuth } from "@/lib/auth-context";

const TABS = [
  { href: "/home", label: "Matches", icon: "⚽" },
  { href: "/bets", label: "My Bets", icon: "🎟" },
  { href: "/agents", label: "Agents", icon: "📈" },
] as const;

/**
 * Persistent left sidebar shown once a viewport is wide enough to stop pretending to be a phone
 * (see layout.tsx). Mirrors BottomNav's tabs exactly so the two never drift apart -- this is the
 * desktop equivalent of that bar, not a separate information architecture. Renders nothing when
 * signed out: the login screen owns its own centered layout and has no tabs to show yet.
 */
export function DesktopNav() {
  const { address, signOut } = useAuth();
  const { ausdUnits } = useBalances(address);
  const pathname = usePathname();
  const router = useRouter();

  if (!address) return null;

  return (
    <aside className="sticky top-8 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col md:flex">
      <Wordmark />

      <nav className="mt-10 flex flex-col gap-1">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <button
              type="button"
              key={tab.href}
              onClick={() => router.push(tab.href)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium transition-colors ${
                active ? "glass text-lime" : "text-text-muted hover:text-text"
              }`}
            >
              <span className="text-base">{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <button
          type="button"
          onClick={() => router.push("/dev")}
          className={`rounded-xl px-3 py-2 text-left text-[12px] font-medium transition-colors ${
            pathname === "/dev" ? "text-violet" : "text-text-faint hover:text-violet"
          }`}
        >
          Build your own agent →
        </button>
        <BalancePill label="AUSD" value={formatAusd(ausdUnits)} />
        <p className="tabular px-1 text-[11px] text-text-faint">
          {address.slice(0, 6)}…{address.slice(-4)}
        </p>
        <button
          type="button"
          onClick={signOut}
          className="rounded-xl px-3 py-2 text-left text-[12px] font-medium text-coral hover:bg-coral/10"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
