import type { NextRequest } from "next/server";
import { commentaryEnabled, latestCommentary } from "@/lib/server/commentary";

/** The current commentary line for a match; `enabled: false` when no Kimi key is configured. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/matches/[id]/commentary">) {
  const { id } = await ctx.params;
  return Response.json({ enabled: commentaryEnabled(), line: await latestCommentary(id) });
}
