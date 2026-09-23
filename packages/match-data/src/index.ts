import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WyscoutAdapter } from "./adapters/wyscout.js";
import { MatchDataServer } from "./server.js";

export type { MatchDataAdapter, MatchTeam, RawMatchData } from "./adapters/types.js";
export { parseWyscoutMatch, WyscoutAdapter } from "./adapters/wyscout.js";
export { ReplayClock } from "./replay/clock.js";
export { MatchDataServer } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Only runs the server when this file is executed directly (`tsx src/index.ts`), not on import. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MATCH_DATA_PORT ?? 8080);
  const adapter = new WyscoutAdapter({
    fixturesDir: join(__dirname, "..", "fixtures"),
    ...(process.env.WYSCOUT_MIRROR_BASE ? { mirrorBase: process.env.WYSCOUT_MIRROR_BASE } : {}),
  });
  const server = new MatchDataServer({
    adapter,
    defaultSpeed: Number(process.env.REPLAY_SPEED ?? 1),
  });

  server.listen(port).then(() => {
    console.log(`match-data listening on :${port}`);
  });
}
