import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScheduledJobsPanel } from "./ScheduledJobsPanel";
import type { CronHealthRow } from "@/data/platform";
import type { EdgeFnMetric } from "@/lib/systemHealth";

const cron: CronHealthRow = {
  job_name: "cron-health-watcher", schedule: "*/15 * * * *", status: "healthy",
  last_status_code: 200, last_ok_at: null, last_error: null, consecutive_failures: 0,
  last_run_at: "2026-06-24T09:45:00Z", recent_failures: [],
};
const metric: EdgeFnMetric = {
  fn: "cron-health-watcher", invocations: 10, errors: 0, p50Ms: 4000, p95Ms: 18000,
  lastInvokedAt: "2026-06-24T09:45:00Z", lastStatus: 200, recent: [],
};

describe("ScheduledJobsPanel", () => {
  it("shows a slow-but-200 job as Degraded, not Down", () => {
    render(<ScheduledJobsPanel cronRows={[cron]} metrics={[metric]} />);
    expect(screen.getByText("cron-health-watcher")).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.queryByText("Down")).not.toBeInTheDocument();
  });
});
