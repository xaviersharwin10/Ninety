"use client";

import type { NormalizedEvent } from "@ninety/core";
import type { MatchListEntry } from "@/lib/match-data";
import { recentMoments, recentPlay } from "@/lib/pitch";

const W = 105;
const H = 68;

const MOMENT_LABEL: Partial<Record<NormalizedEvent["type"], string>> = {
  goal: "GOAL",
  shot_on_target: "On target",
  shot_off_target: "Shot wide",
  corner: "Corner",
  card: "Card",
};

/**
 * The match as it plays, in place of video we can't show: where the ball is, the last few touches
 * leading there, and the big moments of the last minute. Home attacks left to right throughout.
 * Built from the same event stream as the ticker and stats; nothing extra is fetched.
 */
export function PitchView({
  events,
  teams,
  nowSec,
}: {
  events: NormalizedEvent[];
  teams: MatchListEntry["teams"];
  nowSec: number;
}) {
  const [home, away] = teams;
  const homeId = home?.id;
  const play = recentPlay(events, homeId, nowSec);
  const moments = recentMoments(events, homeId, nowSec);
  const ball = play.at(-1);
  const color = (isHome: boolean) => (isHome ? "var(--color-lime)" : "var(--color-violet)");

  return (
    <div className="rounded-3xl border border-border bg-bg-elevated/80 p-3 md:p-5">
      <div className="flex items-center justify-between px-1 text-[11px] font-semibold">
        <span className="text-lime">{home?.name ?? "Home"} →</span>
        <span className="text-violet">← {away?.name ?? "Away"}</span>
      </div>
      <svg
        viewBox={`-2 -2 ${W + 4} ${H + 4}`}
        className="mt-2 w-full"
        role="img"
        aria-label="Where the ball is, and the last few moments of play"
      >
        <g fill="none" stroke="currentColor" strokeWidth={0.35} className="text-white/15">
          <rect x={0} y={0} width={W} height={H} rx={0.5} />
          <line x1={W / 2} y1={0} x2={W / 2} y2={H} />
          <circle cx={W / 2} cy={H / 2} r={9.15} />
          <rect x={0} y={(H - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={W - 16.5} y={(H - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={0} y={(H - 18.3) / 2} width={5.5} height={18.3} />
          <rect x={W - 5.5} y={(H - 18.3) / 2} width={5.5} height={18.3} />
          <rect x={-1.5} y={(H - 7.3) / 2} width={1.5} height={7.3} />
          <rect x={W} y={(H - 7.3) / 2} width={1.5} height={7.3} />
        </g>

        {/* The last few touches: who had it, and the path to where the ball is now. */}
        {play.length > 1 && (
          <polyline
            points={play.map((p) => `${(p.x * W) / 100},${(p.y * H) / 100}`).join(" ")}
            fill="none"
            stroke="white"
            strokeOpacity={0.18}
            strokeWidth={0.4}
            strokeLinejoin="round"
          />
        )}
        {play.slice(0, -1).map((p, i) => (
          <circle
            key={p.id}
            cx={(p.x * W) / 100}
            cy={(p.y * H) / 100}
            r={0.9}
            fill={color(p.isHome)}
            opacity={0.25 + (0.5 * i) / play.length}
          />
        ))}

        {moments.map((m) => (
          <g key={m.id} transform={`translate(${(m.x * W) / 100} ${(m.y * H) / 100})`}>
            <circle r={2.6} fill={color(m.isHome)} opacity={0.18} />
            <circle r={1.3} fill={color(m.isHome)} />
            <text
              y={-3.6}
              // Pulled inwards near either end, so a label by the goal line stays on the pitch.
              textAnchor={m.x > 85 ? "end" : m.x < 15 ? "start" : "middle"}
              fontSize={3.4}
              fontWeight={700}
              fill={m.type === "goal" ? "var(--color-lime)" : "white"}
            >
              {MOMENT_LABEL[m.type]}
            </text>
          </g>
        ))}

        {ball && (
          <circle
            r={1.4}
            fill="white"
            stroke="black"
            strokeWidth={0.3}
            style={{
              transform: `translate(${(ball.x * W) / 100}px, ${(ball.y * H) / 100}px)`,
              transition: "transform 600ms ease-out",
            }}
          />
        )}
      </svg>
    </div>
  );
}
