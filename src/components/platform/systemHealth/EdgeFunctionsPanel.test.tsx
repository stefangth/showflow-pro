import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EdgeFunctionsPanel } from "./EdgeFunctionsPanel";
import type { EdgeFnMetric } from "@/lib/systemHealth";

const metric = (over: Partial<EdgeFnMetric> = {}): EdgeFnMetric => ({
  fn: "open-offer-tier", invocations: 48, errors: 0, rejected: 48,
  byStatus: { "401": 48 }, p50Ms: 300, p95Ms: 400,
  lastInvokedAt: "2026-07-21T09:00:00Z", lastStatus: 401,
  lastFailure: { status: 401, at: "2026-07-21T09:00:00Z" }, recent: [], ...over,
});

describe("EdgeFunctionsPanel", () => {
  it("shows the status-code breakdown so the failure is identifiable", () => {
    render(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText("401 × 48")).toBeInTheDocument();
  });

  it("reports rejected calls alongside errors", () => {
    render(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText(/48 rejected/)).toBeInTheDocument();
    expect(screen.getByText(/0 errors/)).toBeInTheDocument();
  });

  it("marks an all-rejected function as Down, not Operational", () => {
    render(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText("Down")).toBeInTheDocument();
    expect(screen.queryByText("Operational")).not.toBeInTheDocument();
  });

  it("notes when no call succeeded in the window", () => {
    render(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText(/no 2xx in this window/)).toBeInTheDocument();
  });

  it("omits the breakdown row entirely for a clean function", () => {
    render(<EdgeFunctionsPanel metrics={[metric({
      fn: "generate-hire-orders", invocations: 6, rejected: 0, errors: 0,
      byStatus: { "200": 6 }, lastStatus: 200, lastFailure: null,
    })]} />);
    expect(screen.getByText("Operational")).toBeInTheDocument();
    expect(screen.queryByText(/rejected/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no 2xx/)).not.toBeInTheDocument();
  });

  it("gives the run timeline a text equivalent for screen readers", () => {
    render(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText(/48 calls, 48 rejected, 0 errors/)).toBeInTheDocument();
  });
});
