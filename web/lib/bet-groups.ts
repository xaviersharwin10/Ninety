import { TEMPLATE_NAME_BY_ID, type TemplateName } from "@ninety/core";
import type { MyBet } from "@/hooks/useMyBets";
import type { BetResult } from "./account-engine";

/**
 * A fan's bets as they think of them: one per market. On chain a single tap can be several bets
 * (split across up to three agents' prices), and a cash-out is a second bet on the other side (see
 * lib/cash-out.ts); neither is something the fan should have to add up.
 */
export interface BetGroup {
  marketId: string;
  template: TemplateName | null;
  /** The side they backed; null once cashed out (they hold both). */
  side: "Yes" | "No" | null;
  status: "Open" | "Won" | "Lost" | "Voided" | "CashedOut";
  /** Everything staked on the market. */
  stake: bigint;
  /** If open: what it pays if it wins (for a cash-out, what it pays whatever happens). */
  payout: bigint;
  /** Once settled: what came back. */
  received: bigint;
  /** Blended decimal odds of the side backed; 0 once cashed out. */
  odds: number;
}

/**
 * `groups` with any result the account already knows (`outcomes`, by market id) applied to groups the
 * indexer still has as open -- it trails the chain, and a fan who just saw "You won" shouldn't see
 * "Live" here.
 */
export function withKnownOutcomes(
  groups: BetGroup[],
  outcomes: ReadonlyMap<string, BetResult>,
): BetGroup[] {
  return groups.map((g) => {
    const known = outcomes.get(g.marketId);
    if (g.status !== "Open" || !known) return g;
    return { ...g, status: known.outcome, received: known.amount };
  });
}

export function groupBets(bets: MyBet[]): BetGroup[] {
  const byMarket = new Map<string, MyBet[]>();
  for (const bet of bets) {
    const key = bet.marketId.toString();
    byMarket.set(key, [...(byMarket.get(key) ?? []), bet]);
  }
  return [...byMarket.entries()].map(([marketId, group]) => {
    const sum = (bs: MyBet[], f: (b: MyBet) => bigint) => bs.reduce((a, b) => a + f(b), 0n);
    const stake = sum(group, (b) => b.stake);
    const received =
      sum(
        group.filter((b) => b.status === "Won"),
        (b) => b.payout,
      ) +
      sum(
        group.filter((b) => b.status === "Voided"),
        (b) => b.stake,
      );
    const open = group.some((b) => b.status === "Open");
    const template = TEMPLATE_NAME_BY_ID[group[0]!.templateId] ?? null;
    const yes = group.filter((b) => b.side === "Yes");
    const no = group.filter((b) => b.side === "No");

    if (yes.length > 0 && no.length > 0) {
      const yesPays = sum(yes, (b) => b.payout);
      const noPays = sum(no, (b) => b.payout);
      return {
        marketId,
        template,
        side: null,
        status: open ? "Open" : "CashedOut",
        stake,
        payout: yesPays < noPays ? yesPays : noPays,
        received,
        odds: 0,
      };
    }
    const payout = sum(group, (b) => b.payout);
    const status: BetGroup["status"] = open
      ? "Open"
      : group.some((b) => b.status === "Won")
        ? "Won"
        : group.every((b) => b.status === "Voided")
          ? "Voided"
          : "Lost";
    return {
      marketId,
      template,
      side: group[0]!.side,
      status,
      stake,
      payout,
      received,
      odds: stake > 0n ? Number(payout) / Number(stake) : 0,
    };
  });
}
