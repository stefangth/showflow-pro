import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCronHealth, useEdgeFnMetrics } from "@/hooks/useSystemHealth";
import { OverallStatusBanner } from "./systemHealth/OverallStatusBanner";
import { DomainSummaryGrid } from "./systemHealth/DomainSummaryGrid";
import { ScheduledJobsPanel } from "./systemHealth/ScheduledJobsPanel";
import { EdgeFunctionsPanel } from "./systemHealth/EdgeFunctionsPanel";
import {
  deriveJobStatus, deriveEdgeFnStatus, worstStatus, CRON_JOB_TO_FN, type HealthState,
} from "@/lib/systemHealth";
import { SYSTEM_HEALTH } from "@/config/app.config";

const budget = { p95Ms: SYSTEM_HEALTH.p95BudgetMs, errorRate: SYSTEM_HEALTH.errorRateBudget };

export function SystemHealthTab() {
  const cron = useCronHealth();
  const edge = useEdgeFnMetrics();

  if (cron.isLoading) return <Skeleton className="h-40 w-full" />;
  if (cron.isError) return <Alert variant="destructive"><AlertDescription>{(cron.error as Error).message}</AlertDescription></Alert>;

  const cronRows = cron.data ?? [];
  const metrics = edge.data ?? [];
  const byFn = new Map(metrics.map((m) => [m.fn, m]));

  const jobStates: HealthState[] = cronRows.map((c) =>
    deriveJobStatus(c.status, byFn.get(CRON_JOB_TO_FN[c.job_name] ?? c.job_name) ?? null, budget));
  const cronFns = new Set(Object.values(CRON_JOB_TO_FN));
  const edgeStates: HealthState[] = metrics.filter((m) => !cronFns.has(m.fn)).map((m) => deriveEdgeFnStatus(m, budget));

  const jobsState = worstStatus(jobStates);
  const edgeState = worstStatus(edgeStates);
  const overall = worstStatus([jobsState, edgeState]);

  const slowJobs = jobStates.filter((s) => s !== "operational").length;
  const detail = edge.isError
    ? "Latency metrics unavailable — showing scheduled-job status only"
    : `${cronRows.length} jobs · ${slowJobs} need attention`;

  return (
    <div className="space-y-4">
      <OverallStatusBanner state={overall} detail={detail} />
      <DomainSummaryGrid domains={[
        { key: "jobs", label: "Scheduled jobs", state: jobsState, detail: `${cronRows.length} jobs · ${slowJobs} flagged` },
        { key: "edge", label: "Edge functions", state: edgeState, detail: edge.isError ? "metrics unavailable" : `${metrics.length} active` },
      ]} />
      <ScheduledJobsPanel cronRows={cronRows} metrics={metrics} />
      <EdgeFunctionsPanel metrics={metrics} />
    </div>
  );
}
