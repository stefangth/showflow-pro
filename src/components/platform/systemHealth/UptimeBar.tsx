import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { buildUptimeCells, describeUptimeDay, uptimePercent, type DayState, type HealthDay } from "@/lib/uptime";

const TONE: Record<DayState, string> = {
  operational: "bg-success",
  degraded: "bg-warning",
  down: "bg-destructive",
  // Muted, not green: an unrecorded day is an absence of evidence, not evidence of health.
  nodata: "bg-muted",
};

/**
 * Statuspage-style uptime bar: one cell per day, oldest on the left, with the window's
 * successful-run percentage on the right. Cells flex to fill the row so the bar reads as one
 * continuous object at any panel width.
 *
 * Fed by health_daily (durable) rather than the Analytics API (24h), which is the only reason
 * it can show anything older than yesterday.
 */
export function UptimeBar({ rows, days, now = new Date() }: {
  rows: HealthDay[]; days: number; now?: Date;
}) {
  const cells = buildUptimeCells(rows, days, now);
  const pct = uptimePercent(cells);

  return (
    <div className="space-y-1">
      <TooltipProvider delayDuration={80}>
        {/* aria-hidden: the cells are a visual index. The keyboard-reachable equivalents are the
            uptime figure below and the Recent runs / Failure history lists in the row. */}
        <div className="flex items-stretch gap-[2px]" aria-hidden>
          {cells.map((c) => (
            <Tooltip key={c.day}>
              <TooltipTrigger asChild>
                <span
                  data-uptime-day
                  data-state={c.state}
                  className={cn("h-6 min-w-[3px] flex-1 rounded-s cursor-default", TONE[c.state])}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="px-2 py-1 text-xs">
                {describeUptimeDay(c)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
      <div className="flex items-center justify-between text-eyebrow text-muted-foreground">
        <span>{days} days ago</span>
        <span className="tabular-nums">
          {pct === null ? "no data yet" : `${pct.toFixed(1)}% uptime`}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}
