import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, StatusDot, LatencyStat, RunTimeline, IncidentTimeline } from "./primitives";
import { describeJobHealth, deriveJobStatus, CRON_JOB_TO_FN, type EdgeFnMetric } from "@/lib/systemHealth";
import { SYSTEM_HEALTH_BUDGET as budget, SYSTEM_HEALTH } from "@/config/app.config";
import type { CronHealthRow } from "@/data/platform";

export function ScheduledJobsPanel({ cronRows, metrics }: { cronRows: CronHealthRow[]; metrics: EdgeFnMetric[] }) {
  const byFn = new Map(metrics.map((m) => [m.fn, m]));
  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-base">Scheduled jobs</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {cronRows.map((c) => {
          const metric = byFn.get(CRON_JOB_TO_FN[c.job_name] ?? c.job_name) ?? null;
          const state = deriveJobStatus(c.status, metric, budget);
          const reason = describeJobHealth(c.status, metric, budget);
          return (
            <div key={c.job_name} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                <StatusDot state={state} />
                <span className="font-mono text-sm font-medium flex-1 truncate">{c.job_name}</span>
                <StatusPill state={state} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-5 text-xs text-muted-foreground">
                <RunTimeline metric={metric} p95BudgetMs={budget.p95Ms} />
                <LatencyStat p95Ms={metric?.p95Ms ?? null} />
                <span>· {c.schedule ?? "—"}</span>
                {c.last_run_at && <span>· last run {new Date(c.last_run_at).toLocaleString()}</span>}
                {c.last_error && <span>· {c.last_error}</span>}
              </div>
              {/* Two different clocks, deliberately stacked: RunTimeline above covers the last 20
                  runs (under two hours for a five-minute job, and nothing at all beyond the 24h
                  Analytics window), while this one covers the last 7 days from the durable
                  cron_health_log. Neither one alone answers "what failed and when". */}
              <div className="mt-2 pl-5">
                <IncidentTimeline failures={c.recentFailures.map((f) => ({
                  status_code: f.status_code, error: f.error, observed_at: f.observed_at,
                }))} days={SYSTEM_HEALTH.historyDays} />
              </div>
              {reason && <p className="mt-2 pl-5 text-xs text-muted-foreground">{reason}</p>}
              {c.recentFailures.length > 0 && (
                <details className="mt-2 pl-5 text-xs text-muted-foreground">
                  {/* The count and latest time live in the closed summary on purpose: a job
                      that failed hours ago is healthy again now, so its row is green and the
                      only trace of the alert that was emailed out would otherwise be hidden
                      behind a disclosure nobody has a reason to open. */}
                  <summary className="cursor-pointer font-medium text-foreground">
                    Failure history ({c.recentFailures.length} in {SYSTEM_HEALTH.logRetentionDays} days) · last {new Date(c.recentFailures[0].observed_at).toLocaleString()}
                  </summary>
                  <div className="mt-2 space-y-1 rounded-md bg-muted/40 p-2">
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
