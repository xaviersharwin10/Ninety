import { TEMPLATE_ID } from "@ninety/core";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@metamask/agent-wallet/plugin", () => import("./sdk-mock.js"));

const { recentBets } = await import("../src/lib/history.js");

afterEach(() => vi.unstubAllGlobals());

const corner = { id: "9", templateId: TEMPLATE_ID.CORNER_NEXT_N };

describe("recentBets", () => {
  it("adds a bet's fills back up into the one bet the trader placed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: {
            Bet: [
              {
                id: "11",
                groupId: "5",
                side: "Yes",
                stake: "15000000",
                payout: "32000000",
                status: "Won",
                placedAt: "1",
                claimedAt: null,
                market: corner,
              },
              {
                id: "12",
                groupId: "5",
                side: "Yes",
                stake: "9000000",
                payout: "19000000",
                status: "Won",
                placedAt: "1",
                claimedAt: null,
                market: corner,
              },
              {
                id: "10",
                groupId: "4",
                side: "No",
                stake: "2000000",
                payout: "3000000",
                status: "Lost",
                placedAt: "0",
                claimedAt: null,
                market: corner,
              },
            ],
          },
        }),
      ),
    );
    const bets = await recentBets("0xAbC0000000000000000000000000000000000000");
    expect(bets).toHaveLength(2);
    expect(bets[0]).toMatchObject({
      marketId: "9",
      question: "Corner in the next 3 min?",
      side: "yes",
      stake: 24_000_000n,
      payout: 51_000_000n,
      status: "won",
      uncollected: true,
      betIds: [11n, 12n],
    });
    expect(bets[1]).toMatchObject({ status: "lost", uncollected: false });
  });
});
