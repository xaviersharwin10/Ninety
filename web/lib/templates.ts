import type { TemplateName } from "@ninety/core";

export const TEMPLATE_QUESTION: Record<TemplateName, string> = {
  SHOT_ON_TARGET_NEXT_N: "Shot on target in the next 2 min?",
  CORNER_NEXT_N: "Corner in the next 3 min?",
  CARD_NEXT_N: "Card shown in the next 5 min?",
  GOAL_NEXT_N: "Goal in the next 5 min?",
};

export const TEMPLATE_ORDER: TemplateName[] = [
  "SHOT_ON_TARGET_NEXT_N",
  "CORNER_NEXT_N",
  "CARD_NEXT_N",
  "GOAL_NEXT_N",
];
