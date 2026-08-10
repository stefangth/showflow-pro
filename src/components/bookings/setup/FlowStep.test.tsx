import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { flowRef, flowErrorRef, timesRef, flowOrgSpy, timesOrgSpy } = vi.hoisted(() => ({
  flowRef: { value: undefined as unknown },
  // Ref-held so a test can put the query into its error state, where `data` is
  // undefined FOREVER rather than just not yet.
  flowErrorRef: { value: null as Error | null },
  timesRef: { value: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } },
  flowOrgSpy: vi.fn(),
  timesOrgSpy: vi.fn(),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: (orgId?: string | null) => {
    flowOrgSpy(orgId);
    return { data: flowRef.value, isError: Boolean(flowErrorRef.value), error: flowErrorRef.value };
  },
  useFlowTimes: (orgId: string | null) => { timesOrgSpy(orgId); return { data: timesRef.value }; },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { FlowStep } from "./FlowStep";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "@/lib/bookingFlow";

beforeEach(() => {
  flowRef.value = { ...BOOKING_FLOW_DEFAULTS };
  flowErrorRef.value = null;
  flowOrgSpy.mockClear();
  timesOrgSpy.mockClear();
});

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

  it("reads the flow for the org it was handed, not for whatever org the shell is on", async () => {
    // The Save writes to the orgId prop and the suggested preset is a view of the flow read
    // here, so both reads have to key on the same org: the switcher lives in the app shell
    // and does not unmount this panel.
    renderWithProviders(<FlowStep orgId="org-9" onDone={() => {}} />);
    await screen.findByText("Classic");
    expect(flowOrgSpy).toHaveBeenCalledWith("org-9");
    expect(timesOrgSpy).toHaveBeenCalledWith("org-9");
  });

  it("enables saving once the org's own flow is in hand", async () => {
    renderWithProviders(<FlowStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByRole("button", { name: /use classic/i })).toBeEnabled();
  });

  it("re-suggests the preset when the org changes under it", async () => {
    // The suggestion is a view of the current org's flow (no seeding latch), so an org
    // switch with this panel mounted re-suggests from the NEW org's flow as soon as it
    // lands. The Save label is the selection, so it is what the assertion reads.
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    const { rerender } = renderWithProviders(<FlowStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByRole("button", { name: /use direct book/i })).toBeInTheDocument();

    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "classic");
    rerender(<FlowStep orgId="org-2" onDone={() => {}} />);
    expect(await screen.findByRole("button", { name: /use classic/i })).toBeInTheDocument();

  });
});
