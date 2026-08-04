import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScheduledJobsPanel } from "./ScheduledJobsPanel";
import type { CronHealthRow } from "@/data/platform";
import type { EdgeFnMetric } from "@/lib/systemHealth";

const cron: CronHealthRow = {
  job_name: "cron-health-watcher", schedule: "*/15 * * * *", status: "healthy",
  last_status_code: 200, last_ok_at: null, last_error: null, consecutive_failures: 0,
  last_run_at: "2026-06-24T09:45:00Z", recentFailures: [],
};
const metric: EdgeFnMetric = {
  fn: "cron-health-watcher", invocations: 10, errors: 0, rejected: 0, byStatus: {}, p50Ms: 4000, p95Ms: 18000,
  lastInvokedAt: "2026-06-24T09:45:00Z", lastStatus: 200, lastFailure: null, recent: [],
};

describe("ScheduledJobsPanel", () => {
  it("shows a slow-but-200 job as Degraded, not Down", () => {
    render(<ScheduledJobsPanel cronRows={[cron]} metrics={[metric]} />);
    expect(screen.getByText("cron-health-watcher")).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("p95 latency 18.0s exceeds the 12.0s budget")).toBeInTheDocument();
    expect(screen.queryByText("Down")).not.toBeInTheDocument();
  });

  it("reveals recorded failure history on demand", () => {
    const withFailureHistory = {
      ...cron,
      recentFailures: [{
        status_code: 504,
        error: "timed out",
        observed_at: "2026-07-23T10:00:00Z",
      }],
    } as unknown as CronHealthRow;

    render(<ScheduledJobsPanel cronRows={[withFailureHistory]} metrics={[metric]} />);
    // The count and the latest failure time are visible while collapsed, so a job that
    // has recovered still shows a trace of the alert that was emailed out.
    const summary = screen.getByText(/Failure history \(1 in 30 days\)/);
    expect(summary).toHaveTextContent(new Date("2026-07-23T10:00:00Z").toLocaleString());
    fireEvent.click(summary);
    expect(screen.getByText(/HTTP 504/)).toBeInTheDocument();
    expect(screen.getByText(/timed out/)).toBeInTheDocument();
  });

  it("draws a 7-day incident timeline even for a job that has since recovered", () => {
    const recovered = {
      ...cron,
      status: "healthy",
      recentFailures: [{
        status_code: 502,
        error: "HTTP 502",
        // This morning: long past the last 20 runs of a */15 job, so the run timeline
        // cannot show it — the whole reason the day cells exist.
        observed_at: new Date(new Date().setHours(2, 39, 5, 0)).toISOString(),
      }],
    } as unknown as CronHealthRow;

    const { container } = render(<ScheduledJobsPanel cronRows={[recovered]} metrics={[metric]} />);
    const cells = container.querySelectorAll("[data-incident-day]");
    expect(cells).toHaveLength(7);
    // Today is the last cell, and it is the only one carrying a failure.
    expect(cells[6].getAttribute("data-failures")).toBe("1");
    expect([...cells].filter((c) => c.getAttribute("data-failures") !== "0")).toHaveLength(1);
  });
});
