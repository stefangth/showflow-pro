import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { applyPreset, BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { FlowTimeline } from "./FlowTimeline";

const TIMES = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };
const noop = () => {};

describe("FlowTimeline", () => {
  it("renders all seven steps in classic mode with no skipped chips", () => {
    renderWithProviders(
      <FlowTimeline flow={BOOKING_FLOW_DEFAULTS} times={TIMES} onFlowChange={noop} onTimesChange={noop} customFields={[]} referencePreview="Offer: X · Apr 30" />,
    );
    expect(screen.getByText("Open offer tier")).toBeInTheDocument();
    expect(screen.getByText("Understudy promotion")).toBeInTheDocument();
    expect(screen.queryAllByText("Skipped")).toHaveLength(0);
  });

  it("direct mode dims offer steps, shows Skipped and Locked on chips", () => {
    renderWithProviders(
      <FlowTimeline flow={applyPreset(BOOKING_FLOW_DEFAULTS, "direct")} times={TIMES} onFlowChange={noop} onTimesChange={noop} customFields={[]} referencePreview="x" />,
    );
    expect(screen.getAllByText("Skipped").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Locked on")).toBeInTheDocument();
  });

  it("toggling artist acceptance calls onFlowChange", () => {
    const onFlowChange = vi.fn();
    renderWithProviders(
      <FlowTimeline flow={BOOKING_FLOW_DEFAULTS} times={TIMES} onFlowChange={onFlowChange} onTimesChange={noop} customFields={[]} referencePreview="x" />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /artist acceptance/i }));
    expect(onFlowChange).toHaveBeenCalledWith({ artist_acceptance: false });
  });

  it("renders no em- or en-dashes anywhere", () => {
    const { container } = renderWithProviders(
      <FlowTimeline flow={BOOKING_FLOW_DEFAULTS} times={TIMES} onFlowChange={noop} onTimesChange={noop} customFields={[]} referencePreview="x" />,
    );
    expect(container.textContent).not.toMatch(/[—–]/);
  });
});
