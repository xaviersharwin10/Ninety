import type { NextRequest } from "next/server";
import { fetchEvents } from "@/lib/match-data";
import { ensureOnchainMatch } from "@/lib/server/scheduler";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/matches/[id]/ensure">) {
  const { id: wyscoutId } = await ctx.params;

  try {
    // Kickoff time doesn't need to be exact -- it's only ever read back as informational metadata
    // (MarketManager never uses it in a settlement decision), so "roughly when this replay
    // actually started" is fine, derived from the earliest event revealed so far.
    const events = await fetchEvents(wyscoutId);
    const kickoffTsSec =
      events.length > 0
        ? Math.floor(Math.min(...events.map((e) => e.revealedAtMs)) / 1000)
        : Math.floor(Date.now() / 1000);

    const onchainMatchId = await ensureOnchainMatch(wyscoutId, kickoffTsSec);
    return Response.json({ onchainMatchId });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
