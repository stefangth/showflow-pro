import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { dfLocale } from "@/lib/dates";

interface TodayHeaderProps {
  openCount: number;
  fillingOnTheirOwn: number;
  bookedOvernight: number;
  /** "today" as a Date, used only for the eyebrow's weekday + full date. */
  today: Date;
}

/**
 * Page eyebrow + H1 + sub line (prototype lines 153-157). Eyebrow uses
 * `text-accent-text`, never `text-accent-700` — the accent 50-900 scale is
 * immutable across modes, so `accent-700` is unreadable on the dark ground.
 */
export function TodayHeader({ openCount, fillingOnTheirOwn, bookedOvernight, today }: TodayHeaderProps) {
  const { t } = useTranslation("today");
  const done = openCount === 0;

  // "sub" pluralizes on fillingOnTheirOwn (its own {{count}}); the booked-overnight
  // figure inside it is a second quantity with its own zero/one/other shape, so it
  // is resolved as its own translation first and interpolated in as plain text —
  // i18next only ever pluralizes a string on its single "count" option.
  const bookedText = t("header.bookedOvernight", { count: bookedOvernight });

  return (
    <div>
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[1.6px] text-accent-text">
        {format(today, "EEEE d MMMM", { locale: dfLocale() })}
      </p>
      <h1 className="m-0 mt-1 text-[32px] font-semibold tracking-[-0.6px]">
        {done ? t("header.headlineDone") : t("header.headline", { count: openCount })}
      </h1>
      <p className="m-0 mt-1.5 text-sm text-muted-foreground">
        {done
          ? t("header.subDone", { count: bookedOvernight })
          : t("header.sub", { count: fillingOnTheirOwn, bookedText })}
      </p>
    </div>
  );
}
