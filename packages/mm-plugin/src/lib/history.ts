import { BetRouterAbi, TEMPLATE_ID, TEMPLATE_NAMES } from "@ninety/core";
import type { Abi, Address, PublicClient } from "viem";
import { indexer } from "./api.js";
import { MULTICALL3 } from "./chain.js";
import { CONTRACTS } from "./config.js";
import { question } from "./markets.js";

interface BetFillRow {
  id: string;
  groupId: string;
  side: "Yes" | "No";
  stake: string;
  payout: string;
  status: "Open" | "Won" | "Lost" | "Voided";
  placedAt: string;
  claimedAt: string | null;
  market: { id: string; templateId: string };
}

/** One bet as the trader placed it: the up-to-three fills it was split into, added back up. */
export interface PlacedBet {
  groupId: string;
  marketId: string;
  question: string;
  side: "yes" | "no";
  stake: bigint;
  /** Paid if it wins, stake included. */
  payout: bigint;
  status: "open" | "won" | "lost" | "refunded";
  /** Won or refunded, and not collected yet. */
  uncollected: boolean;
  /** The fills' bet ids, which `claim` takes. */
  betIds: bigint[];
  placedAt: number;
}

const TEMPLATE_IDX_BY_ID = new Map(
  TEMPLATE_NAMES.map((name, i) => [TEMPLATE_ID[name].toLowerCase(), i]),
);

const STATUS = { Open: "open", Won: "won", Lost: "lost", Voided: "refunded" } as const;

/** BetRouter's BetStatus, by its onchain number. */
const CHAIN_STATUS = ["Open", "Open", "Won", "Lost", "Voided"] as const;

/**
 * Brings fills the history still shows as unfinished up to date from the chain. The history comes
 * from an indexer that can trail by up to a minute: a bet that had settled still read "open", and
 * winnings just collected still read as waiting. Only fills that could have changed are re-read:
 * open ones, and won or refunded ones not yet marked collected.
 */
async function refresh(client: PublicClient, fills: BetFillRow[]): Promise<void> {
  const stale = fills.filter((f) => f.status === "Open" || (f.status !== "Lost" && !f.claimedAt));
  if (stale.length === 0) return;
  const router = { address: CONTRACTS.betRouter, abi: BetRouterAbi as Abi };
  const read = await client.multicall({
    multicallAddress: MULTICALL3,
    allowFailure: false,
    contracts: stale.flatMap((f) => [
      { ...router, functionName: "getBet", args: [BigInt(f.id)] },
      { ...router, functionName: "claimed", args: [BigInt(f.id)] },
    ]),
  });
  for (const [i, fill] of stale.entries()) {
    const bet = read[i * 2] as { status: number };
    fill.status = CHAIN_STATUS[bet.status] ?? fill.status;
    if (read[i * 2 + 1]) fill.claimedAt ??= "onchain";
  }
}

/**
 * The owner's recent bets, newest first, each fill group added back up into the one bet they
 * placed. With `client`, unfinished ones are checked against the chain.
 */
export async function recentBets(
  owner: Address,
  limit = 60,
  client?: PublicClient,
): Promise<PlacedBet[]> {
  const { Bet } = await indexer<{ Bet: BetFillRow[] }>(
    `query($a: String!, $n: Int!) {
      Bet(where: { bettor: { _eq: $a } }, order_by: { placedAt: desc }, limit: $n) {
        id groupId side stake payout status placedAt claimedAt market { id templateId }
      }
    }`,
    { a: owner.toLowerCase(), n: limit },
  );
  if (client) await refresh(client, Bet);
  const groups = new Map<string, PlacedBet>();
  for (const fill of Bet) {
    const existing = groups.get(fill.groupId);
    const status = STATUS[fill.status];
    const uncollected = (status === "won" || status === "refunded") && fill.claimedAt === null;
    if (existing) {
      existing.stake += BigInt(fill.stake);
      existing.payout += BigInt(fill.payout);
      existing.betIds.push(BigInt(fill.id));
      existing.uncollected ||= uncollected;
      continue;
    }
    groups.set(fill.groupId, {
      groupId: fill.groupId,
      marketId: fill.market.id,
      question: question(TEMPLATE_IDX_BY_ID.get(fill.market.templateId.toLowerCase()) ?? 0),
      side: fill.side === "Yes" ? "yes" : "no",
      stake: BigInt(fill.stake),
      payout: BigInt(fill.payout),
      status,
      uncollected,
      betIds: [BigInt(fill.id)],
      placedAt: Number(fill.placedAt),
    });
  }
  return [...groups.values()];
}
