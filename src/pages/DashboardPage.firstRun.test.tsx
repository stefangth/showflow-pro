import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// Reuses the auth/data harness from DashboardPage.test.tsx so the ProducerDashboard
// data reads resolve, then adds the first-run-hook mock and asserts the welcome text.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: () => true,
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }), // falls back to BOOKING_FLOW_DEFAULTS (artist_acceptance: true)
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));
vi.mock("@/components/dashboard/TierAttentionCard", () => ({ TierAttentionCard: () => null }));
vi.mock("@/components/dashboard/DirectBookingCard", () => ({ DirectBookingCard: () => null }));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchTierAttention: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/components/dashboard/firstRun/useDashboardFirstRun", () => ({
  useDashboardFirstRun: vi.fn(),
}));

// Settable first-run state so the sample-vs-live body switch can be exercised.
function frState(overrides: Record<string, unknown> = {}) {
  return {
    show: true, complete: false, dismissed: false,
    steps: [], rules: [], offFooters: [],
    sample: { stats: [{ title: "Live dates", value: "34", label: "upcoming" }], queue: [], week: [] },
    welcome: { eyebrow: "Welcome", headline: "You are the first admin at Halle Kollektiv", body: "b", primaryLabel: "Start setup", secondaryLabel: "Later", progressLabel: "Set up · 0 of 4", progressFilled: 0, progressTotal: 4, progressHint: "About 15 minutes" },
    sectionTitle: "What this page becomes", sectionHint: "Sample rows.",
    railEyebrow: "Set up", railTitle: "Get running", railBody: "b",
    collapsedLabel: "Set up in progress", collapsedHint: "4 steps left", collapsedCta: "Resume",
    railOpen: false, openRail: vi.fn(), closeRail: vi.fn(), dismiss: vi.fn(),
    ...overrides,
  };
}

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import { useDashboardFirstRun } from "@/components/dashboard/firstRun/useDashboardFirstRun";
import DashboardPage from "./DashboardPage";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useDashboardFirstRun).mockReturnValue(frState() as never);
  vi.mocked(useAuth).mockReturnValue({
    hasRole: (r: string) => r === "admin",
    currentOrg: { id: "o1", name: "Halle Kollektiv" },
  } as never);
  seedClient({
    show_dates: { data: [], error: null },
    bookings: [
      { when: { status: "confirmed" }, data: [], error: null },
      { when: { status: "soft_booked" }, data: [], error: null },
    ],
  });
});

describe("DashboardPage first-run layer", () => {
  it("renders the welcome panel above the producer dashboard", async () => {
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByText(/first admin at Halle Kollektiv/)).toBeInTheDocument();
  });

  it("shows the greyed Sample (not the live body) when setup is incomplete and the org has no dates", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({ complete: false }) as never);
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    // Sample fixture stat is visible; the real body heading is not rendered.
    expect(await screen.findByText("Live dates")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("renders the live body (not the Sample) when setup is complete", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({ complete: true }) as never);
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByText("Live dates")).not.toBeInTheDocument();
  });

  it("renders the live body when the org already has dates, even while setup is incomplete", async () => {
    // The data-presence override: complete is false, but a real upcoming date exists,
    // so the body must go live (not the greyed Sample).
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({ complete: false }) as never);
    seedClient({
      show_dates: { data: [{ id: "d1", date: "2099-12-31", show_id: "s1", status: "confirmed", show: { program: "Show", sub_program: null, main_cast_slots: 1, understudy_slots: 0 } }], error: null },
      bookings: [
        { when: { status: "confirmed" }, data: [], error: null },
        { when: { status: "soft_booked" }, data: [], error: null },
      ],
    });
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByText("Live dates")).not.toBeInTheDocument();
  });
});
