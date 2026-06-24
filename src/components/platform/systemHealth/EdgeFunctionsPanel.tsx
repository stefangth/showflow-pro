import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, StatusDot, LatencyStat, RunTimeline } from "./primitives";
import { deriveEdgeFnStatus, CRON_JOB_TO_FN, type EdgeFnMetric } from "@/lib/systemHealth";
import { SYSTEM_HEALTH } from "@/config/app.config";

const budget = { p95Ms: SYSTEM_HEALTH.p95BudgetMs, errorRate: SYSTEM_HEALTH.errorRateBudget };
const CRON_FNS = new Set(Object.values(CRON_JOB_TO_FN));

export function EdgeFunctionsPanel({ metrics }: { metrics: EdgeFnMetric[] }) {
  const nonCron = metrics.filter((m) => !CRON_FNS.has(m.fn));
  const rows = nonCron.length > 0 ? nonCron : metrics;
  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-base">Edge functions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map((m) => {
          const state = deriveEdgeFnStatus(m, budget);
          return (
            <div key={m.fn} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                <StatusDot state={state} />
                <span className="font-mono text-sm font-medium flex-1 truncate">{m.fn}</span>
                <StatusPill state={state} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-5 text-xs text-muted-foreground">
                <RunTimeline metric={m} p95BudgetMs={budget.p95Ms} />
                <LatencyStat p95Ms={m.p95Ms} />
                <span>· {m.invocations} calls</span>
                <span>· {m.errors} errors</span>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No edge-function activity in the window.</p>}
      </CardContent>
    </Card>
  );
}
