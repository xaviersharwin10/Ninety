import { describe, expect, it } from "vitest";
import { resultText } from "@/lib/result-text";

const base = { id: "9", question: "Corner in the next 3 min?" };

describe("result text, shared by the toast and the notification", () => {
  it("leads with what the fan got", () => {
    expect(resultText({ ...base, outcome: "Won", amount: 10_500_000n, stake: 5_000_000n })).toEqual(
      { title: "You won 10.50 nUSD", detail: "Added to your balance" },
    );
    expect(
      resultText({ ...base, outcome: "Voided", amount: 5_000_000n, stake: 5_000_000n }).title,
    ).toBe("5.00 nUSD refunded");
    expect(resultText({ ...base, outcome: "Lost", amount: 0n, stake: 5_000_000n })).toEqual({
      title: "Not this time",
      detail: "5.00 nUSD stake",
    });
  });
});
