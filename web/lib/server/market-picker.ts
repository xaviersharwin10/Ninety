import { type NormalizedEvent, TEMPLATE_NAMES, type TemplateName, teamIdFor } from "@ninety/core";

/**
 * Chooses the next market to open from what the match is doing, rather than cycling through the
 * four types in order. A team laying siege gets a market about its next corner or shot; a game
 * turning bad-tempered gets a card market; a quiet spell falls back to the plain rotation, because
 * with nothing to go on every type scores the same and the least recently used wins.
 *
 * It only chooses the question. What it's worth is still up to the agents.
 */
export interface MarketPick {
  templateIdx: number;
  /** 0 = either team, 1 = home only, 2 = away only. */
  teamFilter: number;
}

export interface PickInput {
  /** Everything that has aired so far. */
  events: readonly NormalizedEvent[];
  /** The match's teams, home first. Without them only either-team markets are picked. */
  teams: readonly { id: number }[];
  nowMatchClockSec: number;
  /** Markets open right now: the same question is never open twice. */
  open: readonly { templateIdx: number; teamFilter?: number }[];
  /** Market types opened lately, newest first. */
  recentTemplateIdx: readonly number[];
}

const LOOKBACK_SEC = 6 * 60;
/** How much less a type scores for having just been asked: newest first. */
const RECENCY_PENALTY = [0.2, 0.45, 0.7];
/** A one-team question needs that team to be doing something; on a quiet pitch it scores below
 *  the either-team one. */
const TEAM_BASE = 0.55;

/** Which recent events make each market type more worth asking, and how strongly. */
const HEAT: Record<TemplateName, Partial<Record<NormalizedEvent["type"], number>>> = {
  SHOT_ON_TARGET_NEXT_N: { shot_on_target: 0.5, shot_off_target: 0.35, corner: 0.25 },
  CORNER_NEXT_N: { corner: 0.5, shot_on_target: 0.25, shot_off_target: 0.25 },
  CARD_NEXT_N: { card: 0.7 },
  GOAL_NEXT_N: { shot_on_target: 0.45, goal: 0.3, corner: 0.15, shot_off_target: 0.15 },
};

export function pickNextMarket(input: PickInput): MarketPick {
  const recent = input.events.filter(
    (e) =>
      e.matchClockSec > input.nowMatchClockSec - LOOKBACK_SEC &&
      e.matchClockSec <= input.nowMatchClockSec,
  );
  const heat = (template: TemplateName, teamId?: number) =>
    recent.reduce(
      (sum, e) =>
        teamId === undefined || e.teamId === teamId ? sum + (HEAT[template][e.type] ?? 0) : sum,
      0,
    );

  let best: MarketPick & { score: number } = { templateIdx: 0, teamFilter: 0, score: -1 };
  TEMPLATE_NAMES.forEach((template, templateIdx) => {
    const age = input.recentTemplateIdx.indexOf(templateIdx);
    const variety = age === -1 ? 1 : (RECENCY_PENALTY[age] ?? 1);
    // Cards come late: tired legs and a result to protect.
    const late = template === "CARD_NEXT_N" && input.nowMatchClockSec > 60 * 60 ? 0.4 : 0;
    for (const teamFilter of [0, 1, 2]) {
      if (
        input.open.some((m) => m.templateIdx === templateIdx && (m.teamFilter ?? 0) === teamFilter)
      ) {
        continue;
      }
      const teamId = teamIdFor(teamFilter, input.teams);
      if (teamFilter !== 0 && teamId === undefined) continue;
      const all = heat(template);
      const own = heat(template, teamId);
      // The either-team question rises gently with the play. A one-team question rises faster the
      // more of that play is this team's: it overtakes only when one side is doing the pressing.
      const interest =
        teamFilter === 0 ? 1 + all * 0.5 : TEAM_BASE + own * (0.5 + (all > 0 ? own / all : 0));
      const score = (interest + late) * variety;
      // Strictly greater: on a tie the earlier type and the either-team question win, which is
      // what makes a quiet match fall back to the plain rotation.
      if (score > best.score) best = { templateIdx, teamFilter, score };
    }
  });
  return { templateIdx: best.templateIdx, teamFilter: best.teamFilter };
}
