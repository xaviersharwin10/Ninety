import { MarketManagerAbi, TEMPLATE_ID, TEMPLATE_NAMES } from "@ninety/core";
import { createWalletClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet, publicClient, RPC_URL } from "@/lib/chain";
import { MARKET_MANAGER } from "@/lib/contracts";
import { getMatchRecord, type MatchRecord, setMatchRecord } from "./match-store";

/** Typical window length per CORE template (CLAUDE.md §6.4), matching packages/simulator's own
 *  scheduler.ts -- kept independently since this route is server infra, not a simulator import. */
const TEMPLATE_WINDOW_SEC: Record<(typeof TEMPLATE_NAMES)[number], number> = {
  SHOT_ON_TARGET_NEXT_N: 2 * 60,
  CORNER_NEXT_N: 3 * 60,
  CARD_NEXT_N: 5 * 60,
  GOAL_NEXT_N: 5 * 60,
};

const CADENCE_SEC = 120;
const MAX_CONCURRENT = 4;

function schedulerAccount() {
  // No key has been granted a dedicated SCHEDULER_ROLE on the live deployment yet -- the deployer
  // still holds it (Deploy.s.sol grants it to the deployer when SCHEDULER_ADDRESS is unset, which
  // it is). Falling back to it here is a documented, deliberate stand-in, not an oversight.
  const key = process.env.SCHEDULER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("Neither SCHEDULER_PRIVATE_KEY nor DEPLOYER_PRIVATE_KEY is set");
  return privateKeyToAccount(key as `0x${string}`);
}

/** Creates the on-chain match for this Wyscout fixture if it doesn't exist yet, and returns its
 *  on-chain matchId. Idempotent: safe to call on every page load. */
export async function ensureOnchainMatch(wyscoutId: string, kickoffTsSec: number): Promise<string> {
  const existing = await getMatchRecord(wyscoutId);
  if (existing) return existing.onchainMatchId;

  const account = schedulerAccount();
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) });
  const sourceRef = keccak256(toBytes(`wyscout:${wyscoutId}`));

  const hash = await wallet.writeContract({
    address: MARKET_MANAGER,
    abi: MarketManagerAbi,
    functionName: "createMatch",
    args: [sourceRef, BigInt(kickoffTsSec), wyscoutId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // MatchCreated's first indexed topic (after the event signature) is the new matchId.
  const log = receipt.logs.find((l) => l.address.toLowerCase() === MARKET_MANAGER.toLowerCase());
  const onchainMatchId = log?.topics[1] ? BigInt(log.topics[1]).toString() : undefined;
  if (!onchainMatchId) throw new Error("createMatch succeeded but no matchId could be read back");

  const record: MatchRecord = { onchainMatchId, nextTemplateIdx: 0, openMarkets: [] };
  await setMatchRecord(wyscoutId, record);
  return onchainMatchId;
}

export interface ScheduleTickResult {
  onchainMatchId: string;
  openMarkets: MatchRecord["openMarkets"];
  opened: boolean;
}

/**
 * Closes every market whose match-clock window has ended, on-chain. This is what actually fires
 * `MarketClosed` -- the event the CRE settlement workflow's EVM log trigger watches for. Without
 * it, a market's window passing here only stopped this route from tracking it; the market itself
 * sat in `Open` on-chain forever and nothing downstream ever settled it. The scheduler account
 * holds `SCHEDULER_ROLE` (see `Deploy.s.sol`), which lets `close()` succeed immediately rather
 * than waiting for its real-world `closesAt` -- necessary because replays run at up to 20x speed,
 * so a window's match-clock end arrives long before that much wall-clock time has actually
 * passed. Each close is independent: one market already settled or otherwise not closable (a
 * possible race with the CRE workflow resolving it between polls) must not block the others.
 */
// `any` here for the same reason as scripts/rehearse/lib.ts's writeAndWait: viem's writeContract
// typing over a dynamic ABI is too strict for a helper taking a wallet client built elsewhere.
async function closeExpiredMarkets(
  wallet: any,
  markets: MatchRecord["openMarkets"],
  nowMatchClockSec: number,
): Promise<void> {
  const expired = markets.filter((m) => m.windowEnd <= nowMatchClockSec);
  for (const m of expired) {
    try {
      const hash = await wallet.writeContract({
        address: MARKET_MANAGER,
        abi: MarketManagerAbi,
        functionName: "close",
        args: [BigInt(m.marketId)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    } catch (err) {
      console.error(`[scheduler] close(${m.marketId}) failed:`, err);
    }
  }
}

/** One scheduling decision: close markets whose window has passed (so CRE can settle them), then
 *  open the next one in the CORE template rotation if there's room and enough match-clock time
 *  has passed since the last. */
export async function scheduleTick(
  wyscoutId: string,
  nowMatchClockSec: number,
): Promise<ScheduleTickResult> {
  const record = await getMatchRecord(wyscoutId);
  if (!record) throw new Error(`No on-chain match for ${wyscoutId} -- call ensure first`);

  const wallet = createWalletClient({
    account: schedulerAccount(),
    chain: monadTestnet,
    transport: http(RPC_URL),
  });

  const stillOpen = record.openMarkets.filter((m) => m.windowEnd > nowMatchClockSec);
  const expired = record.openMarkets.filter((m) => m.windowEnd <= nowMatchClockSec);
  if (expired.length > 0) {
    await closeExpiredMarkets(wallet, expired, nowMatchClockSec);
  }
  const lastOpenedAt = record.openMarkets.at(-1)?.windowStart ?? -Infinity;
  const dueForNext = nowMatchClockSec - lastOpenedAt >= CADENCE_SEC;

  if (stillOpen.length >= MAX_CONCURRENT || !dueForNext) {
    const pruned = { ...record, openMarkets: stillOpen };
    await setMatchRecord(wyscoutId, pruned);
    return { onchainMatchId: record.onchainMatchId, openMarkets: stillOpen, opened: false };
  }

  const templateName = TEMPLATE_NAMES[record.nextTemplateIdx % TEMPLATE_NAMES.length]!;
  const windowStart = nowMatchClockSec;
  const windowEnd = windowStart + TEMPLATE_WINDOW_SEC[templateName];
  const closesAtSec = Math.floor(Date.now() / 1000) + TEMPLATE_WINDOW_SEC[templateName];

  const hash = await wallet.writeContract({
    address: MARKET_MANAGER,
    abi: MarketManagerAbi,
    functionName: "openMarket",
    args: [
      BigInt(record.onchainMatchId),
      TEMPLATE_ID[templateName],
      windowStart,
      windowEnd,
      BigInt(closesAtSec),
      0,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const log = receipt.logs.find((l) => l.address.toLowerCase() === MARKET_MANAGER.toLowerCase());
  const marketId = log?.topics[1] ? BigInt(log.topics[1]).toString() : undefined;
  if (!marketId) throw new Error("openMarket succeeded but no marketId could be read back");

  const openMarkets = [
    ...stillOpen,
    {
      marketId,
      templateIdx: record.nextTemplateIdx % TEMPLATE_NAMES.length,
      windowStart,
      windowEnd,
    },
  ];
  const updated: MatchRecord = {
    onchainMatchId: record.onchainMatchId,
    nextTemplateIdx: record.nextTemplateIdx + 1,
    openMarkets,
  };
  await setMatchRecord(wyscoutId, updated);
  return { onchainMatchId: record.onchainMatchId, openMarkets, opened: true };
}
