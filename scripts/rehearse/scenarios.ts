/**
 * The three hardening scenarios run against the shared infrastructure `boot()` sets up.
 *
 * Each proves a property the unit and integration test suites already assert in isolation, but
 * here against the real, live, end-to-end pipeline: a real replay, a real agent process, a real
 * quote relay, real on-chain transactions. The first attempt at the sniper case initially skipped
 * this distinction and only proved the happy path -- see the doc comment on `runSniperScenario`.
 */
import { AgentRunner } from "@ninety/agents/src/runner.js";
import { steadyStrategy } from "@ninety/agents/src/strategies/steady.js";
import { BetRouterAbi, MarketManagerAbi, type Quote, SettlementReceiverAbi } from "@ninety/core";
import type { Address } from "viem";
import {
  assert,
  CHAIN,
  DEPLOYER_PK,
  deliverSettlement,
  GOAL_1_MATCH_CLOCK_SEC,
  GOAL_2_MATCH_CLOCK_SEC,
  log,
  MATCH_ID,
  MOCK_USD_ABI,
  type QuotesResponse,
  type RehearsalContext,
  waitForOutcome,
  writeAndWait,
} from "./lib.js";

const BET_STATUS_WON = 2;
const BET_STATUS_VOIDED = 4;

async function fetchBestQuote(relayBase: string, marketId: bigint): Promise<QuotesResponse> {
  const res = await fetch(`${relayBase}/quotes/${marketId}?side=yes`);
  const body = (await res.json()) as QuotesResponse;
  assert(
    body.quotes.length === 1,
    `expected exactly 1 quote from the relay, got ${body.quotes.length}`,
  );
  return body;
}

function toContractQuotes(best: QuotesResponse) {
  return best.quotes.map((q) => ({
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
  }));
}

/**
 * Sweeps for a fresh quote and places a bet on it, retrying the whole sweep-fetch-place sequence
 * if the quote expires before the transaction lands. Steady's quotes carry a short, deliberate
 * 5-second expiry (STEADY_QUOTE_EXPIRY_SEC) so a stale price can't be sniped -- exactly the
 * property this file's sniper scenario proves -- and the sweep -> HTTP fetch -> simulate -> send
 * -> wait sequence a fan's own script runs can occasionally take long enough to cross that
 * boundary itself. Retrying with a fresh sweep is the correct response, not loosening the expiry.
 */
async function sweepAndPlaceBet(
  ctx: RehearsalContext,
  marketId: bigint,
  stake: bigint,
): Promise<{ betId: bigint; probYesBps: number }> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await ctx.runner.sweep();
    const best = await fetchBestQuote(ctx.relayBase, marketId);
    try {
      return await placeBet(ctx, marketId, stake, best);
    } catch (err) {
      const expired = /QuoteExpired/.test(String(err));
      if (!expired || attempt === attempts) throw err;
      log(
        "bet",
        `quote expired before placeBet landed (attempt ${attempt}/${attempts}); re-sweeping`,
      );
    }
  }
  throw new Error("unreachable");
}

async function placeBet(
  ctx: RehearsalContext,
  marketId: bigint,
  stake: bigint,
  best: QuotesResponse,
): Promise<{ betId: bigint; probYesBps: number }> {
  const args = [marketId, 0, stake, 0n, toContractQuotes(best)] as const;

  // Simulate first to get the real return value (groupId, betIds) -- placeBet's actual on-chain
  // ids, not a hand-maintained counter that could drift if a scenario ever placed more than one
  // bet or a fill split across several agents.
  const { result } = await ctx.publicClient.simulateContract({
    address: ctx.deployed.betRouter,
    abi: BetRouterAbi,
    functionName: "placeBet",
    args,
    account: ctx.fan,
  } as never);
  const [, betIds] = result as [bigint, bigint[]];
  assert(
    betIds.length === 1,
    `expected exactly one bet id from a single-quote fill, got ${betIds.length}`,
  );

  const hash = await ctx.fanWallet.writeContract({
    address: ctx.deployed.betRouter,
    abi: BetRouterAbi,
    functionName: "placeBet",
    args,
    chain: ctx.testClient.chain,
    account: ctx.fan,
  } as never);
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  assert(receipt.status === "success", "placeBet must succeed");

  // Guarded by fetchBestQuote's assert (exactly one quote), so this index is provably in bounds.
  return { betId: betIds[0]!, probYesBps: best.quotes[0]!.quote.probYesBps };
}

async function balanceOf(ctx: RehearsalContext, address: Address): Promise<bigint> {
  return (await ctx.publicClient.readContract({
    address: ctx.deployed.ausd,
    abi: MOCK_USD_ABI,
    functionName: "balanceOf",
    args: [address],
  })) as bigint;
}

async function getBetStatus(ctx: RehearsalContext, betId: bigint): Promise<number> {
  const bet = (await ctx.publicClient.readContract({
    address: ctx.deployed.betRouter,
    abi: BetRouterAbi,
    functionName: "getBet",
    args: [betId],
  })) as { status: number };
  return bet.status;
}

// ------------------------------------------------------------------
// Scenario 1: the happy path -- a bet placed well before the event wins the exact payout
// ------------------------------------------------------------------

export async function runHappyPathScenario(ctx: RehearsalContext): Promise<void> {
  log("happy-path", "=== scenario: bet placed before the event, must win the exact payout ===");
  const marketId = ctx.nextMarketId();
  const windowStart = Math.floor(GOAL_1_MATCH_CLOCK_SEC - 100);
  const windowEnd = Math.ceil(GOAL_1_MATCH_CLOCK_SEC + 50);
  const etaSec = Math.ceil(GOAL_1_MATCH_CLOCK_SEC / ctx.replaySpeed);

  const now = Math.floor(Date.now() / 1000);
  const closesAt = now + etaSec + 5; // just enough margin past the expected goal to place the bet
  await writeAndWait(ctx.deployerWallet, ctx.publicClient, {
    address: ctx.deployed.marketManager,
    abi: MarketManagerAbi,
    functionName: "openMarket",
    args: [1n, ctx.templateId, windowStart, windowEnd, BigInt(closesAt), 0],
  });
  log("happy-path", `opened market ${marketId}: window [${windowStart}, ${windowEnd})`);

  const stake = 10_000_000n;
  const { betId, probYesBps } = await sweepAndPlaceBet(ctx, marketId, stake);
  const expectedPayout = (stake * 10000n) / BigInt(probYesBps);
  log(
    "happy-path",
    `bet ${betId} placed at ${probYesBps}bps; expected payout ${Number(expectedPayout) / 1e6} mUSD`,
  );

  const settlement = await waitForOutcome(
    ctx.matchDataBase,
    MATCH_ID,
    "GOAL_NEXT_N",
    windowStart,
    windowEnd,
    (etaSec + 30) * 1000,
  );
  log(
    "happy-path",
    `resolved: ${settlement.outcome}, qualifyingEventTsWallClock=${settlement.qualifyingEventTsWallClock}`,
  );

  // Wait in *real* time for closesAt to pass, rather than warping the chain clock forward with
  // testClient.increaseTime. This scenario runs before suspension and sniper on the same shared
  // anvil instance; jumping block.timestamp ahead of real Date.now() here previously left every
  // later quote looking expired the instant it was signed (Steady computes expiry from real wall
  // time), since real time could never catch up to the artificially-skipped chain clock. Keeping
  // chain time and real time in sync throughout is what makes the later scenarios' timestamp
  // comparisons meaningful at all.
  const remainingMs = Math.max(0, (closesAt - Math.floor(Date.now() / 1000) + 1) * 1000);
  if (remainingMs > 0) {
    log(
      "happy-path",
      `waiting ${Math.ceil(remainingMs / 1000)}s in real time for the betting window to close`,
    );
    await new Promise((r) => setTimeout(r, remainingMs));
  }
  await ctx.testClient.mine({ blocks: 1 });

  await writeAndWait(ctx.deployerWallet, ctx.publicClient, {
    address: ctx.deployed.settlementReceiver,
    abi: SettlementReceiverAbi,
    functionName: "setSimAttestor",
    args: [ctx.attestor.address],
  });
  await deliverSettlement({
    receiver: ctx.deployed.settlementReceiver,
    simForwarder: ctx.deployed.simForwarder,
    attestorPk: ctx.attestorPk,
    matchId: "1",
    marketId: String(marketId),
    outcome: settlement.outcome,
    qualifyingEventTsWallClock: settlement.qualifyingEventTsWallClock,
  });

  await writeAndWait(ctx.deployerWallet, ctx.publicClient, {
    address: ctx.deployed.betRouter,
    abi: BetRouterAbi,
    functionName: "settleBatch",
    args: [[betId]],
  });

  const status = await getBetStatus(ctx, betId);
  assert(status === BET_STATUS_WON, `expected the bet to be Won (2), got status ${status}`);

  const before = await balanceOf(ctx, ctx.fan.address);
  await writeAndWait(ctx.fanWallet, ctx.publicClient, {
    address: ctx.deployed.betRouter,
    abi: BetRouterAbi,
    functionName: "claim",
    args: [[betId]],
  });
  const after = await balanceOf(ctx, ctx.fan.address);
  const actualPayout = after - before;

  log(
    "happy-path",
    `fan received ${Number(actualPayout) / 1e6} mUSD (expected ${Number(expectedPayout) / 1e6})`,
  );
  assert(
    actualPayout === expectedPayout,
    `payout mismatch: got ${actualPayout}, expected ${expectedPayout}`,
  );
  log("happy-path", "PASSED");
}

// ------------------------------------------------------------------
// Scenario 2: the sniper case -- a bet placed after the event must be voided, not paid
//
// The on-chain rule (BetRouter.sol) is:
//   sniped = qualifyingEventTs != 0 && placedAt + DELAY_SECONDS > qualifyingEventTs
// This is true not only for a bet placed in the few seconds before the event, but for ANY bet
// placed after it too -- placedAt >= qualifyingEventTs trivially satisfies the inequality. That
// makes this scenario simple to prove correctly without racing a narrow timing window: place the
// bet only once match-data confirms the event has already happened, then verify the vote is
// voided and the fan gets back exactly their stake, not a payout.
// ------------------------------------------------------------------

export async function runSniperScenario(ctx: RehearsalContext): Promise<void> {
  log("sniper", "=== scenario: a bet placed AFTER the event must be voided, not paid ===");
  const marketId = ctx.nextMarketId();
  const windowStart = Math.floor(GOAL_2_MATCH_CLOCK_SEC - 100);
  const windowEnd = Math.ceil(GOAL_2_MATCH_CLOCK_SEC + 50);
  // Generous but not unreachable: we want to still be able to call placeBet long after the real
  // event, to prove the anti-sniping rule -- not MarketManager's own closesAt check -- is what
  // catches this, while keeping closesAt itself reachable with a bounded time jump below. This is
  // the last scenario this rehearsal runs, so warping the chain clock forward here (unlike in
  // happy-path, which runs first and must keep chain time synced with real time for the scenarios
  // after it) cannot corrupt anything downstream.
  const now = Math.floor(Date.now() / 1000);
  const closesAt = now + 90;
  await writeAndWait(ctx.deployerWallet, ctx.publicClient, {
    address: ctx.deployed.marketManager,
    abi: MarketManagerAbi,
    functionName: "openMarket",
    args: [1n, ctx.templateId, windowStart, windowEnd, BigInt(closesAt), 0],
  });
  log("sniper", `opened market ${marketId}: window [${windowStart}, ${windowEnd})`);

  log(
    "sniper",
    "waiting for the replay to actually reach the second goal before betting late, on purpose",
  );
  const settlement = await waitForOutcome(
    ctx.matchDataBase,
    MATCH_ID,
    "GOAL_NEXT_N",
    windowStart,
    windowEnd,
    120_000,
  );
  log(
    "sniper",
    `goal has already happened (wall clock ${settlement.qualifyingEventTsWallClock}); placing a bet on it anyway`,
  );

  // The on-chain market doesn't know the event already happened -- no report has landed yet --
  // so the agent will happily quote it and the fan can still bet. That information asymmetry is
  // exactly what the anti-sniping rule exists to close.
  const stake = 10_000_000n;
  const { betId } = await sweepAndPlaceBet(ctx, marketId, stake);
  log(
    "sniper",
    `late bet ${betId} placed successfully on chain (the market itself doesn't know yet)`,
  );

  // Push the chain past closesAt so resolve() will accept the report. Safe here -- see the note
  // on closesAt above.
  const remainingSec = Math.max(0, closesAt - Math.floor(Date.now() / 1000) + 1);
  await ctx.testClient.increaseTime({ seconds: remainingSec });
  await ctx.testClient.mine({ blocks: 1 });

  await deliverSettlement({
    receiver: ctx.deployed.settlementReceiver,
    simForwarder: ctx.deployed.simForwarder,
    attestorPk: ctx.attestorPk,
    matchId: "1",
    marketId: String(marketId),
    outcome: settlement.outcome,
    qualifyingEventTsWallClock: settlement.qualifyingEventTsWallClock,
  });

  await writeAndWait(ctx.deployerWallet, ctx.publicClient, {
    address: ctx.deployed.betRouter,
    abi: BetRouterAbi,
    functionName: "settleBatch",
    args: [[betId]],
  });

  const status = await getBetStatus(ctx, betId);
  assert(
    status === BET_STATUS_VOIDED,
    `expected the late bet to be Voided (4), got status ${status}`,
  );
  log("sniper", "confirmed: settleBatch marked the late bet Voided, not Won");

  const before = await balanceOf(ctx, ctx.fan.address);
  await writeAndWait(ctx.fanWallet, ctx.publicClient, {
    address: ctx.deployed.betRouter,
    abi: BetRouterAbi,
    functionName: "claim",
    args: [[betId]],
  });
  const after = await balanceOf(ctx, ctx.fan.address);
  const refunded = after - before;

  assert(
    refunded === stake,
    `a voided bet must refund exactly the stake; got ${refunded}, staked ${stake}`,
  );
  log("sniper", `fan got back exactly the ${Number(stake) / 1e6} mUSD stake, no payout. PASSED`);
}

// ------------------------------------------------------------------
// Scenario 3: suspension blocks both quoting and betting, and resuming restores both
// ------------------------------------------------------------------

export async function runSuspensionScenario(ctx: RehearsalContext): Promise<void> {
  log(
    "suspension",
    "=== scenario: a suspended market blocks quoting and betting; resuming restores both ===",
  );
  const marketId = ctx.nextMarketId();
  // Far beyond anything the replay will reach during this run -- this scenario tests the
  // suspend/resume mechanism itself, not a real match outcome, so the window's content doesn't
  // matter and is never settled.
  const windowStart = 200_000;
  const windowEnd = 200_100;
  const now = Math.floor(Date.now() / 1000);
  await writeAndWait(ctx.deployerWallet, ctx.publicClient, {
    address: ctx.deployed.marketManager,
    abi: MarketManagerAbi,
    functionName: "openMarket",
    args: [1n, ctx.templateId, windowStart, windowEnd, BigInt(now + 600), 0],
  });
  log("suspension", `opened market ${marketId}`);

  // A dedicated runner with an in-memory recording publisher, rather than the shared HTTP relay:
  // the relay only drops a quote once it expires (Steady's quotes live 5s), so checking what the
  // relay currently serves could be ambiguous about whether a *fresh* quote was actually issued.
  // Counting the agent's own publish calls is unambiguous.
  const published: Quote[] = [];
  const spyRunner = new AgentRunner({
    chain: CHAIN,
    rpcUrl: ctx.rpcUrl,
    agentId: ctx.agentId,
    quoteSigner: ctx.signer,
    agentRegistry: ctx.deployed.agentRegistry,
    marketManager: ctx.deployed.marketManager,
    betRouter: ctx.deployed.betRouter,
    strategy: steadyStrategy,
    publisher: {
      publish: async (quote) => {
        published.push(quote);
      },
    },
  });

  await spyRunner.sweep();
  assert(
    published.length === 1,
    `expected the agent to quote the open market once, got ${published.length}`,
  );
  log("suspension", "agent quoted the open market");

  await writeAndWait(ctx.deployerWallet, ctx.publicClient, {
    address: ctx.deployed.marketManager,
    abi: MarketManagerAbi,
    functionName: "suspend",
    args: [marketId, `0x${"73".repeat(32)}`], // arbitrary bytes32 reason
  });
  const bettableWhileSuspended = await ctx.publicClient.readContract({
    address: ctx.deployed.marketManager,
    abi: MarketManagerAbi,
    functionName: "isBettable",
    args: [marketId],
  });
  assert(bettableWhileSuspended === false, "isBettable must be false while suspended");
  log("suspension", "confirmed suspended: isBettable() == false");

  published.length = 0;
  await spyRunner.sweep();
  assert(
    published.length === 0,
    `agent must not quote a suspended market, got ${published.length} quote(s)`,
  );
  log("suspension", "confirmed: agent stopped quoting the suspended market");

  // Prove the *contract*, not just the agent's good behaviour, blocks betting: simulate a
  // placeBet call with an empty quotes array. isBettable() is BetRouter's very first check, ahead
  // of even the fill-count check, so this reverts with MarketNotBettable regardless of quote
  // contents.
  let revertedWithMarketNotBettable = false;
  try {
    await ctx.publicClient.simulateContract({
      address: ctx.deployed.betRouter,
      abi: BetRouterAbi,
      functionName: "placeBet",
      args: [marketId, 0, 1_000_000n, 0n, []],
      account: ctx.fan,
    } as never);
  } catch (err) {
    revertedWithMarketNotBettable = /MarketNotBettable/.test(String(err));
  }
  assert(
    revertedWithMarketNotBettable,
    "placeBet must revert with MarketNotBettable while suspended",
  );
  log("suspension", "confirmed: placeBet reverts with MarketNotBettable while suspended");

  await writeAndWait(ctx.deployerWallet, ctx.publicClient, {
    address: ctx.deployed.marketManager,
    abi: MarketManagerAbi,
    functionName: "resume",
    args: [marketId],
  });
  const bettableAfterResume = await ctx.publicClient.readContract({
    address: ctx.deployed.marketManager,
    abi: MarketManagerAbi,
    functionName: "isBettable",
    args: [marketId],
  });
  assert(bettableAfterResume === true, "isBettable must be true again after resume()");

  published.length = 0;
  await spyRunner.sweep();
  assert(
    published.length === 1,
    `agent must resume quoting after resume(), got ${published.length}`,
  );
  log("suspension", "confirmed: agent resumed quoting after resume(). PASSED");
}
