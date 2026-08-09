import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SystemHealthTab } from "./SystemHealthTab";
import * as platform from "@/data/platform";
import type { EmailHealth } from "@/lib/systemHealth";

// Fully healthy (operational) so its own "Operational" pill never collides with the
// "Down"/"Degraded" pills asserted against cron-job rows in the tests below.
const emailFixture: EmailHealth = {
  attempted: 100, sent: 100, delivered: 100, delayed: 0, bounced: 0, complained: 0, failed: 0, suppressed: 0,
  deliveryRate: 1, bounceRate: 0, complaintRate: 0, failureCount: 0,
  lastEventAt: "2026-07-11T08:00:00Z", byTemplate: [], recentIssues: [],
};

describe("SystemHealthTab", () => {
  it("renders a failing cron job as Down", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([{
      job_name: "offer-digest", schedule: "0 16-19 * * *", status: "failing",
      last_status_code: 404, last_ok_at: null, last_error: "HTTP 404",
      consecutive_failures: 1, last_run_at: null, recentFailures: [],
    }]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockResolvedValue([]);
    vi.spyOn(platform, "fetchEmailHealth").mockResolvedValue(emailFixture);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("offer-digest")).toBeInTheDocument();
    expect(await screen.findByText("Down")).toBeInTheDocument();
  });

  it("renders a healthy-but-slow job as Degraded (not Down) when metrics are present", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([{
      job_name: "cron-health-watcher", schedule: "*/15 * * * *", status: "healthy",
      last_status_code: 200, last_ok_at: null, last_error: null,
      consecutive_failures: 0, last_run_at: "2026-06-24T09:45:00Z", recentFailures: [],
    }]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockResolvedValue([{
      fn: "cron-health-watcher", invocations: 10, errors: 0, rejected: 0, byStatus: {}, p50Ms: 4000, p95Ms: 18000,
      lastInvokedAt: "2026-06-24T09:45:00Z", lastStatus: 200, lastFailure: null, recent: [],
    }]);
    vi.spyOn(platform, "fetchEmailHealth").mockResolvedValue(emailFixture);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("Degraded")).toBeInTheDocument();
  });

  it("still renders cron status when the metrics proxy fails", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([{
      job_name: "airtable-poll", schedule: "*/5 * * * *", status: "healthy",
      last_status_code: 200, last_ok_at: null, last_error: null,
      consecutive_failures: 0, last_run_at: null, recentFailures: [],
    }]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockRejectedValue(new Error("analytics down"));
    vi.spyOn(platform, "fetchEmailHealth").mockResolvedValue(emailFixture);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("airtable-poll")).toBeInTheDocument();
  });

  it("renders the Email delivery tile and panel once email metrics load", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockResolvedValue([]);
    vi.spyOn(platform, "fetchEmailHealth").mockResolvedValue(emailFixture);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("100 sent · 0.0% bounce")).toBeInTheDocument();
    expect(await screen.findByText("Delivery rate")).toBeInTheDocument();
  });

  it("does not blank the tab when the email-health query errors", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockResolvedValue([]);
    vi.spyOn(platform, "fetchEmailHealth").mockRejectedValue(new Error("email metrics down"));
    renderWithProviders(<SystemHealthTab />);
    // useEmailHealth retries once (~1s backoff) before settling into isError — allow extra time.
    expect(await screen.findByText("metrics unavailable", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("Delivery rate")).not.toBeInTheDocument();
  });

  it("counts only on-demand functions in the Edge functions card, matching the panel below", async () => {
    // One cron function (rendered in Scheduled jobs) + one on-demand function.
    // The card must not count the cron one: the panel below does not list it.
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockResolvedValue([{
      fn: "airtable-poll", invocations: 12, errors: 0, rejected: 0, byStatus: { "200": 12 }, p50Ms: 200, p95Ms: 300,
      lastInvokedAt: "2026-07-21T09:00:00Z", lastStatus: 200, lastFailure: null, recent: [],
    }, {
      // 403 (forbidden) is a genuine rejection fault, so this on-demand function is flagged. 401
      // would NOT flag it — that case is covered by the test below.
      fn: "open-offer-tier", invocations: 48, errors: 0, rejected: 48, byStatus: { "403": 48 }, p50Ms: 300, p95Ms: 400,
      lastInvokedAt: "2026-07-21T09:00:00Z", lastStatus: 403,
      lastFailure: { status: 403, at: "2026-07-21T09:00:00Z" }, recent: [],
    }]);
    vi.spyOn(platform, "fetchEmailHealth").mockResolvedValue(emailFixture);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText(/1 on-demand · 1 flagged/)).toBeInTheDocument();
    expect(screen.queryByText(/2 active/)).not.toBeInTheDocument();
  });

  it("does not flag an on-demand function whose only non-2xx are unauthorized 401s", async () => {
    // A function hit by expired-JWT browser polls (or a non-prod stack firing at prod) rejects
    // those with 401 while serving its real callers. That is operational, not flagged.
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockResolvedValue([{
      fn: "open-offer-tier", invocations: 348, errors: 0, rejected: 233,
      byStatus: { "200": 115, "401": 233 }, p50Ms: 300, p95Ms: 400,
      lastInvokedAt: "2026-07-21T09:00:00Z", lastStatus: 401,
      lastFailure: { status: 401, at: "2026-07-21T09:00:00Z" }, recent: [],
    }]);
    vi.spyOn(platform, "fetchEmailHealth").mockResolvedValue(emailFixture);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText(/1 on-demand · 0 flagged/)).toBeInTheDocument();
  });
});
