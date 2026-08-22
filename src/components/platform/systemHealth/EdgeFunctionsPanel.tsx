import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { StatusDot } from "@/components/ui/status-dot";
import { LatencyStat } from "./primitives";
import { UptimeBar } from "./UptimeBar";
import { RecentRunsList } from "./RecentRunsList";
import { describeEdgeFnHealth, deriveEdgeFnStatus, healthRejected, healthTone, healthLabel, CRON_FNS, type EdgeFnMetric } from "@/lib/systemHealth";
import { SYSTEM_HEALTH_BUDGET as budget, SYSTEM_HEALTH } from "@/config/app.config";
import type { HealthDay } from "@/lib/uptime";
import { useEdgeFnLogs } from "@/hooks/useSystemHealth";
import { edgeLogUnavailableMessage } from "./edgeLogCopy";

/** Status-code histogram as sorted "code × count" chips, faults first. A bare
 *  error count cannot answer "what went wrong"; the exact code can. */
function statusChips(byStatus: Record<string, number>) {
  return Object.entries(byStatus)
    .map(([code, count]) => ({ code: Number(code), count }))
    .filter((c) => c.code >= 400)
    .sort((a, b) => b.count - a.count);
}

function EdgeFnRow({ m, rollup }: { m: EdgeFnMetric; rollup: HealthDay[] }) {
  const [open, setOpen] = useState(false);
  const state = deriveEdgeFnStatus(m, budget);
  const chips = statusChips(m.byStatus);
  const succeeded = m.invocations - m.errors - m.rejected;
  // Health-relevant rejections exclude 401 (unauthorized) — see healthRejected. The raw 401
  // count stays visible in the byStatus chips below and in the recent-errors drill-down, but it
  // must not colour this summary red or the row would contradict its own operational status pill.
  const rejected = healthRejected(m);
  const hasFaults = m.errors + rejected > 0;
  const reason = describeEdgeFnHealth(m, budget);
  // A single combined line, not three separate spans: splitting it per stat would duplicate
  // the same numbers into extra DOM nodes, which is redundant for sighted and screen-reader
  // users alike. It covers the last 24h (the Analytics window), whereas the bar above covers
  // 30 days — the two are different clocks and the row reads top-down from long to short.
  const summary = rejected > 0
    ? `${m.invocations} calls, ${rejected} rejected, ${m.errors} errors`
    : `${m.invocations} calls, ${m.errors} errors`;
  // Lazy: only fires when the row is expanded. The ANALYTICS PAT is rate-limited to
  // 60 req/min and the panel already polls every 60s, so a query per row on every
  // refresh would spend that budget on rows nobody is reading.
  const logs = useEdgeFnLogs(m.fn, open);

  return (
    <div className="rounded-l border border-border p-3">
      <div className="flex items-center gap-3">
        <StatusDot tone={healthTone(state)} />
        <span className="font-mono text-sm font-medium flex-1 truncate">{m.fn}</span>
        <StatusPill tone={healthTone(state)} dot>{healthLabel(state)}</StatusPill>
      </div>
      <div className="mt-3">
        <UptimeBar rows={rollup} days={SYSTEM_HEALTH.uptimeDays} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <LatencyStat p95Ms={m.p95Ms} />
        <span className={rejected > 0 || m.errors > 0 ? "text-destructive" : undefined}>· {summary}</span>
      </div>
      {reason && <p className="mt-2 text-xs text-muted-foreground">{reason}</p>}
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {chips.map((c) => (
            <span
              key={c.code}
              className={c.code >= 500
                ? "rounded-m bg-destructive/10 px-2 py-0.5 font-mono text-destructive"
                : "rounded-m bg-warning/10 px-2 py-0.5 font-mono text-warning"}
            >
              {c.code} × {c.count}
            </span>
          ))}
          {hasFaults && succeeded === 0 && (
            <span className="text-muted-foreground">no 2xx in this window</span>
          )}
        </div>
      )}
      <RecentRunsList recent={m.recent} />
      {hasFaults && (
        <div className="mt-2">
          {m.lastFailure && (
            <p className="text-xs text-muted-foreground">
              {/* A full local timestamp, not lib/dates' date-only helpers: "which day did
                  this fail" is useless for a fault you are triaging right now. */}
              Last failure {new Date(m.lastFailure.at).toLocaleString()}, status {m.lastFailure.status}
            </p>
          )}
          <button type="button" className="mt-1 text-control font-medium text-accent-text hover:underline" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide recent errors" : "View recent errors"}
          </button>
          {open && (
            <div className="mt-2 rounded-m bg-muted/40 p-2">
              {logs.isLoading && <p className="text-xs text-muted-foreground">Loading log lines.</p>}
              {logs.isError && <p className="text-xs text-muted-foreground">{edgeLogUnavailableMessage(logs.error)}</p>}
              {logs.data?.length === 0 && <p className="text-xs text-muted-foreground">No error output in this window.</p>}
              {logs.data?.map((l, i) => (
                <p key={i} className="font-mono text-eyebrow leading-relaxed text-muted-foreground">
                  {l.at.slice(11, 19)} {l.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EdgeFunctionsPanel({ metrics, healthDaily }: {
  metrics: EdgeFnMetric[]; healthDaily: HealthDay[];
}) {
  // Non-cron functions only — cron-invoked functions live in the Scheduled jobs panel, and
  // double-listing them here would duplicate their status pills (and double-count health).
  const rows = metrics.filter((m) => !CRON_FNS.has(m.fn));
  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-base">Edge functions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map((m) => <EdgeFnRow key={m.fn} m={m} rollup={healthDaily.filter((r) => r.fn === m.fn)} />)}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No edge-function activity in the window.</p>}
      </CardContent>
    </Card>
  );
}
