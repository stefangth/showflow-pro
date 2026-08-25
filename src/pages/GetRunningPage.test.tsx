import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import { ROUTES } from "@/config/app.config";
import type { GetRunningModelV3 } from "@/lib/getRunning/steps";

// Post v3-cutover, GetRunningPage is a thin two-way fork: an artist (direct URL hit only,
// the nav item is admin/producer-gated) is bounced to Availability via useAuth().hasRole;
// everyone else renders the real GetRunningBoardV3 (context="page"). The v1 board
// (GetRunningHeader/PhaseCard/RetiredBoard/TaskPanel) and the useGetRunning/
// useGetRunningV3Enabled runtime-flag fork are gone from this page entirely.
//
// useAuth is mocked as a vi.fn() (same harness as HireOrderEditPage.test.tsx). A real
// MemoryRouter is used (not a Link stub) because the artist branch renders a real
// <Navigate>, and the test asserts on where the router actually lands.
//
// GetRunningBoardV3 itself is rendered for real (not mocked) so a passing test proves the
// actual v3 board mounts, not a stand-in. Its own live-data hook, useGetRunningV3, IS
// mocked (same as GetRunningBoardV3.test.tsx) so this file doesn't have to seed every
// table that board's model composition touches -- that wiring is covered by
// useGetRunningV3.test.tsx and GetRunningBoardV3.test.tsx. `client` stays mocked because
// GetRunningBoardV3 unconditionally calls useOrgAdminNames (react-query, gated by
// `enabled: role === "producer"`), which needs a working supabase client even when its
// query never actually fires.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useGetRunningV3", () => ({ useGetRunningV3: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import GetRunningPage from "./GetRunningPage";

function seed(s: Record<string, TableSeed> = {}) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

const TEST_ORG = { id: "org-1", name: "Nordstadt Produktionen", slug: "nordstadt", status: "active", is_demo: false };

function authAs(role: "admin" | "producer" | "artist") {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg: TEST_ORG,
    hasRole: (r: string) => r === role,
    roles: [role],
  } as never);
}

/** A minimal v3 model that lands GetRunningBoardV3 on its "nothing to set up" branch
 *  (bookingOn/hireOrdersOn both false) -- a cheap, real render of the actual v3 component
 *  tree that still avoids seeding every table useGetRunningV3's live-data reads touch. */
function v3NothingModel(): GetRunningModelV3 {
  return {
    phases: [],
    doneCount: 0,
    totalCount: 0,
    canFirstOffer: false,
    complete: false,
    bookingOn: false,
    datesSource: null,
    hireOrdersOn: false,
    datesWithoutCity: 0,
    datesWithoutCityUnknown: false,
    nextStep: null,
  };
}

beforeEach(() => {
  seed();
  vi.mocked(useGetRunningV3).mockReturnValue({ model: v3NothingModel(), isLoading: false });
});

function renderPage() {
  return renderWithProviders(
    <MemoryRouter initialEntries={[ROUTES.GET_RUNNING]}>
      <Routes>
        <Route path={ROUTES.GET_RUNNING} element={<GetRunningPage />} />
        <Route path={ROUTES.AVAILABILITY} element={<div>AVAILABILITY STUB</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GetRunningPage", () => {
  it("renders the v3 board for an admin and no v1 header", async () => {
    authAs("admin");

    renderPage();

    // GetRunningBoardV3's root testid, added in this cutover; present on every branch of
    // that component (loading/nothing/retired/board).
    expect(await screen.findByTestId("get-running-board-v3")).toBeInTheDocument();
    // "get-running-tick" is the v1 GetRunningHeader's own progress-tick testid (distinct
    // from the v3 board's "get-running-v3-tick") -- its absence proves the v1 header never
    // mounted, not merely that this particular model has zero ticks.
    expect(screen.queryByTestId("get-running-tick")).toBeNull();
  });

  it("renders the v3 board for a producer and no v1 header", async () => {
    authAs("producer");

    renderPage();

    expect(await screen.findByTestId("get-running-board-v3")).toBeInTheDocument();
    expect(screen.queryByTestId("get-running-tick")).toBeNull();
  });

  it("redirects an artist to Availability instead of rendering any board", () => {
    authAs("artist");

    renderPage();

    expect(screen.getByText("AVAILABILITY STUB")).toBeInTheDocument();
    expect(screen.queryByTestId("get-running-board-v3")).toBeNull();
  });
});
