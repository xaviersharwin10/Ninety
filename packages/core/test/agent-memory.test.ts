import { describe, expect, it } from "vitest";
import { freshMemory, learn, type SettledBet } from "../src/agent-memory.js";

const lost = (id: number, stake = 5_000_000n): SettledBet => ({
  id,
  template: "CORNER_NEXT_N",
  agentPnl: stake, // the bettor lost: the agent kept the stake
});
const paidOut = (id: number, amount = 8_000_000n): SettledBet => ({
  id,
  template: "GOAL_NEXT_N",
  agentPnl: -amount, // the bettor won: the agent paid out
});

describe("learn", () => {
  it("widens the margin on a market type the agent lost money on", () => {
    const next = learn(freshMemory(7), [paidOut(1), paidOut(2)]);
    expect(next.templates.GOAL_NEXT_N.marginAdjBps).toBe(100);
    expect(next.templates.GOAL_NEXT_N.pnl).toBe("-16000000");
    expect(next.lessons[0]).toMatch(/Widened goals margin to \+100bps/);
  });

  it("tightens it a little where the agent won, to compete harder for flow", () => {
    const next = learn(freshMemory(7), [lost(1), lost(2)]);
    expect(next.templates.CORNER_NEXT_N.marginAdjBps).toBe(-25);
  });

  it("builds on what it learned before, session over session", () => {
    const one = learn(freshMemory(7), [paidOut(1), paidOut(2)]);
    const two = learn(one, [paidOut(3), paidOut(4)]);
    expect(two.sessions).toBe(2);
    expect(two.templates.GOAL_NEXT_N.marginAdjBps).toBe(200);
    expect(two.templates.GOAL_NEXT_N.bets).toBe(4);
  });

  it("never learns from the same bet twice", () => {
    const one = learn(freshMemory(7), [paidOut(1), paidOut(2)]);
    expect(learn(one, [paidOut(1), paidOut(2)])).toBe(one);
  });

  it("draws no conclusion from a single bet, but still records it", () => {
    const next = learn(freshMemory(7), [paidOut(1)]);
    expect(next.templates.GOAL_NEXT_N.marginAdjBps).toBe(0);
    expect(next.templates.GOAL_NEXT_N.bets).toBe(1);
  });

  it("caps how far the margin can move", () => {
    let m = freshMemory(7);
    for (let s = 0; s < 10; s++) m = learn(m, [paidOut(2 * s + 1), paidOut(2 * s + 2)]);
    expect(m.templates.GOAL_NEXT_N.marginAdjBps).toBe(500);
  });
});
