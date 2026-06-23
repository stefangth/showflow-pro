import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SystemHealthTab } from "./SystemHealthTab";
import * as platform from "@/data/platform";

describe("SystemHealthTab", () => {
  it("renders a failing job with its status", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([
      {
        job_name: "offer-digest", schedule: "0 16-19 * * *", status: "failing",
        last_status_code: 404, last_ok_at: null, last_error: "HTTP 404",
        consecutive_failures: 1, last_run_at: null, recent_failures: [],
      },
    ]);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("offer-digest")).toBeInTheDocument();
    expect(await screen.findByText(/failing/i)).toBeInTheDocument();
  });

  it("shows an empty state when there is no health data", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([]);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText(/no scheduled-job health/i)).toBeInTheDocument();
  });
});
