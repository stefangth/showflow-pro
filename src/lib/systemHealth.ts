import type { Tone } from "@/components/ui/tones";

export type HealthState = "operational" | "pending" | "degraded" | "down" | "stale";
export type CronStatus = "healthy" | "failing" | "stale" | "unknown";

/** Maps a system-health state to the canonical status tone (ADR 0012 TONES).
 *  Amber (`waiting`) means a human is being watched for, red (`risk`) means an
 *  active fault; `pending`/`stale` carry no signal yet, so they read neutral. */
const HEALTH_TONE: Record<HealthState, Tone> = {
  operational: "confirmed",
  pending: "neutral",
  degraded: "waiting",
  down: "risk",
  stale: "neutral",
};

const HEALTH_LABEL: Record<HealthState, string> = {
  operational: "Operational",
  pending: "Pending",
  degraded: "Degraded",
  down: "Down",
  stale: "Stale",
};

export function healthTone(state: HealthState): Tone {
  return HEALTH_TONE[state];
}

export function healthLabel(state: HealthState): string {
  return HEALTH_LABEL[state];
}

/** A single recent invocation outcome, for the run timeline (most-recent-first).
 *  `at` is optional: it was added after the first shipped shape, so a metric cached
 *  from an older proxy response still renders (just without a time in its tooltip). */
export interface EdgeFnOutcome { status: number; ms: number; at?: string }

/** `describeOutcome` split into its two typographic halves: `status` is the
 *  machine token (an HTTP status, or "no response") a reader might quote back
 *  when filing a fault; `rest` is the duration and, when present, the local
 *  timestamp — quantities, not tokens. Callers that render the two halves
 *  differently (RecentRunsList: `status` in `<Token>`, `rest` in sans) use
 *  this; `describeOutcome` stays the single-string form for anything that
 *  just wants one line of text (e.g. a title attribute). */
export function describeOutcomeParts(o: EdgeFnOutcome): { status: string; rest: string } {
  const status = o.status > 0 ? `HTTP ${o.status}` : "no response";
  const rest = [seconds(o.ms)];
  // A full local timestamp, not lib/dates' date-only helpers: "which day" is useless
  // when you are placing a fault inside the last 24 hours. The Analytics API's row
  // shape is only partly verified, so an unparseable value drops the segment rather
  // than rendering "Invalid Date" into the tooltip.
  const at = o.at ? new Date(o.at) : null;
  if (at && !Number.isNaN(at.getTime())) rest.push(at.toLocaleString());
  return { status, rest: rest.join(" · ") };
}

/** One-line detail for a single run tick — the timeline's hover tooltip.
 *  Status code first: it is the whole reason someone is pointing at a red tick. */
export function describeOutcome(o: EdgeFnOutcome): string {
  const { status, rest } = describeOutcomeParts(o);
  return [status, rest].join(" · ");
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
  "health-rollup": "health-rollup",
};

/** Deployed slugs of the cron-invoked functions — used to keep them out of the on-demand
 *  Edge functions panel (they belong to the Scheduled jobs panel). Single source of truth. */
export const CRON_FNS = new Set(Object.values(CRON_JOB_TO_FN));

/** 401 = unauthorized. The auth layer correctly rejecting an unauthenticated caller is not the
 *  function failing, so 401 is excluded from every health decision (error/reject rate and the
 *  all-failed -> down check). It stays visible in the byStatus histogram and the run timeline.
 *  Every other 4xx (400/403/404/409/422 ...) is a real fault. Read from byStatus because
 *  `rejected` lumps all 4xx together. */
const unauthorizedCount = (m: EdgeFnMetric | null): number =>
  m ? (m.byStatus?.["401"] ?? 0) : 0;

/** 4xx rejections that count against health: all 4xx minus 401. Never negative. */
export const healthRejected = (m: EdgeFnMetric | null): number =>
  m ? Math.max(0, m.rejected - unauthorizedCount(m)) : 0;

/** Invocations that count toward health: the total minus unauthorized (401) traffic. Both the
 *  error rate and the reject rate divide by this — 401 is excluded from the numerator AND the
 *  denominator — so a rate reads as "the fraction of authenticated traffic that failed."
 *  This is a deliberate refinement of the design doc's numerator-only formula (§B.2): leaving
 *  401s in the denominator would let a flood of unauthorized probes dilute, and so hide, a real
 *  403/5xx spike. The trade-off is stricter alerting for functions with a heavy 401 mix. */
const realCalls = (m: EdgeFnMetric | null): number =>
  m ? Math.max(0, m.invocations - unauthorizedCount(m)) : 0;

const errorRate = (m: EdgeFnMetric | null): number =>
  m && realCalls(m) > 0 ? m.errors / realCalls(m) : 0;

const rejectRate = (m: EdgeFnMetric | null): number =>
  m && realCalls(m) > 0 ? healthRejected(m) / realCalls(m) : 0;

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const seconds = (milliseconds: number) => `${(milliseconds / 1000).toFixed(1)}s`;

function metricHealthReason(metric: EdgeFnMetric | null, budget: HealthBudget): string | null {
  if (!metric || metric.invocations === 0) return null;
  if (realCalls(metric) > 0 && metric.errors + healthRejected(metric) === realCalls(metric)) {
    return `All ${realCalls(metric)} recent calls failed or were rejected`;
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
    if (realCalls(metric) > 0 && metric.errors + healthRejected(metric) === realCalls(metric)) return "down";
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
 *  Non-401 4xx counts as a fault alongside 5xx — a function that rejects every legitimate
 *  caller is as unavailable as one that crashes, and the run timeline has always drawn it
 *  that way. Keeping the two rates separate lets an occasional validation 400 pass while a
 *  sustained rejection rate does not. 401 (unauthorized) is excluded — see healthRejected.
 *  Accepted trade-off of that exclusion: if every legitimate caller of a user-facing function
 *  started getting 401 (a total auth outage), realCalls falls to 0 and this reads operational —
 *  there is no non-401 signal left to flag. Cron/service-role callers still have the
 *  cron-health-watcher and 403 backstops; a purely JWT-authed on-demand function does not. */
export function deriveEdgeFnStatus(metric: EdgeFnMetric | null, budget: HealthBudget): HealthState {
  if (!metric || metric.invocations === 0) return "operational";
  // Every real (non-401) call in the window was an error or a rejection.
  if (realCalls(metric) > 0 && metric.errors + healthRejected(metric) === realCalls(metric)) return "down";
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
