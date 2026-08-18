import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import { ROUTES } from "@/config/app.config";
import { resetGetRunningLanding } from "@/lib/getRunning/landing";
import type { GetRunningModel } from "@/lib/getRunning/tasks";

// The Producer dashboard's "Ready to Confirm" bulk actions are the only surface
// under test here. Everything else (upcoming-dates cards, the tier-attention /
// direct-booking cockpit cards) is either seeded empty or stubbed so the file
// stays focused on the confirm_bookings gate (decline is deliberately NOT gated).
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }), // falls back to BOOKING_FLOW_DEFAULTS (artist_acceptance: true)
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));
vi.mock("@/components/dashboard/TierAttentionCard", () => ({ TierAttentionCard: () => null }));
vi.mock("@/components/dashboard/DirectBookingCard", () => ({ DirectBookingCard: () => null }));
// The onboarding gate reads the composed board model; drive it directly here so these
// tests exercise the gate/dashboard split without the whole entitlement+setup plumbing.
vi.mock("@/hooks/useGetRunning", () => ({ useGetRunning: vi.fn() }));
// Probe for the artist branch so the artist-does-not-redirect test doesn't pay for the
// real ArtistDashboard's data layer.
vi.mock("@/components/dashboard/ArtistDashboard", () => ({
  ArtistDashboard: () => <div>artist dashboard probe</div>,
}));

const bulkConfirmSoftBooked = vi.fn((..._a: unknown[]) => Promise.resolve({ affected: 1 }));
const bulkDeclineSoftBooked = vi.fn((..._a: unknown[]) => Promise.resolve({ affected: 1 }));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchTierAttention: vi.fn(() => Promise.resolve([])),
  bulkConfirmSoftBooked: (...a: unknown[]) => bulkConfirmSoftBooked(...a),
  bulkDeclineSoftBooked: (...a: unknown[]) => bulkDeclineSoftBooked(...a),
}));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
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

const SOFT_BOOKED_ROW = {
  id: "bk-1",
  is_understudy: false,
  artist: { id: "ar-1", name: "Ada Lovelace" },
  show_date: { id: "sd-1", date: "2026-03-01", show: { program: "Aurora", sub_program: null } },
};

function authAs(role: "producer" | "admin" | "artist") {
  vi.mocked(useAuth).mockReturnValue({
    hasRole: (r: string) => r === role,
    currentOrg: { id: "org-1", name: "Aurora Productions" },
  } as never);
}

describe("DashboardPage (producer) confirm_bookings gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAs("producer");
    // Complete board → the onboarding gate lets the dashboard render (these tests are about
    // the confirm gate, not the redirect).
    vi.mocked(useGetRunning).mockReturnValue({ model: COMPLETE_MODEL, isLoading: false });
    seedClient({
      show_dates: { data: [], error: null },
      bookings: [
        { when: { status: "confirmed" }, data: [], error: null },
        { when: { status: "soft_booked" }, data: [SOFT_BOOKED_ROW], error: null },
      ],
    });
    vi.mocked(useCan).mockReturnValue(true);
  });

  it("confirm_bookings on: bulk Confirm is enabled once a row is selected", async () => {
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText("Ada Lovelace");
    fireEvent.click(screen.getAllByRole("checkbox")[0]); // select-all header checkbox
    expect(await screen.findByRole("button", { name: /^confirm 1$/i })).toBeEnabled();
  });

  it("confirm_bookings off: bulk Confirm is disabled, Decline stays enabled (not gated)", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText("Ada Lovelace");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(await screen.findByRole("button", { name: /^confirm 1$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^decline 1$/i })).toBeEnabled();
  });
});

describe("DashboardPage onboarding gate (drop into Get running until setup is done)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedClient({
      show_dates: { data: [], error: null },
      bookings: [
        { when: { status: "confirmed" }, data: [], error: null },
        { when: { status: "soft_booked" }, data: [], error: null },
      ],
    });
    vi.mocked(useCan).mockReturnValue(true);
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

  it("does not redirect once the board is complete — the dashboard renders", () => {
    authAs("producer");
    vi.mocked(useGetRunning).mockReturnValue({ model: COMPLETE_MODEL, isLoading: false });
    renderAt();
    expect(screen.queryByText("get running board")).not.toBeInTheDocument();
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
