import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUOTE_TYPES, type Quote, quoteDomain } from "../src/eip712.js";
import { AgentRunner } from "../src/runner.js";
import { STEADY_MARGIN_BPS, STEADY_MAX_STAKE_PER_QUOTE } from "../src/strategies/steady.js";
import {
  type DeployedAddresses,
  deployTestStack,
  startAnvil,
  stopAnvil,
  testChain,
} from "./support/chain.js";

const execFileAsync = promisify(execFile);
const PORT = 8555;
const RPC_URL = `http://127.0.0.1:${PORT}`;
const CONTRACTS_DIR = new URL("../../../contracts/", import.meta.url).pathname;

// Anvil's well-known default account #0, used only as the local test deployer.
const DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

function cast(args: string[]): Promise<string> {
  return execFileAsync("cast", args, { cwd: CONTRACTS_DIR }).then((r) => r.stdout.trim());
}

/** `cast call ...(uint256)` prints a human-readable suffix like "1500000000 [1.5e9]"; this keeps
 *  only the exact decimal value, which is what BigInt() needs. */
function castUint(args: string[]): Promise<bigint> {
  return cast(args).then((out) => BigInt(out.split(" ")[0]!));
}

describe("AgentRunner (against a real deployed contract set)", () => {
  let anvilProc: Awaited<ReturnType<typeof startAnvil>>;
  let deployed: DeployedAddresses;
  let agentId: number;
  let vault: `0x${string}`;
  const signerPk = "0x9717a79468d4f8830c77f69d16ed1b0b64a0555f3254ecf7aaaabc5c452d4084" as const; // freshly generated test-only key
  const signer = privateKeyToAccount(signerPk);

  beforeAll(async () => {
    anvilProc = await startAnvil(PORT);
    deployed = await deployTestStack(RPC_URL, DEPLOYER_PK);

    // Register one agent with the fixed test signer, matching how a real operator would: the
    // quote-signing key is a plain address, unrelated to any wallet.
    await cast([
      "send",
      deployed.agentRegistry,
      "register(address,bytes,string)",
      signer.address,
      "0xcafe",
      "steady-test",
      "--private-key",
      DEPLOYER_PK,
      "--rpc-url",
      RPC_URL,
    ]);
    agentId = 1;
    vault = (await cast([
      "call",
      deployed.agentRegistry,
      "vaultOf(uint32)(address)",
      String(agentId),
      "--rpc-url",
      RPC_URL,
    ])) as `0x${string}`;

    // Fund the vault: mint MockUSD to the deployer, approve, deposit.
    await cast([
      "send",
      deployed.ausd,
      "mint(address,uint256)",
      DEPLOYER_ACCOUNT(),
      "5000000000", // 5000 * 1e6
      "--private-key",
      DEPLOYER_PK,
      "--rpc-url",
      RPC_URL,
    ]);
    await cast([
      "send",
      deployed.ausd,
      "approve(address,uint256)",
      vault,
      "5000000000",
      "--private-key",
      DEPLOYER_PK,
      "--rpc-url",
      RPC_URL,
    ]);
    await cast([
      "send",
      vault,
      "deposit(uint256,address)",
      "5000000000",
      DEPLOYER_ACCOUNT(),
      "--private-key",
      DEPLOYER_PK,
      "--rpc-url",
      RPC_URL,
    ]);

    // Create a match and open one market: a 2-minute SHOT_ON_TARGET_NEXT_N window starting now.
    const now = Math.floor(Date.now() / 1000);
    await cast([
      "send",
      deployed.marketManager,
      "createMatch(bytes32,uint64,string)",
      "0x" + "11".repeat(32),
      String(now),
      "",
      "--private-key",
      DEPLOYER_PK,
      "--rpc-url",
      RPC_URL,
    ]);
    const templateId = await cast(["keccak", "SHOT_ON_TARGET_NEXT_N"]);
    await cast([
      "send",
      deployed.marketManager,
      "openMarket(uint64,bytes32,uint32,uint32,uint64,uint16)",
      "1",
      templateId,
      "600",
      "720",
      String(now + 3600),
      "0",
      "--private-key",
      DEPLOYER_PK,
      "--rpc-url",
      RPC_URL,
    ]);
  }, 60_000);

  afterAll(() => {
    stopAnvil(anvilProc);
  });

  function DEPLOYER_ACCOUNT(): string {
    return "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // anvil default account #0's address
  }

  it("sweeps the open market and publishes a signed, on-chain-valid quote", async () => {
    const published: { quote: Quote; signature: `0x${string}` }[] = [];
    const runner = new AgentRunner({
      chain: testChain,
      rpcUrl: RPC_URL,
      agentId,
      quoteSigner: signer,
      agentRegistry: deployed.agentRegistry,
      marketManager: deployed.marketManager,
      betRouter: deployed.betRouter,
      publisher: {
        publish: async (quote, signature) => {
          published.push({ quote, signature });
        },
      },
    });

    await runner.sweep();

    expect(published).toHaveLength(1);
    const { quote, signature } = published[0]!;

    expect(quote.marketId).toBe(1n);
    expect(quote.agentId).toBe(agentId);
    // 120-second window on SHOT_ON_TARGET_NEXT_N, 300bps margin -- matches steadyPrice directly.
    expect(quote.probYesBps + quote.probNoBps).toBeGreaterThanOrEqual(10_000 + STEADY_MARGIN_BPS);
    expect(quote.maxStake).toBeLessThanOrEqual(STEADY_MAX_STAKE_PER_QUOTE);
    expect(quote.maxStake).toBeGreaterThan(0n);

    // The published signature must verify against the configured signer under BetRouter's own
    // domain and struct type -- not just "some signature was produced".
    const valid = await verifyTypedData({
      address: signer.address,
      domain: quoteDomain(testChain.id, deployed.betRouter),
      types: QUOTE_TYPES,
      primaryType: "Quote",
      message: quote,
      signature,
    });
    expect(valid).toBe(true);
  }, 20_000);

  it("a second sweep republishes with a fresh, later expiry (short-lived quotes)", async () => {
    const published: { quote: Quote; signature: `0x${string}` }[] = [];
    const runner = new AgentRunner({
      chain: testChain,
      rpcUrl: RPC_URL,
      agentId,
      quoteSigner: signer,
      agentRegistry: deployed.agentRegistry,
      marketManager: deployed.marketManager,
      betRouter: deployed.betRouter,
      publisher: { publish: async (quote, signature) => void published.push({ quote, signature }) },
    });

    await runner.sweep();
    await new Promise((r) => setTimeout(r, 1100));
    await runner.sweep();

    expect(published).toHaveLength(2);
    expect(published[1]!.quote.expiry).toBeGreaterThan(published[0]!.quote.expiry);
    expect(published[1]!.quote.salt).not.toBe(published[0]!.quote.salt);
  }, 20_000);

  it("stops quoting once the vault has no free capital left on that market", async () => {
    // Drain quotableBudget(1) to zero by impersonating BetRouter (the only address AgentVault's
    // onlyRouter modifier accepts) and locking the vault's entire exposure cap directly. This
    // isolates the vault's state from needing a full signed-bet flow just to set it up.
    await cast(["rpc", "anvil_impersonateAccount", deployed.betRouter, "--rpc-url", RPC_URL]);
    await cast([
      "rpc",
      "anvil_setBalance",
      deployed.betRouter,
      "0x8AC7230489E80000",
      "--rpc-url",
      RPC_URL,
    ]);

    const cap = await castUint([
      "call",
      vault,
      "quotableBudget(uint256)(uint256)",
      "1",
      "--rpc-url",
      RPC_URL,
    ]);
    expect(cap).toBeGreaterThan(0n);

    await cast([
      "send",
      vault,
      "lockLiability(uint256,uint256,uint256)",
      "1",
      "999",
      cap.toString(),
      "--unlocked",
      "--from",
      deployed.betRouter,
      "--rpc-url",
      RPC_URL,
    ]);

    const budgetAfter = await castUint([
      "call",
      vault,
      "quotableBudget(uint256)(uint256)",
      "1",
      "--rpc-url",
      RPC_URL,
    ]);
    expect(budgetAfter).toBe(0n);

    const published: { quote: Quote; signature: `0x${string}` }[] = [];
    const runner = new AgentRunner({
      chain: testChain,
      rpcUrl: RPC_URL,
      agentId,
      quoteSigner: signer,
      agentRegistry: deployed.agentRegistry,
      marketManager: deployed.marketManager,
      betRouter: deployed.betRouter,
      publisher: { publish: async (quote, signature) => void published.push({ quote, signature }) },
    });

    await runner.sweep();

    expect(published).toHaveLength(0);
  }, 20_000);
});
