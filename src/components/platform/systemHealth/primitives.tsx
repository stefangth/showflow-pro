import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HealthState, EdgeFnMetric } from "@/lib/systemHealth";

const LABEL: Record<HealthState, string> = {
  operational: "Operational", degraded: "Degraded", down: "Down", stale: "Stale",
};
const DOT: Record<HealthState, string> = {
  operational: "bg-success", degraded: "bg-warning", down: "bg-destructive", stale: "bg-muted-foreground",
};
const PILL: Record<HealthState, string> = {
  operational: "border-success/30 text-success",
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
  const text = p95Ms === null ? "—" : `${(p95Ms / 1000).toFixed(1)}s`;
  return <span className="tabular-nums text-muted-foreground">{p95Ms === null ? "—" : `p95 ${text}`}</span>;
}

/** Up to 20 recent-outcome ticks (most-recent-first), colored by outcome. */
export function RunTimeline({ metric, p95BudgetMs }: { metric: EdgeFnMetric | null; p95BudgetMs: number }) {
  const ticks = (metric?.recent ?? []).slice(0, 20);
  const tone = (o: { status: number; ms: number }) =>
    o.status >= 500 ? "bg-destructive" : o.status >= 400 || o.ms > p95BudgetMs ? "bg-warning" : "bg-success";
  if (ticks.length === 0) return <span className="text-xs text-muted-foreground">no recent runs</span>;
  return (
    <span className="inline-flex items-center gap-px" aria-hidden>
      {ticks.map((o, i) => <span key={i} className={cn("h-3 w-[3px] rounded-sm", tone(o))} />)}
    </span>
  );
}
