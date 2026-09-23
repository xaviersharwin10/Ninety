"use client";

import { useState } from "react";
import { BalancePill } from "@/components/ui/BalancePill";
import { Logo } from "@/components/ui/Logo";
import { formatAusd, useBalances } from "@/hooks/useBalances";
import { useAuth } from "@/lib/auth-context";

export function TopBar() {
  const { address, signOut } = useAuth();
  const { ausdUnits } = useBalances(address);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex items-center justify-between px-5 py-4">
      <Logo size={30} />
      <div className="flex items-center gap-2">
        <BalancePill label="AUSD" value={formatAusd(ausdUnits)} />
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="glass flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold text-text-muted"
          >
            {address ? address.slice(2, 4).toUpperCase() : "?"}
          </button>
          {menuOpen && (
            <div className="glass absolute right-0 top-11 z-10 w-44 rounded-xl p-1.5">
              <div className="px-2.5 py-2 text-[11px] text-text-faint">
                {address?.slice(0, 6)}…{address?.slice(-4)}
              </div>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  signOut();
                }}
                className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] text-coral hover:bg-coral/10"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
