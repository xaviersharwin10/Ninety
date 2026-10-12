/**
 * Match data, the quote relay and the three house agents in one Node process. Hosted on a free
 * instance with 512 MB, three separate processes cost about 60 MB each before doing anything;
 * together they share one runtime. Locally each still runs on its own (`pnpm --filter ... dev`).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MatchDataServer, WyscoutAdapter } from "../packages/match-data/src/index.js";
import { QuoteRelay } from "../packages/quote-relay/src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;

const betRouter = env.NEXT_PUBLIC_BET_ROUTER as `0x${string}` | undefined;
if (!betRouter) throw new Error("NEXT_PUBLIC_BET_ROUTER must be set");
const oddsLock = env.NEXT_PUBLIC_ODDS_LOCK as `0x${string}` | undefined;

const matchData = new MatchDataServer({
  adapter: new WyscoutAdapter({
    fixturesDir: join(root, "packages", "match-data", "fixtures"),
    ...(env.WYSCOUT_MIRROR_BASE ? { mirrorBase: env.WYSCOUT_MIRROR_BASE } : {}),
  }),
  defaultSpeed: Number(env.REPLAY_SPEED ?? 1),
});
const relay = new QuoteRelay({
  chainId: Number(env.NEXT_PUBLIC_CHAIN_ID ?? 10143),
  betRouter,
  ...(oddsLock ? { oddsLock } : {}),
});

await matchData.listen(Number(env.MATCH_DATA_PORT ?? 8082));
await relay.listen(Number(env.QUOTE_RELAY_PORT ?? 8081));
console.log("match-data and quote-relay listening");

// The agents' entrypoint starts them as it loads, and expects both services above to be up.
// RUN_AGENTS=0 leaves them out, for a host too small to price markets as well as serve them.
if (env.RUN_AGENTS !== "0") await import("../packages/agents/src/main.js");
