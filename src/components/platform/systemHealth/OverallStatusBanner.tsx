import { Card } from "@/components/ui/card";
import { StatusDot } from "./primitives";
import type { HealthState } from "@/lib/systemHealth";

const SUMMARY: Record<HealthState, string> = {
  operational: "All systems operational",
  degraded: "Some systems degraded",
  down: "A system is down",
  stale: "A scheduled job has stopped firing",
};

export function OverallStatusBanner({ state, detail }: { state: HealthState; detail: string }) {
  return (
    <Card className="flex items-center justify-between gap-4 p-4">
      <div className="flex items-center gap-3 min-w-0">
        <StatusDot state={state} className="h-2.5 w-2.5" />
        <div className="min-w-0">
          <div className="font-display font-medium">{SUMMARY[state]}</div>
          <div className="text-sm text-muted-foreground truncate">{detail}</div>
        </div>
      </div>
    </Card>
  );
}
