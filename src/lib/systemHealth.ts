export type HealthState = "operational" | "pending" | "degraded" | "down" | "stale";
export type CronStatus = "healthy" | "failing" | "stale" | "unknown";

/** A single recent invocation outcome, for the run timeline (most-recent-first). */
export interface EdgeFnOutcome { status: number; ms: number }

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

/** Combine durable cron status with latency/errors to yield the status model. */
export function deriveJobStatus(cron: CronStatus, metric: EdgeFnMetric | null, budget: HealthBudget): HealthState {
  if (cron === "stale") return "stale";
  if (cron === "failing") return "down";
  // Never assessed yet (cron_health_state defaults to 'unknown'): neutral "pending" — not a false
  // green, and ranked below 'degraded' so a brand-new job can't mask a real degraded signal in rollups.
  if (cron === "unknown") return "pending";
  if (metric) {
    if (errorRate(metric) > budget.errorRate) return "degraded";
    if (metric.p95Ms !== null && metric.p95Ms > budget.p95Ms) return "degraded";
  }
  return "operational";
}

/** On-demand functions: no schedule/stale concept; derive purely from metrics. */
export function deriveEdgeFnStatus(metric: EdgeFnMetric | null, budget: HealthBudget): HealthState {
  if (!metric || metric.invocations === 0) return "operational";
  const ok2xx = metric.invocations - metric.errors;
  if (metric.errors > 0 && ok2xx === 0) return "down";
  if (errorRate(metric) > budget.errorRate) return "degraded";
  if (metric.p95Ms !== null && metric.p95Ms > budget.p95Ms) return "degraded";
  return "operational";
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
