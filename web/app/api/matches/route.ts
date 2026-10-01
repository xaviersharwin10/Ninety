import { listMatches } from "@/lib/match-data";

/**
 * The fixtures on offer and which are playing now. Clients other than this app's own screens (the
 * MetaMask Agent Wallet plugin) read it here, so they only ever need this app's address.
 */
export async function GET() {
  try {
    return Response.json({ matches: await listMatches() });
  } catch {
    return Response.json({ error: "match_data_unreachable" }, { status: 502 });
  }
}
