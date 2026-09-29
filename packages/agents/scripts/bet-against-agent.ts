/**
 * Live test helper: plays a match and bets against one specific agent's quotes, so an operator can
 * watch their own agent take bets and learn from them. Not part of the product.
 *
 *   tsx --env-file=../../.env scripts/bet-against-agent.ts <agentId> [wyscoutMatchId]
 *
 * Drives the market scheduler through the web app's own API (what an open match screen does), funds
 * a throwaway bettor from the deployer (a little MON, freshly minted nUSD), and places two small
 * bets on the first market the agent is quoting (two bets on one market type is what the agent's
 * memory needs before it will draw a conclusion). Then keeps the match running until the
 * settlement watcher has settled them, and returns the bettor's leftover MON to the deployer.
 */
import {
  BetRouterAbi,
  fromWire,
  MarketManagerAbi,
  rateLimitedHttp,
  type SignedQuoteWire,
  TEMPLATE_NAME_BY_ID,
  type TemplateName,
} from "@ninety/core";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  parseAbi,
  parseEther,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const agentId = Number(process.argv[2]);
const wyscoutId = process.argv[3] ?? "1694392";
if (!agentId) throw new Error("usage: bet-against-agent.ts <agentId> [wyscoutMatchId]");

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};
const RPC = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const chain = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const publicClient = createPublicClient({ chain, transport: rateLimitedHttp(RPC) });
const MARKETS = env("NEXT_PUBLIC_MARKET_MANAGER") as Address;
const ROUTER = env("NEXT_PUBLIC_BET_ROUTER") as Address;
const NUSD = env("NUSD_ADDRESS") as Address;
const WEB = "http://localhost:3000";
const MATCH_DATA = "http://localhost:8082";
const RELAY = "http://localhost:8081";
const STAKE = 5_000_000n;
const NUSD_ABI = parseAbi([
  "function mint(address,uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const deployer = privateKeyToAccount(env("DEPLOYER_PRIVATE_KEY") as `0x${string}`);
const deployerWallet = createWalletClient({
  account: deployer,
  chain,
  transport: rateLimitedHttp(RPC),
});
const bettor = privateKeyToAccount(generatePrivateKey());
const bettorWallet = createWalletClient({
  account: bettor,
  chain,
  transport: rateLimitedHttp(RPC),
});

async function send(p: Promise<`0x${string}`>) {
  const r = await publicClient.waitForTransactionReceipt({ hash: await p });
  if (r.status !== "success") throw new Error(`tx reverted: ${r.transactionHash}`);
  return r;
}

let ticking = true;
async function driveScheduler() {
  await fetch(`${MATCH_DATA}/matches/${wyscoutId}/replay/start?speed=5`, { method: "POST" });
  await fetch(`${WEB}/api/matches/${wyscoutId}/ensure`, { method: "POST" });
  while (ticking) {
    await fetch(`${WEB}/api/matches/${wyscoutId}/schedule-tick`, { method: "POST" }).catch(
      () => {},
    );
    await sleep(10_000);
  }
}

async function main() {
  log(`bettor ${bettor.address}; funding from deployer`);
  await send(deployerWallet.sendTransaction({ to: bettor.address, value: parseEther("0.12") }));
  await send(
    deployerWallet.writeContract({
      address: NUSD,
      abi: NUSD_ABI,
      functionName: "mint",
      args: [bettor.address, 50_000_000n],
    }),
  );
  await send(
    bettorWallet.writeContract({
      address: NUSD,
      abi: NUSD_ABI,
      functionName: "approve",
      args: [ROUTER, 50_000_000n],
    }),
  );

  const scheduler = driveScheduler();
  const betsByTemplate = new Map<TemplateName, bigint[]>();
  const betsOn = new Map<bigint, number>();
  const deadline = Date.now() + 10 * 60_000;
  let done: TemplateName | undefined;

  while (!done && Date.now() < deadline) {
    const count = (await publicClient.readContract({
      address: MARKETS,
      abi: MarketManagerAbi,
      functionName: "marketCount",
    })) as bigint;
    for (let id = count; id > 0n && id > count - 6n && !done; id--) {
      if ((betsOn.get(id) ?? 0) >= 2) continue;
      const { quotes } = (await (await fetch(`${RELAY}/quotes/${id}?side=yes`)).json()) as {
        quotes: SignedQuoteWire[];
      };
      const mine = quotes.map(fromWire).find((q) => q.quote.agentId === agentId);
      if (!mine || mine.quote.maxStake < STAKE) continue;
      const market = (await publicClient.readContract({
        address: MARKETS,
        abi: MarketManagerAbi,
        functionName: "getMarket",
        args: [id],
      })) as { templateId: `0x${string}` };
      const template = TEMPLATE_NAME_BY_ID[market.templateId]!;
      try {
        await send(
          bettorWallet.writeContract({
            address: ROUTER,
            abi: BetRouterAbi,
            functionName: "placeBet",
            args: [id, 0, STAKE, 0n, [{ quote: mine.quote, signature: mine.signature }]],
          } as never),
        );
      } catch (err) {
        log(
          `bet on market ${id} failed (quote likely expired), retrying later:`,
          String(err).split("\n")[0],
        );
        continue;
      }
      betsOn.set(id, (betsOn.get(id) ?? 0) + 1);
      const list = [...(betsByTemplate.get(template) ?? []), id];
      betsByTemplate.set(template, list);
      log(
        `bet ${STAKE / 1_000_000n} nUSD YES on market ${id} (${template}) against agent ${agentId}`,
      );
      if (list.length >= 2) done = template;
    }
    await sleep(3000);
  }
  if (!done) log("never got two bets on one market type -- stopping");

  // Keep the match running until the watcher has settled them.
  for (let i = 0; i < 90; i++) {
    const res = await fetch(`${WEB}/api/indexer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `{ Bet(where:{agent_id:{_eq:"${agentId}"}}) { id status } }` }),
    });
    const bets = ((await res.json()) as { data: { Bet: { id: string; status: string }[] } }).data
      .Bet;
    if (bets.length && bets.every((b) => b.status !== "Open")) {
      log("settled:", JSON.stringify(bets));
      break;
    }
    await sleep(5000);
  }
  ticking = false;
  await scheduler;

  // Send what's left back: an unrecovered throwaway key is MON gone for good.
  const left = await publicClient.getBalance({ address: bettor.address });
  const fee = parseEther("0.005");
  if (left > fee) {
    await send(bettorWallet.sendTransaction({ to: deployer.address, value: left - fee }));
    log(`returned ${Number(left - fee) / 1e18} MON to the deployer`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
