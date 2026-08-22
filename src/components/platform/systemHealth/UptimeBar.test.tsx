import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UptimeBar } from "./UptimeBar";
import type { HealthDay } from "@/lib/uptime";

const now = new Date("2026-08-04T12:00:00Z");
const row = (over: Partial<HealthDay> = {}): HealthDay => ({
  day: "2026-08-04", fn: "airtable-poll", runs: 288, failures: 0, rejected: 0, unauthorized: 0,
  worst_status: 200, p95_ms: 900, ...over,
});

describe("UptimeBar", () => {
  it("renders one cell per day in the window", () => {
    const { container } = render(<UptimeBar rows={[]} days={30} now={now} />);
    expect(container.querySelectorAll("[data-uptime-day]")).toHaveLength(30);
  });

  it("labels the axis so the direction of time is unambiguous", () => {
    render(<UptimeBar rows={[]} days={30} now={now} />);
    expect(screen.getByText("30 days ago")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("shows the uptime percentage when there is data", () => {
    render(<UptimeBar rows={[row({ runs: 100, failures: 1 })]} days={30} now={now} />);
    expect(screen.getByText(/99\.0% uptime/)).toBeInTheDocument();
  });

  it("says no data instead of printing a fake 100% before any rollup exists", () => {
    render(<UptimeBar rows={[]} days={30} now={now} />);
    expect(screen.getByText("no data yet")).toBeInTheDocument();
    expect(screen.queryByText(/uptime/)).not.toBeInTheDocument();
  });

  it("colours a fully failed day as down and an unrecorded day as muted", () => {
    const { container } = render(
      <UptimeBar rows={[row({ runs: 12, failures: 12, worst_status: 502 })]} days={30} now={now} />,
    );
    const cells = container.querySelectorAll("[data-uptime-day]");
    expect(cells[29].className).toContain("bg-destructive");
    expect(cells[0].className).toContain("bg-well-tint");
  });

  it("reveals that day's detail on hover", async () => {
    const { container } = render(
      <UptimeBar rows={[row({ runs: 288, failures: 1, worst_status: 502 })]} days={30} now={now} />,
    );
    const cells = container.querySelectorAll("[data-uptime-day]");
    // Radix opens a tooltip from pointermove on the trigger, not mouseover.
    fireEvent.pointerMove(cells[29] as HTMLElement, { pointerType: "mouse" });
    // Radix renders the visible bubble plus a visually-hidden copy, hence findAllByText.
    expect(await screen.findAllByText(/288 runs · 1 failure · HTTP 502/)).not.toHaveLength(0);
  });
});
