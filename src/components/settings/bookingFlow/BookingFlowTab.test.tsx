import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { BOOKING_FLOW_DEFAULTS, BOOKING_FLOW_TEMPLATE_DEFAULTS, type BookingFlow } from "@/lib/bookingFlow";

// The tab and its child hooks (useSettingsAudit, useEntitlements, custom fields) all
// read `currentOrg` from useAuth and hit the shared supabase client. A null org keeps
// every internal query idle (enabled: Boolean(orgId)) so most tests render without
// touching the network. The entitlement tests below need a real org id so the
// entitlements query actually runs, so useAuth is a vi.fn() controlled per test
// (vi.hoisted holder pattern — see src/hooks/useCities.test.tsx) rather than a fixed
// factory, and the supabase client is a shared mutable object seeded with
// createFakeSupabase (never a hand-rolled vi.mock chain).
const { client, fetchTemplates } = vi.hoisted(() => ({
  client: {} as Record<string, unknown>,
  fetchTemplates: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/data/platform", async (original) => ({
  ...(await original<typeof import("@/data/platform")>()),
  fetchPlatformBookingTemplates: () => fetchTemplates(),
}));

Object.assign(
  client,
  createFakeSupabase({
    org_entitlements: [
      { when: { org_id: "org-locked" }, data: [{ feature: "booking_flow", enabled: false }], error: null },
      { when: { org_id: "org-entitled" }, data: [{ feature: "booking_flow", enabled: true }], error: null },
    ],
    custom_field_definitions: { data: [], error: null },
    profiles: { data: [], error: null },
    settings_audit_log: [
      {
        when: { org_id: "org-locked" },
        data: [
          {
            id: "audit-1",
            key: "booking_flow",
            actor: null,
            old_value: null,
            new_value: { artist_acceptance: false },
            created_at: "2026-07-01T00:00:00Z",
          },
        ],
        error: null,
      },
    ],
  }),
);

import { useAuth } from "@/features/auth/AuthContext";
import { BookingFlowTab } from "./BookingFlowTab";

function Harness({ orgFlow, dirtyKeys = [], readOnly }: { orgFlow?: BookingFlow; dirtyKeys?: string[]; readOnly?: boolean } = {}) {
  const [draft, setDraft] = useState<Record<string, unknown>>({
    booking_flow: orgFlow ?? BOOKING_FLOW_DEFAULTS,
    offer_response_window_hours: 48,
    offer_digest_hour_berlin: 19,
    confirmation_digest_hour_berlin: 20,
  });
  return (
    <BookingFlowTab
      get={(k) => draft[k]}
      set={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
      dirtyKeys={dirtyKeys}
      saving={false}
      onSave={() => {}}
      onDiscard={() => {}}
      readOnly={readOnly}
    />
  );
}

describe("BookingFlowTab", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: null } as never);
    fetchTemplates.mockResolvedValue(BOOKING_FLOW_TEMPLATE_DEFAULTS);
  });

  it("blocks template selection when platform templates fail to load", async () => {
    fetchTemplates.mockRejectedValueOnce(new Error("template read failed"));
    renderWithProviders(<Harness />);

    expect(await screen.findByText("template read failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /direct book/i })).not.toBeInTheDocument();
  });

  it("selecting the Direct book preset flips the timeline into direct mode", async () => {
    renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /direct book/i }));
    expect(screen.getAllByText("Skipped").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Locked on")).toBeInTheDocument();
  });

  it("shows the resulting lifecycle chips in the rail", () => {
    renderWithProviders(<Harness />);
    // "Offered"/"Soft booked" also appear as timeline step badges, so scope the
    // assertion to the rail's Resulting lifecycle card to keep it unambiguous.
    const lifecycle = screen.getByText("Resulting lifecycle").parentElement as HTMLElement;
    expect(within(lifecycle).getByText("Offered")).toBeInTheDocument();
    expect(within(lifecycle).getByText("Soft booked")).toBeInTheDocument();
  });

  // Regression: normalizeBookingFlow forces producer_confirmation on whenever
  // artist_acceptance is off (security-relevant invariant: direct bookings ARE the
  // confirmation, so the field can't mean "not yet confirmed"). But that invariant must
  // not permanently clobber a user's earlier choice to run fast-track (confirmation off):
  // turning acceptance back on should restore what the user had set before it was forced on.
  // Same invariant, but the acceptance-off step comes from a PRESET click instead of the
  // switch: Fast-track (confirmation off) then Direct book (acceptance off) then acceptance
  // back on must restore the fast-track choice, not the pre-fast-track default. Presets
  // bypassed the ref tracking in onFlowChange, so the restore used a stale value.
  it("a preset's producer_confirmation choice survives an acceptance off/on round trip", async () => {
    renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /fast-track/i }));
    expect(screen.getByRole("switch", { name: /^producer confirmation$/i })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: /direct book/i }));
    fireEvent.click(screen.getByRole("switch", { name: /^artist acceptance$/i }));
    expect(screen.getByRole("switch", { name: /^producer confirmation$/i })).toHaveAttribute("aria-checked", "false");
  });

  it("restores the user's producer_confirmation choice after an acceptance off/on round trip", async () => {
    renderWithProviders(<Harness />);
    // Fast-track: artist_acceptance stays on, producer_confirmation goes off.
    fireEvent.click(await screen.findByRole("button", { name: /fast-track/i }));
    const acceptance = screen.getByRole("switch", { name: /^artist acceptance$/i });
    const confirmation = screen.getByRole("switch", { name: /^producer confirmation$/i });
    expect(confirmation).toHaveAttribute("aria-checked", "false");

    // Toggle acceptance off then back on.
    fireEvent.click(acceptance);
    expect(screen.getByRole("switch", { name: /^producer confirmation$/i })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch", { name: /^artist acceptance$/i }));

    expect(screen.getByRole("switch", { name: /^producer confirmation$/i })).toHaveAttribute("aria-checked", "false");
  });

  describe("entitlement gating", () => {
    it("shows a lock notice and disables editing when booking_flow is not entitled, but keeps audit history", async () => {
      vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-locked" } } as never);
      // The org has a stored override (artist_acceptance off) that must NOT be the
      // displayed flow while locked — the locked view always shows classic defaults,
      // since that override is not the live behavior right now.
      renderWithProviders(<Harness orgFlow={{ ...BOOKING_FLOW_DEFAULTS, artist_acceptance: false }} />);

      await waitFor(() => expect(screen.getByText("Booking engine is not enabled")).toBeInTheDocument());
      expect(
        screen.getByText(
          "Booking is switched off for your organization, so no offers, reminders or confirmations are sent. Contact your ShowFlow administrator to enable it.",
        ),
      ).toBeInTheDocument();

      // Preset chips disabled.
      expect(await screen.findByRole("button", { name: /direct book/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /fast-track/i })).toBeDisabled();

      // A representative FlowTimeline input is disabled.
      expect(screen.getByRole("switch", { name: /^artist acceptance$/i })).toBeDisabled();

      // Save button absent, but audit history is still rendered.
      expect(screen.queryByRole("button", { name: /^save/i })).not.toBeInTheDocument();
      expect(screen.getByText("Change history")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(/Artist acceptance: on → off/)).toBeInTheDocument());

      // Displayed flow is normalizeBookingFlow(null) (classic defaults), not the
      // stored override — the switch reads "on" even though the draft has it off.
      expect(screen.getByRole("switch", { name: /^artist acceptance$/i })).toHaveAttribute("aria-checked", "true");
    });

    // Critical-bug regression: the from-address input stays editable while locked and its
    // dirty key reaches this rail. The rail has no Save/Discard in that state, so it must not
    // announce an unsaved draft that the page-level Save handles elsewhere.
    it("hides the rail's unsaved-draft banner while locked even when dirtyKeys is non-empty", async () => {
      vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-locked" } } as never);
      renderWithProviders(<Harness dirtyKeys={["resend_from_address"]} />);

      await waitFor(() => expect(screen.getByText("Booking engine is not enabled")).toBeInTheDocument());
      expect(screen.queryByText(/previewing unsaved draft/i)).not.toBeInTheDocument();
    });

    it("tells the admin the pipeline is stopped, not running the standard flow", async () => {
      vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-locked" } } as never);
      renderWithProviders(<Harness />);

      expect(await screen.findByText("Booking engine is not enabled")).toBeInTheDocument();
      expect(screen.queryByText(/runs the standard flow/i)).not.toBeInTheDocument();
    });

    it("leaves the entitled path unchanged: no lock notice, Save present", async () => {
      vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-entitled" } } as never);
      renderWithProviders(<Harness />);

      // Give the entitlements query a tick to resolve (it defaults to entitled anyway).
      await waitFor(() => expect(screen.queryByText("Change history")).toBeInTheDocument());

      expect(screen.queryByText("Booking engine is not enabled")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^saved$/i })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /direct book/i })).not.toBeDisabled();
      expect(screen.getByRole("switch", { name: /^artist acceptance$/i })).not.toBeDisabled();
    });
  });

  // Capability read-only floor (distinct from entitlement `locked` above): the org IS
  // entitled and the flow renders normally, but a producer without `edit_booking_settings`
  // can't change it.
  describe("readOnly (capability floor, org entitled)", () => {
    it("disables presets, timeline switches, the from-address input, and hides rail Save, while showing real values", async () => {
      renderWithProviders(<Harness readOnly dirtyKeys={[]} />);

      expect(await screen.findByRole("button", { name: /direct book/i })).toBeDisabled();
      expect(screen.getByRole("switch", { name: /^artist acceptance$/i })).toBeDisabled();
      expect(screen.getByLabelText(/from address/i)).toBeDisabled();
      // No entitlement lock notice — this is a capability gate, not a module gate.
      expect(screen.queryByText("Booking engine is not enabled")).not.toBeInTheDocument();
      // The rail's own Save/Discard is hidden (no write control to grant).
      expect(screen.queryByRole("button", { name: /^save/i })).not.toBeInTheDocument();
      // Read floor: the default flow's real value (artist acceptance on) still renders.
      expect(screen.getByRole("switch", { name: /^artist acceptance$/i })).toHaveAttribute("aria-checked", "true");
    });

    it("leaves every control enabled when readOnly is false", async () => {
      renderWithProviders(<Harness readOnly={false} />);

      expect(await screen.findByRole("button", { name: /direct book/i })).not.toBeDisabled();
      expect(screen.getByRole("switch", { name: /^artist acceptance$/i })).not.toBeDisabled();
      expect(screen.getByLabelText(/from address/i)).not.toBeDisabled();
    });

    it("keeps the sender address here but no longer renders an email-template editor", () => {
      renderWithProviders(<Harness />);

      expect(screen.getByLabelText(/from address/i)).toBeInTheDocument();
      expect(screen.queryByText("Email Templates")).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText("Default subject")).not.toBeInTheDocument();
    });
  });

  describe("off state", () => {
    it("shows the Off state: banner + Off tile pressed when the flow is inactive", async () => {
      renderWithProviders(<Harness orgFlow={{ ...BOOKING_FLOW_DEFAULTS, active: false }} />);

      expect(screen.getByText(/booking flow is off/i)).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /^Off\b/i })).toHaveAttribute("aria-pressed", "true");
    });

    it("selecting a real preset from Off turns the flow active", async () => {
      renderWithProviders(<Harness orgFlow={{ ...BOOKING_FLOW_DEFAULTS, active: false }} />);

      fireEvent.click(await screen.findByRole("button", { name: /^Classic\b/i }));

      expect(screen.queryByText(/booking flow is off/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Classic\b/i })).toHaveAttribute("aria-pressed", "true");
    });

    it("keeps the rail Save available in the off state so the Off choice is persistable", () => {
      // Regression: the off state must NOT lock the rail, or both the rail Save and the
      // page-level Save (hidden for booking-scoped dirt) vanish and Off can never be saved.
      renderWithProviders(
        <Harness orgFlow={{ ...BOOKING_FLOW_DEFAULTS, active: false }} dirtyKeys={["booking_flow"]} />,
      );

      expect(screen.getByRole("button", { name: /^Save/i })).toBeInTheDocument();
      expect(screen.getByText(/previewing unsaved draft/i)).toBeInTheDocument();
    });
  });
});
