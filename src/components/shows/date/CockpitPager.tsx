import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Metric } from "@/components/ui/metric";

export interface CockpitPagerProps {
  /** Tabular sans label, e.g. "Date 3 of 11". */
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
}

const arrowCls =
  "inline-flex h-7 w-7 items-center justify-center rounded-field border-[0.5px] border-[var(--line-strong)] bg-[var(--surface)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--surface)]";

/**
 * The cockpit's top pager bar (prototype's command rail): prev/next through the
 * caller's ordered list plus a position label. Rendered above the header only
 * when the sheet is opened from a list context (the bookings page) — the sheet's
 * own close button (top-right) serves as the ✕. Purely presentational.
 */
export function CockpitPager({ label, onPrev, onNext, prevDisabled, nextDisabled }: CockpitPagerProps) {
  const { t } = useTranslation("showsDetail");
  return (
    <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)] px-5 py-2.5">
      <button type="button" aria-label={t("cockpitPager.previousDate")} className={arrowCls} onClick={onPrev} disabled={prevDisabled}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button type="button" aria-label={t("cockpitPager.nextDate")} className={arrowCls} onClick={onNext} disabled={nextDisabled}>
        <ChevronRight className="h-4 w-4" />
      </button>
      <Metric className="text-xs text-muted-foreground">{label}</Metric>
    </div>
  );
}
