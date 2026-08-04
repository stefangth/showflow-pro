import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCronHealth, useEdgeFnMetrics, useEmailHealth, useHealthDaily } from "@/hooks/useSystemHealth";
import { OverallStatusBanner } from "./systemHealth/OverallStatusBanner";
import { DomainSummaryGrid } from "./systemHealth/DomainSummaryGrid";
import { ScheduledJobsPanel } from "./systemHealth/ScheduledJobsPanel";
import { EdgeFunctionsPanel } from "./systemHealth/EdgeFunctionsPanel";
import { EmailDeliveryPanel } from "./systemHealth/EmailDeliveryPanel";
import {
  deriveJobStatus, deriveEdgeFnStatus, deriveEmailStatus, worstStatus, CRON_JOB_TO_FN, CRON_FNS, type HealthState,
} from "@/lib/systemHealth";
import { SYSTEM_HEALTH_BUDGET as budget, EMAIL_HEALTH } from "@/config/app.config";

export function SystemHealthTab() {
  const cron = useCronHealth();
  const edge = useEdgeFnMetrics();
  const daily = useHealthDaily();
  // Explicit `number` — EMAIL_HEALTH.windowMinutes is a literal (1440) via `as const`, which would
  // otherwise narrow the setter to Dispatch<SetStateAction<1440>> and reject the panel's (m: number) toggle.
  const [emailWindow, setEmailWindow] = useState<number>(EMAIL_HEALTH.windowMinutes);
  const email = useEmailHealth(emailWindow);
  const emailState = email.data ? deriveEmailStatus(email.data, EMAIL_HEALTH) : "pending";

  if (cron.isLoading) return <Skeleton className="h-40 w-full" />;
  if (cron.isError) return <Alert variant="destructive"><AlertDescription>{(cron.error as Error).message}</AlertDescription></Alert>;

  const cronRows = cron.data ?? [];
  const metrics = edge.data ?? [];
  // Empty array is the correct fallback, not a loading gate: the bar then renders all "no data"
  // cells, which is exactly right before the rollup has run, and a rollup outage must not
  // blank the whole tab.
  const healthDaily = daily.data ?? [];
  const byFn = new Map(metrics.map((m) => [m.fn, m]));

  const jobStates: HealthState[] = cronRows.map((c) =>
    deriveJobStatus(c.status, byFn.get(CRON_JOB_TO_FN[c.job_name] ?? c.job_name) ?? null, budget));
  // Cron-invoked functions are rendered in the Scheduled jobs panel, not here — this filtered
  // list is the single source both the card and EdgeFunctionsPanel derive from, so they can't disagree.
  const onDemand = metrics.filter((m) => !CRON_FNS.has(m.fn));
  const edgeStates: HealthState[] = onDemand.map((m) => deriveEdgeFnStatus(m, budget));

  const jobsState = worstStatus(jobStates);
  const edgeState = worstStatus(edgeStates);
  const overall = worstStatus([jobsState, edgeState, emailState]);

  // "Flagged" counts actionable states only — a never-assessed 'pending' job isn't a problem.
  const flaggedJobs = jobStates.filter((s) => s === "degraded" || s === "down" || s === "stale").length;
  const flaggedEdge = edgeStates.filter((s) => s === "degraded" || s === "down" || s === "stale").length;
  const detail = edge.isError
    ? "Latency metrics unavailable — showing scheduled-job status only"
    : `${cronRows.length} jobs · ${flaggedJobs} need attention`;

  return (
    <div className="space-y-4">
      <OverallStatusBanner state={overall} detail={detail} />
      <DomainSummaryGrid domains={[
        { key: "jobs", label: "Scheduled jobs", state: jobsState, detail: edge.isError ? `${cronRows.length} jobs · latency n/a` : `${cronRows.length} jobs · ${flaggedJobs} flagged` },
        { key: "edge", label: "Edge functions", state: edgeState,
          detail: edge.isError ? "metrics unavailable" : `${onDemand.length} on-demand · ${flaggedEdge} flagged` },
        { key: "email", label: "Email delivery",
          state: email.isError ? "pending" : emailState,
          detail: email.isError ? "metrics unavailable"
            : email.data ? `${email.data.sent} sent · ${(email.data.bounceRate * 100).toFixed(1)}% bounce`
            : "loading…" },
      ]} />
      <ScheduledJobsPanel cronRows={cronRows} metrics={metrics} healthDaily={healthDaily} />
      <EdgeFunctionsPanel metrics={metrics} healthDaily={healthDaily} />
      {email.data && (
        <EmailDeliveryPanel health={email.data} state={emailState} window={emailWindow} onWindowChange={setEmailWindow} />
      )}
    </div>
  );
}
