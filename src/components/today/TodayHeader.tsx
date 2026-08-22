import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { dfLocale } from "@/lib/dates";
import { Eyebrow } from "@/components/ui/eyebrow";

interface TodayHeaderProps {
  openCount: number;
  fillingOnTheirOwn: number;
  bookedOvernight: number;
  /** `TodayModel.producerConfirmation` — with the last word kept, an overnight
   *  yes is a hold waiting on the producer, not a booking. */
  producerConfirmation: boolean;
  /** Whether THIS viewer may book an artist who said yes (`confirm_bookings`).
   *  An org admin can revoke it from producers, and then the said-yes dates are
   *  waiting on an admin, not on the producer reading this line. */
  canBook: boolean;
  /** "today" as a Date, used only for the eyebrow's weekday + full date. */
  today: Date;
}

/**
 * Page eyebrow + H1 + sub line (prototype lines 153-157). Eyebrow uses
 * `text-accent-text`, never `text-accent-700` — the accent 50-900 scale is
 * immutable across modes, so `accent-700` is unreadable on the dark ground.
 */
export function TodayHeader({
  openCount,
  fillingOnTheirOwn,
  bookedOvernight,
  producerConfirmation,
  canBook,
  today,
}: TodayHeaderProps) {
  const { t } = useTranslation("today");
  const done = openCount === 0;

  // "sub" pluralizes on fillingOnTheirOwn (its own {{count}}); the booked-overnight
  // figure inside it is a second quantity with its own zero/one/other shape, so it
  // is resolved as its own translation first and interpolated in as plain text —
  // i18next only ever pluralizes a string on its single "count" option.
  // Classic orgs (producer_confirmation on) get the said-yes wording: the artists
  // counted here accepted overnight, but nothing is booked until someone books it.
  // Who that someone is depends on the viewer's own right to book, so a producer
  // whose org took `confirm_bookings` away is not told to do something they cannot.
  // Autopilot orgs, where a yes books on its own, keep the booked wording.
  const bookedKey = !producerConfirmation
    ? "header.bookedOvernight"
    : canBook
      ? "header.saidYesOvernight"
      : "header.saidYesOvernightAdmin";
  const bookedText = t(bookedKey, { count: bookedOvernight });

  return (
    <div>
      <Eyebrow tone="accent">
        {format(today, "EEEE d MMMM", { locale: dfLocale() })}
      </Eyebrow>
      <h1 className="m-0 mt-1 text-display-sm font-semibold tracking-[-0.6px]">
        {done ? t("header.headlineDone") : t("header.headline", { count: openCount })}
      </h1>
      <p className="m-0 mt-1.5 text-sm text-muted-foreground">
        {done
          ? t("header.subDone", { bookedText })
          : t("header.sub", { count: fillingOnTheirOwn, bookedText })}
      </p>
    </div>
  );
}
