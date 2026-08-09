import { describe, it, expect } from "vitest";

import {
  deriveJobStatus, deriveEdgeFnStatus, describeJobHealth, describeEdgeFnHealth, describeOutcome,
  worstStatus, CRON_JOB_TO_FN,
  type EdgeFnMetric, type HealthBudget,
} from "@/lib/systemHealth";

const BUDGET: HealthBudget = { p95Ms: 12000, errorRate: 0.05, rejectRate: 0.2 };
const metric = (over: Partial<EdgeFnMetric> = {}): EdgeFnMetric => ({
  fn: "f", invocations: 10, errors: 0, rejected: 0, byStatus: {}, p50Ms: 100, p95Ms: 200,
  lastInvokedAt: "2026-06-24T00:00:00Z", lastStatus: 200, lastFailure: null, recent: [], ...over,
});

describe("deriveJobStatus", () => {
  it("maps cron 'stale' to stale regardless of metrics", () => {
    expect(deriveJobStatus("stale", metric(), BUDGET)).toBe("stale");
  });
  it("maps cron 'failing' to down", () => {
    expect(deriveJobStatus("failing", metric(), BUDGET)).toBe("down");
  });
  it("is operational when healthy and within budget", () => {
    expect(deriveJobStatus("healthy", metric({ p95Ms: 8000 }), BUDGET)).toBe("operational");
  });
  it("is degraded when healthy but p95 over budget", () => {
    expect(deriveJobStatus("healthy", metric({ p95Ms: 15000 }), BUDGET)).toBe("degraded");
  });
  it("is degraded when healthy but error rate over budget", () => {
    expect(deriveJobStatus("healthy", metric({ invocations: 10, errors: 2 }), BUDGET)).toBe("degraded");
  });
  it("is operational when healthy with no metrics yet", () => {
    expect(deriveJobStatus("healthy", null, BUDGET)).toBe("operational");
  });
  it("maps cron 'unknown' to pending (neutral, never a false green)", () => {
    expect(deriveJobStatus("unknown", metric({ p95Ms: 8000 }), BUDGET)).toBe("pending");
  });
  it("is degraded when a healthy cron job is being rejected with 4xx", () => {
    expect(deriveJobStatus("healthy", metric({ invocations: 10, rejected: 3 }), BUDGET)).toBe("degraded");
  });
  it("is down when every recent scheduled invocation failed or was rejected", () => {
    expect(deriveJobStatus("healthy", metric({ invocations: 3, errors: 2, rejected: 1 }), BUDGET)).toBe("down");
  });
});

describe("deriveEdgeFnStatus", () => {
  it("is operational with no recent invocations", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 0 }), BUDGET)).toBe("operational");
  });
  it("is down when every recent invocation errored", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 3, errors: 3 }), BUDGET)).toBe("down");
  });
  it("is degraded on elevated error rate with some success", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 10, errors: 2 }), BUDGET)).toBe("degraded");
  });
  it("is degraded on slow p95", () => {
    expect(deriveEdgeFnStatus(metric({ p95Ms: 20000 }), BUDGET)).toBe("degraded");
  });
  it("is down when every call was rejected with 4xx", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 48, rejected: 48, errors: 0 }), BUDGET)).toBe("down");
  });
  it("is degraded when the 4xx rate is over budget but some calls get through", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 10, rejected: 3 }), BUDGET)).toBe("degraded");
  });
  it("tolerates an occasional 4xx below budget", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 100, rejected: 5 }), BUDGET)).toBe("operational");
  });
  it("is down when 4xx and 5xx together account for every call", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 4, rejected: 2, errors: 2 }), BUDGET)).toBe("down");
  });
});

describe("401 (unauthorized) is not a health fault", () => {
  // A 401 is the auth layer correctly rejecting an unauthenticated caller, not the function
  // failing. Unauthorized traffic (e.g. a non-prod stack firing at prod, or an expired-JWT
  // browser poll) must never drag a healthy function to degraded/down. 401 is read from the
  // byStatus histogram; every other 4xx stays a real fault.
  it("keeps a cron job operational when it is flooded with 401s (the prod scenario)", () => {
    // 115 real 200s + 233 foreign 401s: 0.67 raw 4xx rate, but 0 genuine rejections.
    expect(deriveJobStatus("healthy",
      metric({ invocations: 348, rejected: 233, byStatus: { "200": 115, "401": 233 } }), BUDGET))
      .toBe("operational");
  });
  it("keeps an on-demand function operational when every call is an unauthorized 401", () => {
    expect(deriveEdgeFnStatus(
      metric({ invocations: 50, rejected: 50, byStatus: { "401": 50 } }), BUDGET))
      .toBe("operational");
  });
  it("still degrades on genuine (non-401) 4xx above budget, even mixed with 401 noise", () => {
    // 40 ok, 40 unauthorized 401, 20 genuine 403 -> non-401 reject rate 20/60 = 33% > 20%.
    expect(deriveEdgeFnStatus(
      metric({ invocations: 100, rejected: 60, byStatus: { "200": 40, "401": 40, "403": 20 } }), BUDGET))
      .toBe("degraded");
  });
  it("still marks a function down when its real (non-401) calls all fail", () => {
    // 5 genuine 5xx + 5 foreign 401: the 5 real calls all failed -> down.
    expect(deriveEdgeFnStatus(
      metric({ invocations: 10, errors: 5, rejected: 5, byStatus: { "500": 5, "401": 5 } }), BUDGET))
      .toBe("down");
  });
  it("gives no health reason for a 401-flooded but otherwise healthy function", () => {
    expect(describeEdgeFnHealth(
      metric({ invocations: 348, rejected: 233, byStatus: { "200": 115, "401": 233 } }), BUDGET))
      .toBeNull();
  });
  it("reports the non-401 rejection rate in the explanation", () => {
    expect(describeEdgeFnHealth(
      metric({ invocations: 100, rejected: 60, byStatus: { "200": 40, "401": 40, "403": 20 } }), BUDGET))
      .toBe("4xx rejection rate 33.3% exceeds the 20.0% budget");
  });
});

describe("health-status explanations", () => {
  it("explains a scheduled job whose p95 latency exceeds its budget", () => {
    expect(describeJobHealth("healthy", metric({ p95Ms: 15_000 }), BUDGET))
      .toBe("p95 latency 15.0s exceeds the 12.0s budget");
  });

  it("explains a failed scheduled run before evaluating metrics", () => {
    expect(describeJobHealth("failing", metric({ p95Ms: 15_000 }), BUDGET))
      .toBe("The latest scheduled run failed");
  });

  it("explains a sustained 4xx rejection rate", () => {
    expect(describeEdgeFnHealth(metric({ invocations: 10, rejected: 3 }), BUDGET))
      .toBe("4xx rejection rate 30.0% exceeds the 20.0% budget");
  });

  it("explains an all-failed on-demand function as down", () => {
    expect(describeEdgeFnHealth(metric({ invocations: 3, errors: 3 }), BUDGET))
      .toBe("All 3 recent calls failed or were rejected");
  });

  it("returns no explanation for an operational function", () => {
    expect(describeEdgeFnHealth(metric(), BUDGET)).toBeNull();
  });
});

describe("worstStatus", () => {
  it("ranks down worst, then stale, then degraded, then operational", () => {
    expect(worstStatus(["operational", "degraded", "down"])).toBe("down");
    expect(worstStatus(["operational", "stale", "degraded"])).toBe("stale");
    expect(worstStatus([])).toBe("operational");
  });
  it("ranks pending below degraded so a never-assessed job can't mask a real signal", () => {
    expect(worstStatus(["pending", "degraded"])).toBe("degraded");
    expect(worstStatus(["operational", "pending"])).toBe("pending");
  });
});

describe("CRON_JOB_TO_FN", () => {
  it("maps cron job names to their deployed function slugs", () => {
    expect(CRON_JOB_TO_FN["offer-digest"]).toBe("send-offer-digest");
    expect(CRON_JOB_TO_FN["expire-offers-hourly"]).toBe("expire-offers");
  });
  it("maps the health rollup job to its function slug", () => {
    expect(CRON_JOB_TO_FN["health-rollup"]).toBe("health-rollup");
  });
});

describe("describeOutcome", () => {
  it("names the status code and the duration", () => {
    expect(describeOutcome({ status: 502, ms: 4200 })).toContain("HTTP 502");
    expect(describeOutcome({ status: 502, ms: 4200 })).toContain("4.2s");
  });
  it("appends the run time when the outcome carries one", () => {
    const text = describeOutcome({ status: 200, ms: 900, at: "2026-08-04T09:24:06.000Z" });
    expect(text).toContain(new Date("2026-08-04T09:24:06.000Z").toLocaleString());
  });
  it("omits the time segment when the outcome has no timestamp", () => {
    expect(describeOutcome({ status: 200, ms: 900 })).toBe("HTTP 200 · 0.9s");
  });
  it("reads a missing status code as no response rather than HTTP 0", () => {
    expect(describeOutcome({ status: 0, ms: 0 })).toContain("no response");
  });
});
