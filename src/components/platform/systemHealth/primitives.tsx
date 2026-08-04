import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HealthState } from "@/lib/systemHealth";

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
