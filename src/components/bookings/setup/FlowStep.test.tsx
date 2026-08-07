import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { flowRef, timesRef } = vi.hoisted(() => ({
  flowRef: { value: undefined as unknown },
  timesRef: { value: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } },
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowRef.value }),
  useFlowTimes: () => ({ data: timesRef.value }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { FlowStep } from "./FlowStep";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";

beforeEach(() => { flowRef.value = { ...BOOKING_FLOW_DEFAULTS }; });

describe("FlowStep", () => {
  it("renders the three preset cards and a live lifecycle preview", async () => {
    renderWithProviders(<FlowStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText("Classic")).toBeInTheDocument();
    expect(screen.getByText("Fast-track")).toBeInTheDocument();
    expect(screen.getByText("Direct book")).toBeInTheDocument();
    // Classic lifecycle chips: Suggested / Soft booked / Confirmed
    expect(screen.getByText("Soft booked")).toBeInTheDocument();
  });
});
