import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BetRouterAbi, type LockOffer, OddsLockAbi, type Quote } from "@ninety/core";
import { createPublicClient, createWalletClient, http, maxUint256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentRunner } from "../src/runner.js";
import { steadyStrategy } from "../src/strategies/steady.js";
import {
  type DeployedAddresses,
  deployTestStack,
  startAnvil,
  stopAnvil,
  testChain,
} from "./support/chain.js";

const execFileAsync = promisify(execFile);
const PORT = 8556;
const RPC_URL = `http://127.0.0.1:${PORT}`;
const CONTRACTS_DIR = new URL("../../../contracts/", import.meta.url).pathname;
// Anvil's well-known default accounts #0 (deployer) and #1 (the fan). Local test chain only.
const DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const FAN_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const send = (...args: string[]) =>
  execFileAsync("cast", ["send", ...args, "--private-key", DEPLOYER_PK, "--rpc-url", RPC_URL], {
    cwd: CONTRACTS_DIR,
  });

describe("AgentRunner holds (Odds Lock, against a real deployed contract set)", () => {
  let anvilProc: Awaited<ReturnType<typeof startAnvil>>;
  let deployed: DeployedAddresses;
  const signer = privateKeyToAccount(
    "0x9717a79468d4f8830c77f69d16ed1b0b64a0555f3254ecf7aaaabc5c452d4084",
  );
  const fan = privateKeyToAccount(FAN_PK);
  const publicClient = createPublicClient({ chain: testChain, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account: fan, chain: testChain, transport: http(RPC_URL) });

  const offers: LockOffer[] = [];
  const offerSigs: `0x${string}`[] = [];
  const honoured: { lockId: bigint; fan: string; quote: Quote; signature: `0x${string}` }[] = [];
  let runner: AgentRunner;

  beforeAll(async () => {
    anvilProc = await startAnvil(PORT);
    deployed = await deployTestStack(RPC_URL, DEPLOYER_PK);

    await send(
      deployed.agentRegistry,
      "register(address,bytes,string)",
      signer.address,
      "0xcafe",
      "steady",
    );
    const vault = (
      await execFileAsync(
        "cast",
        ["call", deployed.agentRegistry, "vaultOf(uint32)(address)", "1", "--rpc-url", RPC_URL],
        { cwd: CONTRACTS_DIR },
      )
    ).stdout.trim();
    await send(deployed.nusd, "mint(address,uint256)", DEPLOYER, "5000000000");
    await send(deployed.nusd, "approve(address,uint256)", vault, "5000000000");
    await send(vault, "deposit(uint256,address)", "5000000000", DEPLOYER);
    await send(deployed.nusd, "mint(address,uint256)", fan.address, "100000000");

    const now = Math.floor(Date.now() / 1000);
    await send(
      deployed.marketManager,
      "createMatch(bytes32,uint64,string)",
      `0x${"11".repeat(32)}`,
      String(now),
      "",
    );
    const templateId = (await execFileAsync("cast", ["keccak", "CORNER_NEXT_N"])).stdout.trim();
    await send(
      deployed.marketManager,
      "openMarket(uint64,bytes32,uint32,uint32,uint64,uint16)",
      "1",
      templateId,
      "600",
      "780",
      String(now + 3600),
      "0",
    );

    const erc20 = parseAbi(["function approve(address,uint256) returns (bool)"]);
    for (const spender of [deployed.oddsLock, deployed.betRouter]) {
      await publicClient.waitForTransactionReceipt({
        hash: await wallet.writeContract({
          address: deployed.nusd,
          abi: erc20,
          functionName: "approve",
          args: [spender, maxUint256],
        }),
      });
    }

    runner = new AgentRunner({
      chain: testChain,
      rpcUrls: [RPC_URL],
      agentId: 1,
      quoteSigner: signer,
      agentRegistry: deployed.agentRegistry,
      marketManager: deployed.marketManager,
      betRouter: deployed.betRouter,
      oddsLock: deployed.oddsLock,
      strategy: steadyStrategy,
      publisher: {
        publish: async () => {},
        publishLockOffer: async (offer, signature) => {
          offers.push(offer);
          offerSigs.push(signature);
        },
        publishHold: async (lockId, fanAddress, quote, signature) => {
          honoured.push({ lockId, fan: fanAddress, quote, signature });
        },
      },
    });
  }, 90_000);

  afterAll(() => stopAnvil(anvilProc));

  it("offers holds on both sides, signed so OddsLock accepts them", async () => {
    await runner.sweep();
    expect(offers.map((o) => o.side).sort()).toEqual([0, 1]);

    const no = offers.findIndex((o) => o.side === 1);
    await publicClient.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        address: deployed.oddsLock,
        abi: OddsLockAbi,
        functionName: "buy",
        args: [offers[no]!, offerSigs[no]!, 10_000_000n, 10_000_000n],
      }),
    });
    expect(
      await publicClient.readContract({
        address: deployed.oddsLock,
        abi: OddsLockAbi,
        functionName: "lockCount",
      }),
    ).toBe(1n);
  }, 30_000);

  it("honours the hold with one quote at the held price, for the fan who bought it", async () => {
    await runner.sweep(); // picks up the hold
    await runner.honourHolds();
    await runner.honourHolds(); // one at a time: nothing new while the first is live

    expect(honoured).toHaveLength(1);
    const { lockId, fan: holder, quote, signature } = honoured[0]!;
    const held = offers.find((o) => o.side === 1)!;
    expect(lockId).toBe(1n);
    expect(holder.toLowerCase()).toBe(fan.address.toLowerCase());
    expect(quote.probNoBps).toBe(held.probBps);
    expect(quote.probYesBps).toBe(9800);
    expect(quote.maxStake).toBe(10_000_000n);

    // The fan bets it, through BetRouter like any other bet.
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        address: deployed.betRouter,
        abi: BetRouterAbi,
        functionName: "placeBet",
        args: [1n, 1, 10_000_000n, 0n, [{ quote, signature }]],
      }),
    });
    expect(receipt.status).toBe("success");
  }, 30_000);

  it("never honours a hold twice over: once bet, no more quotes for it", async () => {
    // Let the bet-on quote expire, then look again.
    await new Promise((r) => setTimeout(r, (steadyStrategy.quoteExpirySec + 1) * 1000));
    await runner.honourHolds();
    expect(honoured).toHaveLength(1);
  }, 30_000);
});
