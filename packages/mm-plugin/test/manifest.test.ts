import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Agent Wallet gates each command to the capabilities its manifest entry declares; a command that
 * reaches for more fails at runtime with PERMISSION_DENIED. This keeps package.json#mm and the code
 * in step: every command is declared, and declares what it uses.
 */
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const declared = new Map<string, string[]>(
  pkg.mm.commands.map((c: { id: string; capabilities: string[] }) => [c.id, c.capabilities]),
);
const dir = new URL("../src/commands/ninety/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
const libSource = (name: string) => readFileSync(join(dir, "../../lib", name), "utf8");

/** Library helpers that reach a gated context member, and the capability each needs. */
const GATED: [RegExp, string][] = [
  [/\bsend\(/, "wallet-submit"],
  [/\bwalletAddress\(/, "wallet-read"],
  [/\bmonad\(/, "wallet-read"],
];

describe("plugin manifest", () => {
  it("declares exactly the commands that exist", () => {
    expect([...declared.keys()].sort()).toEqual(
      files.map((f) => `ninety:${f.replace(".ts", "")}`).sort(),
    );
  });

  for (const file of files) {
    const source = readFileSync(join(dir, file), "utf8");
    const id = `ninety:${file.replace(".ts", "")}`;
    it(`${id} declares what it uses`, () => {
      expect(source).toContain(`pluginCommandId = "${id}"`);
      for (const [use, capability] of GATED) {
        if (use.test(source)) expect(declared.get(id)).toContain(capability);
      }
    });
  }

  it("keeps the plugin-wide capability list empty, as Agent Wallet advises", () => {
    expect(pkg.mm.capabilities).toEqual([]);
    expect(libSource("wallet.ts")).toContain("ctx.walletExecutor");
  });
});
