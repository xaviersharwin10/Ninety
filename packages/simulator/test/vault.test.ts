import { describe, expect, it } from "vitest";
import {
  InsufficientFreeCapitalError,
  MarketExposureExceededError,
  SimVault,
} from "../src/vault.js";

const nUSD = 1_000_000n;

describe("SimVault", () => {
  it("quotableBudget is capped by both free capital and the per-market exposure cap", () => {
    const vault = new SimVault("Steady", 1000n * nUSD, 3000n); // 30% cap = 300 nUSD
    expect(vault.quotableBudget("m1")).toBe(300n * nUSD);

    vault.lockLiability("m1", 250n * nUSD);
    // 50 nUSD of exposure headroom left on m1, but 750 nUSD of free capital -- the tighter bound wins.
    expect(vault.quotableBudget("m1")).toBe(50n * nUSD);

    // A different market has its own exposure budget, but shares the same free-capital pool.
    expect(vault.quotableBudget("m2")).toBe(300n * nUSD);
  });

  it("lockLiability throws InsufficientFreeCapitalError beyond free capital", () => {
    const vault = new SimVault("Steady", 100n * nUSD, 10000n); // 100% cap, so only freeCapital binds
    expect(() => vault.lockLiability("m1", 101n * nUSD)).toThrow(InsufficientFreeCapitalError);
  });

  it("lockLiability throws MarketExposureExceededError beyond the per-market cap", () => {
    const vault = new SimVault("Steady", 1000n * nUSD, 3000n); // cap 300 nUSD per market
    expect(() => vault.lockLiability("m1", 301n * nUSD)).toThrow(MarketExposureExceededError);
  });

  it("settleWon releases the lock and credits the stake as profit", () => {
    const vault = new SimVault("Steady", 1000n * nUSD, 3000n);
    vault.lockLiability("m1", 50n * nUSD);
    vault.settleWon("m1", 50n * nUSD, 20n * nUSD);

    expect(vault.lockedLiability).toBe(0n);
    expect(vault.totalAssets).toBe(1020n * nUSD); // +20 nUSD stake, liability just released
    expect(vault.quotableBudget("m1")).toBe((1020n * 3000n * nUSD) / 10000n);
  });

  it("settleLost releases the lock and pays the liability out", () => {
    const vault = new SimVault("Steady", 1000n * nUSD, 3000n);
    vault.lockLiability("m1", 50n * nUSD);
    vault.settleLost("m1", 50n * nUSD);

    expect(vault.lockedLiability).toBe(0n);
    expect(vault.totalAssets).toBe(950n * nUSD);
  });

  it("releaseVoided releases the lock without moving any assets", () => {
    const vault = new SimVault("Steady", 1000n * nUSD, 3000n);
    vault.lockLiability("m1", 50n * nUSD);
    vault.releaseVoided("m1", 50n * nUSD);

    expect(vault.lockedLiability).toBe(0n);
    expect(vault.totalAssets).toBe(1000n * nUSD);
    expect(vault.quotableBudget("m1")).toBe(300n * nUSD); // exposure fully released too
  });

  it("supports several concurrent locks across different markets independently", () => {
    const vault = new SimVault("Steady", 1000n * nUSD, 3000n);
    vault.lockLiability("m1", 100n * nUSD);
    vault.lockLiability("m2", 100n * nUSD);
    expect(vault.lockedLiability).toBe(200n * nUSD);
    expect(vault.freeCapital()).toBe(800n * nUSD);

    vault.settleWon("m1", 100n * nUSD, 30n * nUSD);
    expect(vault.lockedLiability).toBe(100n * nUSD); // m2's lock is untouched
    expect(vault.totalAssets).toBe(1030n * nUSD);
  });
});
