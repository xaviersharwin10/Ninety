#!/usr/bin/env tsx
/**
 * The integrated rehearsal: every live piece built so far, talking to every other one, for real.
 *
 * Boots one shared chain, contract deployment, replay and agent (see `lib.ts`), then runs three
 * scenarios against it in sequence (see `scenarios.ts`):
 *
 *   1. happy path  -- a bet placed before a real goal wins the exact payout OddsMath predicts
 *   2. sniper       -- a bet placed after a real goal is voided, refunding only the stake
 *   3. suspension   -- a suspended market blocks quoting and betting; resuming restores both
 *
 * Nothing here is mocked: every process is the real class from its package, talking over real
 * HTTP/WebSocket/JSON-RPC, against a real deployed contract set. Run with `pnpm rehearse` from
 * the repo root.
 */
import { boot, log } from "./lib.js";
import { runHappyPathScenario, runSniperScenario, runSuspensionScenario } from "./scenarios.js";

async function main() {
  const ctx = await boot();
  try {
    await runHappyPathScenario(ctx);
    await runSuspensionScenario(ctx);
    await runSniperScenario(ctx);

    console.log("\n=== ALL SCENARIOS PASSED ===");
    console.log("happy path, sniper, suspension -- all live, all real, nothing mocked.");

    for (const fn of ctx.cleanup.reverse()) await fn();
    process.exit(0);
  } catch (err) {
    console.error("\n=== REHEARSAL FAILED ===");
    console.error(err);
    for (const fn of ctx.cleanup.reverse()) await Promise.resolve(fn()).catch(() => {});
    process.exit(1);
  }
}

main().catch((err) => {
  log("fatal", String(err));
  process.exit(1);
});
