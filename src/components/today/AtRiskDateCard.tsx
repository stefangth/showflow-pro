import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/utils";
import type { AtRiskDate } from "@/lib/autopilot/today";
import { DateRail } from "./DateRail";

interface AtRiskDateCardProps {
  item: AtRiskDate;
  /** "19:00" — the org's offer digest hour, formatted. */
  askTimeLabel: string;
  onOpenNextCast: (item: AtRiskDate) => void;
  onOpenDate: (item: AtRiskDate) => void;
}

interface ResolutionOption {
  key: string;
  title: string;
  note: string;
  buttonLabel: string;
  onClick: () => void;
}

/**
 * The hero at-risk card (prototype lines 168-207): three resolution options
 * in the design, but only two are wired here. The middle option ("Run the
 * show with N fewer") is deliberately omitted — there is no per-date slot
 * override anywhere in this system (`showSlots` and the DB's
 * `compute_show_date_status` trigger both read only `shows.main_cast_slots`),
 * so the button would silently do nothing. Flagged to the owner as a product
 * gap, not solved here.
 *
 * When there is no next-tier cast to open (`item.nextCastName` is null —
 * either every tier is already open, or the next tier has no cast assigned),
 * only "Pick the people yourself" renders, promoted to the recessed/primary
 * treatment so the card never shows a gap or a dead row.
 *
 * `item.exhausted` (finding 2 in the Today board review) is true only when
 * BOTH `hasUnopenedTier` is false AND `unaskedEligibleCount` is 0 — i.e.
 * there is genuinely no further tier to open AND no eligible artist left
 * unasked. `nextCastName` is mathematically already null whenever that's
 * true (it is only ever set from a not-yet-opened tier), so the "Open it up
 * to X" option was already hidden by coincidence; `!item.exhausted` below
 * makes that explicit and defensive rather than relying on the coincidence.
 * The body copy and the "pick yourself" note also switch to exhausted-aware
 * text so the card stops implying Autopilot could still surface a candidate,
 * or that the roster still has someone free, when it does not.
 */
export function AtRiskDateCard({ item, askTimeLabel, onOpenNextCast, onOpenDate }: AtRiskDateCardProps) {
  const { t } = useTranslation("today");

  const options: ResolutionOption[] = [];
  if (!item.exhausted && item.nextCastName) {
    options.push({
      key: "openCast",
      title: t("atRisk.openCastTitle", { cast: item.nextCastName }),
      note: t("atRisk.openCastNote", { count: item.nextCastFreeCount, time: askTimeLabel }),
      buttonLabel: t("atRisk.doThis"),
      onClick: () => onOpenNextCast(item),
    });
  }
  const nobodyFreeEither = item.exhausted && item.rosterFreeCount === 0;
  options.push({
    key: "pickYourself",
    title: t("atRisk.pickYourselfTitle"),
    note: nobodyFreeEither
      ? t("atRisk.pickYourselfExhaustedNote")
      : t("atRisk.pickYourselfNote", { total: item.rosterCount, free: item.rosterFreeCount }),
    buttonLabel: t("atRisk.openDate"),
    onClick: () => onOpenDate(item),
  });

  return (
    <div className="flex items-stretch overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-elev3">
      <DateRail dateKey={item.date} daysOut={item.daysOut} tone="amber" />
      <div className="flex min-w-0 flex-1 items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <Eyebrow tone="waiting" className="mb-1">
            {t("atRisk.badge", { count: item.placesEmpty })}
          </Eyebrow>
          <p className="m-0 text-title-sm font-semibold tracking-[-0.2px]">
            {item.title} · {item.where}
          </p>
          <p className="m-0 mt-2 text-sm leading-[21px]">
            {item.exhausted
              ? t("atRisk.exhaustedBody", { count: item.placesEmpty, days: item.daysOut })
              : t("atRisk.body", { count: item.placesEmpty, days: item.daysOut })}
          </p>
          <div className="mt-3.5 flex flex-col gap-2">
            {options.map((opt, i) => (
              <div
                key={opt.key}
                className={cn(
                  "flex items-center gap-3 rounded-l border border-border p-3.5",
                  i === 0 && "bg-well-tint",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-control font-semibold">{opt.title}</p>
                  <p className="m-0 mt-0.5 text-control text-muted-foreground">{opt.note}</p>
                </div>
                <Button
                  size="sm"
                  variant={i === 0 ? "default" : "secondary"}
                  onClick={opt.onClick}
                  className="shrink-0"
                >
                  {opt.buttonLabel}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
