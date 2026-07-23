import { describe, it, expect } from "vitest";
import {
  deriveJobStatus, deriveEdgeFnStatus, describeJobHealth, describeEdgeFnHealth, worstStatus, CRON_JOB_TO_FN,
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
});
