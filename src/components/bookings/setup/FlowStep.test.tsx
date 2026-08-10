import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { flowRef, flowErrorRef, timesRef } = vi.hoisted(() => ({
  flowRef: { value: undefined as unknown },
  // Ref-held so a test can put the query into its error state, where `data` is
  // undefined FOREVER rather than just not yet.
  flowErrorRef: { value: null as Error | null },
  timesRef: { value: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } },
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({
    data: flowRef.value,
    isError: Boolean(flowErrorRef.value),
    error: flowErrorRef.value,
  }),
  useFlowTimes: () => ({ data: timesRef.value }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { FlowStep } from "./FlowStep";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";

beforeEach(() => { flowRef.value = { ...BOOKING_FLOW_DEFAULTS }; flowErrorRef.value = null; });

describe("FlowStep", () => {
  it("renders the three preset cards and a live lifecycle preview", async () => {
    renderWithProviders(<FlowStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText("Classic")).toBeInTheDocument();
    expect(screen.getByText("Fast-track")).toBeInTheDocument();
    expect(screen.getByText("Direct book")).toBeInTheDocument();
    // Classic lifecycle chips: Offered / Soft booked / Confirmed
    expect(screen.getByText("Soft booked")).toBeInTheDocument();
  });

  // Like TimingStep, this step had no loading gate: `base` fell back to
  // BOOKING_FLOW_DEFAULTS and `selected` to "classic" while the read was in flight,
  // and Save was enabled the whole time. Saving there wrote the classic preset over
  // the org's real flow AND silently dropped any non-preset customization, because
  // applyPreset was layered onto the defaults instead of onto the org's own flow.
  it("offers no Save while the org's stored flow is still loading", () => {
    flowRef.value = undefined;
    renderWithProviders(<FlowStep orgId="org-1" onDone={() => {}} />);

    expect(screen.queryByRole("button", { name: /^use /i })).not.toBeInTheDocument();
  });

  it("still renders without an active org, where the query never runs", () => {
    flowRef.value = undefined;
    renderWithProviders(<FlowStep orgId={null} onDone={() => {}} />);

    expect(screen.getByRole("button", { name: /^use /i })).toBeDisabled();
  });

  // See the matching TimingStep test: gating on "does the value exist" turns a failed
  // read into an indefinite skeleton, since `data` never arrives once React Query has
  // exhausted its retries.
  it("surfaces the failed read instead of holding the skeleton forever", () => {
    flowRef.value = undefined;
    flowErrorRef.value = new Error("permission denied");
    renderWithProviders(<FlowStep orgId="org-1" onDone={() => {}} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load the booking flow/i);
    expect(screen.getByRole("alert")).toHaveTextContent("permission denied");
    expect(screen.queryByRole("button", { name: /^use /i })).not.toBeInTheDocument();
  });
});
