import { marketQuestion, TEMPLATE_NAMES, type TemplateName } from "@ninety/core";

/** Each market type's question when it's about either team; see `marketQuestion` for one team's. */
export const TEMPLATE_QUESTION = Object.fromEntries(
  TEMPLATE_NAMES.map((t) => [t, marketQuestion(t)]),
) as Record<TemplateName, string>;

/** The name of the team a one-team market is about, given the match's teams home first. */
export function teamNameFor(
  teamFilter: number | undefined,
  teams: readonly { name: string }[] | undefined,
): string | null {
  if (!teamFilter) return null;
  return teams?.[teamFilter - 1]?.name ?? (teamFilter === 1 ? "Home team" : "Away team");
}

export const TEMPLATE_ORDER: TemplateName[] = [
  "SHOT_ON_TARGET_NEXT_N",
  "CORNER_NEXT_N",
  "CARD_NEXT_N",
  "GOAL_NEXT_N",
];
