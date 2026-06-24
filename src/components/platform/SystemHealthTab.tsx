import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCronHealth, useEdgeFnMetrics } from "@/hooks/useSystemHealth";
import { OverallStatusBanner } from "./systemHealth/OverallStatusBanner";
import { DomainSummaryGrid } from "./systemHealth/DomainSummaryGrid";
import { ScheduledJobsPanel } from "./systemHealth/ScheduledJobsPanel";
import { EdgeFunctionsPanel } from "./systemHealth/EdgeFunctionsPanel";
import {
  deriveJobStatus, deriveEdgeFnStatus, worstStatus, CRON_JOB_TO_FN, CRON_FNS, type HealthState,
} from "@/lib/systemHealth";
import { SYSTEM_HEALTH_BUDGET as budget } from "@/config/app.config";

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
  const edgeStates: HealthState[] = metrics.filter((m) => !CRON_FNS.has(m.fn)).map((m) => deriveEdgeFnStatus(m, budget));

  const jobsState = worstStatus(jobStates);
  const edgeState = worstStatus(edgeStates);
  const overall = worstStatus([jobsState, edgeState]);

  // "Flagged" counts actionable states only — a never-assessed 'pending' job isn't a problem.
  const flaggedJobs = jobStates.filter((s) => s === "degraded" || s === "down" || s === "stale").length;
  const detail = edge.isError
    ? "Latency metrics unavailable — showing scheduled-job status only"
    : `${cronRows.length} jobs · ${flaggedJobs} need attention`;

  return (
    <div className="space-y-4">
      <OverallStatusBanner state={overall} detail={detail} />
      <DomainSummaryGrid domains={[
        { key: "jobs", label: "Scheduled jobs", state: jobsState, detail: edge.isError ? `${cronRows.length} jobs · latency n/a` : `${cronRows.length} jobs · ${flaggedJobs} flagged` },
        { key: "edge", label: "Edge functions", state: edgeState, detail: edge.isError ? "metrics unavailable" : `${metrics.length} active` },
      ]} />
      <ScheduledJobsPanel cronRows={cronRows} metrics={metrics} />
      <EdgeFunctionsPanel metrics={metrics} />
    </div>
  );
}
