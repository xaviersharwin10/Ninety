import { describe, expect, it } from "vitest";
import {
  InsufficientFreeCapitalError,
  MarketExposureExceededError,
  SimVault,
} from "../src/vault.js";

const AUSD = 1_000_000n;

describe("SimVault", () => {
  it("quotableBudget is capped by both free capital and the per-market exposure cap", () => {
    const vault = new SimVault("Steady", 1000n * AUSD, 3000n); // 30% cap = 300 AUSD
    expect(vault.quotableBudget("m1")).toBe(300n * AUSD);

    vault.lockLiability("m1", 250n * AUSD);
    // 50 AUSD of exposure headroom left on m1, but 750 AUSD of free capital -- the tighter bound wins.
    expect(vault.quotableBudget("m1")).toBe(50n * AUSD);

    // A different market has its own exposure budget, but shares the same free-capital pool.
    expect(vault.quotableBudget("m2")).toBe(300n * AUSD);
  });

  it("lockLiability throws InsufficientFreeCapitalError beyond free capital", () => {
    const vault = new SimVault("Steady", 100n * AUSD, 10000n); // 100% cap, so only freeCapital binds
    expect(() => vault.lockLiability("m1", 101n * AUSD)).toThrow(InsufficientFreeCapitalError);
  });

  it("lockLiability throws MarketExposureExceededError beyond the per-market cap", () => {
    const vault = new SimVault("Steady", 1000n * AUSD, 3000n); // cap 300 AUSD per market
    expect(() => vault.lockLiability("m1", 301n * AUSD)).toThrow(MarketExposureExceededError);
  });

  it("settleWon releases the lock and credits the stake as profit", () => {
    const vault = new SimVault("Steady", 1000n * AUSD, 3000n);
    vault.lockLiability("m1", 50n * AUSD);
    vault.settleWon("m1", 50n * AUSD, 20n * AUSD);

    expect(vault.lockedLiability).toBe(0n);
    expect(vault.totalAssets).toBe(1020n * AUSD); // +20 AUSD stake, liability just released
    expect(vault.quotableBudget("m1")).toBe((1020n * 3000n * AUSD) / 10000n);
  });

  it("settleLost releases the lock and pays the liability out", () => {
    const vault = new SimVault("Steady", 1000n * AUSD, 3000n);
    vault.lockLiability("m1", 50n * AUSD);
    vault.settleLost("m1", 50n * AUSD);

    expect(vault.lockedLiability).toBe(0n);
    expect(vault.totalAssets).toBe(950n * AUSD);
  });

  it("releaseVoided releases the lock without moving any assets", () => {
    const vault = new SimVault("Steady", 1000n * AUSD, 3000n);
    vault.lockLiability("m1", 50n * AUSD);
    vault.releaseVoided("m1", 50n * AUSD);

    expect(vault.lockedLiability).toBe(0n);
    expect(vault.totalAssets).toBe(1000n * AUSD);
    expect(vault.quotableBudget("m1")).toBe(300n * AUSD); // exposure fully released too
  });

  it("supports several concurrent locks across different markets independently", () => {
    const vault = new SimVault("Steady", 1000n * AUSD, 3000n);
    vault.lockLiability("m1", 100n * AUSD);
    vault.lockLiability("m2", 100n * AUSD);
    expect(vault.lockedLiability).toBe(200n * AUSD);
    expect(vault.freeCapital()).toBe(800n * AUSD);

    vault.settleWon("m1", 100n * AUSD, 30n * AUSD);
    expect(vault.lockedLiability).toBe(100n * AUSD); // m2's lock is untouched
    expect(vault.totalAssets).toBe(1030n * AUSD);
  });
});
