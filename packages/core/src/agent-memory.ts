import { TEMPLATE_NAMES, type TemplateName } from "./templates.js";

/**
 * An agent's memory: what it has learned from the markets it priced, carried from one session to
 * the next. Per market type: how its bets went, and a margin adjustment learned from that -- a type
 * where it keeps paying out gets a wider margin, one where it keeps winning a slightly tighter one.
 * Learned incrementally, one session at a time, from only the bets settled since the last save, so
 * it can't be recomputed from public history alone: it's the agent's own edge. How it's sealed to
 * the operator's passkey and stored lives in the web app (web/lib/agent-memory.ts).
 */
export interface TemplateMemory {
  /** Bets settled on this market type across every session. */
  bets: number;
  /** Net P&L on them, nUSD base units as a decimal string (JSON has no bigint). */
  pnl: string;
  /** Learned change to the strategy's margin for this market type, in bps. */
  marginAdjBps: number;
}

export interface AgentMemory {
  v: 1;
  agentId: number;
  /** Sessions the agent has learned from. */
  sessions: number;
  /** Highest bet id already learned from, so a bet is never counted twice. */
  lastBetId: number;
  templates: Record<TemplateName, TemplateMemory>;
  /** Plain-language record of what changed and why, newest first. */
  lessons: string[];
}

/** How far a learned adjustment may move the margin, either way. */
const MAX_ADJ_BPS = 500;
const MIN_ADJ_BPS = -100;
/** Bets on a market type in one session before the agent will draw a conclusion from them. */
const MIN_BETS_TO_LEARN = 2;
const MAX_LESSONS = 12;

export function freshMemory(agentId: number): AgentMemory {
  return {
    v: 1,
    agentId,
    sessions: 0,
    lastBetId: 0,
    templates: Object.fromEntries(
      TEMPLATE_NAMES.map((t) => [t, { bets: 0, pnl: "0", marginAdjBps: 0 }]),
    ) as Record<TemplateName, TemplateMemory>,
    lessons: [],
  };
}

/** A settled bet, from the agent's side. */
export interface SettledBet {
  id: number;
  template: TemplateName;
  /** The agent's P&L on it: +stake if the bettor lost, -(payout - stake) if they won, 0 if voided. */
  agentPnl: bigint;
}

const TEMPLATE_LABEL: Record<TemplateName, string> = {
  SHOT_ON_TARGET_NEXT_N: "shots on target",
  CORNER_NEXT_N: "corners",
  CARD_NEXT_N: "cards",
  GOAL_NEXT_N: "goals",
};

function formatNusd(units: bigint): string {
  const abs = units < 0n ? -units : units;
  return `${units < 0n ? "−" : "+"}${(Number(abs) / 1e6).toFixed(2)}`;
}

/**
 * One session's learning: folds the bets settled since the last save into the memory and adjusts
 * each market type's margin from how *this session* went. A losing type widens by 100bps (the agent
 * was underpricing the risk); a clearly winning one tightens by 25bps (it can afford to compete
 * harder for flow). Pure and deterministic -- the same memory and bets always give the same result.
 */
export function learn(memory: AgentMemory, settled: SettledBet[]): AgentMemory {
  const fresh = settled.filter((b) => b.id > memory.lastBetId);
  if (fresh.length === 0) return memory;

  const next: AgentMemory = structuredClone(memory);
  next.sessions += 1;
  next.lastBetId = Math.max(memory.lastBetId, ...fresh.map((b) => b.id));

  const lessons: string[] = [];
  for (const template of TEMPLATE_NAMES) {
    const bets = fresh.filter((b) => b.template === template);
    if (bets.length === 0) continue;
    const pnl = bets.reduce((sum, b) => sum + b.agentPnl, 0n);
    const t = next.templates[template];
    t.bets += bets.length;
    t.pnl = (BigInt(t.pnl) + pnl).toString();

    if (bets.length < MIN_BETS_TO_LEARN) continue;
    const before = t.marginAdjBps;
    if (pnl < 0n) t.marginAdjBps = Math.min(MAX_ADJ_BPS, before + 100);
    else if (pnl > 0n) t.marginAdjBps = Math.max(MIN_ADJ_BPS, before - 25);
    if (t.marginAdjBps !== before) {
      const verb = t.marginAdjBps > before ? "Widened" : "Tightened";
      lessons.push(
        `Session ${next.sessions}: ${verb} ${TEMPLATE_LABEL[template]} margin to ${t.marginAdjBps >= 0 ? "+" : ""}${t.marginAdjBps}bps after ${formatNusd(pnl)} nUSD on ${bets.length} bets.`,
      );
    }
  }
  if (lessons.length === 0) {
    lessons.push(`Session ${next.sessions}: ${fresh.length} bets settled, no change warranted.`);
  }
  next.lessons = [...lessons, ...memory.lessons].slice(0, MAX_LESSONS);
  return next;
}
