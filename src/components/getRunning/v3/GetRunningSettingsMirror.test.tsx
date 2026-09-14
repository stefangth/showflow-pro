import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import { composeGetRunningV3, type GetRunningInputV3, type GetRunningModelV3 } from "@/lib/getRunning/steps";

// GetRunningSettingsMirror is just GetRunningBoardV3 (context="settings") in its own
// wrapper: the v3 cutover (wireflow v3 phase 5) dropped the GetRunningV3Toggle it used to
// stack above the board, since the board is unconditional now and there is no remaining
// org-level runtime flag for a super-admin to flip. This suite still seeds `app_settings`
// via the fake client (SettingsPage-adjacent components under this tree may still touch
// it) and mocks useGetRunningV3 with a real composer output, same as
// GetRunningBoardV3.test.tsx, rather than seeding every table the underlying
// booking/hire-order setup reads touch.
//
// MemoryRouter is required (not optional) even though this mirror renders with
// context="settings" and never reads `?step=`: GetRunningBoardV3 (Phase 5) calls
// react-router's useSearchParams unconditionally per the rules of hooks, ignoring the
// param only after the hook call. In production this mirror is always mounted under the
// app's real BrowserRouter (it lives on the /settings route), so this just matches that.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/hooks/useGetRunningV3", () => ({ useGetRunningV3: vi.fn() }));

function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { GetRunningSettingsMirror } from "./GetRunningSettingsMirror";

const TEST_ORG = { id: "org-1", name: "Test Org", slug: "test-org", status: "active", is_demo: false, org_kind: "production" as const, org_kind_set_at: null };

// Neither module is on, which is the shallowest board state (get-running-v3-nothing) and
// keeps this suite from needing to build booking/hire fixtures at all, unlike
// GetRunningBoardV3.test.tsx's other cases.
const base: GetRunningInputV3 = {
  role: "admin",
  bookingOn: false,
  hireOrdersOn: false,
  booking: null,
  hire: null,
  datesSource: "airtable",
  datesConnectDone: true,
  datesMapDone: true,
  datesCitiesDone: true,
  hasAnyDates: true,
  orgKindChosen: true,
  producerCount: 1,
  skillGaps: 0,
  feeDone: false,
  documentDone: false,
  canManageShows: true,
  canEditScheduling: true,
  canEditBooking: true,
  canManageSkills: true,
  canEditHire: true,
  canAddArtists: true,
  canInvite: true,
};

function mockModel(model: GetRunningModelV3) {
  vi.mocked(useGetRunningV3).mockReturnValue({ model, isLoading: false });
}

describe("GetRunningSettingsMirror", () => {
  it("renders the settings-context board and no v3 toggle", () => {
    seed({ app_settings: { data: [], error: null } });
    mockModel(composeGetRunningV3(base));

    renderWithProviders(
      <MemoryRouter>
        <GetRunningSettingsMirror />
      </MemoryRouter>,
      { authOverrides: { isSuperAdmin: false, currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" } },
    );

    expect(screen.getByTestId("get-running-board-v3")).toBeInTheDocument();
    expect(screen.getByTestId("get-running-v3-nothing")).toBeInTheDocument();
    // toggle.title copy — the v3 cutover (wireflow v3 phase 5) dropped GetRunningV3Toggle
    // from this mirror, since the board is unconditional now and there is no org-level
    // runtime flag left for a super-admin to flip.
    expect(screen.queryByText(/get running v3/i)).toBeNull();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  // Super-admins used to see an extra toggle switch above the board; that surface is gone,
  // so a super-admin now sees exactly the same board as anyone else.
  it("renders no toggle switch for a super-admin either", () => {
    seed({ app_settings: { data: [], error: null } });
    mockModel(composeGetRunningV3(base));

    renderWithProviders(
      <MemoryRouter>
        <GetRunningSettingsMirror />
      </MemoryRouter>,
      { authOverrides: { isSuperAdmin: true, currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" } },
    );

    expect(screen.getByTestId("get-running-v3-nothing")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/get running v3/i)).toBeNull();
  });
});
