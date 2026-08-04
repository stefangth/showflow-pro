export type HealthState = "operational" | "pending" | "degraded" | "down" | "stale";
export type CronStatus = "healthy" | "failing" | "stale" | "unknown";

/** A single recent invocation outcome, for the run timeline (most-recent-first).
 *  `at` is optional: it was added after the first shipped shape, so a metric cached
 *  from an older proxy response still renders (just without a time in its tooltip). */
export interface EdgeFnOutcome { status: number; ms: number; at?: string }

/** One-line detail for a single run tick — the timeline's hover tooltip.
 *  Status code first: it is the whole reason someone is pointing at a red tick. */
export function describeOutcome(o: EdgeFnOutcome): string {
  const parts = [o.status > 0 ? `HTTP ${o.status}` : "no response", seconds(o.ms)];
  // A full local timestamp, not lib/dates' date-only helpers: "which day" is useless
  // when you are placing a fault inside the last 24 hours. The Analytics API's row
  // shape is only partly verified, so an unparseable value drops the segment rather
  // than rendering "Invalid Date" into the tooltip.
  const at = o.at ? new Date(o.at) : null;
  if (at && !Number.isNaN(at.getTime())) parts.push(at.toLocaleString());
  return parts.join(" · ");
}

/** Per-function metrics from the platform-edge-metrics proxy over the lookback window.
 *  This shape is mirrored by the edge function's JSON output — keep the two in sync. */
export interface EdgeFnMetric {
  fn: string;
  invocations: number;
  errors: number;            // count of 5xx responses
  rejected: number;          // count of 4xx responses
  /** Exact status-code histogram, e.g. { "200": 3, "401": 48 }. Drives the panel's
   *  "what went wrong" chips, which a bare error count cannot answer. */
  byStatus: Record<string, number>;
  p50Ms: number | null;
  p95Ms: number | null;
  lastInvokedAt: string | null;
  lastStatus: number | null;
  /** Most recent non-2xx outcome in the window, or null if every call succeeded. */
  lastFailure: { status: number; at: string } | null;
  recent: EdgeFnOutcome[];
}

/** One recorded cron failure incident (a cron_health_log row, as mapped by fetchCronHealth).
 *  Structural on purpose so this module doesn't depend on the data layer. */
export interface FailureRecord { status_code: number | null; error: string | null; observed_at: string }

/** One day of the scheduled-job incident timeline. */
export interface FailureDay { key: string; date: Date; count: number; latest: FailureRecord | null }

/** Local calendar day, not UTC: every timestamp the panel prints is local, so a failure at
 *  01:00 Berlin must land on the cell the operator would call "today". */
const localDayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Bucket recorded failure incidents into one cell per day, oldest first, ending on `now`'s day.
 * Days with nothing recorded come back with count 0 — that means "no failure was logged", which
 * is not quite the same as "the job ran fine", and the tooltip copy says exactly that.
 */
export function dailyFailureBuckets(failures: FailureRecord[], days: number, now: Date): FailureDay[] {
  const byDay = new Map<string, FailureRecord[]>();
  for (const f of failures) {
    const at = new Date(f.observed_at);
    if (Number.isNaN(at.getTime())) continue;
    const key = localDayKey(at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(f); else byDay.set(key, [f]);
  }
  const out: FailureDay[] = [];
  for (let back = days - 1; back >= 0; back--) {
    // Date arithmetic via the constructor's day overflow — correct across month and DST boundaries.
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const key = localDayKey(date);
    const hits = [...(byDay.get(key) ?? [])].sort((a, b) => b.observed_at.localeCompare(a.observed_at));
    out.push({ key, date, count: hits.length, latest: hits[0] ?? null });
  }
  return out;
}

/** Tooltip line for one day of the incident timeline. */
export function describeFailureDay(day: FailureDay): string {
  const label = day.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  if (day.count === 0 || !day.latest) return `${label} · no failures recorded`;
  const code = day.latest.status_code === null ? "no HTTP response" : `HTTP ${day.latest.status_code}`;
  const parts = [label, `${day.count} ${day.count === 1 ? "failure" : "failures"}`, code];
  // The watcher stores `HTTP 502` as the error text for a bare status failure — repeating it
  // would make every tooltip read "HTTP 502 · HTTP 502".
  if (day.latest.error && day.latest.error !== code) parts.push(day.latest.error);
  return parts.join(" · ");
}

export interface HealthBudget {
  p95Ms: number;             // above this (while otherwise healthy) -> degraded
  errorRate: number;         // 0..1; above this -> degraded
  rejectRate: number;        // 0..1; 4xx fraction above this -> degraded
}

/** Cron job_name -> deployed edge-function slug (digests/watchers use different names). */
export const CRON_JOB_TO_FN: Record<string, string> = {
  "offer-digest": "send-offer-digest",
  "confirmation-digest": "send-confirmation-digest",
  "expire-offers-hourly": "expire-offers",
  "tier-at-risk-hourly": "tier-at-risk-watcher",
  "airtable-poll": "airtable-poll",
  "cron-health-watcher": "cron-health-watcher",
  "email-health-watcher": "email-health-watcher",
};

/** Deployed slugs of the cron-invoked functions — used to keep them out of the on-demand
 *  Edge functions panel (they belong to the Scheduled jobs panel). Single source of truth. */
export const CRON_FNS = new Set(Object.values(CRON_JOB_TO_FN));

const errorRate = (m: EdgeFnMetric | null): number =>
  m && m.invocations > 0 ? m.errors / m.invocations : 0;

const rejectRate = (m: EdgeFnMetric | null): number =>
  m && m.invocations > 0 ? m.rejected / m.invocations : 0;

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const seconds = (milliseconds: number) => `${(milliseconds / 1000).toFixed(1)}s`;

function metricHealthReason(metric: EdgeFnMetric | null, budget: HealthBudget): string | null {
  if (!metric || metric.invocations === 0) return null;
  if (metric.errors + metric.rejected === metric.invocations) {
    return `All ${metric.invocations} recent calls failed or were rejected`;
  }
  if (errorRate(metric) > budget.errorRate) {
    return `5xx error rate ${percent(errorRate(metric))} exceeds the ${percent(budget.errorRate)} budget`;
  }
  if (rejectRate(metric) > budget.rejectRate) {
    return `4xx rejection rate ${percent(rejectRate(metric))} exceeds the ${percent(budget.rejectRate)} budget`;
  }
  if (metric.p95Ms !== null && metric.p95Ms > budget.p95Ms) {
    return `p95 latency ${seconds(metric.p95Ms)} exceeds the ${seconds(budget.p95Ms)} budget`;
  }
  return null;
}

/** Combine durable cron status with latency/errors to yield the status model. */
export function deriveJobStatus(cron: CronStatus, metric: EdgeFnMetric | null, budget: HealthBudget): HealthState {
  if (cron === "stale") return "stale";
  if (cron === "failing") return "down";
  // Never assessed yet (cron_health_state defaults to 'unknown'): neutral "pending" — not a false
  // green, and ranked below 'degraded' so a brand-new job can't mask a real degraded signal in rollups.
  if (cron === "unknown") return "pending";
  if (metric) {
    if (metric.invocations > 0 && metric.errors + metric.rejected === metric.invocations) return "down";
    if (errorRate(metric) > budget.errorRate) return "degraded";
    if (rejectRate(metric) > budget.rejectRate) return "degraded";
    if (metric.p95Ms !== null && metric.p95Ms > budget.p95Ms) return "degraded";
  }
  return "operational";
}

/** Concise, user-facing reason for a scheduled job's non-operational state. */
export function describeJobHealth(cron: CronStatus, metric: EdgeFnMetric | null, budget: HealthBudget): string | null {
  if (cron === "stale") return "No recent scheduled dispatch or response was recorded";
  if (cron === "failing") return "The latest scheduled run failed";
  if (cron === "unknown") return "This job has not been assessed yet";
  return metricHealthReason(metric, budget);
}

/** On-demand functions: no schedule/stale concept; derive purely from metrics.
 *  4xx counts as a fault alongside 5xx — a function that rejects every caller is
 *  as unavailable as one that crashes, and the run timeline has always drawn it
 *  that way. Keeping the two rates separate lets an occasional validation 400 pass
 *  while a sustained rejection rate does not. */
export function deriveEdgeFnStatus(metric: EdgeFnMetric | null, budget: HealthBudget): HealthState {
  if (!metric || metric.invocations === 0) return "operational";
  // Nothing got through in the window, whatever the reason.
  if (metric.errors + metric.rejected === metric.invocations) return "down";
  if (errorRate(metric) > budget.errorRate) return "degraded";
  if (rejectRate(metric) > budget.rejectRate) return "degraded";
  if (metric.p95Ms !== null && metric.p95Ms > budget.p95Ms) return "degraded";
  return "operational";
}

/** Concise, user-facing reason for an on-demand function's non-operational state. */
export function describeEdgeFnHealth(metric: EdgeFnMetric | null, budget: HealthBudget): string | null {
  return metricHealthReason(metric, budget);
}

// Severity for rollups. 'pending' (never assessed) sits just above operational so it never
// outranks an actionable degraded / stale / down signal in the overall banner.
const RANK: Record<HealthState, number> = { operational: 0, pending: 1, degraded: 2, stale: 3, down: 4 };
/** The worst (most severe) state in a list; "operational" for an empty list. */
export function worstStatus(states: HealthState[]): HealthState {
  return states.reduce<HealthState>((w, s) => (RANK[s] > RANK[w] ? s : w), "operational");
}

/** Per-template delivery breakdown row (from get_email_health). */
export interface EmailTemplateStat {
  templateName: string; sent: number; delivered: number; bounced: number; failed: number; deliveryRate: number;
}
/** One actionable recent issue (failed/bounced/complained/suppressed). */
export interface EmailIssue {
  recipientEmail: string; templateName: string; status: string; errorMessage: string | null; occurredAt: string;
}
/** Aggregated email-delivery health over a window. Mirrors get_email_health's mapped shape. */
export interface EmailHealth {
  attempted: number; sent: number; delivered: number; delayed: number; bounced: number;
  complained: number; failed: number; suppressed: number;
  deliveryRate: number; bounceRate: number; complaintRate: number; failureCount: number;
  lastEventAt: string | null; byTemplate: EmailTemplateStat[]; recentIssues: EmailIssue[];
}
export interface EmailHealthThresholds {
  bounceWarn: number; bounceDown: number; complaintWarn: number; complaintDown: number; deliveryWarn: number;
}

/**
 * Pure 4-state derivation for email delivery. `sent` = reached Resend; rates use it as denominator.
 * `suppressed` (pre-send skip) is healthy, never a fault.
 * MIRROR: keep in sync with supabase/functions/_shared/emailHealth.ts (Deno watcher copy).
 */
export function deriveEmailStatus(h: EmailHealth, t: EmailHealthThresholds): HealthState {
  if (h.attempted === 0) return "operational";                 // idle
  if (h.sent === 0) return h.failed > 0 ? "down" : "operational"; // all-fail vs all-suppressed
  if (h.delivered + h.delayed + h.bounced + h.complained === 0) return "stale"; // no delivery webhooks
  if (h.bounceRate > t.bounceDown || h.complaintRate > t.complaintDown) return "down";
  if (h.bounceRate > t.bounceWarn || h.complaintRate > t.complaintWarn ||
      h.failureCount > 0 || h.deliveryRate < t.deliveryWarn) return "degraded";
  return "operational";
}
