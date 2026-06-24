import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SystemHealthTab } from "./SystemHealthTab";
import * as platform from "@/data/platform";

describe("SystemHealthTab", () => {
  it("renders a failing cron job as Down", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([{
      job_name: "offer-digest", schedule: "0 16-19 * * *", status: "failing",
      last_status_code: 404, last_ok_at: null, last_error: "HTTP 404",
      consecutive_failures: 1, last_run_at: null, recent_failures: [],
    }]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockResolvedValue([]);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("offer-digest")).toBeInTheDocument();
    expect(await screen.findByText("Down")).toBeInTheDocument();
  });

  it("renders a healthy-but-slow job as Degraded (not Down) when metrics are present", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([{
      job_name: "cron-health-watcher", schedule: "*/15 * * * *", status: "healthy",
      last_status_code: 200, last_ok_at: null, last_error: null,
      consecutive_failures: 0, last_run_at: "2026-06-24T09:45:00Z", recent_failures: [],
    }]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockResolvedValue([{
      fn: "cron-health-watcher", invocations: 10, errors: 0, p50Ms: 4000, p95Ms: 18000,
      lastInvokedAt: "2026-06-24T09:45:00Z", lastStatus: 200, recent: [],
    }]);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("Degraded")).toBeInTheDocument();
  });

  it("still renders cron status when the metrics proxy fails", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([{
      job_name: "airtable-poll", schedule: "*/5 * * * *", status: "healthy",
      last_status_code: 200, last_ok_at: null, last_error: null,
      consecutive_failures: 0, last_run_at: null, recent_failures: [],
    }]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockRejectedValue(new Error("analytics down"));
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("airtable-poll")).toBeInTheDocument();
  });
});
