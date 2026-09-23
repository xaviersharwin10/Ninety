export function BalancePill({
  label,
  value,
  accent = "lime",
}: {
  label: string;
  value: string;
  accent?: "lime" | "violet";
}) {
  const color = accent === "lime" ? "text-lime" : "text-violet";
  return (
    <div className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5">
      <span className="text-[11px] font-medium text-text-faint">{label}</span>
      <span className={`tabular font-display text-[15px] ${color}`}>{value}</span>
    </div>
  );
}
