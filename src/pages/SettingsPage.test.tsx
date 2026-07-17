import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// SettingsPage queries `app_settings` directly (not through a data-access hook), and the
// Booking flow tab it renders pulls in its own children (useSettingsAudit, fetchCustomFieldDefs,
// useFeature/useEntitlements) which query settings_audit_log / custom_field_definitions /
// org_entitlements. Seed every table this page's tree can reach so each query resolves
// instead of hanging or throwing.
//
// org_entitlements is an array seed matched on org_id: "org-locked" is explicitly not
// entitled to booking_flow, "org-1" (used by every other test) has no matching entry and
// falls back to `{ data: [] }`, which resolves to the registry default (entitled) — same
// as before this file seeded the table at all.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  app_settings: { data: [], error: null },
  shows: { data: [], error: null },
  custom_field_definitions: { data: [], error: null },
  settings_audit_log: { data: [], error: null },
  org_entitlements: [
    { when: { org_id: "org-locked" }, data: [{ feature: "booking_flow", enabled: false }], error: null },
  ],
}));

// useAuth is a vi.fn() (not a fixed factory) so the locked-org test below can swap in a
// different currentOrg without affecting the other tests in this file — see the
// vi.hoisted holder pattern in BookingFlowTab.test.tsx.
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import SettingsPage from "./SettingsPage";

const DEFAULT_AUTH = {
  hasRole: () => true,
  currentOrg: { id: "org-1", name: "Test Org", slug: "test-org" },
  isSuperAdmin: false,
  refreshOrgs: async () => {},
};

describe("SettingsPage Booking flow tab Save affordance", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
  });

  // Regression: the Booking flow tab renders its own scoped Save/Discard in FlowRail,
  // fed by the page-level dirtyKeys filtered to BOOKING_AUDIT_KEYS. Before this fix, the
  // page-level header Save button (and the "unsaved changes" banner) stayed visible too,
  // so the same draft showed two Save affordances at once while that tab was active.
  it("hides the page-level Save while the booking tab holds only booking-key dirt", async () => {
    renderWithProviders(<SettingsPage />);
    // Radix TabsTrigger activates on mousedown (not click) — see @radix-ui/react-tabs.
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /booking flow/i }));
    fireEvent.click(await screen.findByRole("button", { name: /direct book/i }));

    // The rail's own Save is the sole Save affordance left on this tab.
    expect(screen.getAllByRole("button", { name: /^Save/i })).toHaveLength(1);
    expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
  });

  it("keeps the page-level Save when the dirt is on another tab", async () => {
    renderWithProviders(<SettingsPage />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /^notifications$/i }));
    fireEvent.click(await screen.findByRole("switch"));

    expect(screen.getByRole("button", { name: /^Save \(1\)$/i })).toBeInTheDocument();
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  });
});

describe("SettingsPage Booking flow tab, locked (booking_flow not entitled)", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      ...DEFAULT_AUTH,
      currentOrg: { id: "org-locked", name: "Locked Org", slug: "locked-org" },
    } as never);
  });

  // Critical-bug regression: the from-address input and EmailTemplatesCard deliberately
  // stay editable while the booking_flow module is locked (email copy isn't part of that
  // module). Both write keys inside BOOKING_AUDIT_KEYS, so the OLD entitlement-blind
  // heuristic (`activeTab === 'booking' && dirtyKeys.every(k => BOOKING_AUDIT_KEYS.includes(k))`)
  // hid the page-level Save for this edit too — and FlowRail already hides its own Save/Discard
  // while locked, so the edit had NO save control anywhere on the page. The fix makes the
  // heuristic entitlement-aware: page-level Save only ever hides when the org IS entitled.
  it("keeps the page-level Save visible, with no rail dirty banner, when editing the from-address while locked", async () => {
    renderWithProviders(<SettingsPage />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /booking flow/i }));
    await waitFor(() => expect(screen.getByText("Booking flow is not enabled")).toBeInTheDocument());

    const fromAddress = screen.getByLabelText(/from address/i);
    fireEvent.change(fromAddress, { target: { value: "Locked Org <noreply@locked.example>" } });

    // Page-level Save reappears — it's the only save control left, since FlowRail's own
    // Save/Discard stays hidden while locked.
    expect(await screen.findByRole("button", { name: /^Save \(1\)$/i })).toBeInTheDocument();
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();

    // The rail shows no "Previewing unsaved draft" banner: it offers no actions while
    // locked, so that banner would point the user at a save control that doesn't exist.
    expect(screen.queryByText(/previewing unsaved draft/i)).not.toBeInTheDocument();
  });

  // Regression guard: an entitled org editing an actual flow field must keep hiding the
  // page-level Save (unchanged from before this fix) — the rail's own Save/Discard covers it.
  it("still hides the page-level Save for an entitled org editing a flow field", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(<SettingsPage />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /booking flow/i }));
    fireEvent.click(await screen.findByRole("button", { name: /direct book/i }));

    expect(screen.getAllByRole("button", { name: /^Save/i })).toHaveLength(1);
    expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
  });
});
