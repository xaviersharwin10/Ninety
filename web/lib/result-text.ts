import { formatNusd } from "@/hooks/useBalances";
import type { BetResult } from "./account-engine";

/** What a bet's result says, in the in-app toast and the browser notification alike. */
export function resultText(r: BetResult): { title: string; detail: string } {
  switch (r.outcome) {
    case "Won":
      return { title: `You won ${formatNusd(r.amount)} nUSD`, detail: "Added to your balance" };
    case "Voided":
      return {
        title: `${formatNusd(r.amount)} nUSD refunded`,
        detail: "This bet didn't count, so your stake is back",
      };
    case "CashedOut":
      return { title: `Cashed out ${formatNusd(r.amount)} nUSD`, detail: "Added to your balance" };
    case "Lost":
      return { title: "Not this time", detail: `${formatNusd(r.stake)} nUSD stake` };
  }
}
