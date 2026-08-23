import type React from "react";
import { AlertCircle, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import type { SyncLogSummary } from "@/data/airtableSync";
import { sourceLabel, statusBadge, runClock, type StatusTone } from "./console";
import { AttentionPanel } from "./AttentionPanel";

// eslint-disable-next-line no-restricted-syntax -- non-standard tracking (0.1em), not the Eyebrow primitive's 1.6px
const EYEBROW = "text-eyebrow font-semibold uppercase tracking-[0.1em] text-muted-foreground";

/** A status-log dot color from its badge tone. */
function dotColor(tone: StatusTone): string {
  if (tone === "green") return "var(--green-600)";
  if (tone === "red") return "hsl(var(--destructive))";
  return "var(--amber-600)";
}

interface OverviewTabProps {
  /** Render the failing-token error banner. */
  showError: boolean;
  errorTitle: string;
  errorDetail: string;
  onReplaceToken: () => void;
  /** Healthy empty state (nothing held). */
  allClear: boolean;
  /** Attention-panel props, or null when there are no held causes. */
  attention: React.ComponentProps<typeof AttentionPanel> | null;
  connection: { token: string; base: string; tableView: string; frequency: string };
  onManageConnection: () => void;
  /** Up to 5 most-recent runs. */
  recentRuns: SyncLogSummary[];
  canWrite: boolean;
}

/**
 * The Airtable Sync console Overview tab: error banner, held-record attention
 * (or an all-clear card), and a Connection + Last-5-runs summary grid.
 * Presentational: all data and callbacks arrive via props.
 */
export function OverviewTab({
  showError,
  errorTitle,
  errorDetail,
  onReplaceToken,
  allClear,
  attention,
  connection,
  onManageConnection,
  recentRuns,
  canWrite,
}: OverviewTabProps) {
  const { t } = useTranslation('settingsAirtable');
  const connectionRows: Array<{ label: string; value: string }> = [
    { label: t('overviewTab.rowToken'), value: connection.token },
    { label: t('overviewTab.rowBase'), value: connection.base },
    { label: t('overviewTab.rowTableView'), value: connection.tableView },
    { label: t('overviewTab.rowFrequency'), value: connection.frequency },
  ];

  return (
    <div className="flex flex-col gap-4">
      {showError && (
        <div className="flex items-start gap-2.5 rounded-l border border-destructive bg-destructive/10 p-3 text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{errorTitle}</p>
            <p className="mt-1 text-control leading-5">{errorDetail}</p>
          </div>
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onReplaceToken}
            >
              {t('overviewTab.replaceToken')}
            </Button>
          )}
        </div>
      )}

      {attention ? (
        <AttentionPanel {...attention} />
      ) : allClear ? (
        <div className="flex items-center gap-3 rounded-l border border-border bg-card p-4 shadow-sm">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-l"
            style={{ background: "var(--green-100)" }}
          >
            <Check className="h-4 w-4" style={{ color: "var(--green-600)" }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {t('overviewTab.allClearTitle')}
            </p>
            <p className="mt-0.5 text-control text-muted-foreground">
              {t('overviewTab.allClearDescription')}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-l border border-border bg-card p-4 shadow-sm">
          <p className={`mb-3 ${EYEBROW}`}>{t('overviewTab.connectionLabel')}</p>
          {connectionRows.map((row) => (
            <div
              key={row.label}
              className="flex items-center gap-2.5 border-t border-border py-2"
            >
              <span className="flex-1 text-control text-muted-foreground">{row.label}</span>
              <span className="text-control font-medium text-foreground">{row.value}</span>
            </div>
          ))}
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onManageConnection}
            >
              {t('overviewTab.manageConnection')}
            </Button>
          )}
        </div>

        <div className="rounded-l border border-border bg-card p-4 shadow-sm">
          <p className={`mb-3 ${EYEBROW}`}>{t('overviewTab.last5Runs')}</p>
          {recentRuns.length === 0 ? (
            <p className="text-control text-muted-foreground">{t('overviewTab.noRuns')}</p>
          ) : (
            recentRuns.slice(0, 5).map((run) => {
              const badge = statusBadge(run.status, t);
              return (
                <div
                  key={run.id}
                  className="flex items-center gap-2.5 border-t border-border py-2"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-xs"
                    style={{ background: dotColor(badge.tone) }}
                  />
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {runClock(run.synced_at)}
                  </span>
                  <StatusPill tone="neutral">{sourceLabel(run.sync_type, t)}</StatusPill>
                  <span className="flex-1 text-control text-foreground">
                    {t('overviewTab.runSummary', { importedCount: run.imported_count ?? 0, heldCount: run.held_count ?? 0 })}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
