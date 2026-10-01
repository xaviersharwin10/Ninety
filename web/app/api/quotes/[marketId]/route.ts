import type { NextRequest } from "next/server";
import { RELAY_HTTP_URL } from "@/lib/quote-relay";

/**
 * The best signed prices on both sides of a market, as the relay serves them (best first). The
 * contract re-verifies every quote, so passing them through untouched is safe; this only spares
 * clients outside the browser (the MetaMask Agent Wallet plugin) a second address to configure.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/quotes/[marketId]">) {
  const { marketId } = await ctx.params;
  if (!/^\d+$/.test(marketId)) return Response.json({ error: "invalid_market" }, { status: 400 });
  try {
    const [yes, no] = await Promise.all(
      (["yes", "no"] as const).map(async (side) => {
        const res = await fetch(`${RELAY_HTTP_URL}/quotes/${marketId}?side=${side}`, {
          cache: "no-store",
        });
        return res.ok ? ((await res.json()) as { quotes: unknown[] }).quotes : [];
      }),
    );
    return Response.json({ yes, no }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "quotes_unreachable" }, { status: 502 });
  }
}
