import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/hooks/useEntitlements", () => {
  const useFeature = vi.fn();
  return { useFeature, useModuleGate: (f: string) => ({ allow: useFeature(f), pending: false }) };
});
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(() => true),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }), // BOOKING_FLOW_DEFAULTS (artist_acceptance: true)
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));
vi.mock("@/components/dashboard/TierAttentionCard", () => ({ TierAttentionCard: () => null }));
vi.mock("@/components/dashboard/DirectBookingCard", () => ({ DirectBookingCard: () => null }));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchTierAttention: vi.fn(() => Promise.resolve([])),
}));
// DashboardPage now reads the onboarding board to decide the get-running redirect. These
// tests are about the booking-module gate, not the redirect, so pin the board complete so
// the dashboard renders (a complete/empty board never redirects).
vi.mock("@/hooks/useGetRunning", () => ({
  useGetRunning: () => ({
    model: {
      phases: [],
      doneCount: 0,
      totalCount: 0,
      canFirstOffer: true,
      complete: true,
      bookingOn: true,
      hireOrdersOn: false,
    },
    isLoading: false,
  }),
}));

import { useFeature } from "@/hooks/useEntitlements";
import { useAuth } from "@/features/auth/AuthContext";
import DashboardPage, { ProducerBookingSection } from "./DashboardPage";

const SOFT_BOOKED_ROW = {
  id: "bk-1",
  is_understudy: false,
  artist: { id: "ar-1", name: "Ada Lovelace" },
  show_date: { id: "sd-1", date: "2026-03-01", show: { program: "Aurora", sub_program: null } },
};

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

describe("DashboardPage producer booking section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      hasRole: (r: string) => r === "producer",
      currentOrg: { id: "org-1", name: "Aurora Productions" },
    } as never);
    seedClient({
      show_dates: { data: [], error: null },
      bookings: [
        { when: { status: "confirmed" }, data: [], error: null },
        { when: { status: "soft_booked" }, data: [SOFT_BOOKED_ROW], error: null },
      ],
    });
  });

  it("renders the cards when booking_flow is on", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    render(<ProducerBookingSection><div data-testid="cards" /></ProducerBookingSection>);
    expect(screen.getByTestId("cards")).toBeInTheDocument();
  });

  it("replaces them with the gate notice when off", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    render(<ProducerBookingSection><div data-testid="cards" /></ProducerBookingSection>);
    expect(screen.queryByTestId("cards")).not.toBeInTheDocument();
    expect(screen.getByTestId("module-gate-booking_flow")).toBeInTheDocument();
  });

  // I1(1): "Ready to Confirm" is backlog-driven, and the freeze decision deliberately
  // PRESERVES the soft_booked backlog when the module is switched off — so an
  // unentitled org is precisely the case where this card, and its bulk
  // Confirm/Decline writes, would otherwise appear.
  it("entitled: the Ready to Confirm bulk controls are reachable", async () => {
    vi.mocked(useFeature).mockReturnValue(true);
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Ready to Confirm")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  });

  it("unentitled: the Ready to Confirm card and its bulk controls are gone", async () => {
    vi.mocked(useFeature).mockReturnValue(false);
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByTestId("module-gate-booking_flow")).toBeInTheDocument();
    expect(screen.queryByText("Ready to Confirm")).not.toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
