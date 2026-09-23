"use client";

import { usePathname, useRouter } from "next/navigation";

const TABS = [
  { href: "/home", label: "Matches", icon: "⚽" },
  { href: "/bets", label: "My Bets", icon: "🎟" },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="glass sticky bottom-0 mt-auto flex items-center justify-around border-t border-border px-4 py-2.5">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <button
            type="button"
            key={tab.href}
            onClick={() => router.push(tab.href)}
            className={`flex flex-col items-center gap-0.5 px-4 py-1 text-[11px] font-medium transition-colors ${
              active ? "text-lime" : "text-text-faint"
            }`}
          >
            <span className="text-base">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
