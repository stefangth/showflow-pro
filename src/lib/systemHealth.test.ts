import { describe, it, expect } from "vitest";

import {
  deriveJobStatus, deriveEdgeFnStatus, describeJobHealth, describeEdgeFnHealth, describeOutcome,
  dailyFailureBuckets, describeFailureDay, worstStatus, CRON_JOB_TO_FN,
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

describe("dailyFailureBuckets", () => {
  const now = new Date(2026, 7, 4, 17, 0, 0); // 4 Aug 2026, local
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

  it("returns one bucket per day, oldest first, ending today", () => {
    const days = dailyFailureBuckets([], 7, now);
    expect(days).toHaveLength(7);
    expect(days[0].date.getDate()).toBe(29); // 29 Jul — crosses the month boundary
    expect(days[6].date.getDate()).toBe(4);
  });

  it("counts every failure recorded on a day and keeps the latest one", () => {
    const days = dailyFailureBuckets([
      { status_code: 502, error: "HTTP 502", observed_at: at(2026, 7, 4, 11) },
      { status_code: 504, error: "timed out", observed_at: at(2026, 7, 4, 15) },
    ], 7, now);
    const today = days[6];
    expect(today.count).toBe(2);
    expect(today.latest?.status_code).toBe(504);
  });

  it("leaves days with no recorded failure empty", () => {
    const days = dailyFailureBuckets(
      [{ status_code: 502, error: "HTTP 502", observed_at: at(2026, 7, 2) }], 7, now);
    expect(days.filter((d) => d.count > 0)).toHaveLength(1);
    expect(days[4].count).toBe(1); // 2 Aug
  });

  it("ignores failures outside the window and unparseable timestamps", () => {
    const days = dailyFailureBuckets([
      { status_code: 500, error: null, observed_at: at(2026, 6, 20) },
      { status_code: 500, error: null, observed_at: "not-a-date" },
    ], 7, now);
    expect(days.every((d) => d.count === 0)).toBe(true);
  });
});

describe("describeFailureDay", () => {
  const day = (over: Partial<ReturnType<typeof dailyFailureBuckets>[number]>) =>
    ({ key: "2026-08-04", date: new Date(2026, 7, 4), count: 0, latest: null, ...over });

  it("says so when nothing failed that day", () => {
    expect(describeFailureDay(day({}))).toContain("no failures recorded");
  });

  it("reports the count and the status code", () => {
    const text = describeFailureDay(day({
      count: 1, latest: { status_code: 502, error: "HTTP 502", observed_at: "2026-08-04T09:24:06Z" },
    }));
    expect(text).toContain("1 failure");
    expect(text).toContain("HTTP 502");
  });

  it("pluralises and appends an error that adds something beyond the code", () => {
    const text = describeFailureDay(day({
      count: 2, latest: { status_code: 504, error: "timed out", observed_at: "2026-08-04T09:24:06Z" },
    }));
    expect(text).toContain("2 failures");
    expect(text).toContain("timed out");
  });

  it("does not repeat the status code when the error is just that code", () => {
    const text = describeFailureDay(day({
      count: 1, latest: { status_code: 502, error: "HTTP 502", observed_at: "2026-08-04T09:24:06Z" },
    }));
    expect(text.match(/HTTP 502/g)).toHaveLength(1);
  });

  it("names a failure with no HTTP response at all", () => {
    const text = describeFailureDay(day({
      count: 1, latest: { status_code: null, error: "timed out", observed_at: "2026-08-04T09:24:06Z" },
    }));
    expect(text).toContain("no HTTP response");
  });
});
