import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ROUTES } from "@/config/app.config";
import type { GetRunningModel } from "@/lib/getRunning/tasks";

// GetRunningPage reads useAuth (org/role) and useGetRunning (the composed board model)
// directly. Both are mocked here — useAuth as a vi.fn() (same harness as
// HireOrderEditPage.test.tsx), useGetRunning as a vi.fn() so each test can hand back an
// exact model shape without seeding every table the underlying booking/hire-order setup
// reads touch (that live-data wiring is covered by useGetRunning.test.tsx). A real
// MemoryRouter is used (not a Link stub) because the artist branch renders a real
// <Navigate>, and the test asserts on where the router actually lands.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useGetRunning", () => ({ useGetRunning: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunning } from "@/hooks/useGetRunning";
import GetRunningPage from "./GetRunningPage";

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
