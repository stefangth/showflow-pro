import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// ShowDateDetailSheet reaches the shared client through several raw
// supabase.from(...) queries plus data-access helpers (fetchOfferTiers,
// fetchRequiredSkillIds, resolveOrgSetting, ...). Everything not seeded below
// resolves to the fake's benign empty-array default, which every one of those
// helpers already degrades to gracefully. Heavy/unrelated child surfaces
// (chat, hire orders, the edit dialog, dry-run, direct-book list) are stubbed
// out so this file stays focused on the sheet's own capability gates.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));
vi.mock("@/hooks/useEntitlements", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useEntitlements")>()),
  useFeature: vi.fn(),
}));
vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false }) }));
vi.mock("@/hooks/useEligibleArtists", () => ({
  useEligibleArtists: () => ({ data: { artistIds: null, castIds: [] }, isError: false }),
}));
vi.mock("@/hooks/useSkills", () => ({ useSkills: () => ({ data: [] }) }));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }), // falls back to BOOKING_FLOW_DEFAULTS (artist_acceptance: true)
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));
vi.mock("@/hooks/useAllCities", () => ({ useAllCities: () => ({ data: [] }) }));
vi.mock("@/hooks/useShowDates", () => ({
  useCancelShowDate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteShowDate: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/chat/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/shows/hireOrders/HireOrdersCard", () => ({ HireOrdersCard: () => null }));
vi.mock("@/components/shows/ShowDateFormDialog", () => ({ ShowDateFormDialog: () => null }));
vi.mock("@/components/shows/date/DryRunDialog", () => ({ DryRunDialog: () => null }));
vi.mock("@/components/shows/date/EligibilityBookList", () => ({ EligibilityBookList: () => null }));
// Stub exposes the exact `canManage` prop it was handed so the open/close-tier
// gate (run_offer_engine) can be asserted without needing TierTimeline's own deps.
vi.mock("@/components/shows/date/TierTimeline", () => ({
  TierTimeline: ({ canManage }: { canManage: boolean }) =>
    <div data-testid="tier-timeline-can-manage">{String(canManage)}</div>,
}));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useFeature } from "@/hooks/useEntitlements";
import { ShowDateDetailSheet } from "./ShowDateDetailSheet";

const SHOW_DATE = {
  id: "sd-1",
  date: "2026-03-01",
  session_1: "20:00:00",
  session_2: null,
  session_3: null,
  venue: "Main Hall",
  status: "open",
  notes: null,
  city_id: null,
  show_id: "show-1",
  cancellation_reason: null,
  airtable_record_id: null, // manual (non-synced) date -> hard-delete-eligible
  custom: null,
  show: { id: "show-1", program: "Aurora", sub_program: null, main_cast_slots: 2, understudy_slots: 1 },
  city: null,
};

const SOFT_BOOKED = {
  id: "bk-1",
  show_date_id: "sd-1",
  artist_id: "ar-1",
  status: "soft_booked",
  is_understudy: false,
  offer_expires_at: null,
  artist: { id: "ar-1", name: "Ada Lovelace" },
};

function authAs(role: "producer" | "admin") {
  vi.mocked(useAuth).mockReturnValue({
    hasRole: (r: string) => r === role,
    roles: [role],
    user: { id: "u1" },
    currentOrg: { id: "org-1", name: "Aurora Productions" },
  } as never);
}

function renderSheet() {
  return renderWithProviders(
    <ShowDateDetailSheet showDateId="sd-1" open onOpenChange={vi.fn()} />,
  );
}

describe("ShowDateDetailSheet capability gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAs("producer");
    // No active bookings by default so the hard-delete-eligibility calc (0 bookings
    // required) isn't entangled with the confirm_bookings tests below, which reseed
    // a soft_booked row explicitly.
    seedClient({
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    vi.mocked(useCan).mockReturnValue(true); // all capabilities on by default
    // hire_orders off by default; booking_flow on by default so the booking
    // card's own ModuleGate stays transparent for tests that aren't about it.
    vi.mocked(useFeature).mockImplementation((feature) => feature === "booking_flow");
  });

  it("hire_orders on + fully filled + no order: header shows Generate hire order and drafts on click", async () => {
    vi.mocked(useFeature).mockReturnValue(true);
    seedClient({
      show_dates: { data: { ...SHOW_DATE, status: "fully_filled" }, error: null },
      bookings: { data: [], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
      hire_orders: { data: [], error: null },
      "fn:generate-hire-orders": { data: { created: ["ho-x"], skipped: [] }, error: null },
    });
    renderSheet();
    const btn = await screen.findByRole("button", { name: /generate hire order/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      expect(invoke).toBeDefined();
      const body = invoke!.args[0] as { action: string; show_date_id: string };
      expect(body.action).toBe("draft");
      expect(body.show_date_id).toBe("sd-1");
    });
  });

  it("hire_orders off: no Generate hire order CTA in the header", async () => {
    seedClient({
      show_dates: { data: { ...SHOW_DATE, status: "fully_filled" }, error: null },
      bookings: { data: [], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    renderSheet();
    await screen.findByText("Main Hall");
    expect(screen.queryByRole("button", { name: /generate hire order/i })).not.toBeInTheDocument();
  });

  it("manage_show_dates on: Edit schedule is enabled", async () => {
    renderSheet();
    expect(await screen.findByRole("button", { name: /edit schedule/i })).toBeEnabled();
  });

  it("manage_show_dates off: Edit schedule is disabled, the date still reads", async () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "manage_show_dates");
    renderSheet();
    expect(await screen.findByRole("button", { name: /edit schedule/i })).toBeDisabled();
    expect(screen.getByText("Main Hall")).toBeInTheDocument();
  });

  it("hard_delete_show_dates on: a producer (not admin) sees an enabled Delete for a manual, booking-free date", async () => {
    renderSheet();
    expect(await screen.findByRole("button", { name: /^delete$/i })).toBeEnabled();
  });

  it("hard_delete_show_dates off: Delete control is absent, Cancel date still available", async () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "hard_delete_show_dates");
    renderSheet();
    expect(await screen.findByRole("button", { name: /cancel date/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it("run_offer_engine off: TierTimeline receives canManage=false", async () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "run_offer_engine");
    renderSheet();
    expect(await screen.findByTestId("tier-timeline-can-manage")).toHaveTextContent("false");
  });

  it("run_offer_engine on: TierTimeline receives canManage=true", async () => {
    renderSheet();
    expect(await screen.findByTestId("tier-timeline-can-manage")).toHaveTextContent("true");
  });

  it("confirm_bookings off: Confirm is hidden on a soft_booked row, Cancel stays available", async () => {
    seedClient({
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [SOFT_BOOKED], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    vi.mocked(useCan).mockImplementation((action: string) => action !== "confirm_bookings");
    renderSheet();
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^confirm$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  it("confirm_bookings on: Confirm is shown on a soft_booked row", async () => {
    seedClient({
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [SOFT_BOOKED], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    renderSheet();
    expect(await screen.findByRole("button", { name: /^confirm$/i })).toBeInTheDocument();
  });
});
