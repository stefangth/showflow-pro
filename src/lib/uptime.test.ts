import { describe, it, expect } from "vitest";
import { buildUptimeCells, uptimePercent, describeUptimeDay, type HealthDay } from "@/lib/uptime";

// Pinned to a UTC instant, not a local one: the cells are keyed by UTC day, so a local
// construction would shift the expected keys on a developer machine outside UTC.
const now = new Date("2026-08-04T12:00:00Z");
const row = (over: Partial<HealthDay> = {}): HealthDay => ({
  day: "2026-08-04", fn: "airtable-poll", runs: 100, failures: 0, rejected: 0,
  worst_status: 200, p95_ms: 900, ...over,
});

describe("buildUptimeCells", () => {
  it("returns one cell per day, oldest first, ending today", () => {
    const cells = buildUptimeCells([], 30, now);
    expect(cells).toHaveLength(30);
    expect(cells[29].day).toBe("2026-08-04");
    expect(cells[0].day).toBe("2026-07-06");
  });

  it("marks days with no recorded rollup as nodata, not as healthy", () => {
    // The bar ships before any history exists; a blank day must never read as green.
    expect(buildUptimeCells([], 30, now).every((c) => c.state === "nodata")).toBe(true);
  });

  it("is operational when a day recorded runs and no faults", () => {
    expect(buildUptimeCells([row()], 30, now)[29].state).toBe("operational");
  });

  it("is down when every run that day failed", () => {
    const cells = buildUptimeCells([row({ runs: 12, failures: 12, worst_status: 502 })], 30, now);
    expect(cells[29].state).toBe("down");
  });

  it("is degraded when some but not all runs failed", () => {
    expect(buildUptimeCells([row({ runs: 100, failures: 3 })], 30, now)[29].state).toBe("degraded");
  });

  it("is degraded when runs were rejected with 4xx above the budget", () => {
    expect(buildUptimeCells([row({ runs: 100, rejected: 40 })], 30, now)[29].state).toBe("degraded");
  });

  it("tolerates an occasional 4xx below the budget", () => {
    expect(buildUptimeCells([row({ runs: 100, rejected: 5 })], 30, now)[29].state).toBe("operational");
  });

  it("treats a day the function was idle as nodata, not as an outage", () => {
    // Zero invocations means nobody called it, which is not the same as it being broken.
    const cells = buildUptimeCells([row({ runs: 0, failures: 0, worst_status: null })], 30, now);
    expect(cells[29].state).toBe("nodata");
  });

  it("ignores rollup rows outside the window", () => {
    const cells = buildUptimeCells([row({ day: "2026-06-01", failures: 5 })], 30, now);
    expect(cells.every((c) => c.state === "nodata")).toBe(true);
  });

  it("crosses a month boundary without skipping or repeating a day", () => {
    const days = buildUptimeCells([], 30, now).map((c) => c.day);
    expect(new Set(days).size).toBe(30);
    expect(days).toContain("2026-07-31");
    expect(days).toContain("2026-08-01");
  });
});

describe("uptimePercent", () => {
  it("is null when no day has any recorded run", () => {
    expect(uptimePercent(buildUptimeCells([], 30, now))).toBeNull();
  });

  it("counts only days with data, so a fresh install is not penalised", () => {
    expect(uptimePercent(buildUptimeCells([row({ runs: 100, failures: 1 })], 30, now))).toBeCloseTo(99, 5);
  });

  it("is 100 when every recorded run succeeded", () => {
    expect(uptimePercent(buildUptimeCells([row()], 30, now))).toBe(100);
  });

  it("does not count 4xx rejections against uptime", () => {
    // A rejected caller is a caller problem, not the function being unavailable.
    const cells = buildUptimeCells([row({ runs: 100, rejected: 50, failures: 0 })], 30, now);
    expect(uptimePercent(cells)).toBe(100);
  });
});

describe("describeUptimeDay", () => {
  it("says so for a day with no data", () => {
    expect(describeUptimeDay({
      day: "2026-08-04", state: "nodata", runs: 0, failures: 0, rejected: 0, worstStatus: null,
    })).toContain("no data recorded");
  });

  it("reports runs and failures with the worst status code", () => {
    const text = describeUptimeDay({
      day: "2026-08-04", state: "degraded", runs: 288, failures: 1, rejected: 0, worstStatus: 502,
    });
    expect(text).toContain("288 runs");
    expect(text).toContain("1 failure");
    expect(text).toContain("HTTP 502");
  });

  it("pluralises failures and mentions rejections", () => {
    const text = describeUptimeDay({
      day: "2026-08-04", state: "degraded", runs: 10, failures: 2, rejected: 3, worstStatus: 500,
    });
    expect(text).toContain("2 failures");
    expect(text).toContain("3 rejected");
  });

  it("says all runs succeeded on a clean day, without a status code", () => {
    const text = describeUptimeDay({
      day: "2026-08-04", state: "operational", runs: 288, failures: 0, rejected: 0, worstStatus: 200,
    });
    expect(text).toContain("288 runs");
    expect(text).toContain("no failures");
    expect(text).not.toContain("HTTP");
  });

  it("labels the day from its own date, not from the viewer's clock", () => {
    // 'YYYY-MM-DD' must be parsed as local midnight; new Date('2026-08-04') is UTC midnight
    // and renders as 3 Aug for any viewer west of Greenwich.
    expect(describeUptimeDay({
      day: "2026-08-04", state: "nodata", runs: 0, failures: 0, rejected: 0, worstStatus: null,
    })).toContain(new Date(2026, 7, 4).toLocaleDateString(undefined, {
      weekday: "short", day: "numeric", month: "short",
    }));
  });
});
