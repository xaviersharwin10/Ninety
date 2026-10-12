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

/**
 * Whether a market on `template` should stop taking bets while `dangerTypes` are imminent or just
 * happened: true when any of them would decide it. An upcoming corner pauses corner markets, not
 * goal markets, so a match isn't frozen wholesale every time something might happen.
 */
export function isTemplateInDanger(
  template: TemplateName,
  dangerTypes: readonly EventType[],
): boolean {
  return TEMPLATE_QUALIFYING_EVENTS[template].some((t) => dangerTypes.includes(t));
}

/** Reverse of {@link TEMPLATE_ID}: on-chain templateId -> the name it was computed from. */
export const TEMPLATE_NAME_BY_ID: Record<string, TemplateName> = Object.fromEntries(
  TEMPLATE_NAMES.map((name) => [TEMPLATE_ID[name], name]),
);

/**
 * Which team a market is about, as `MarketManager` stores it: 0 = either team ("Corner in the next
 * 3 min?"), 1 = the home team only, 2 = the away team only ("France corner in the next 3 min?").
 */
export type TeamFilter = 0 | 1 | 2;

/**
 * The provider team id a {@link TeamFilter} selects, given a match's teams home first. Undefined
 * for "either team", which is how every function taking a `teamId` reads "no restriction".
 */
export function teamIdFor(
  teamFilter: number,
  teams: readonly { id: number }[],
): number | undefined {
  return teamFilter === 1 ? teams[0]?.id : teamFilter === 2 ? teams[1]?.id : undefined;
}

/** Whether `event` counts towards `template`, for one team only when `teamId` is given. */
export function qualifies(
  event: { type: EventType; teamId: number },
  template: TemplateName,
  teamId?: number,
): boolean {
  return (
    TEMPLATE_QUALIFYING_EVENTS[template].includes(event.type) &&
    (teamId === undefined || event.teamId === teamId)
  );
}

const QUESTION: Record<TemplateName, { either: string; team: string }> = {
  SHOT_ON_TARGET_NEXT_N: {
    either: "Shot on target in the next 2 min?",
    team: "{team} shot on target in the next 2 min?",
  },
  CORNER_NEXT_N: { either: "Corner in the next 3 min?", team: "{team} corner in the next 3 min?" },
  CARD_NEXT_N: { either: "Card shown in the next 5 min?", team: "{team} card in the next 5 min?" },
  GOAL_NEXT_N: { either: "Goal in the next 5 min?", team: "{team} goal in the next 5 min?" },
};

/**
 * A market's question as a fan reads it. `teamName` is the team a one-team market is about; leave
 * it out for a market about either team.
 */
export function marketQuestion(template: TemplateName, teamName?: string | null): string {
  return teamName ? QUESTION[template].team.replace("{team}", teamName) : QUESTION[template].either;
}
