import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DomainSummaryGrid } from "./DomainSummaryGrid";

describe("DomainSummaryGrid", () => {
  it("renders live domains and honest 'Not monitored yet' placeholders", () => {
    render(<DomainSummaryGrid domains={[
      { key: "jobs", label: "Scheduled jobs", state: "degraded", detail: "1 slow" },
      { key: "edge", label: "Edge functions", state: "operational", detail: "p95 4.9s" },
    ]} />);
    expect(screen.getByText("Scheduled jobs")).toBeInTheDocument();
    expect(screen.getByText("1 slow")).toBeInTheDocument();
    expect(screen.getAllByText("Not monitored yet").length).toBeGreaterThan(0);
  });
});
