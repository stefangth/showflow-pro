import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatusPill, LatencyStat, RunTimeline } from "./primitives";
import type { EdgeFnMetric } from "@/lib/systemHealth";

const metric = (recent: EdgeFnMetric["recent"]): EdgeFnMetric => ({
  fn: "airtable-poll", invocations: recent.length, errors: 0, rejected: 0, byStatus: {},
  p50Ms: 100, p95Ms: 200, lastInvokedAt: null, lastStatus: null, lastFailure: null, recent,
});

describe("StatusPill", () => {
  it("labels each state in sentence case", () => {
    render(<StatusPill state="degraded" />);
    expect(screen.getByText("Degraded")).toBeInTheDocument();
  });
});

describe("LatencyStat", () => {
  it("formats milliseconds as seconds", () => {
    render(<LatencyStat p95Ms={8400} />);
    expect(screen.getByText(/8\.4s/)).toBeInTheDocument();
  });
  it("renders a dash when latency is unknown", () => {
    render(<LatencyStat p95Ms={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("RunTimeline", () => {
  it("renders one tick per recent outcome", () => {
    const { container } = render(
      <RunTimeline metric={metric([{ status: 200, ms: 900 }, { status: 502, ms: 4200 }])} p95BudgetMs={12000} />,
    );
    expect(container.querySelectorAll("[data-run-tick]")).toHaveLength(2);
  });

  it("reveals that run's failure detail on hover", async () => {
    const { container } = render(
      <RunTimeline
        metric={metric([{ status: 502, ms: 4200, at: "2026-08-04T09:24:06.000Z" }])}
        p95BudgetMs={12000}
      />,
    );
    // Radix opens a tooltip from pointermove on the trigger, not mouseover.
    fireEvent.pointerMove(container.querySelector("[data-run-tick]") as HTMLElement, { pointerType: "mouse" });
    // Queried by text, not role: the timeline stays aria-hidden (the row's text summary
    // is the screen-reader equivalent), so its tooltip is outside the accessibility tree.
    // Radix renders the visible bubble plus a visually-hidden copy, hence findAllByText.
    expect(await screen.findAllByText(/HTTP 502 · 4\.2s/)).not.toHaveLength(0);
  });

  it("says so when there are no recent runs", () => {
    render(<RunTimeline metric={metric([])} p95BudgetMs={12000} />);
    expect(screen.getByText("no recent runs")).toBeInTheDocument();
  });
});
