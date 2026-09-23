#!/usr/bin/env tsx
/**
 * The integrated rehearsal: every live piece built so far, talking to every other one, for real.
 *
 *   anvil -> TestDeploy.s.sol -> register Steady -> fund its vault
 *   -> MatchDataServer replays a real Euro 2016 fixture
 *   -> AgentRunner reads the open market on chain and signs a real quote
 *   -> QuoteRelay serves that quote back in BetRouter's exact wire shape
 *   -> a "fan" account fetches it and places a real bet
 *   -> match-data's /settlement resolves the window against what actually happened in the replay
 *   -> that real outcome is signed and delivered through the CRE simulation-forwarder path
 *   -> BetRouter settles the bet and the fan claims the exact payout OddsMath would compute
 *
 * Nothing here is mocked: every process is the real class from its package, talking over real
 * HTTP/WebSocket/JSON-RPC, against a real deployed contract set. Run with `pnpm rehearse` from
 * the repo root.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HttpQuotePublisher } from "@ninety/agents/src/quote-client.js";
import { AgentRunner } from "@ninety/agents/src/runner.js";
import {
  AgentRegistryAbi,
  BetRouterAbi,
  MarketManagerAbi,
  type Quote,
  SettlementReceiverAbi,
} from "@ninety/core";
import { MatchDataServer, WyscoutAdapter } from "@ninety/match-data";
import { QuoteRelay } from "@ninety/quote-relay";
import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  keccak256,
  publicActions,
  toBytes,
  walletActions,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CONTRACTS_DIR = join(REPO_ROOT, "contracts");
const FIXTURES_DIR = join(REPO_ROOT, "packages/match-data/fixtures");

const ANVIL_PORT = 8610;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const CHAIN = { ...anvil, id: 31337 };
const MATCH_ID = "1694390"; // France v Romania -- both goals in the second half

// Anvil's well-known, pre-funded default account #0. Test-only, never used anywhere real.
const DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

// Minimal ERC20 fragment for MockUSD -- it's test-only tooling, not worth a generated ABI for.
const MOCK_USD_ABI = [
  {
    type: "function",
    name: "mint",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approve",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

function log(section: string, msg: string): void {
  console.log(`[${section}] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  const cleanup: (() => Promise<void> | void)[] = [];
  try {
    // ------------------------------------------------------------------
    // 1. Chain
    // ------------------------------------------------------------------
    log("anvil", `starting on :${ANVIL_PORT}`);
    const anvilProc = await startAnvil(ANVIL_PORT);
    cleanup.push(() => {
      anvilProc.kill();
    });

    const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
    const testClient = createTestClient({ chain: CHAIN, mode: "anvil", transport: http(RPC_URL) })
      .extend(publicActions)
      .extend(walletActions);

    const deployer = privateKeyToAccount(DEPLOYER_PK);
    const signerPk = generatePrivateKey();
    const signer = privateKeyToAccount(signerPk);
    const fanPk = generatePrivateKey();
    const fan = privateKeyToAccount(fanPk);
    const attestorPk = generatePrivateKey();
    const attestor = privateKeyToAccount(attestorPk);

    await testClient.setBalance({ address: fan.address, value: 10n ** 18n });
    log(
      "chain",
      `deployer=${deployer.address} signer=${signer.address} fan=${fan.address} attestor=${attestor.address}`,
    );

    // ------------------------------------------------------------------
    // 2. Deploy
    // ------------------------------------------------------------------
    log("deploy", "running TestDeploy.s.sol");
    const deployed = await deploy(RPC_URL, DEPLOYER_PK);
    log("deploy", JSON.stringify(deployed));

    const deployerWallet = createWalletClient({
      chain: CHAIN,
      transport: http(RPC_URL),
      account: deployer,
    });

    // ------------------------------------------------------------------
    // 3. Register Steady, fund its vault
    // ------------------------------------------------------------------
    log("registry", "registering Steady");
    await writeAndWait(deployerWallet, publicClient, {
      address: deployed.agentRegistry,
      abi: AgentRegistryAbi,
      functionName: "register",
      args: [signer.address, "0xcafe", "steady-rehearsal"],
    });
    const agentId = 1;
    const vault = (await publicClient.readContract({
      address: deployed.agentRegistry,
      abi: AgentRegistryAbi,
      functionName: "vaultOf",
      args: [agentId],
    })) as Address;
    log("registry", `vault=${vault}`);

    log("vault", "funding with 5000 mUSD");
    const FIVE_THOUSAND = 5_000_000_000n;
    await writeAndWait(deployerWallet, publicClient, {
      address: deployed.ausd,
      abi: MOCK_USD_ABI,
      functionName: "mint",
      args: [deployer.address, FIVE_THOUSAND],
    });
    await writeAndWait(deployerWallet, publicClient, {
      address: deployed.ausd,
      abi: MOCK_USD_ABI,
      functionName: "approve",
      args: [vault, FIVE_THOUSAND],
    });
    await writeAndWait(deployerWallet, publicClient, {
      address: vault,
      abi: [
        {
          type: "function",
          name: "deposit",
          inputs: [{ type: "uint256" }, { type: "address" }],
          outputs: [{ type: "uint256" }],
          stateMutability: "nonpayable",
        },
      ] as const,
      functionName: "deposit",
      args: [FIVE_THOUSAND, deployer.address],
    });

    // ------------------------------------------------------------------
    // 4. Open the market and place the bet BEFORE the replay reaches the goal
    //
    // This ordering matters and was wrong on the first attempt: letting the whole replay finish
    // before opening a market meant the "bet" was placed after its qualifying event had already
    // happened, which the anti-sniping rule correctly voids -- but for the wrong structural
    // reason. A real fan bets on a window that hasn't closed yet.
    // ------------------------------------------------------------------
    // Known ahead of time from docs/wyscout-fixtures.md: this fixture's first goal is at
    // matchClockSec ~3418.93 (2H + 718.93s). A moderate replay speed keeps the goal comfortably
    // ahead of the bet -- placed in the rehearsal's first few real seconds -- while keeping the
    // whole run well under a minute.
    const REPLAY_SPEED = 120;
    const GOAL_MATCH_CLOCK_SEC = 3418.93;
    const windowStart = 3318;
    const windowEnd = 3469;

    log("match-data", `starting replay server, fixture ${MATCH_ID} at ${REPLAY_SPEED}x`);
    const matchData = new MatchDataServer({
      adapter: new WyscoutAdapter({ fixturesDir: FIXTURES_DIR }),
      defaultSpeed: REPLAY_SPEED,
    });
    const matchDataPort = await matchData.listen();
    cleanup.push(() => matchData.close());
    const matchDataBase = `http://127.0.0.1:${matchDataPort}`;

    await fetch(`${matchDataBase}/matches/${MATCH_ID}/replay/start`, { method: "POST" });
    const etaSec = Math.ceil(GOAL_MATCH_CLOCK_SEC / REPLAY_SPEED);
    log("match-data", `replay running; goal expected in ~${etaSec}s of real time`);

    const now = Math.floor(Date.now() / 1000);
    await writeAndWait(deployerWallet, publicClient, {
      address: deployed.marketManager,
      abi: MarketManagerAbi,
      functionName: "createMatch",
      args: [`0x${"11".repeat(32)}`, BigInt(now), MATCH_ID],
    });
    const templateId = keccak256(toBytes("GOAL_NEXT_N"));
    await writeAndWait(deployerWallet, publicClient, {
      address: deployed.marketManager,
      abi: MarketManagerAbi,
      functionName: "openMarket",
      args: [1n, templateId, windowStart, windowEnd, BigInt(now + etaSec + 30), 0],
    });
    log("market", `opened GOAL_NEXT_N market 1: window [${windowStart}, ${windowEnd})`);

    // ------------------------------------------------------------------
    // 6. Quote relay + Steady agent
    // ------------------------------------------------------------------
    const relay = new QuoteRelay({ chainId: CHAIN.id, betRouter: deployed.betRouter });
    const relayPort = await relay.listen();
    cleanup.push(() => relay.close());
    const relayBase = `http://127.0.0.1:${relayPort}`;
    log("relay", `listening on ${relayBase}`);

    const runner = new AgentRunner({
      chain: CHAIN,
      rpcUrl: RPC_URL,
      agentId,
      quoteSigner: signer,
      agentRegistry: deployed.agentRegistry,
      marketManager: deployed.marketManager,
      betRouter: deployed.betRouter,
      publisher: new HttpQuotePublisher(relayBase),
    });
    await runner.sweep();
    log("agent", "Steady swept the open market and published a quote");

    // ------------------------------------------------------------------
    // 7. Fan fetches the best quote and places a real bet
    // ------------------------------------------------------------------
    const bestRes = await fetch(`${relayBase}/quotes/1?side=yes`);
    const best = (await bestRes.json()) as QuotesResponse;
    assert(best.quotes.length === 1, `expected 1 quote from the relay, got ${best.quotes.length}`);
    log("fan", `fetched ${best.quotes.length} quote(s) from the relay`);

    const fanWallet = createWalletClient({ chain: CHAIN, transport: http(RPC_URL), account: fan });
    await writeAndWait(deployerWallet, publicClient, {
      address: deployed.ausd,
      abi: MOCK_USD_ABI,
      functionName: "mint",
      args: [fan.address, 100_000_000n],
    });
    await writeAndWait(fanWallet, publicClient, {
      address: deployed.ausd,
      abi: MOCK_USD_ABI,
      functionName: "approve",
      args: [deployed.betRouter, 100_000_000n],
    });

    const stake = 10_000_000n; // 10 mUSD
    const placeBetTxHash = await fanWallet.writeContract({
      address: deployed.betRouter,
      abi: BetRouterAbi,
      functionName: "placeBet",
      args: [
        1n,
        0, // Side.Yes
        stake,
        0n, // minPayout -- accept whatever the relay's one quote gives
        best.quotes.map((q) => ({
          quote: {
            marketId: BigInt(q.quote.marketId),
            agentId: q.quote.agentId,
            probYesBps: q.quote.probYesBps,
            probNoBps: q.quote.probNoBps,
            maxStake: BigInt(q.quote.maxStake),
            expiry: BigInt(q.quote.expiry),
            salt: BigInt(q.quote.salt),
          },
          signature: q.signature,
        })),
      ],
      chain: CHAIN,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: placeBetTxHash });
    assert(receipt.status === "success", "placeBet must succeed");

    // Guarded by the assert above (exactly one quote), so the index is provably in bounds.
    const probYesBps = best.quotes[0]!.quote.probYesBps;
    const expectedPayout = (stake * 10000n) / BigInt(probYesBps);
    log(
      "fan",
      `placed a ${Number(stake) / 1e6} mUSD bet at ${probYesBps}bps; expected payout ${Number(expectedPayout) / 1e6} mUSD`,
    );

    // ------------------------------------------------------------------
    // 8. Wait for the replay to actually reach the goal, then resolve against what really
    //    happened -- polling rather than a fixed sleep, so this is robust to REPLAY_SPEED tuning.
    // ------------------------------------------------------------------
    const settlementUrl = `${matchDataBase}/matches/${MATCH_ID}/settlement?template=GOAL_NEXT_N&windowStart=${windowStart}&windowEnd=${windowEnd}`;
    let settlement: SettlementResponse = {
      outcome: "No",
      qualifyingEventTs: 0,
      qualifyingEventTsWallClock: 0,
    };
    const pollDeadline = Date.now() + (etaSec + 30) * 1000;
    while (Date.now() < pollDeadline) {
      settlement = (await (await fetch(settlementUrl)).json()) as SettlementResponse;
      if (settlement.outcome === "Yes") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert(
      settlement.outcome === "Yes",
      `the replay did not reach the goal within ${etaSec + 30}s`,
    );
    log(
      "settlement",
      `match-data resolved: ${settlement.outcome}, qualifyingEventTsWallClock=${settlement.qualifyingEventTsWallClock}`,
    );

    // Now that the qualifying event has actually happened, push the chain past closesAt so
    // MarketManager will accept resolve() -- betting itself already closed naturally, since the
    // bet was placed long before this point.
    await testClient.increaseTime({ seconds: etaSec + 35 });
    await testClient.mine({ blocks: 1 });

    // ------------------------------------------------------------------
    // 9. Deliver the real outcome through the CRE simulation path
    // ------------------------------------------------------------------
    await writeAndWait(deployerWallet, publicClient, {
      address: deployed.settlementReceiver,
      abi: SettlementReceiverAbi,
      functionName: "setSimAttestor",
      args: [attestor.address],
    });

    log("cre-sim", "delivering the signed settlement report");
    await execFileAsync(
      "forge",
      ["script", "script/smoke/SettleViaSim.s.sol", "--rpc-url", RPC_URL, "--broadcast"],
      {
        cwd: CONTRACTS_DIR,
        env: {
          ...process.env,
          RECEIVER: deployed.settlementReceiver,
          SIM_FORWARDER: deployed.simForwarder,
          ATTESTOR_PK: attestorPk,
          MATCH_ID: "1",
          MARKET_ID: "1",
          DEPLOYER_PK,
          OUTCOME: settlement.outcome === "Yes" ? "1" : "2",
          // BetRouter's anti-sniping rule compares this against block.timestamp, so it must be
          // wall-clock, not match-clock -- see DeliveredEvent's doc comment in match-data/server.ts.
          QUALIFYING_EVENT_TS: String(settlement.qualifyingEventTsWallClock),
        },
        maxBuffer: 16 * 1024 * 1024,
      },
    );

    // ------------------------------------------------------------------
    // 10. Settle the bet and claim
    // ------------------------------------------------------------------
    await writeAndWait(deployerWallet, publicClient, {
      address: deployed.betRouter,
      abi: BetRouterAbi,
      functionName: "settleBatch",
      args: [[1n]],
    });

    const balanceBefore = (await publicClient.readContract({
      address: deployed.ausd,
      abi: MOCK_USD_ABI,
      functionName: "balanceOf",
      args: [fan.address],
    })) as bigint;

    await writeAndWait(fanWallet, publicClient, {
      address: deployed.betRouter,
      abi: BetRouterAbi,
      functionName: "claim",
      args: [[1n]],
    });

    const balanceAfter = (await publicClient.readContract({
      address: deployed.ausd,
      abi: MOCK_USD_ABI,
      functionName: "balanceOf",
      args: [fan.address],
    })) as bigint;

    const actualPayout = balanceAfter - balanceBefore;
    log(
      "claim",
      `fan received ${Number(actualPayout) / 1e6} mUSD (expected ${Number(expectedPayout) / 1e6})`,
    );
    assert(
      actualPayout === expectedPayout,
      `payout mismatch: got ${actualPayout}, expected ${expectedPayout}`,
    );

    console.log("\n=== REHEARSAL PASSED ===");
    console.log(
      "replay -> agent -> relay -> fan bet -> real settlement -> CRE-sim report -> claim, all live, all real.",
    );

    for (const fn of cleanup.reverse()) await fn();
    process.exit(0);
  } catch (err) {
    console.error("\n=== REHEARSAL FAILED ===");
    console.error(err);
    for (const fn of cleanup.reverse()) await Promise.resolve(fn()).catch(() => {});
    process.exit(1);
  }
}

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

async function startAnvil(port: number): Promise<ChildProcess> {
  const proc = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return proc;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error("anvil did not become ready");
}

interface QuoteWireItem {
  quote: {
    marketId: string;
    agentId: number;
    probYesBps: number;
    probNoBps: number;
    maxStake: string;
    expiry: string;
    salt: string;
  };
  signature: `0x${string}`;
}

interface QuotesResponse {
  quotes: QuoteWireItem[];
}

interface SettlementResponse {
  outcome: "Yes" | "No";
  qualifyingEventTs: number; // match-clock seconds -- NOT what goes on chain, see below
  qualifyingEventTsWallClock: number; // unix seconds -- this is what BetRouter compares against
}

interface Deployed {
  ausd: Address;
  agentRegistry: Address;
  marketManager: Address;
  betRouter: Address;
  settlementReceiver: Address;
  simForwarder: Address;
}

async function deploy(rpcUrl: string, deployerPk: string): Promise<Deployed> {
  const { stdout } = await execFileAsync(
    "forge",
    ["script", "script/TestDeploy.s.sol", "--rpc-url", rpcUrl, "--broadcast"],
    {
      cwd: CONTRACTS_DIR,
      env: { ...process.env, DEPLOYER_PRIVATE_KEY: deployerPk },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const grab = (label: string): Address => {
    const m = stdout.match(new RegExp(`${label}\\s+(0x[0-9a-fA-F]{40})`));
    if (!m) throw new Error(`could not find "${label}" in forge output:\n${stdout}`);
    return m[1] as Address;
  };
  return {
    ausd: grab("TestUSD"),
    agentRegistry: grab("AgentRegistry"),
    marketManager: grab("MarketManager"),
    betRouter: grab("BetRouter"),
    settlementReceiver: grab("SettlementReceiver"),
    simForwarder: grab("SimForwarder"),
  };
}

// viem's writeContract typing over dynamic ABIs is too strict for this script's purposes;
// correctness here is verified by the rehearsal actually running end to end against real
// contracts, not by the type checker.
async function writeAndWait(wallet: any, publicClient: any, request: any) {
  const hash = await wallet.writeContract({ ...request, chain: CHAIN });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert(receipt.status === "success", `transaction failed: ${request.functionName}`);
  return receipt;
}

main();
