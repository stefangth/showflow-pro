import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// AdminPage's People/Activity/Sync-log content moved into SettingsPage as an
// admin-only nav group. This file pins the People tab specifically: it renders
// PeopleTab (a real, unmocked component) which pulls in its own queries
// (org members via RPC, org_invitations, removed members via RPC), so every
// table/RPC that tree can reach needs a safe default here — mirrors the seed
// shape in SettingsPage.test.tsx.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  app_settings: { data: [], error: null },
  shows: { data: [], error: null },
  custom_field_definitions: { data: [], error: null },
  settings_audit_log: { data: [], error: null },
  org_entitlements: { data: [], error: null },
  org_invitations: { data: [], error: null },
  "rpc:list_org_members": { data: [], error: null },
  "rpc:list_removed_members": { data: [], error: null },
}));

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import SettingsPage from "./SettingsPage";

const DEFAULT_AUTH = {
  hasRole: () => true,
  currentOrg: { id: "org-1", name: "Test Org", slug: "test-org" },
  isSuperAdmin: false,
  user: { id: "admin-1" },
  refreshOrgs: async () => {},
};

beforeEach(() => {
  vi.mocked(useCan).mockReturnValue(true);
});

describe("SettingsPage People tab", () => {
  it("renders a People tab for an admin, with the invite bar", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=people"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /^people$/i })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByPlaceholderText(/invitee@email\.com/i)).toBeInTheDocument();
  });

  it("does not show a People tab for a producer", async () => {
    vi.mocked(useAuth).mockReturnValue({
      ...DEFAULT_AUTH,
      hasRole: (r: string) => r === "producer",
    } as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await screen.findByText("Modules", { selector: "p" });
    expect(screen.queryByRole("tab", { name: /^people$/i })).not.toBeInTheDocument();
  });
});
