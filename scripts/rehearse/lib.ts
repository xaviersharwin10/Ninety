/**
 * Shared boot sequence and small utilities for the integrated rehearsal scenarios. Everything a
 * scenario needs to interact with the live chain, contracts, match-data replay and quote relay
 * lives here so each scenario file stays focused on the property it's proving.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HttpQuotePublisher } from "@ninety/agents/src/quote-client.js";
import { AgentRunner } from "@ninety/agents/src/runner.js";
import { steadyStrategy } from "@ninety/agents/src/strategies/steady.js";
import { AgentRegistryAbi, MarketManagerAbi } from "@ninety/core";
import { MatchDataServer, WyscoutAdapter } from "@ninety/match-data";
import { QuoteRelay } from "@ninety/quote-relay";
import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  keccak256,
  type PublicClient,
  publicActions,
  toBytes,
  type WalletClient,
  walletActions,
} from "viem";
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

const execFileAsync = promisify(execFile);
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const CONTRACTS_DIR = join(REPO_ROOT, "contracts");
export const FIXTURES_DIR = join(REPO_ROOT, "packages/match-data/fixtures");

export const ANVIL_PORT = 8610;
export const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
export const CHAIN = { ...anvil, id: 31337 };
export const MATCH_ID = "1694390"; // France v Romania -- both goals in the second half

// This fixture's two goals, known ahead of time from docs/wyscout-fixtures.md and pinned by the
// golden-file adapter tests -- not rediscovered by scanning the replay on every run.
export const GOAL_1_MATCH_CLOCK_SEC = 3418.93;
export const GOAL_2_MATCH_CLOCK_SEC = 5301.0;
export const REPLAY_SPEED = 120;

// Anvil's well-known, pre-funded default account #0. Test-only, never used anywhere real.
export const DEPLOYER_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

// Minimal ERC20 fragment for MockUSD -- it's test-only tooling, not worth a generated ABI for.
export const MOCK_USD_ABI = [
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

export const VAULT_DEPOSIT_ABI = [
  {
    type: "function",
    name: "deposit",
    inputs: [{ type: "uint256" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

export function log(section: string, msg: string): void {
  console.log(`[${section}] ${msg}`);
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

export interface QuoteWireItem {
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

export interface QuotesResponse {
  quotes: QuoteWireItem[];
}

export interface SettlementResponse {
  outcome: "Yes" | "No";
  qualifyingEventTs: number; // match-clock seconds -- NOT what goes on chain
  qualifyingEventTsWallClock: number; // unix seconds -- this is what BetRouter compares against
}

export interface Deployed {
  ausd: Address;
  agentRegistry: Address;
  marketManager: Address;
  betRouter: Address;
  settlementReceiver: Address;
  simForwarder: Address;
}

export async function startAnvil(port: number): Promise<ChildProcess> {
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
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error("anvil did not become ready");
}

export async function deployContracts(rpcUrl: string, deployerPk: string): Promise<Deployed> {
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
export async function writeAndWait(wallet: any, publicClient: any, request: any) {
  const hash = await wallet.writeContract({ ...request, chain: CHAIN });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert(receipt.status === "success", `transaction failed: ${request.functionName}`);
  return receipt;
}

export async function deliverSettlement(opts: {
  receiver: Address;
  simForwarder: Address;
  attestorPk: `0x${string}`;
  matchId: string;
  marketId: string;
  outcome: "Yes" | "No";
  qualifyingEventTsWallClock: number;
}): Promise<void> {
  await execFileAsync(
    "forge",
    ["script", "script/smoke/SettleViaSim.s.sol", "--rpc-url", RPC_URL, "--broadcast"],
    {
      cwd: CONTRACTS_DIR,
      env: {
        ...process.env,
        RECEIVER: opts.receiver,
        SIM_FORWARDER: opts.simForwarder,
        ATTESTOR_PK: opts.attestorPk,
        MATCH_ID: opts.matchId,
        MARKET_ID: opts.marketId,
        DEPLOYER_PK,
        OUTCOME: opts.outcome === "Yes" ? "1" : "2",
        // BetRouter's anti-sniping rule compares this against block.timestamp, so it must be
        // wall-clock, not match-clock -- see DeliveredEvent's doc comment in match-data/server.ts.
        QUALIFYING_EVENT_TS: String(opts.qualifyingEventTsWallClock),
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

/** Polls match-data's /settlement until it reports Yes, or throws after `timeoutMs`. */
export async function waitForOutcome(
  matchDataBase: string,
  matchId: string,
  template: string,
  windowStart: number,
  windowEnd: number,
  timeoutMs: number,
): Promise<SettlementResponse> {
  const url = `${matchDataBase}/matches/${matchId}/settlement?template=${template}&windowStart=${windowStart}&windowEnd=${windowEnd}`;
  const deadline = Date.now() + timeoutMs;
  let last: SettlementResponse = {
    outcome: "No",
    qualifyingEventTs: 0,
    qualifyingEventTsWallClock: 0,
  };
  while (Date.now() < deadline) {
    last = (await (await fetch(url)).json()) as SettlementResponse;
    if (last.outcome === "Yes") return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `settlement did not reach Yes for [${windowStart},${windowEnd}) within ${timeoutMs}ms`,
  );
}

export interface RehearsalContext {
  cleanup: (() => Promise<void> | void)[];
  rpcUrl: string;
  replaySpeed: number;
  templateId: `0x${string}`;
  publicClient: PublicClient;
  testClient: ReturnType<typeof createTestClient> &
    ReturnType<typeof publicActions> &
    ReturnType<typeof walletActions>;
  deployer: PrivateKeyAccount;
  deployerWallet: WalletClient;
  signer: PrivateKeyAccount;
  fan: PrivateKeyAccount;
  fanWallet: WalletClient;
  attestor: PrivateKeyAccount;
  attestorPk: `0x${string}`;
  deployed: Deployed;
  agentId: number;
  vault: Address;
  matchData: MatchDataServer;
  matchDataBase: string;
  relayBase: string;
  runner: AgentRunner;
  nextMarketId: () => bigint;
}

/**
 * Everything every scenario needs, booted once: chain, contracts, a registered and funded Steady
 * agent, a running replay of the fixture, a quote relay, and an AgentRunner pointed at all of it.
 * Scenarios differ only in which market they open and what they do with it.
 */
export async function boot(): Promise<RehearsalContext> {
  const cleanup: RehearsalContext["cleanup"] = [];

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
  const signer = privateKeyToAccount(generatePrivateKey());
  const fan = privateKeyToAccount(generatePrivateKey());
  const attestorPk = generatePrivateKey();
  const attestor = privateKeyToAccount(attestorPk);

  await testClient.setBalance({ address: fan.address, value: 10n ** 18n });
  log(
    "chain",
    `deployer=${deployer.address} signer=${signer.address} fan=${fan.address} attestor=${attestor.address}`,
  );

  log("deploy", "running TestDeploy.s.sol");
  const deployed = await deployContracts(RPC_URL, DEPLOYER_PK);
  log("deploy", JSON.stringify(deployed));

  const deployerWallet = createWalletClient({
    chain: CHAIN,
    transport: http(RPC_URL),
    account: deployer,
  });
  const fanWallet = createWalletClient({ chain: CHAIN, transport: http(RPC_URL), account: fan });

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
    abi: VAULT_DEPOSIT_ABI,
    functionName: "deposit",
    args: [FIVE_THOUSAND, deployer.address],
  });

  log("vault", "funding the fan with 100 mUSD");
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

  log("match-data", `starting replay server, fixture ${MATCH_ID} at ${REPLAY_SPEED}x`);
  const matchData = new MatchDataServer({
    adapter: new WyscoutAdapter({ fixturesDir: FIXTURES_DIR }),
    defaultSpeed: REPLAY_SPEED,
  });
  const matchDataPort = await matchData.listen();
  cleanup.push(() => matchData.close());
  const matchDataBase = `http://127.0.0.1:${matchDataPort}`;
  await fetch(`${matchDataBase}/matches/${MATCH_ID}/replay/start`, { method: "POST" });
  log("match-data", "replay running");

  const now = Math.floor(Date.now() / 1000);
  await writeAndWait(deployerWallet, publicClient, {
    address: deployed.marketManager,
    abi: MarketManagerAbi,
    functionName: "createMatch",
    args: [`0x${"11".repeat(32)}`, BigInt(now), MATCH_ID],
  });
  const templateId = keccak256(toBytes("GOAL_NEXT_N"));

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
    strategy: steadyStrategy,
    publisher: new HttpQuotePublisher(relayBase),
  });

  let marketCounter = 0n;
  const nextMarketId = () => {
    marketCounter += 1n;
    return marketCounter;
  };

  return {
    cleanup,
    rpcUrl: RPC_URL,
    replaySpeed: REPLAY_SPEED,
    templateId,
    publicClient,
    testClient,
    deployer,
    deployerWallet,
    signer,
    fan,
    fanWallet,
    attestor,
    attestorPk,
    deployed,
    agentId,
    vault,
    matchData,
    matchDataBase,
    relayBase,
    runner,
    nextMarketId,
  };
}
