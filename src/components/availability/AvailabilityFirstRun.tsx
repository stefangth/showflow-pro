import { useTranslation } from "react-i18next";
import { FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface AvailabilityFirstRunProps {
  /** currentOrg?.name, used in the eyebrow and the rules-card attribution. */
  orgName: string;
  /** Drives "N of 1 done" and whether the one-task strip still shows. */
  blockedCount: number;
  /** useFeature('hire_orders') — the footer line only appears when paperwork is on. */
  hireOrdersEnabled: boolean;
  /** flow.artist_acceptance — offers-by-email vs direct-book wording in the rules card. */
  artistAcceptance: boolean;
  /** Offer digest time, e.g. "19:00" (derived from the org's flow times). */
  digestLabel: string;
  /** Response window in hours (default 48). */
  windowHours: number;
  /** Scrolls to and focuses the block-date picker further down the page. */
  onBlockDates: () => void;
}

/**
 * The artist Availability first-run chrome (design screen 08,
 * `screen_08_08_Artist_first_run.html`). An artist has exactly one step, so there is no
 * board: a header + a "Your setup · 0 of 1 done" card, a single "Block what you cannot
 * play" task strip that retires the moment a date is blocked, and a read-only "How
 * booking works here" rules card that stays (it is reference, not setup). Purely
 * presentational; the page owns the data and the block mutation.
 */
export function AvailabilityFirstRun({
  orgName,
  blockedCount,
  hireOrdersEnabled,
  artistAcceptance,
  digestLabel,
  windowHours,
  onBlockDates,
}: AvailabilityFirstRunProps): JSX.Element {
  const { t } = useTranslation("availability");
  const done = Math.min(blockedCount, 1);
  const stepDone = blockedCount > 0;

  return (
    <div className="space-y-5">
      {/* Header row: intro + "Your setup" progress card */}
      <div className="flex flex-col items-start gap-6 sm:flex-row">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[1.6px] text-accent-600">
            {t("firstRun.eyebrow", { org: orgName })}
          </div>
          <h1 className="mt-2 max-w-[620px] font-display text-[32px] font-semibold leading-[38px] tracking-[-0.6px] text-pretty">
            {t("firstRun.headline")}
          </h1>
          <p className="mt-2 max-w-[600px] text-sm leading-[21px] text-muted-foreground text-pretty">
            {t("firstRun.body")}
          </p>
        </div>
        <div className="w-full shrink-0 rounded-[var(--radius-l)] border border-border bg-card p-3.5 sm:w-[236px]">
          <div className="text-[11px] font-semibold uppercase tracking-[1.6px] text-[var(--text-faint)]">
            {t("firstRun.setup.label")}
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-[22px] font-semibold tracking-[-0.4px]">{done}</span>
            <span className="text-xs text-[var(--text-faint)]">{t("firstRun.setup.ofOne")}</span>
          </div>
          <div className="mt-2.5 flex gap-[3px]">
            <div className={`h-[3px] flex-1 rounded-full ${stepDone ? "bg-primary" : "bg-[var(--surface-3)]"}`} />
          </div>
          <div className="mt-2.5 text-xs leading-[17px] text-muted-foreground text-pretty">
            {t("firstRun.setup.hint")}
          </div>
        </div>
      </div>

      {/* The one task — retires the moment a date is blocked */}
      {!stepDone && (
        <div className="flex items-start gap-3.5 rounded-[var(--radius-l)] border border-accent-300 bg-card p-4 shadow-elev2">
          <span className="mt-[3px] h-4 w-4 shrink-0 rounded-full border-[1.5px] border-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-base font-semibold tracking-[-0.1px]">{t("firstRun.task.title")}</div>
              <Badge variant="neutral">{t("firstRun.task.blocksNothing")}</Badge>
            </div>
            <div className="mt-1 text-[13px] leading-[19px] text-muted-foreground text-pretty">
              {t("firstRun.task.body")}
            </div>
          </div>
          <Button type="button" className="shrink-0" onClick={onBlockDates}>
            {t("firstRun.task.cta")}
          </Button>
        </div>
      )}

      {/* Rules inherited from the org — read-only reference, always shown */}
      <div className="rounded-[var(--radius-l)] border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
            {t("firstRun.rules.heading")}
          </span>
          <span className="flex-1" />
          <span className="text-xs text-[var(--text-faint)]">{t("firstRun.rules.setBy", { org: orgName })}</span>
        </div>
        <div className="flex flex-col sm:flex-row">
          <div className="flex-1 border-b border-border p-4 sm:border-b-0 sm:border-r">
            <div className="text-[13px] font-semibold">{t("firstRun.rules.eligibilityTitle")}</div>
            <div className="mt-1 text-xs leading-[17px] text-muted-foreground text-pretty">
              {t("firstRun.rules.eligibilityBody")}
            </div>
          </div>
          <div
            className={`flex-1 border-b border-border p-4 sm:border-b-0 ${artistAcceptance ? "sm:border-r" : ""}`}
          >
            <div className="text-[13px] font-semibold">{t("firstRun.rules.offersTitle")}</div>
            <div className="mt-1 text-xs leading-[17px] text-muted-foreground text-pretty">
              {artistAcceptance
                ? t("firstRun.rules.offersBody", { time: digestLabel })
                : t("firstRun.rules.offersBodyDirect")}
            </div>
          </div>
          {/* The response window only exists for offer based orgs. A direct book org has
              no offer to answer, so this column would be misleading and is dropped. */}
          {artistAcceptance && (
            <div className="flex-1 p-4">
              <div className="text-[13px] font-semibold">{t("firstRun.rules.windowTitle", { hours: windowHours })}</div>
              <div className="mt-1 text-xs leading-[17px] text-muted-foreground text-pretty">
                {t("firstRun.rules.windowBody")}
              </div>
            </div>
          )}
        </div>
      </div>

      {hireOrdersEnabled && (
        <div className="flex items-center gap-2.5 text-xs text-[var(--text-faint)]">
          <FileSignature className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t("firstRun.hireOrdersFooter")}</span>
        </div>
      )}
    </div>
  );
}
