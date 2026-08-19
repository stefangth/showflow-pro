import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ROUTES } from "@/config/app.config";
import { resetGetRunningLanding } from "@/lib/getRunning/landing";
import type { GetRunningModel } from "@/lib/getRunning/tasks";

// This file exercises only the onboarding (Get running) landing gate — the
// artist/producer branch and the one-time redirect. The Autopilot Today board
// mounted for the producer/admin branch (TodayContainer) is stubbed with a
// probe, the same way the artist branch's ArtistDashboard is, so these tests
// don't pay for its data layer and stay focused on the gate itself.
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useGetRunning", () => ({ useGetRunning: vi.fn() }));
vi.mock("@/components/dashboard/ArtistDashboard", () => ({
  ArtistDashboard: () => <div>artist dashboard probe</div>,
}));
vi.mock("@/components/today/TodayPage", () => ({
  default: () => <div>today board probe</div>,
}));

import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunning } from "@/hooks/useGetRunning";
import DashboardPage from "./DashboardPage";

/** A trivially-complete board (no phases → every task done) — the state in which the gate
 *  must NOT redirect, so the dashboard itself renders. */
const COMPLETE_MODEL: GetRunningModel = {
  phases: [],
  doneCount: 0,
  totalCount: 0,
  canFirstOffer: true,
  complete: true,
  bookingOn: true,
  hireOrdersOn: false,
};

function authAs(role: "producer" | "admin" | "artist") {
  vi.mocked(useAuth).mockReturnValue({
    hasRole: (r: string) => r === role,
    currentOrg: { id: "org-1", name: "Aurora Productions" },
  } as never);
}

describe("DashboardPage onboarding gate (drop into Get running until setup is done)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderAt() {
    return renderWithProviders(
      <MemoryRouter initialEntries={[ROUTES.DASHBOARD]}>
        <Routes>
          <Route path={ROUTES.DASHBOARD} element={<DashboardPage />} />
          <Route path={ROUTES.GET_RUNNING} element={<div>get running board</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("redirects a non-artist to /get-running while the board is incomplete", () => {
    resetGetRunningLanding();
    authAs("producer");
    vi.mocked(useGetRunning).mockReturnValue({ model: { ...COMPLETE_MODEL, complete: false }, isLoading: false });
    renderAt();
    expect(screen.getByText("get running board")).toBeInTheDocument();
  });

  // One-time landing: after the first post-login redirect has fired, a later visit to the
  // dashboard renders it even while the board is still incomplete — so the user is never
  // trapped on the board.
  it("does NOT redirect on a subsequent visit once the landing has been consumed", () => {
    resetGetRunningLanding();
    authAs("producer");
    vi.mocked(useGetRunning).mockReturnValue({ model: { ...COMPLETE_MODEL, complete: false }, isLoading: false });
    // First visit consumes the one-time landing (redirects to the board)…
    const { unmount } = renderAt();
    expect(screen.getByText("get running board")).toBeInTheDocument();
    unmount();
    // …a second visit with the board still incomplete now renders the dashboard.
    renderAt();
    expect(screen.queryByText("get running board")).not.toBeInTheDocument();
  });

  // The landing flag is per-org: a multi-org producer/admin who consumed org A's landing
  // must still land on org B's board when they switch to it mid-session (B is also
  // incomplete). A single shared flag would drop them on B's empty dashboard instead.
  it("lands independently per org: consuming org A's landing does not suppress org B's", () => {
    resetGetRunningLanding();
    vi.mocked(useGetRunning).mockReturnValue({ model: { ...COMPLETE_MODEL, complete: false }, isLoading: false });
    const asOrg = (id: string) =>
      vi.mocked(useAuth).mockReturnValue({
        hasRole: (r: string) => r === "producer",
        currentOrg: { id, name: id },
      } as never);
    // Org A: first visit consumes A's landing (redirects to the board)…
    asOrg("org-A");
    const { unmount } = renderAt();
    expect(screen.getByText("get running board")).toBeInTheDocument();
    unmount();
    // …switch to org B (also incomplete) in the same tab: B hasn't landed, so it redirects.
    asOrg("org-B");
    renderAt();
    expect(screen.getByText("get running board")).toBeInTheDocument();
  });

  it("does not redirect once the board is complete — the dashboard renders", () => {
    authAs("producer");
    vi.mocked(useGetRunning).mockReturnValue({ model: COMPLETE_MODEL, isLoading: false });
    renderAt();
    expect(screen.queryByText("get running board")).not.toBeInTheDocument();
    expect(screen.getByText("today board probe")).toBeInTheDocument();
  });

  it("does not redirect while the board model is still loading", () => {
    authAs("producer");
    vi.mocked(useGetRunning).mockReturnValue({ model: null, isLoading: true });
    renderAt();
    expect(screen.queryByText("get running board")).not.toBeInTheDocument();
  });

  it("never redirects an artist (they have no board) even when the model reads incomplete", () => {
    authAs("artist");
    vi.mocked(useGetRunning).mockReturnValue({ model: { ...COMPLETE_MODEL, complete: false }, isLoading: false });
    renderAt();
    expect(screen.getByText("artist dashboard probe")).toBeInTheDocument();
    expect(screen.queryByText("get running board")).not.toBeInTheDocument();
  });
});
