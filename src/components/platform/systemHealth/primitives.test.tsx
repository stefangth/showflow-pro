import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill, LatencyStat } from "./primitives";

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
