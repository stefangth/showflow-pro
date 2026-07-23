import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { EdgeFunctionsPanel } from "./EdgeFunctionsPanel";
import { edgeLogUnavailableMessage } from "./edgeLogCopy";
import type { EdgeFnMetric } from "@/lib/systemHealth";

const metric = (over: Partial<EdgeFnMetric> = {}): EdgeFnMetric => ({
  fn: "open-offer-tier", invocations: 48, errors: 0, rejected: 48,
  byStatus: { "401": 48 }, p50Ms: 300, p95Ms: 400,
  lastInvokedAt: "2026-07-21T09:00:00Z", lastStatus: 401,
  lastFailure: { status: 401, at: "2026-07-21T09:00:00Z" }, recent: [], ...over,
});

describe("EdgeFunctionsPanel", () => {
  it("shows the status-code breakdown so the failure is identifiable", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText("401 × 48")).toBeInTheDocument();
  });

  it("reports rejected calls alongside errors", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText(/48 rejected/)).toBeInTheDocument();
    expect(screen.getByText(/0 errors/)).toBeInTheDocument();
  });

  it("marks an all-rejected function as Down, not Operational", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText("Down")).toBeInTheDocument();
    expect(screen.queryByText("Operational")).not.toBeInTheDocument();
  });

  it("notes when no call succeeded in the window", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText(/no 2xx in this window/)).toBeInTheDocument();
  });

  it("omits the breakdown row entirely for a clean function", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric({
      fn: "generate-hire-orders", invocations: 6, rejected: 0, errors: 0,
      byStatus: { "200": 6 }, lastStatus: 200, lastFailure: null,
    })]} />);
    expect(screen.getByText("Operational")).toBeInTheDocument();
    expect(screen.queryByText(/rejected/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no 2xx/)).not.toBeInTheDocument();
  });

  it("gives the run timeline a text equivalent for screen readers", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText(/48 calls, 48 rejected, 0 errors/)).toBeInTheDocument();
  });

  it("offers a log drill-down only for a function with faults", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByRole("button", { name: /view recent errors/i })).toBeInTheDocument();
  });

  it("offers no drill-down for a clean function", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric({
      fn: "generate-hire-orders", invocations: 6, rejected: 0, errors: 0,
      byStatus: { "200": 6 }, lastStatus: 200, lastFailure: null,
    })]} />);
    expect(screen.queryByRole("button", { name: /view recent errors/i })).not.toBeInTheDocument();
  });

  it("explains an elevated 5xx rate", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric({ invocations: 10, errors: 2, rejected: 0, byStatus: { "200": 8, "500": 2 } })]} />);
    expect(screen.getByText("5xx error rate 20.0% exceeds the 5.0% budget")).toBeInTheDocument();
  });

  it("opens the recent-error detail region", () => {
    renderWithProviders(<EdgeFunctionsPanel metrics={[metric()]} />);
    fireEvent.click(screen.getByRole("button", { name: /view recent errors/i }));
    expect(screen.getByRole("button", { name: /hide recent errors/i })).toBeInTheDocument();
    expect(screen.getByText("Loading log lines.")).toBeInTheDocument();
  });

  it("includes the analytics failure message in unavailable log copy", () => {
    expect(edgeLogUnavailableMessage(new Error("analytics request returned 502")))
      .toBe("Log lines unavailable: analytics request returned 502");
  });
});
