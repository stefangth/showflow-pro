import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, StatusDot, LatencyStat, RunTimeline } from "./primitives";
import { deriveJobStatus, CRON_JOB_TO_FN, type EdgeFnMetric } from "@/lib/systemHealth";
import { SYSTEM_HEALTH } from "@/config/app.config";
import type { CronHealthRow } from "@/data/platform";

const budget = { p95Ms: SYSTEM_HEALTH.p95BudgetMs, errorRate: SYSTEM_HEALTH.errorRateBudget };

export function ScheduledJobsPanel({ cronRows, metrics }: { cronRows: CronHealthRow[]; metrics: EdgeFnMetric[] }) {
  const byFn = new Map(metrics.map((m) => [m.fn, m]));
  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-base">Scheduled jobs</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {cronRows.map((c) => {
          const metric = byFn.get(CRON_JOB_TO_FN[c.job_name] ?? c.job_name) ?? null;
          const state = deriveJobStatus(c.status, metric, budget);
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
            </div>
          );
        })}
        {cronRows.length === 0 && <p className="text-sm text-muted-foreground">No scheduled-job health recorded yet.</p>}
      </CardContent>
    </Card>
  );
}
