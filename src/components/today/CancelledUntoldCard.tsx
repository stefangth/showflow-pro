import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { CancelledUntoldDate } from "@/lib/autopilot/today";
import { DateRail } from "./DateRail";

interface CancelledUntoldCardProps {
  item: CancelledUntoldDate;
  onTellCast: (item: CancelledUntoldDate) => void;
  onReadFirst: (item: CancelledUntoldDate) => void;
}

/** Locale-aware "A and B" / "A, B and C" joiner — native Intl, no hardcoded
 *  " and " literal (that would bypass i18n for German). Duplicated from
 *  BouncedAsksBanner (2 call sites, not worth a shared module). */
interface ListFormatCtor {
  new (locale: string, options: { style: "long"; type: "conjunction" }): { format: (list: string[]) => string };
}

function joinNames(names: string[], locale: string): string {
  const ListFormatImpl = (Intl as unknown as { ListFormat: ListFormatCtor }).ListFormat;
  return new ListFormatImpl(locale, { style: "long", type: "conjunction" }).format(names);
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
    <div className="flex items-stretch overflow-hidden rounded-[14px] border border-border bg-card shadow-elev2">
      <DateRail dateKey={item.date} daysOut={item.daysOut} tone="accent" />
      <div className="flex min-w-0 flex-1 items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <p className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-[1.6px] text-accent-text">
            {t("cancelled.badge")}
          </p>
          <p className="m-0 text-[18px] font-semibold tracking-[-0.2px]">
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
              className="border-0 bg-transparent p-0 text-[12.5px] font-medium text-accent-text"
            >
              {t("cancelled.readFirst")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
