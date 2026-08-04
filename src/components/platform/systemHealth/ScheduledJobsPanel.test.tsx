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
    render(<ScheduledJobsPanel cronRows={[cron]} metrics={[metric]} healthDaily={[]} />);
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

    render(<ScheduledJobsPanel cronRows={[withFailureHistory]} metrics={[metric]} healthDaily={[]} />);
    // The count and the latest failure time are visible while collapsed, so a job that
    // has recovered still shows a trace of the alert that was emailed out.
    const summary = screen.getByText(/Failure history \(1 in 30 days\)/);
    expect(summary).toHaveTextContent(new Date("2026-07-23T10:00:00Z").toLocaleString());
    fireEvent.click(summary);
    expect(screen.getByText(/HTTP 504/)).toBeInTheDocument();
    expect(screen.getByText(/timed out/)).toBeInTheDocument();
  });

  it("draws an uptime bar for the job from its function's rollup", () => {
    const { container } = render(
      <ScheduledJobsPanel
        cronRows={[cron]}
        metrics={[metric]}
        healthDaily={[{
          day: new Date().toISOString().slice(0, 10), fn: "cron-health-watcher",
          runs: 96, failures: 0, rejected: 0, worst_status: 200, p95_ms: 4000,
        }]}
      />,
    );
    expect(container.querySelectorAll("[data-uptime-day]")).toHaveLength(30);
    expect(screen.getByText(/100\.0% uptime/)).toBeInTheDocument();
  });

  it("maps a job whose cron name differs from its function slug", () => {
    // offer-digest -> send-offer-digest. Keying the rollup lookup by job_name would
    // silently show an empty bar for every job in CRON_JOB_TO_FN that gets renamed.
    const digest = { ...cron, job_name: "offer-digest" } as CronHealthRow;
    render(
      <ScheduledJobsPanel
        cronRows={[digest]}
        metrics={[]}
        healthDaily={[{
          day: new Date().toISOString().slice(0, 10), fn: "send-offer-digest",
          runs: 4, failures: 1, rejected: 0, worst_status: 500, p95_ms: 1000,
        }]}
      />,
    );
    expect(screen.getByText(/75\.0% uptime/)).toBeInTheDocument();
  });
});
