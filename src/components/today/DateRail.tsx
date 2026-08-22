import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { dfLocale, parseDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/eyebrow";
import type { Tone } from "@/components/ui/tones";

export type DateRailTone = "amber" | "accent";

interface DateRailProps {
  /** yyyy-mm-dd */
  dateKey: string;
  daysOut: number;
  tone: DateRailTone;
}

const TONE_CLASSES: Record<DateRailTone, { bg: string; text: string }> = {
  amber: { bg: "bg-[var(--amber-100)]", text: "text-[var(--amber-600)]" },
  accent: { bg: "bg-accent-tint", text: "text-accent-text" },
};

// The two `DateRailTone` values render an identical color to the matching `TONES`
// entry (amber = waiting, accent = accent), so the weekday eyebrow can use the
// canonical `<Eyebrow>` primitive instead of a hand-rolled uppercase block.
const TONE_TO_TONES: Record<DateRailTone, Tone> = { amber: "waiting", accent: "accent" };

/**
 * The 92px weekday/day/month/"in Nd" rail shared by the at-risk and
 * cancelled-untold cards (prototype lines 170-175, 211-215).
 *
 * The prototype's mono "in 17d" abbreviation has no backing today.json key —
 * `today.json` (Task 4) never added a dateRail namespace. Rather than invent
 * a key or hardcode English, this reuses the existing, already-translated
 * `bookings:calendar.needsYou.note.atRiskLeadDays` pair ("in {{count}} day(s)"),
 * which is the app's one other "days until a date" phrase. That trades the
 * prototype's compact "17d" for the fuller "in 17 days" — flagged in the
 * task report as a fidelity deviation, not a silent guess.
 */
export function DateRail({ dateKey, daysOut, tone }: DateRailProps) {
  const { t } = useTranslation("bookings");
  const date = parseDateOnly(dateKey);
  const toneClasses = TONE_CLASSES[tone];

  return (
    <div
      className={cn(
        "flex w-[92px] shrink-0 flex-col items-center gap-0.5 border-r border-border py-5",
        toneClasses.bg,
      )}
    >
      <Eyebrow tone={TONE_TO_TONES[tone]}>
        {format(date, "EEE", { locale: dfLocale() })}
      </Eyebrow>
      <p className={cn("m-0 font-mono text-display-sm font-semibold leading-8", toneClasses.text)}>
        {format(date, "dd", { locale: dfLocale() })}
      </p>
      <p className="m-0 text-eyebrow text-muted-foreground">{format(date, "MMM", { locale: dfLocale() })}</p>
      <p className={cn("m-0 mt-1.5 font-mono text-eyebrow", toneClasses.text)}>
        {t("calendar.needsYou.note.atRiskLeadDays", { count: daysOut })}
      </p>
    </div>
  );
}
