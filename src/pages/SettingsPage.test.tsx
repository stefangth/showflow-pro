import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// SettingsPage queries `app_settings` directly (not through a data-access hook), and the
// Booking flow tab it renders pulls in its own children (useSettingsAudit, fetchCustomFieldDefs)
// which query settings_audit_log / custom_field_definitions. Seed every table this page's
// tree can reach so each query resolves instead of hanging or throwing.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  app_settings: { data: [], error: null },
  shows: { data: [], error: null },
  custom_field_definitions: { data: [], error: null },
  settings_audit_log: { data: [], error: null },
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({
    hasRole: () => true,
    currentOrg: { id: "org-1", name: "Test Org", slug: "test-org" },
    isSuperAdmin: false,
    refreshOrgs: async () => {},
  }),
}));

import SettingsPage from "./SettingsPage";

describe("SettingsPage Booking flow tab Save affordance", () => {
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
