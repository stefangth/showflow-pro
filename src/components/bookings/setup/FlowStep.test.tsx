import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { flowRef, flowErrorRef, timesRef, flowOrgSpy, timesOrgSpy, upsertOrgSettings, fetchTemplates } = vi.hoisted(() => ({
  flowRef: { value: undefined as unknown },
  // Ref-held so a test can put the query into its error state, where `data` is
  // undefined FOREVER rather than just not yet.
  flowErrorRef: { value: null as Error | null },
  timesRef: { value: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } },
  flowOrgSpy: vi.fn(),
  timesOrgSpy: vi.fn(),
  upsertOrgSettings: vi.fn(() => Promise.resolve()),
  fetchTemplates: vi.fn(),
}));
vi.mock("@/data/settings", async (original) => ({
  ...(await original<typeof import("@/data/settings")>()),
  upsertOrgSettings,
}));
vi.mock("@/data/platform", () => ({
  fetchPlatformBookingTemplates: fetchTemplates,
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
import { BOOKING_FLOW_DEFAULTS, BOOKING_FLOW_TEMPLATE_DEFAULTS, applyPreset } from "@/lib/bookingFlow";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";

beforeEach(() => {
  flowRef.value = { ...BOOKING_FLOW_DEFAULTS };
  flowErrorRef.value = null;
  flowOrgSpy.mockClear();
  timesOrgSpy.mockClear();
  upsertOrgSettings.mockClear();
  fetchTemplates.mockResolvedValue(BOOKING_FLOW_TEMPLATE_DEFAULTS);
});

describe("FlowStep", () => {
  it("renders the three preset cards and a live lifecycle preview", async () => {
    renderWithProviders(<FlowStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText("Classic")).toBeInTheDocument();
    expect(screen.getByText("Autopilot")).toBeInTheDocument();
    expect(screen.getByText("Direct book")).toBeInTheDocument();
    // Classic lifecycle chips: Asked / Said yes, waiting on you / Booked
    expect(screen.getByText("Said yes, waiting on you")).toBeInTheDocument();
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

  it("still renders without an active org, where the query never runs", async () => {
    flowRef.value = undefined;
    renderWithProviders(<FlowStep orgId={null} onDone={() => {}} />);

    expect(await screen.findByRole("button", { name: /^use /i })).toBeDisabled();
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

  it("portals its primary action into the wizard footer slot when one is provided", async () => {
    const slotEl = document.createElement("div");
    slotEl.setAttribute("data-testid", "wizard-footer-slot");
    const register = vi.fn();
    renderWithProviders(
      <WizardFooterContext.Provider value={{ el: slotEl, register }}>
        <FlowStep orgId="org-1" onDone={() => {}} />
      </WizardFooterContext.Provider>,
    );
    // The save button renders inside the provided slot, not loose in the body.
    await waitFor(() => expect(slotEl.querySelector("button")).toBeTruthy());
    expect(register).toHaveBeenCalledWith(true);
  });

  it("persists the selected template identity with the onboarding flow", async () => {
    renderWithProviders(<FlowStep orgId="org-1" onDone={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /autopilot/i }));
    fireEvent.click(screen.getByRole("button", { name: /use autopilot/i }));

    await waitFor(() => expect(upsertOrgSettings).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      expect.arrayContaining([
        expect.objectContaining({ key: "booking_flow" }),
        { key: "booking_flow_template", value: "fasttrack" },
        { key: "offer_response_window_hours", value: 48 },
        { key: "offer_digest_hour_berlin", value: 19 },
        { key: "confirmation_digest_hour_berlin", value: 20 },
      ]),
    ));
  });

  it("uses the current platform template flow, timing, and description", async () => {
    const templates = structuredClone(BOOKING_FLOW_TEMPLATE_DEFAULTS);
    templates.fasttrack.flow.auto_open_tier1 = false;
    templates.fasttrack.times = { windowHours: 72, offerDigestHour: 7, confirmationDigestHour: 8 };
    fetchTemplates.mockResolvedValue(templates);
    renderWithProviders(<FlowStep orgId="org-1" onDone={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /autopilot/i }));
    expect(screen.getByText(/you send each ask yourself/i)).toBeInTheDocument();
    expect(screen.getByText(/answer by 72 h/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /use autopilot/i }));

    await waitFor(() => expect(upsertOrgSettings).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      expect.arrayContaining([
        expect.objectContaining({ key: "booking_flow", value: expect.objectContaining({ auto_open_tier1: false }) }),
        { key: "offer_response_window_hours", value: 72 },
        { key: "offer_digest_hour_berlin", value: 7 },
        { key: "confirmation_digest_hour_berlin", value: 8 },
      ]),
    ));
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
