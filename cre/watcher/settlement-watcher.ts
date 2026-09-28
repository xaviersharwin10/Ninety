/**
 * Settles every market that closes, end to end, so a fan's bet resolves on its own:
 *
 *   1. watches `MarketManager` for `MarketClosed`;
 *   2. runs the ninety-settlement CRE workflow for it (`cre workflow simulate --broadcast`), which
 *      fetches the outcome, reaches consensus and writes the signed report that resolves the market;
 *   3. calls `BetRouter.settleBatch` for that market's bets, which marks each Won/Lost/Voided,
 *      moves losing stakes into the agents' vaults and releases their locked liability.
 *
 * Why (2) runs from here: a deployed CRE workflow's EVM log trigger does it natively -- the DON
 * watches for `MarketClosed` and runs the workflow. Deploying needs Chainlink's `cre account access`
 * approval, which hasn't landed, and `simulate` is one-shot (it takes one tx hash). This process is
 * the log trigger's stand-in and nothing more: it never decides an outcome; every resolution still
 * comes from the workflow's own fetch, consensus and signed report. Once deploy access lands,
 * `cre workflow deploy` replaces step 2.
 *
 * Why (3) is needed at all: `settleBatch` is permissionless and pull-based by design (Monad bills
 * gas on the limit, so settlement can't loop over every bet inside the resolve call). Someone has
 * to call it, and without a keeper doing so, a resolved market's bets stayed Open forever -- no
 * payout became claimable and no agent's P&L ever moved.
 *
 * It also keeps `config.staging.json`'s `matchDatasetIds` current. The workflow needs the Wyscout
 * fixture behind an on-chain matchId, and `MarketManager` only exposes that in its `MatchCreated`
 * event (`metadataURI` is the fixture id), which the Envio indexer already stores.
 *
 * Run from cre/watcher:  bun run start
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  parseAbi,
  parseAbiItem,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CRE_DIR = join(import.meta.dir, "..");
const CONFIG_PATH = join(CRE_DIR, "ninety-settlement", "config.staging.json");
const STATE_PATH = join(import.meta.dir, ".settlement-watcher-state.json");
const RPC_URL = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:8080/v1/graphql";
const BET_ROUTER = process.env.NEXT_PUBLIC_BET_ROUTER as Address | undefined;
const KEEPER_KEY = (process.env.SCHEDULER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY) as
  | Hex
  | undefined;

/** Monad's public RPC rejects eth_getLogs spans wider than 100 blocks. */
const MAX_LOG_RANGE = 100n;
const POLL_MS = 4000;
const MAX_ATTEMPTS = 5;
/** Bets per settleBatch call: comfortably inside a block while gas is billed on the limit. */
const SETTLE_CHUNK = 40;

const MARKET_CLOSED = parseAbiItem("event MarketClosed(uint256 indexed marketId)");
const MARKET_MANAGER_ABI = parseAbi([
  "function getMarket(uint256 marketId) view returns ((uint64 matchId, bytes32 templateId, uint32 windowStart, uint32 windowEnd, uint64 openedAt, uint64 closesAt, uint64 qualifyingEventTs, uint8 state, uint8 outcome, uint16 teamFilter))",
]);
const BET_ROUTER_ABI = parseAbi(["function settleBatch(uint256[] betIds)"]);
/** MarketState.Resolved / MarketState.Voided -- the only states settleBatch accepts. */
const SETTLED_STATES = new Set([4, 5]);

const chain = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
// viem's http transport retries 429s; the public RPC's 15 req/s cap is shared with every other
// local service, so give it room to back off.
const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { retryCount: 6, retryDelay: 400 }),
});

interface Config {
  evms: { marketManagerAddress: Address }[];
  matchDatasetIds: Record<string, string>;
}

type Stage = "report" | "bets";

interface PendingMarket {
  marketId: bigint;
  txHash: Hex;
  stage: Stage;
  attempts: number;
  nextTryAt: number;
}

const log = (...args: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 19), "[settlement-watcher]", ...args);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readConfig(): Config {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

/** Last block fully scanned, so a restart picks up closes that happened while it was down. */
function readCursor(): bigint | null {
  try {
    return BigInt(JSON.parse(readFileSync(STATE_PATH, "utf8")).lastScannedBlock);
  } catch {
    return null;
  }
}

function writeCursor(block: bigint) {
  writeFileSync(STATE_PATH, JSON.stringify({ lastScannedBlock: block.toString() }));
}

async function queryIndexer<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!body.data) throw new Error(`indexer: ${body.errors?.[0]?.message ?? res.status}`);
  return body.data;
}

/** Rebuilds the on-chain match -> Wyscout fixture map from the indexer into the workflow config. */
async function syncMatchDatasetIds(): Promise<Config> {
  const config = readConfig();
  const { Match } = await queryIndexer<{ Match: { id: string; metadataURI: string }[] }>(
    "{ Match { id metadataURI } }",
  );
  // Built from the indexer alone, not merged: entries left over from an earlier deployment's
  // MarketManager would otherwise map a new match id to the wrong fixture.
  const next: Record<string, string> = {};
  for (const m of Match) next[m.id] = m.metadataURI;
  if (JSON.stringify(next) !== JSON.stringify(config.matchDatasetIds)) {
    config.matchDatasetIds = next;
    writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    log("matchDatasetIds updated:", next);
  }
  return config;
}

async function getMarket(marketManager: Address, marketId: bigint) {
  return publicClient.readContract({
    address: marketManager,
    abi: MARKET_MANAGER_ABI,
    functionName: "getMarket",
    args: [marketId],
  });
}

/** Position of the MarketClosed log within its own transaction -- what `--evm-event-index` wants. */
async function eventIndexInTx(txHash: Hex): Promise<number> {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  const topic = "0x9dc30b8eda31a6a144e092e5de600955523a6a925cc15cc1d1b9b4872cfa6155";
  return Math.max(
    receipt.logs.findIndex((l) => l.topics[0] === topic),
    0,
  );
}

async function runWorkflow(txHash: Hex): Promise<{ ok: boolean; out: string }> {
  const proc = Bun.spawn(
    [
      "cre",
      "workflow",
      "simulate",
      "ninety-settlement",
      "--target",
      "staging-settings",
      "--non-interactive",
      "--trigger-index",
      "0",
      "--evm-tx-hash",
      txHash,
      "--evm-event-index",
      String(await eventIndexInTx(txHash)),
      "--broadcast",
    ],
    { cwd: CRE_DIR, stdout: "pipe", stderr: "pipe", env: process.env },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const out = `${stdout}\n${stderr}`;
  return { ok: (await proc.exited) === 0 && !out.includes("✗"), out };
}

/** Step 2: resolve the market through the CRE workflow. */
async function resolveViaCre(item: PendingMarket, marketManager: Address): Promise<boolean> {
  const market = await getMarket(marketManager, item.marketId);
  if (SETTLED_STATES.has(market.state)) return true; // already resolved (e.g. a restart re-queued it)

  const config = await syncMatchDatasetIds();
  if (!config.matchDatasetIds[market.matchId.toString()]) {
    // The indexer can lag ~45s on the free HyperSync tier. Not a failure -- try again shortly.
    log(`market ${item.marketId}: match ${market.matchId} not indexed yet`);
    return false;
  }
  const { ok, out } = await runWorkflow(item.txHash);
  if (ok) log(`market ${item.marketId}: resolved via CRE`);
  else log(`market ${item.marketId}: CRE run failed:`, out.trim().split("\n").slice(-3).join(" | "));
  return ok;
}

/** Step 3: settle the market's bets so payouts become claimable and vault P&L moves. */
async function settleBets(item: PendingMarket): Promise<boolean> {
  if (!BET_ROUTER || !KEEPER_KEY) {
    log("NEXT_PUBLIC_BET_ROUTER or a keeper key is missing -- cannot settle bets");
    return true;
  }
  const { Bet } = await queryIndexer<{ Bet: { id: string }[] }>(
    `query($m: String!) { Bet(where: { market_id: { _eq: $m }, status: { _eq: "Open" } }) { id } }`,
    { m: item.marketId.toString() },
  );
  if (Bet.length === 0) return true;

  const wallet = createWalletClient({
    account: privateKeyToAccount(KEEPER_KEY),
    chain,
    transport: http(RPC_URL, { retryCount: 6, retryDelay: 400 }),
  });
  const ids = Bet.map((b) => BigInt(b.id));
  for (let i = 0; i < ids.length; i += SETTLE_CHUNK) {
    const chunk = ids.slice(i, i + SETTLE_CHUNK);
    const hash = await wallet.writeContract({
      address: BET_ROUTER,
      abi: BET_ROUTER_ABI,
      functionName: "settleBatch",
      args: [chunk],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    log(`market ${item.marketId}: settled ${chunk.length} bet(s) (tx ${hash})`);
  }
  return true;
}

async function handleMarket(item: PendingMarket, marketManager: Address): Promise<boolean> {
  if (item.stage === "report") {
    if (!(await resolveViaCre(item, marketManager))) return false;
    item.stage = "bets";
  }
  return settleBets(item);
}

async function main() {
  const marketManager = readConfig().evms[0]!.marketManagerAddress;
  let cursor = readCursor() ?? (await publicClient.getBlockNumber()) - MAX_LOG_RANGE;
  const queue: PendingMarket[] = [];
  log(`watching MarketClosed on ${marketManager} from block ${cursor + 1n}`);

  for (;;) {
    try {
      const latest = await publicClient.getBlockNumber();
      while (cursor < latest) {
        const from = cursor + 1n;
        const to = latest < from + MAX_LOG_RANGE - 1n ? latest : from + MAX_LOG_RANGE - 1n;
        const logs = await publicClient.getLogs({
          address: marketManager,
          event: MARKET_CLOSED,
          fromBlock: from,
          toBlock: to,
        });
        for (const l of logs) {
          log(`market ${l.args.marketId} closed (tx ${l.transactionHash})`);
          queue.push({
            marketId: l.args.marketId!,
            txHash: l.transactionHash,
            stage: "report",
            attempts: 0,
            nextTryAt: 0,
          });
        }
        cursor = to;
        writeCursor(cursor);
      }

      // One at a time: CRE runs and settleBatch calls broadcast from shared keys, so parallel
      // work would race on nonces.
      const item = queue.find((q) => q.nextTryAt <= Date.now());
      if (item) {
        let ok = false;
        try {
          ok = await handleMarket(item, marketManager);
        } catch (err) {
          log(`market ${item.marketId}:`, err instanceof Error ? err.message.split("\n")[0] : err);
        }
        item.attempts++;
        if (ok || item.attempts >= MAX_ATTEMPTS) {
          if (!ok) log(`market ${item.marketId}: giving up after ${item.attempts} attempts`);
          queue.splice(queue.indexOf(item), 1);
        } else {
          item.nextTryAt = Date.now() + 10_000 * item.attempts;
        }
      }
    } catch (err) {
      log("tick failed:", err instanceof Error ? err.message.split("\n")[0] : err);
    }
    await sleep(POLL_MS);
  }
}

main();
