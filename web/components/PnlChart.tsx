import type { PnlPoint } from "@/hooks/useAgentStats";

/**
 * Cumulative realised P&L as a line, with the zero line marked. Plain SVG -- a sparkline on the
 * leaderboard card, a taller chart in the vault sheet. Points are spaced by settlement order, not
 * time: settlements cluster within matches and go quiet between them, and evenly spaced points
 * read far more clearly than long flat gaps.
 */
export function PnlChart({
  series,
  height = 36,
  className = "",
}: {
  series: PnlPoint[];
  height?: number;
  className?: string;
}) {
  const width = 100;
  // Start every curve at zero, before its first settlement.
  const values = [0, ...series.map((p) => Number(p.pnl))];
  if (values.length < 2) {
    return (
      <div
        className={`flex items-center justify-center text-[11px] text-text-faint ${className}`}
        style={{ height }}
      >
        No settled bets yet
      </div>
    );
  }

  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const last = values[values.length - 1]!;
  const color = last >= 0 ? "var(--color-lime)" : "var(--color-coral)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height }}
      role="img"
      aria-label={`Cumulative P&L across ${series.length} settled bets`}
    >
      <line
        x1={0}
        x2={width}
        y1={y(0)}
        y2={y(0)}
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={path.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
