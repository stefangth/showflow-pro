import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import { composeGetRunningV3, type GetRunningInputV3, type GetRunningModelV3 } from "@/lib/getRunning/steps";

// GetRunningSettingsMirror just stacks GetRunningV3Toggle (Task A4) above
// GetRunningBoardV3 (context="settings"), so this suite mirrors both siblings' harnesses:
// GetRunningV3Toggle.test.tsx's fake-client seed of app_settings for the toggle's
// live-data hooks, and GetRunningBoardV3.test.tsx's useGetRunningV3 mock + real composer
// for the board, rather than seeding every table the underlying booking/hire-order setup
// reads touch.
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

const TEST_ORG = { id: "org-1", name: "Test Org", slug: "test-org", status: "active", is_demo: false };

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
  it("renders the v3 board", () => {
    seed({ app_settings: { data: [], error: null } });
    mockModel(composeGetRunningV3(base));

    renderWithProviders(
      <MemoryRouter>
        <GetRunningSettingsMirror />
      </MemoryRouter>,
      { authOverrides: { isSuperAdmin: false, currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" } },
    );

    expect(screen.getByTestId("get-running-v3-nothing")).toBeInTheDocument();
  });

  it("also renders the toggle switch for a super-admin", async () => {
    seed({ app_settings: { data: [], error: null } });
    mockModel(composeGetRunningV3(base));

    renderWithProviders(
      <MemoryRouter>
        <GetRunningSettingsMirror />
      </MemoryRouter>,
      { authOverrides: { isSuperAdmin: true, currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" } },
    );

    expect(await screen.findByRole("switch")).toBeInTheDocument();
    expect(screen.getByTestId("get-running-v3-nothing")).toBeInTheDocument();
  });
});
