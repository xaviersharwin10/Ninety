"use client";

import { useEffect, useState } from "react";
import { declineAlerts, enableAlerts, shouldOfferAlerts } from "@/lib/alerts";

/**
 * "Tell me when it settles", offered once a bet is placed: the moment a fan has a reason to want
 * it. Shown until they answer either way; a browser only asks for permission from a tap.
 */
export function AlertsOffer() {
  const [state, setState] = useState<"hidden" | "offer" | "on">("hidden");
  useEffect(() => {
    if (shouldOfferAlerts()) setState("offer");
  }, []);

  if (state === "hidden") return null;
  if (state === "on") {
    return <p className="mt-4 text-[12px] text-lime">You'll get a notification when it settles.</p>;
  }
  return (
    <div className="mt-4 flex items-center justify-center gap-3 rounded-2xl border border-border px-4 py-3">
      <p className="text-left text-[12px] text-text-muted">Get a notification when it settles?</p>
      <button
        type="button"
        className="shrink-0 rounded-full bg-lime px-3 py-1.5 text-[12px] font-semibold text-[#06070a]"
        onClick={async () => setState((await enableAlerts()) ? "on" : "hidden")}
      >
        Turn on
      </button>
      <button
        type="button"
        className="shrink-0 text-[12px] text-text-faint"
        onClick={() => {
          declineAlerts();
          setState("hidden");
        }}
      >
        Not now
      </button>
    </div>
  );
}
