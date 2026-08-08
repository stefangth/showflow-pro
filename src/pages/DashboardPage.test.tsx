import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

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

const bulkConfirmSoftBooked = vi.fn((..._a: unknown[]) => Promise.resolve({ affected: 1 }));
const bulkDeclineSoftBooked = vi.fn((..._a: unknown[]) => Promise.resolve({ affected: 1 }));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchTierAttention: vi.fn(() => Promise.resolve([])),
  bulkConfirmSoftBooked: (...a: unknown[]) => bulkConfirmSoftBooked(...a),
  bulkDeclineSoftBooked: (...a: unknown[]) => bulkDeclineSoftBooked(...a),
}));
// First-run chrome is out of scope for this file's assertions; stub the hook with
// show:false so the dashboard body renders live (no welcome panel / rail) and the
// artist-onboarding hook chain it would otherwise pull in never runs.
vi.mock("@/components/dashboard/firstRun/useDashboardFirstRun", () => ({
  useDashboardFirstRun: () => ({
    show: false, complete: true, dismissed: false,
    steps: [], rules: [], offFooters: [], sample: { stats: [], queue: [], week: [] },
    welcome: { eyebrow: "", headline: "", body: "", primaryLabel: "", secondaryLabel: "", progressLabel: "", progressFilled: 0, progressTotal: 0, progressHint: "" },
    sectionTitle: "Today", sectionHint: "",
    railEyebrow: "", railTitle: "", railBody: "",
    collapsedLabel: "", collapsedHint: "", collapsedCta: "",
    railOpen: false, openRail: vi.fn(), closeRail: vi.fn(), dismiss: vi.fn(),
  }),
}));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import DashboardPage from "./DashboardPage";

const SOFT_BOOKED_ROW = {
  id: "bk-1",
  is_understudy: false,
  artist: { id: "ar-1", name: "Ada Lovelace" },
  show_date: { id: "sd-1", date: "2026-03-01", show: { program: "Aurora", sub_program: null } },
};

function authAs(role: "producer" | "admin") {
  vi.mocked(useAuth).mockReturnValue({
    hasRole: (r: string) => r === role,
    currentOrg: { id: "org-1", name: "Aurora Productions" },
  } as never);
}

describe("DashboardPage (producer) confirm_bookings gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAs("producer");
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
