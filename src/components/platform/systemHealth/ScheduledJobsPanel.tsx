import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { StatusDot } from "@/components/ui/status-dot";
import { LatencyStat } from "./primitives";
import { UptimeBar } from "./UptimeBar";
import { RecentRunsList } from "./RecentRunsList";
import { describeJobHealth, deriveJobStatus, healthTone, healthLabel, CRON_JOB_TO_FN, type EdgeFnMetric } from "@/lib/systemHealth";
import type { HealthDay } from "@/lib/uptime";
import { SYSTEM_HEALTH_BUDGET as budget, SYSTEM_HEALTH } from "@/config/app.config";
import type { CronHealthRow } from "@/data/platform";

export function ScheduledJobsPanel({ cronRows, metrics, healthDaily }: {
  cronRows: CronHealthRow[]; metrics: EdgeFnMetric[]; healthDaily: HealthDay[];
}) {
  const byFn = new Map(metrics.map((m) => [m.fn, m]));
  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-base">Scheduled jobs</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {cronRows.map((c) => {
          // Jobs are keyed by cron name, metrics and rollups by deployed slug — they differ for
          // the digests and watchers, so both lookups go through CRON_JOB_TO_FN.
          const slug = CRON_JOB_TO_FN[c.job_name] ?? c.job_name;
          const metric = byFn.get(slug) ?? null;
          const state = deriveJobStatus(c.status, metric, budget);
          const reason = describeJobHealth(c.status, metric, budget);
          const rollup = healthDaily.filter((r) => r.fn === slug);
          return (
            <div key={c.job_name} className="rounded-l border border-border p-3">
              <div className="flex items-center gap-3">
                <StatusDot tone={healthTone(state)} />
                <span className="font-mono text-sm font-medium flex-1 truncate">{c.job_name}</span>
                <StatusPill tone={healthTone(state)} dot>{healthLabel(state)}</StatusPill>
              </div>
              <div className="mt-3">
                <UptimeBar rows={rollup} days={SYSTEM_HEALTH.uptimeDays} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <LatencyStat p95Ms={metric?.p95Ms ?? null} />
                <span>· {c.schedule ?? "—"}</span>
                {c.last_run_at && <span>· last run {new Date(c.last_run_at).toLocaleString()}</span>}
                {c.last_error && <span>· {c.last_error}</span>}
              </div>
              {reason && <p className="mt-2 text-xs text-muted-foreground">{reason}</p>}
              <RecentRunsList recent={metric?.recent ?? []} />
              {c.recentFailures.length > 0 && (
                <details className="mt-2 text-xs text-muted-foreground">
                  {/* The count and latest time live in the closed summary on purpose: a job
                      that failed hours ago is healthy again now, so its row is green and the
                      only trace of the alert that was emailed out would otherwise be hidden
                      behind a disclosure nobody has a reason to open. */}
                  <summary className="cursor-pointer font-medium text-foreground">
                    Failure history ({c.recentFailures.length} in {SYSTEM_HEALTH.logRetentionDays} days) · last {new Date(c.recentFailures[0].observed_at).toLocaleString()}
                  </summary>
                  <div className="mt-2 space-y-1 rounded-m bg-well-tint p-2">
                    {c.recentFailures.map((failure) => (
                      <p key={`${failure.observed_at}-${failure.status_code ?? "none"}`}>
                        {new Date(failure.observed_at).toLocaleString()} · {failure.status_code === null ? "no HTTP response" : `HTTP ${failure.status_code}`} · {failure.error ?? "No error detail recorded"}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })}
        {cronRows.length === 0 && <p className="text-sm text-muted-foreground">No scheduled-job health recorded yet.</p>}
      </CardContent>
    </Card>
  );
}
