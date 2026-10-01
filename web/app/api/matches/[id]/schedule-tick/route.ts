import type { NextRequest } from "next/server";
import { fetchEvents, listMatches, REPLAY_SPEED } from "@/lib/match-data";
import { scheduleTick } from "@/lib/server/scheduler";

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<"/api/matches/[id]/schedule-tick">,
) {
  const { id: wyscoutId } = await ctx.params;

  try {
    const [events, matches] = await Promise.all([fetchEvents(wyscoutId), listMatches()]);
    const matchEnded = matches.find((m) => m.matchId === wyscoutId)?.finished ?? false;
    // Wyscout's eventSec carries fractional seconds; MarketManager's window bounds are uint32,
    // and everything downstream (viem's ABI encoding, comparisons against them) wants an integer.
    const nowMatchClockSec = Math.floor(
      events.reduce((max, e) => Math.max(max, e.matchClockSec), 0),
    );
    const result = await scheduleTick(wyscoutId, nowMatchClockSec, matchEnded);
    // The clock and speed let a client say how long each market has left in real seconds.
    return Response.json({ ...result, matchClockSec: nowMatchClockSec, speed: REPLAY_SPEED });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
