import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  describeOutcome, dailyFailureBuckets, describeFailureDay,
  type HealthState, type EdgeFnMetric, type EdgeFnOutcome, type FailureRecord,
} from "@/lib/systemHealth";

const LABEL: Record<HealthState, string> = {
  operational: "Operational", pending: "Pending", degraded: "Degraded", down: "Down", stale: "Stale",
};
const DOT: Record<HealthState, string> = {
  operational: "bg-success", pending: "bg-muted-foreground/50", degraded: "bg-warning",
  down: "bg-destructive", stale: "bg-muted-foreground",
};
const PILL: Record<HealthState, string> = {
  operational: "border-success/30 text-success",
  pending: "border-border text-muted-foreground",
  degraded: "border-warning/30 text-warning",
  down: "border-destructive/30 text-destructive",
  stale: "border-border text-muted-foreground",
};

export function StatusDot({ state, className }: { state: HealthState; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", DOT[state], className)} />;
}

export function StatusPill({ state }: { state: HealthState }) {
  return <Badge variant="outline" className={cn("gap-1.5", PILL[state])}><StatusDot state={state} />{LABEL[state]}</Badge>;
}

export function LatencyStat({ p95Ms }: { p95Ms: number | null }) {
  const text = p95Ms === null ? "—" : `p95 ${(p95Ms / 1000).toFixed(1)}s`;
  return <span className="tabular-nums text-muted-foreground">{text}</span>;
}

/** Up to 20 recent-outcome ticks (most-recent-first), colored by outcome. Each tick
 *  reveals that run's status code, duration and time on hover — without it a red tick
 *  says only "something failed" and the panel's aggregate counts can't say which run.
 *  Ticks are wide enough to be a comfortable pointer target rather than hairlines. */
export function RunTimeline({ metric, p95BudgetMs }: { metric: EdgeFnMetric | null; p95BudgetMs: number }) {
  const ticks = (metric?.recent ?? []).slice(0, 20);
  const tone = (o: EdgeFnOutcome) =>
    o.status >= 500 ? "bg-destructive" : o.status >= 400 || o.ms > p95BudgetMs ? "bg-warning" : "bg-success";
  if (ticks.length === 0) return <span className="text-xs text-muted-foreground">no recent runs</span>;
  return (
    // Its own provider: the panel renders inside App's TooltipProvider, but nesting is
    // harmless and keeps the component self-contained for tests and future reuse.
    <TooltipProvider delayDuration={80}>
      {/* aria-hidden as before — the row's text summary is the screen-reader equivalent,
          and 20 individually announced ticks would be noise, not information. */}
      <span className="inline-flex items-center gap-[2px]" aria-hidden>
        {ticks.map((o, i) => (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <span data-run-tick className={cn("h-4 w-[7px] rounded-sm cursor-default", tone(o))} />
            </TooltipTrigger>
            <TooltipContent side="top" className="px-2 py-1 font-mono text-xs">
              {describeOutcome(o)}
            </TooltipContent>
          </Tooltip>
        ))}
      </span>
    </TooltipProvider>
  );
}

/**
 * One cell per day over the last `days` days, oldest on the left, fed by the durable
 * cron_health_log rather than the 24h Analytics window. This is the only view in which a
 * failure that was emailed out hours ago is still visible after the job has recovered.
 */
export function IncidentTimeline({ failures, days, now = new Date() }: {
  failures: FailureRecord[]; days: number; now?: Date;
}) {
  const buckets = dailyFailureBuckets(failures, days, now);
  return (
    <TooltipProvider delayDuration={80}>
      <span className="inline-flex items-center gap-1" aria-hidden>
        <span className="mr-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{days}d</span>
        {buckets.map((d) => (
          <Tooltip key={d.key}>
            <TooltipTrigger asChild>
              <span
                data-incident-day
                data-failures={d.count}
                className={cn("h-4 w-3 rounded-sm cursor-default", d.count > 0 ? "bg-destructive" : "bg-success/40")}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="px-2 py-1 text-xs">{describeFailureDay(d)}</TooltipContent>
          </Tooltip>
        ))}
      </span>
    </TooltipProvider>
  );
}
