import { describe, expect, it } from "vitest";
import { isPhone } from "@/lib/alerts";

describe("where result alerts are offered", () => {
  it("leaves out phones, where a backgrounded page can't send one", () => {
    const android =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
    expect(isPhone(android)).toBe(true);
    expect(isPhone(iphone)).toBe(true);
  });

  it("keeps computers", () => {
    const linux = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";
    expect(isPhone(linux)).toBe(false);
    // The browser's own answer wins over the user-agent string.
    expect(isPhone(linux, true)).toBe(true);
  });
});
