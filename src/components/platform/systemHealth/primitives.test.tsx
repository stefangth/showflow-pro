import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "@/components/ui/status-pill";
import { healthTone, healthLabel } from "@/lib/systemHealth";
import { LatencyStat } from "./primitives";

describe("healthTone / healthLabel", () => {
  it("labels each state in sentence case", () => {
    render(<StatusPill tone={healthTone("degraded")} dot>{healthLabel("degraded")}</StatusPill>);
    expect(screen.getByText("Degraded")).toBeInTheDocument();
  });

  it("maps states to the canonical tones (amber = waiting, red = risk)", () => {
    expect(healthTone("operational")).toBe("confirmed");
    expect(healthTone("degraded")).toBe("waiting");
    expect(healthTone("down")).toBe("risk");
    expect(healthTone("stale")).toBe("neutral");
    expect(healthTone("pending")).toBe("neutral");
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
