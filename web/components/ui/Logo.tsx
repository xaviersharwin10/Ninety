export function Logo({ size = 36 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl bg-lime font-display leading-none text-[#06070a]"
      style={{ width: size, height: size, fontSize: size * 0.46 }}
    >
      90
    </div>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Logo size={30} />
      <span className="font-display text-[22px] tracking-wide">NINETY</span>
    </div>
  );
}
