import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { EdgeFunctionsPanel } from "./EdgeFunctionsPanel";
import * as systemHealthHooks from "@/hooks/useSystemHealth";
import type { EdgeFnMetric } from "@/lib/systemHealth";

// Default fault fixture uses 403 (forbidden), a GENUINE rejection: it exercises the
// rejected/fault/drill-down/Down UI. 401 (unauthorized) is deliberately NOT the default because
// it is now excluded from health (see the "401 is unauthorized traffic" tests below) — using it
// here would make these fault assertions pass for the wrong reason.
const metric = (over: Partial<EdgeFnMetric> = {}): EdgeFnMetric => ({
  fn: "open-offer-tier", invocations: 48, errors: 0, rejected: 48,
  byStatus: { "403": 48 }, p50Ms: 300, p95Ms: 400,
  lastInvokedAt: "2026-07-21T09:00:00Z", lastStatus: 403,
  lastFailure: { status: 403, at: "2026-07-21T09:00:00Z" }, recent: [], ...over,
});

// An on-demand function whose only non-2xx are unauthorized 401s (e.g. an expired-JWT browser
// poll, or a non-prod stack firing at prod). Under the health model this is operational.
const unauthorizedMetric = (over: Partial<EdgeFnMetric> = {}): EdgeFnMetric => metric({
  byStatus: { "401": 48 }, lastStatus: 401, lastFailure: { status: 401, at: "2026-07-21T09:00:00Z" }, ...over,
});

describe("EdgeFunctionsPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the status-code breakdown so the failure is identifiable", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} healthDaily={[]} />);
    expect(screen.getByText("403 × 48")).toBeInTheDocument();
  });

  it("reports rejected calls alongside errors", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} healthDaily={[]} />);
    expect(screen.getByText(/48 rejected/)).toBeInTheDocument();
    expect(screen.getByText(/0 errors/)).toBeInTheDocument();
  });

  it("marks an all-rejected function as Down, not Operational", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} healthDaily={[]} />);
    expect(screen.getByText("Down")).toBeInTheDocument();
    expect(screen.queryByText("Operational")).not.toBeInTheDocument();
  });

  it("notes when no call succeeded in the window", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} healthDaily={[]} />);
    expect(screen.getByText(/no 2xx in this window/)).toBeInTheDocument();
  });

  it("omits the breakdown row entirely for a clean function", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric({
      fn: "generate-hire-orders", invocations: 6, rejected: 0, errors: 0,
      byStatus: { "200": 6 }, lastStatus: 200, lastFailure: null,
    })]} healthDaily={[]} />);
    expect(screen.getByText("Operational")).toBeInTheDocument();
    expect(screen.queryByText(/rejected/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no 2xx/)).not.toBeInTheDocument();
  });

  it("gives the run timeline a text equivalent for screen readers", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} healthDaily={[]} />);
    expect(screen.getByText(/48 calls, 48 rejected, 0 errors/)).toBeInTheDocument();
  });

  it("offers a log drill-down only for a function with faults", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} healthDaily={[]} />);
    expect(screen.getByRole("button", { name: /view recent errors/i })).toBeInTheDocument();
  });

  it("offers no drill-down for a clean function", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric({
      fn: "generate-hire-orders", invocations: 6, rejected: 0, errors: 0,
      byStatus: { "200": 6 }, lastStatus: 200, lastFailure: null,
    })]} healthDaily={[]} />);
    expect(screen.queryByRole("button", { name: /view recent errors/i })).not.toBeInTheDocument();
  });

  it("explains an elevated 5xx rate", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric({ invocations: 10, errors: 2, rejected: 0, byStatus: { "200": 8, "500": 2 } })]} healthDaily={[]} />);
    expect(screen.getByText("5xx error rate 20.0% exceeds the 5.0% budget")).toBeInTheDocument();
  });

  it("opens the recent-error detail region", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} healthDaily={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /view recent errors/i }));
    expect(screen.getByRole("button", { name: /hide recent errors/i })).toBeInTheDocument();
    expect(screen.getByText("Loading log lines.")).toBeInTheDocument();
  });

  it("renders the analytics failure message after the drill-down opens", () => {
    vi.spyOn(systemHealthHooks, "useEdgeFnLogs").mockReturnValue({
      data: undefined,
      error: new Error("analytics request returned 502"),
      isError: true,
      isLoading: false,
    } as unknown as ReturnType<typeof systemHealthHooks.useEdgeFnLogs>);

    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} healthDaily={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /view recent errors/i }));
    expect(screen.getByText("Log lines unavailable: analytics request returned 502")).toBeInTheDocument();
  });

  it("draws an uptime bar per on-demand function", () => {
    const { container } = renderWithProviders(
      <EdgeFunctionsPanel
        metrics={[metric({ fn: "create-invitation" })]}
        healthDaily={[{
          day: new Date().toISOString().slice(0, 10), fn: "create-invitation",
          runs: 4, failures: 0, rejected: 0, worst_status: 200, p95_ms: 800,
        }]}
      />,
    );
    expect(container.querySelectorAll("[data-uptime-day]")).toHaveLength(30);
  });

  // 401 is unauthorized traffic (the auth layer working), not the function failing.
  it("treats an all-401 function as Operational, not Down", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[unauthorizedMetric()]} healthDaily={[]} />);
    expect(screen.getByText("Operational")).toBeInTheDocument();
    expect(screen.queryByText("Down")).not.toBeInTheDocument();
  });

  it("keeps 401s visible as a chip but out of the rejected summary", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[unauthorizedMetric()]} healthDaily={[]} />);
    expect(screen.getByText("401 × 48")).toBeInTheDocument();          // histogram still discloses them
    expect(screen.getByText(/48 calls, 0 errors/)).toBeInTheDocument(); // summary excludes 401
    expect(screen.queryByText(/rejected/)).not.toBeInTheDocument();
  });

  it("offers no error drill-down when the only non-2xx are 401s", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[unauthorizedMetric()]} healthDaily={[]} />);
    expect(screen.queryByRole("button", { name: /view recent errors/i })).not.toBeInTheDocument();
  });
});
