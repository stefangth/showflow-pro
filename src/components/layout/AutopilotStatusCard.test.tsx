import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { BOOKING_FLOW_DEFAULTS, applyPreset, type BookingFlow } from "@/lib/bookingFlow";

// Regression guard for the card-visibility fix: the sidebar card asserts
// "Autopilot on", so it must appear ONLY when the org's flow is the Autopilot
// (fasttrack) preset, never for Classic/Direct/custom, and never when the
// booking_flow module is off. Before the fix it showed for any active flow.
vi.mock("@/hooks/useEntitlements", async (orig) => {
  const useFeature = vi.fn();
  return {
    ...(await orig<typeof import("@/hooks/useEntitlements")>()),
    useFeature,
  };
});
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowRef.value }),
  useFlowTimes: () => ({ data: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } }),
}));

import { useFeature } from "@/hooks/useEntitlements";
import { AutopilotStatusCard } from "./AutopilotStatusCard";

const flowRef: { value: BookingFlow } = { value: BOOKING_FLOW_DEFAULTS };

beforeEach(() => {
  vi.mocked(useFeature).mockReturnValue(true);
  flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack");
});

describe("AutopilotStatusCard", () => {
  it("shows the Autopilot card when the flow is the Autopilot (fasttrack) preset", () => {
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack");
     renderWithProviders(<MemoryRouter><AutopilotStatusCard /></MemoryRouter>, { authOverrides: {} });
    expect(screen.getByText("Autopilot on")).toBeInTheDocument();
  });

  it("hides the card for the Classic preset (title would otherwise lie)", () => {
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "classic");
     renderWithProviders(<MemoryRouter><AutopilotStatusCard /></MemoryRouter>, { authOverrides: {} });
    expect(screen.queryByText("Autopilot on")).not.toBeInTheDocument();
  });

  it("hides the card for the Direct book preset", () => {
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
     renderWithProviders(<MemoryRouter><AutopilotStatusCard /></MemoryRouter>, { authOverrides: {} });
    expect(screen.queryByText("Autopilot on")).not.toBeInTheDocument();
  });

  it("hides the card when the booking_flow module is off, even in Autopilot", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack");
     renderWithProviders(<MemoryRouter><AutopilotStatusCard /></MemoryRouter>, { authOverrides: {} });
    expect(screen.queryByText("Autopilot on")).not.toBeInTheDocument();
  });
});
