import { ChevronLeft, ChevronRight } from "lucide-react";

export interface CockpitPagerProps {
  /** Mono label, e.g. "Date 3 of 11". */
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
}

const arrowCls =
  "inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-s)] border-[0.5px] border-[var(--line-strong)] bg-[var(--surface)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--surface)]";

/**
 * The cockpit's top pager bar (prototype's command rail): prev/next through the
 * caller's ordered list plus a position label. Rendered above the header only
 * when the sheet is opened from a list context (the bookings page) — the sheet's
 * own close button (top-right) serves as the ✕. Purely presentational.
 */
export function CockpitPager({ label, onPrev, onNext, prevDisabled, nextDisabled }: CockpitPagerProps) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)] px-5 py-2.5">
      <button type="button" aria-label="Previous date" className={arrowCls} onClick={onPrev} disabled={prevDisabled}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Next date" className={arrowCls} onClick={onNext} disabled={nextDisabled}>
        <ChevronRight className="h-4 w-4" />
      </button>
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
