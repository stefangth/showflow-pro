import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, StatusDot, LatencyStat, RunTimeline } from "./primitives";
import { deriveEdgeFnStatus, CRON_FNS, type EdgeFnMetric } from "@/lib/systemHealth";
import { SYSTEM_HEALTH_BUDGET as budget } from "@/config/app.config";

/** Status-code histogram as sorted "code × count" chips, faults first. A bare
 *  error count cannot answer "what went wrong"; the exact code can. */
function statusChips(byStatus: Record<string, number>) {
  return Object.entries(byStatus)
    .map(([code, count]) => ({ code: Number(code), count }))
    .filter((c) => c.code >= 400)
    .sort((a, b) => b.count - a.count);
}

export function EdgeFunctionsPanel({ metrics }: { metrics: EdgeFnMetric[] }) {
  // Non-cron functions only — cron-invoked functions live in the Scheduled jobs panel, and
  // double-listing them here would duplicate their status pills (and double-count health).
  const rows = metrics.filter((m) => !CRON_FNS.has(m.fn));
  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-base">Edge functions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map((m) => {
          const state = deriveEdgeFnStatus(m, budget);
          const chips = statusChips(m.byStatus);
          const succeeded = m.invocations - m.errors - m.rejected;
          // A single combined line, not three separate spans: it is both the visible stat
          // readout and the text equivalent for the aria-hidden RunTimeline ticks next to it.
          // Splitting it into per-stat spans as well would duplicate the same numbers into a
          // second DOM node, which is redundant for sighted and screen-reader users alike.
          const summary = m.rejected > 0
            ? `${m.invocations} calls, ${m.rejected} rejected, ${m.errors} errors`
            : `${m.invocations} calls, ${m.errors} errors`;
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
                <span className={m.rejected > 0 || m.errors > 0 ? "text-destructive" : undefined}>· {summary}</span>
              </div>
              {chips.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-5 text-xs">
                  {chips.map((c) => (
                    <span
                      key={c.code}
                      className={c.code >= 500
                        ? "rounded-md bg-destructive/10 px-2 py-0.5 font-mono text-destructive"
                        : "rounded-md bg-warning/10 px-2 py-0.5 font-mono text-warning"}
                    >
                      {c.code} × {c.count}
                    </span>
                  ))}
                  {succeeded === 0 && (
                    <span className="text-muted-foreground">no 2xx in this window</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No edge-function activity in the window.</p>}
      </CardContent>
    </Card>
  );
}
