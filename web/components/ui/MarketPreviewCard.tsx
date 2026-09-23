import { LiveBadge } from "./LiveBadge";

interface MarketPreviewCardProps {
  question: string;
  minute: string;
  yesOdds: string;
  noOdds: string;
  className?: string;
}

/** A non-interactive glimpse of a hero market card, used to give the login screen a sense of the
 *  real product before anyone has signed in. The real, interactive version lives on the match screen. */
export function MarketPreviewCard({
  question,
  minute,
  yesOdds,
  noOdds,
  className = "",
}: MarketPreviewCardProps) {
  return (
    <div className={`glass w-full max-w-[300px] rounded-2xl p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <LiveBadge />
        <span className="tabular text-[11px] font-semibold text-text-faint">{minute}</span>
      </div>
      <p className="mt-3 text-[15px] font-semibold leading-snug text-text">{question}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-lime/25 bg-lime/8 px-3 py-2 text-center">
          <div className="text-[10px] font-bold tracking-wider text-lime/80">YES</div>
          <div className="font-display text-lg text-lime">{yesOdds}x</div>
        </div>
        <div className="rounded-xl border border-coral/25 bg-coral/8 px-3 py-2 text-center">
          <div className="text-[10px] font-bold tracking-wider text-coral/80">NO</div>
          <div className="font-display text-lg text-coral">{noOdds}x</div>
        </div>
      </div>
    </div>
  );
}
