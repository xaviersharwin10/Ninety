import { keccak256, toBytes } from "viem";
import type { EventType } from "./events.js";

/**
 * The CORE market template menu. Ids are `keccak256(utf8(name))`, computed identically here and
 * on chain (`MarketManager.setTemplate`), so a template id round-trips through an EVM event log
 * without a lookup table. `NEXT_CORNER_TEAM` from the product spec is deliberately not here — see
 * the plan's note on keeping v1 to strictly binary templates.
 */
export const TEMPLATE_NAMES = [
  "SHOT_ON_TARGET_NEXT_N",
  "CORNER_NEXT_N",
  "CARD_NEXT_N",
  "GOAL_NEXT_N",
] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export const TEMPLATE_ID: Record<TemplateName, `0x${string}`> = Object.fromEntries(
  TEMPLATE_NAMES.map((name) => [name, keccak256(toBytes(name))]),
) as Record<TemplateName, `0x${string}`>;

/** Which {@link EventType} qualifies each template. `goal` also satisfies `SHOT_ON_TARGET_NEXT_N`. */
export const TEMPLATE_QUALIFYING_EVENTS: Record<TemplateName, readonly EventType[]> = {
  SHOT_ON_TARGET_NEXT_N: ["shot_on_target", "goal"],
  CORNER_NEXT_N: ["corner"],
  CARD_NEXT_N: ["card"],
  GOAL_NEXT_N: ["goal"],
};
