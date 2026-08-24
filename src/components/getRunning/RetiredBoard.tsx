import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ROUTES } from "@/config/app.config";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import type { GetRunningModel } from "@/lib/getRunning/tasks";

/**
 * Screen 04 of the setup/settings design
 * (docs/superpowers/specs/2026-08-17-setup-settings-design/screens/04_04_Running.html):
 * once every applicable task is done (`model.complete`), the multi-phase board
 * (`GetRunningHeader` + the `PhaseCard` list) collapses into this single summary row
 * plus two info cards, in place of the phase checklist.
 *
 * "Hide from nav" is the same per-person, per-org dismissal every other setup rail
 * uses (`useRailDismissed`), consumed by `useGetRunningNavVisible` to drop the sidebar
 * item — it does not hide THIS row: visiting `/get-running` directly still renders it,
 * it is just no longer linked from the sidebar. "How this org works" opens the durable
 * home the same data lives on once the board itself is gone: `HowThisOrgWorks`,
 * hosted at Settings → How this org works.
 *
 * The design's subtitle line names live counts ("148 dates in, 36 offerable tonight")
 * that have no field on `GetRunningModel` yet (see `GetDatesSummary` in `PhaseCard.tsx`
 * for the same omission on the in-progress board) — reusing the existing
 * `header.body.complete` copy here instead of fabricating numbers.
 */
export function RetiredBoard({ model, orgId }: { model: GetRunningModel; orgId: string | null }): JSX.Element {
  const { t } = useTranslation("getRunning");
  const [, dismiss] = useRailDismissed("getRunning", orgId);

  return (
    <div
      data-testid="get-running-retired"
      className="flex w-full max-w-[1100px] flex-col gap-4 rounded-card border border-border bg-background p-6 shadow-elev3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-control border border-border bg-card p-4">
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-[15px] w-[15px]" strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1 sm:min-w-[220px]">
          <div className="text-base font-semibold tracking-[-0.1px] text-foreground">{t("retired.title")}</div>
          <p className="mt-0.5 text-control leading-[19px] text-muted-foreground text-pretty">
            {t("header.body.complete")}
          </p>
        </div>
        <span className="shrink-0 font-mono text-xs font-medium text-[var(--text-faint)]">
          {t("retired.count", { done: model.doneCount, total: model.totalCount })}
        </span>
        <Button asChild variant="secondary">
          <Link to={`${ROUTES.SETTINGS}?tab=how-it-works`}>{t("retired.howItWorks")}</Link>
        </Button>
        <Button onClick={dismiss}>{t("retired.hideFromNav")}</Button>
      </div>

      {/* The board can retire with a stray city-less date still present (completion is a
          setup measure, not a per-date one), so carry the same non-blocking advisory the
          in-progress header shows. Without it the only surface that warns "N dates can't be
          offered until they have a city" would vanish exactly when setup reads as done. */}
      {(model.datesWithoutCityUnknown || model.datesWithoutCity > 0) && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--amber-600)]" aria-hidden="true" />
          <span>
            {model.datesWithoutCityUnknown
              ? t("header.datesWithoutCityUnknown")
              : t("header.datesWithoutCity", { count: model.datesWithoutCity })}
          </span>
          <Link to={ROUTES.BOOKINGS} className="font-medium text-accent-600 hover:text-accent-700">
            {t("header.datesWithoutCityLink")}
          </Link>
        </p>
      )}

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1 rounded-control border border-border bg-card p-4">
          <Eyebrow className="text-[var(--text-faint)]">{t("retired.cards.whereItGoes.title")}</Eyebrow>
          <p className="mt-2 text-control leading-[19px] text-muted-foreground text-pretty">
            {t("retired.cards.whereItGoes.body")}
          </p>
        </div>
        <div className="flex-1 rounded-control border border-border bg-card p-4">
          <Eyebrow className="text-[var(--text-faint)]">{t("retired.cards.whenItComesBack.title")}</Eyebrow>
          <p className="mt-2 text-control leading-[19px] text-muted-foreground text-pretty">
            {t("retired.cards.whenItComesBack.body")}
          </p>
        </div>
      </div>
    </div>
  );
}
