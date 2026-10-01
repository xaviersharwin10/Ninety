import { TEMPLATE_ID } from "@ninety/core";
import { describe, expect, it } from "vitest";
import type { MyBet } from "@/hooks/useMyBets";
import { groupBets, withKnownOutcomes } from "@/lib/bet-groups";

let n = 0;
function bet(over: Partial<MyBet>): MyBet {
  return {
    betId: String(++n),
    marketId: 7n,
    templateId: TEMPLATE_ID.CORNER_NEXT_N,
    side: "Yes",
    probBps: 4000,
    stake: 5_000_000n,
    payout: 12_500_000n,
    status: "Open",
    ...over,
  };
}

describe("groupBets", () => {
  it("shows one tap split across three agents as one bet", () => {
    const [g, ...rest] = groupBets([bet({}), bet({}), bet({})]);
    expect(rest).toHaveLength(0);
    expect(g).toMatchObject({
      side: "Yes",
      status: "Open",
      stake: 15_000_000n,
      payout: 37_500_000n,
    });
    expect(g!.template).toBe("CORNER_NEXT_N");
  });

  it("shows a cashed-out market as one row, getting the smaller payout whatever happens", () => {
    const [open] = groupBets([
      bet({}),
      bet({ side: "No", stake: 7_000_000n, payout: 12_600_000n }),
    ]);
    expect(open).toMatchObject({ side: null, status: "Open", payout: 12_500_000n });

    const [settled] = groupBets([
      bet({ status: "Won" }),
      bet({ side: "No", stake: 7_000_000n, payout: 12_600_000n, status: "Lost" }),
    ]);
    expect(settled).toMatchObject({ side: null, status: "CashedOut", received: 12_500_000n });
  });

  it("counts a fully refunded bet as refunded, with the stake back", () => {
    const [g] = groupBets([bet({ status: "Voided" }), bet({ status: "Voided" })]);
    expect(g).toMatchObject({ status: "Voided", received: 10_000_000n });
  });

  it("keeps separate markets separate", () => {
    expect(groupBets([bet({ marketId: 1n }), bet({ marketId: 2n })])).toHaveLength(2);
  });
});

describe("withKnownOutcomes", () => {
  it("shows a result the account already knows while the indexer still says open", () => {
    const groups = groupBets([bet({ marketId: 7n }), bet({ marketId: 8n, status: "Lost" })]);
    const known = new Map([
      [
        "7",
        {
          id: "7",
          outcome: "Won" as const,
          amount: 12_500_000n,
          stake: 5_000_000n,
          question: null,
        },
      ],
      ["8", { id: "8", outcome: "Won" as const, amount: 1n, stake: 1n, question: null }],
    ]);
    const [a, b] = withKnownOutcomes(groups, known);
    expect(a).toMatchObject({ status: "Won", received: 12_500_000n });
    // Already settled per the indexer: left as it is.
    expect(b).toMatchObject({ status: "Lost" });
  });
});
