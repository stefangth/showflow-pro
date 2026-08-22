import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateDMY } from "@/lib/dates";
import { formatInterval } from "@/lib/airtablePoll";

import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import type { AirtableConnectStep } from "./AirtableConnectRail";

interface AirtableConnectionSummaryProps {
  orgId: string | null;
  readOnly: boolean;
  canTriggerSync: boolean;
  /** Re-opens the rail (11b) on the group the visitor clicked. */
  onEditStep: (step: AirtableConnectStep) => void;
}

/** The collapsed, steady-state view (screen 11a): four groups — Token, Base and table,
 *  Map fields, Link catalog — each reading straight from `useAirtableConsole`, the same
 *  data-wiring the rail (11b) and the Settings console share. */
export function AirtableConnectionSummary({ orgId, readOnly, canTriggerSync, onEditStep }: AirtableConnectionSummaryProps) {
  const { t } = useTranslation("settingsAirtable");
  const c = useAirtableConsole(orgId, { readOnly, canTriggerSync });
  const canWrite = !readOnly;

  const tableLabel = c.settings.airtable_table_name || t("manageDialog.baseTable.selectTablePlaceholder");
  const viewLabel = c.settings.airtable_view || t("overview.connection.tableViewFallbackView");
  const baseTableLine = t("connection.baseTableRow", {
    base: c.baseName,
    table: tableLabel,
    view: viewLabel,
    frequency: formatInterval(c.settings.airtable_poll_interval_minutes),
  });

  const mapIncomplete = c.mapped < c.mappedTotal;
  const catalogIncomplete = c.heldCount > 0;

  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-elev3">
      <div className="border-b border-border p-4">
        {/* eslint-disable-next-line no-restricted-syntax -- tracking-[0.1em] differs from the standard Eyebrow's tracking-[1.6px]; not a drop-in swap */}
        <p className="text-eyebrow font-semibold uppercase tracking-[0.1em] text-accent-600">{c.eyebrow}</p>
        <h2 className="mt-1.5 font-display text-title font-semibold tracking-tight">{t("connection.title")}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("connection.description")}</p>
      </div>

      <div className="flex flex-col gap-2.5 p-4">
        <SummaryRow
          done
          title={t("connection.tokenLabel")}
          detail={c.keyUpdatedAt
            ? t("connection.tokenSaved", { date: formatDateDMY(new Date(c.keyUpdatedAt)) })
            : t("manageDialog.token.notSet")}
          action={canWrite ? t("manageDialog.token.replace") : undefined}
          onAction={() => onEditStep("connect")}
        />
        <SummaryRow
          done
          title={t("manageDialog.baseTable.label")}
          detail={baseTableLine}
          mono
          action={canWrite ? t("connection.change") : undefined}
          onAction={() => onEditStep("baseTable")}
        />
        <SummaryRow
          stepNumber={mapIncomplete ? 3 : undefined}
          emphasis={mapIncomplete}
          title={t("setupWizard.steps.mapFieldsTitle")}
          detail={t("setupWizard.steps.mapFieldsHint")}
          badge={t("connection.requiredCount", { mapped: c.mapped, total: c.mappedTotal })}
          action={canWrite ? t("connection.mapSessions") : undefined}
          onAction={() => onEditStep("map")}
        />
        <SummaryRow
          stepNumber={catalogIncomplete ? 4 : undefined}
          dashed={catalogIncomplete}
          title={t("setupWizard.steps.linkCatalogTitle")}
          detail={t("connection.catalogHint")}
          action={canWrite ? t("connection.reviewCatalog") : undefined}
          onAction={() => onEditStep("catalog")}
        />
      </div>
    </div>
  );
}

interface SummaryRowProps {
  title: string;
  detail: string;
  mono?: boolean;
  badge?: string;
  action?: string;
  onAction: () => void;
  /** Present (3 or 4) while the group isn't finished yet — renders a step number
   *  instead of a checkmark. Absent (or `done`) renders the completed checkmark. */
  stepNumber?: number;
  done?: boolean;
  emphasis?: boolean;
  dashed?: boolean;
}

/** One collapsed group row: a status dot, a title + one-line detail, an optional
 *  mapped-count badge, and an edit affordance that re-opens the rail on this step. */
function SummaryRow({ title, detail, mono, badge, action, onAction, stepNumber, done, emphasis, dashed }: SummaryRowProps) {
  const finished = done || stepNumber === undefined;
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-[var(--radius-l)] border p-3",
        dashed ? "border-dashed border-border bg-card" : emphasis ? "border-accent-300 bg-accent-tint" : "border-border bg-well-tint",
      )}
    >
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-eyebrow font-semibold",
          finished
            ? "bg-primary text-primary-foreground"
            : emphasis
              ? "border border-accent-300 text-accent-text"
              : "border border-border text-muted-foreground",
        )}
      >
        {finished ? <Check className="h-3 w-3" /> : stepNumber}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-control font-medium", emphasis && "font-semibold")}>{title}</p>
        <p className={cn("mt-0.5 text-xs text-muted-foreground", mono && "font-mono text-eyebrow")}>{detail}</p>
      </div>
      {badge && <span className="shrink-0 font-mono text-xs font-medium text-accent-text">{badge}</span>}
      {action && (
        <Button type="button" variant="secondary" size="sm" className="shrink-0 text-xs font-medium" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}
