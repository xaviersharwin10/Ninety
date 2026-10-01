import { describe, expect, it } from "vitest";
import { clientIp, DripBudget } from "@/lib/server/gas-budget";

const MON = 10n ** 18n;
const drip = 12n * 10n ** 16n; // 0.12 MON

function budget() {
  let t = 0;
  const b = new DripBudget({ newAccountsPerIp: 3, dailyCapWei: MON }, () => t);
  return { b, advance: (ms: number) => (t += ms) };
}

describe("the gas sponsor's budget", () => {
  it("funds a few new accounts per IP a day, then refuses more from it", () => {
    const { b } = budget();
    for (let i = 0; i < 3; i++) {
      expect(b.check("1.1.1.1", true, drip)).toBeNull();
      b.record("1.1.1.1", true, drip);
    }
    expect(b.check("1.1.1.1", true, drip)).toBe("ip_limit");
    // Someone else is unaffected, and so is an existing account topping up from the same IP.
    expect(b.check("2.2.2.2", true, drip)).toBeNull();
    expect(b.check("1.1.1.1", false, drip)).toBeNull();
  });

  it("never gives away more than its daily ceiling, whoever asks", () => {
    const { b } = budget();
    for (let i = 0; i < 8; i++) b.record(`10.0.0.${i}`, true, drip); // 0.96 MON
    expect(b.check("10.0.0.99", true, drip)).toBe("daily_cap");
    expect(b.check("10.0.0.99", false, 4n * 10n ** 16n)).toBeNull(); // 0.04 still fits
  });

  it("forgets grants after a day", () => {
    const { b, advance } = budget();
    for (let i = 0; i < 3; i++) b.record("1.1.1.1", true, drip);
    advance(24 * 60 * 60 * 1000 + 1);
    expect(b.check("1.1.1.1", true, drip)).toBeNull();
  });

  it("reads the caller's IP from the proxy's headers", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "3.3.3.3, 10.0.0.1" }))).toBe("3.3.3.3");
    // A header any caller can set is ignored.
    expect(clientIp(new Headers({ "cf-connecting-ip": "4.4.4.4" }))).toBe("unknown");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
