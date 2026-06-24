export type HealthState = "operational" | "degraded" | "down" | "stale";
export type CronStatus = "healthy" | "failing" | "stale" | "unknown";

/** A single recent invocation outcome, for the run timeline (most-recent-first). */
export interface EdgeFnOutcome { status: number; ms: number }

/** Per-function metrics from the platform-edge-metrics proxy over the lookback window.
 *  This shape is mirrored by the edge function's JSON output — keep the two in sync. */
export interface EdgeFnMetric {
  fn: string;
  invocations: number;
  errors: number;            // count of 5xx responses
  p50Ms: number | null;
  p95Ms: number | null;
  lastInvokedAt: string | null;
  lastStatus: number | null;
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
};

const errorRate = (m: EdgeFnMetric | null): number =>
  m && m.invocations > 0 ? m.errors / m.invocations : 0;

/** Combine durable cron status with latency/errors to yield the 4-state model. */
export function deriveJobStatus(cron: CronStatus, metric: EdgeFnMetric | null, budget: HealthBudget): HealthState {
  if (cron === "stale") return "stale";
  if (cron === "failing") return "down";
  if (cron === "unknown") return "stale"; // never assessed yet (cron_health_state default) — neutral grey, not a false green
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

const RANK: Record<HealthState, number> = { operational: 0, degraded: 1, stale: 2, down: 3 };
/** The worst (most severe) state in a list; "operational" for an empty list. */
export function worstStatus(states: HealthState[]): HealthState {
  return states.reduce<HealthState>((w, s) => (RANK[s] > RANK[w] ? s : w), "operational");
}
