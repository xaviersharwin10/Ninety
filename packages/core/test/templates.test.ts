import { describe, expect, it } from "vitest";
import { isTemplateInDanger } from "../src/templates.js";

describe("isTemplateInDanger", () => {
  it("pauses a market when an event that would decide it is imminent", () => {
    expect(isTemplateInDanger("CORNER_NEXT_N", ["corner"])).toBe(true);
    // A goal is also a shot on target, so it decides SHOT_ON_TARGET markets too.
    expect(isTemplateInDanger("SHOT_ON_TARGET_NEXT_N", ["goal"])).toBe(true);
  });

  it("leaves markets alone that the imminent event can't decide", () => {
    expect(isTemplateInDanger("GOAL_NEXT_N", ["corner"])).toBe(false);
    expect(isTemplateInDanger("CARD_NEXT_N", ["shot_on_target", "goal"])).toBe(false);
  });

  it("is never in danger when nothing is imminent", () => {
    expect(isTemplateInDanger("GOAL_NEXT_N", [])).toBe(false);
  });
});
