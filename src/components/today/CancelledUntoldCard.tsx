import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import type { CancelledUntoldDate } from "@/lib/autopilot/today";
import { DateRail } from "./DateRail";
import { joinNames } from "./joinNames";

interface CancelledUntoldCardProps {
  item: CancelledUntoldDate;
  onTellCast: (item: CancelledUntoldDate) => void;
  onReadFirst: (item: CancelledUntoldDate) => void;
}

/**
 * "Cancelled, cast not told" card (prototype lines 209-229).
 *
 * `cancelled.body` used to carry a `{{when}}` slot ("The house cancelled
 * this date {{when}}.") with no backing data: neither `CancelledUntoldDate`
 * nor its raw `CancelledUntoldInput` carries a cancellation timestamp
 * anywhere in the pipeline (today.ts / autopilot.ts), and `show_dates` has
 * no `cancelled_at` column to source one from — only `cast_notified_at`
 * (a different event: telling the cast, not cancelling the date) and the
 * generic `updated_at` (touched by any field edit, not reliably the
 * cancellation moment, and itself gets bumped by the notify action this
 * card's own CTA triggers). Adding a real column is a schema change, out of
 * scope for a copy fix. Rewrote the sentence in both languages instead of
 * shipping a hole in it.
 */
export function CancelledUntoldCard({ item, onTellCast, onReadFirst }: CancelledUntoldCardProps) {
  const { t, i18n } = useTranslation("today");
  const names = joinNames(item.artistNames, i18n.language);
  const body = t("cancelled.body", { names });

  return (
    <div className="flex items-stretch overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-elev2">
      <DateRail dateKey={item.date} daysOut={item.daysOut} tone="accent" />
      <div className="flex min-w-0 flex-1 items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <Eyebrow tone="accent" className="mb-1">
            {t("cancelled.badge")}
          </Eyebrow>
          <p className="m-0 text-title-sm font-semibold tracking-[-0.2px]">
            {item.title} · {item.where}
          </p>
          <p className="m-0 mt-2 text-sm leading-[21px]">{body}</p>
          <div className="mt-3.5 flex items-center gap-3">
            <Button size="default" onClick={() => onTellCast(item)}>
              {t("cancelled.cta")}
            </Button>
            <button
              type="button"
              onClick={() => onReadFirst(item)}
              className="border-0 bg-transparent p-0 text-control font-medium text-accent-text"
            >
              {t("cancelled.readFirst")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
