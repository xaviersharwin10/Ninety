import { TEMPLATE_ID, TEMPLATE_NAMES } from "@ninety/core";
import type { Address } from "viem";
import { indexer } from "./api.js";
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

/** The trader's recent bets, newest first. */
export async function recentBets(owner: Address, limit = 60): Promise<PlacedBet[]> {
  const { Bet } = await indexer<{ Bet: BetFillRow[] }>(
    `query($a: String!, $n: Int!) {
      Bet(where: { bettor: { _eq: $a } }, order_by: { placedAt: desc }, limit: $n) {
        id groupId side stake payout status placedAt claimedAt market { id templateId }
      }
    }`,
    { a: owner.toLowerCase(), n: limit },
  );
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
