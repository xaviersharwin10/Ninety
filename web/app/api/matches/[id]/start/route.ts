import type { NextRequest } from "next/server";
import { REPLAY_SPEED, startReplay } from "@/lib/match-data";

/** Kicks off a fixture's replay at the app's speed, as opening its match screen does. Idempotent. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/matches/[id]/start">) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "invalid_match" }, { status: 400 });
  try {
    await startReplay(id, REPLAY_SPEED);
    return Response.json({ started: true });
  } catch {
    return Response.json({ error: "match_data_unreachable" }, { status: 502 });
  }
}
