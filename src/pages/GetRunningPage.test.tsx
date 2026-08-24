import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import { ROUTES } from "@/config/app.config";
import type { GetRunningModel } from "@/lib/getRunning/tasks";
import type { GetRunningModelV3 } from "@/lib/getRunning/steps";

// GetRunningPage reads useAuth (org/role) and useGetRunning (the composed board model)
// directly. Both are mocked here — useAuth as a vi.fn() (same harness as
// HireOrderEditPage.test.tsx), useGetRunning as a vi.fn() so each test can hand back an
// exact model shape without seeding every table the underlying booking/hire-order setup
// reads touch (that live-data wiring is covered by useGetRunning.test.tsx). A real
// MemoryRouter is used (not a Link stub) because the artist branch renders a real
// <Navigate>, and the test asserts on where the router actually lands.
//
// The page also reads useGetRunningV3Enabled (Task A3), which resolves the runtime flag
// through the real supabase client rather than through a mocked hook, so `client` is
// seeded per-test with createFakeSupabase (mirroring useGetRunningV3Enabled.test.tsx)
// instead of staying an empty object. useGetRunningV3 (the v3 board's own live-data hook)
// IS mocked, same as GetRunningBoardV3.test.tsx, so a v3-enabled render doesn't also have
// to seed every table that board's model composition touches.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useGetRunning", () => ({ useGetRunning: vi.fn() }));
vi.mock("@/hooks/useGetRunningV3", () => ({ useGetRunningV3: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunning } from "@/hooks/useGetRunning";
import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import GetRunningPage from "./GetRunningPage";

/** Seeds the shared fake supabase client. Defaults to an empty app_settings table (no
 *  org override), so useGetRunningV3Enabled resolves to the GETRUNNING_V3 build default
 *  (false in tests) for every pre-existing test below, matching their behavior before
 *  Task A3 wired the page to the runtime flag. */
function seed(s: Record<string, TableSeed> = { app_settings: { data: [], error: null } }) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

beforeEach(() => {
  seed();
});

const TEST_ORG = { id: "org-1", name: "Nordstadt Produktionen", slug: "nordstadt", status: "active", is_demo: false };

function authAs(role: "admin" | "producer" | "artist") {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg: TEST_ORG,
    hasRole: (r: string) => r === role,
    roles: [role],
  } as never);
}

function emptyModel(overrides: Partial<GetRunningModel> = {}): GetRunningModel {
  return {
    phases: [],
    doneCount: 0,
    totalCount: 0,
    canFirstOffer: false,
    complete: true,
    bookingOn: false,
    hireOrdersOn: false,
    datesWithoutCity: 0,
    datesWithoutCityUnknown: false,
    ...overrides,
  };
}

function boardModel(): GetRunningModel {
  return {
    phases: [
      {
        key: "get_dates",
        tasks: [
          { key: "dates", phase: "get_dates", done: false, block: null, adminOnly: false, actionableByViewer: true },
          { key: "slots", phase: "get_dates", done: false, block: "offers", adminOnly: false, actionableByViewer: true },
        ],
      },
    ],
    doneCount: 0,
    totalCount: 2,
    canFirstOffer: false,
    complete: false,
    bookingOn: true,
    hireOrdersOn: false,
    datesWithoutCity: 0,
    datesWithoutCityUnknown: false,
  };
}

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

describe("GetRunningPage edge states", () => {
  it("shows a skeleton while loading, not the board", () => {
    authAs("admin");
    vi.mocked(useGetRunning).mockReturnValue({ model: null, isLoading: true });

    renderPage();

    expect(document.querySelector('[class*="animate-pulse"]')).toBeInTheDocument();
    expect(screen.queryByTestId(/phase-card-/)).not.toBeInTheDocument();
  });

  it("redirects an artist viewer to /availability instead of rendering the board", () => {
    authAs("artist");
    vi.mocked(useGetRunning).mockReturnValue({ model: boardModel(), isLoading: false });

    renderPage();

    expect(screen.getByText("AVAILABILITY STUB")).toBeInTheDocument();
    expect(screen.queryByTestId(/phase-card-/)).not.toBeInTheDocument();
  });

  it("shows a single nothing-to-set-up card when neither module is on, no board", () => {
    authAs("admin");
    vi.mocked(useGetRunning).mockReturnValue({ model: emptyModel(), isLoading: false });

    renderPage();

    expect(screen.getByTestId("get-running-nothing")).toBeInTheDocument();
    expect(screen.queryByTestId(/phase-card-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("get-running-retired")).not.toBeInTheDocument();
  });

  it("renders the board for a producer viewer when a module is on", () => {
    authAs("producer");
    vi.mocked(useGetRunning).mockReturnValue({ model: boardModel(), isLoading: false });

    renderPage();

    expect(screen.getByTestId("phase-card-get_dates")).toBeInTheDocument();
    expect(screen.queryByTestId("get-running-nothing")).not.toBeInTheDocument();
  });
});

// A minimal v3 model that lands on GetRunningBoardV3's "nothing to set up" branch
// (bookingOn/hireOrdersOn both false) — a cheap, real render of the actual v3 component
// tree that still avoids seeding every table useGetRunningV3's live-data reads touch
// (that wiring is covered by useGetRunningV3.test.tsx and GetRunningBoardV3.test.tsx).
// Its testid (`get-running-v3-nothing`) is distinct from v1's own `get-running-nothing`,
// so asserting on it proves the v3 board rendered, not v1's.
function v3NothingModel(): GetRunningModelV3 {
  return {
    phases: [],
    doneCount: 0,
    totalCount: 0,
    canFirstOffer: false,
    complete: false,
    bookingOn: false,
    hireOrdersOn: false,
    datesWithoutCity: 0,
    datesWithoutCityUnknown: false,
    nextStep: null,
  };
}

describe("GetRunningPage runtime v3 toggle (Task A3)", () => {
  it("renders the v3 board when the org override enables it", async () => {
    authAs("admin");
    vi.mocked(useGetRunning).mockReturnValue({ model: boardModel(), isLoading: false });
    vi.mocked(useGetRunningV3).mockReturnValue({ model: v3NothingModel(), isLoading: false });
    seed({
      app_settings: { data: [{ org_id: TEST_ORG.id, key: "getrunning_v3_enabled", value: true }], error: null },
    });

    renderPage();

    expect(await screen.findByTestId("get-running-v3-nothing")).toBeInTheDocument();
    expect(screen.queryByTestId(/phase-card-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("get-running-nothing")).not.toBeInTheDocument();
  });

  it("renders the v1 board when there is no org override (build flag off in tests)", async () => {
    authAs("admin");
    vi.mocked(useGetRunning).mockReturnValue({ model: boardModel(), isLoading: false });
    vi.mocked(useGetRunningV3).mockReturnValue({ model: v3NothingModel(), isLoading: false });
    // Default seed() from beforeEach: empty app_settings, no org override.

    renderPage();

    expect(await screen.findByTestId("phase-card-get_dates")).toBeInTheDocument();
    expect(screen.queryByTestId("get-running-v3-nothing")).not.toBeInTheDocument();
  });
});
