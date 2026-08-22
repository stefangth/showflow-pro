import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ROUTES } from "@/config/app.config";
import type { GetRunningModel } from "@/lib/getRunning/tasks";

// HomeLanding is the authenticated app-entry decider mounted at '/'. It is the
// only place that lands a non-artist on the Get running board; the /dashboard
// route always renders and never redirects (see DashboardPage.test.tsx).
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useGetRunning", () => ({ useGetRunning: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunning } from "@/hooks/useGetRunning";
import HomeLanding from "./HomeLanding";

const COMPLETE_MODEL: GetRunningModel = {
  phases: [],
  doneCount: 0,
  totalCount: 0,
  canFirstOffer: true,
  complete: true,
  bookingOn: true,
  hireOrdersOn: false,
  datesWithoutCity: 0,
};

function authAs(opts: {
  role?: "producer" | "admin" | "artist";
  user?: boolean;
  loading?: boolean;
}) {
  const { role = "producer", user = true, loading = false } = opts;
  vi.mocked(useAuth).mockReturnValue({
    user: user ? { id: "u1" } : null,
    loading,
    hasRole: (r: string) => r === role,
    currentOrg: { id: "org-1", name: "Aurora Productions" },
  } as never);
}

function renderLanding() {
  return renderWithProviders(
    <MemoryRouter initialEntries={[ROUTES.HOME]}>
      <Routes>
        <Route path={ROUTES.HOME} element={<HomeLanding />} />
        <Route path={ROUTES.LOGIN} element={<div>login screen</div>} />
        <Route path={ROUTES.GET_RUNNING} element={<div>get running board</div>} />
        <Route path={ROUTES.DASHBOARD} element={<div>today board</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HomeLanding — app-entry landing decider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a signed-out visitor to the login screen", () => {
    authAs({ user: false });
    vi.mocked(useGetRunning).mockReturnValue({ model: null, isLoading: false });
    renderLanding();
    expect(screen.getByText("login screen")).toBeInTheDocument();
  });

  it("lands a non-artist on Get running while the board is incomplete", () => {
    authAs({ role: "producer" });
    vi.mocked(useGetRunning).mockReturnValue({ model: { ...COMPLETE_MODEL, complete: false }, isLoading: false });
    renderLanding();
    expect(screen.getByText("get running board")).toBeInTheDocument();
  });

  it("lands a non-artist on the dashboard once the board is complete", () => {
    authAs({ role: "producer" });
    vi.mocked(useGetRunning).mockReturnValue({ model: COMPLETE_MODEL, isLoading: false });
    renderLanding();
    expect(screen.getByText("today board")).toBeInTheDocument();
  });

  it("sends an artist straight to the dashboard (they have no board) even when the model reads incomplete", () => {
    authAs({ role: "artist" });
    vi.mocked(useGetRunning).mockReturnValue({ model: { ...COMPLETE_MODEL, complete: false }, isLoading: false });
    renderLanding();
    expect(screen.getByText("today board")).toBeInTheDocument();
    expect(screen.queryByText("get running board")).not.toBeInTheDocument();
  });

  it("waits (no redirect) while auth is still loading", () => {
    authAs({ role: "producer", loading: true });
    vi.mocked(useGetRunning).mockReturnValue({ model: null, isLoading: true });
    renderLanding();
    expect(screen.queryByText("get running board")).not.toBeInTheDocument();
    expect(screen.queryByText("today board")).not.toBeInTheDocument();
  });

  it("waits (no redirect) while the board model is still loading", () => {
    authAs({ role: "producer" });
    vi.mocked(useGetRunning).mockReturnValue({ model: null, isLoading: true });
    renderLanding();
    expect(screen.queryByText("get running board")).not.toBeInTheDocument();
    expect(screen.queryByText("today board")).not.toBeInTheDocument();
  });
});
