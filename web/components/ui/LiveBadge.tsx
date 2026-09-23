export function LiveBadge({ label = "LIVE" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-coral/12 px-2.5 py-1 text-[11px] font-bold tracking-wider text-coral">
      <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-coral" />
      {label}
    </span>
  );
}
