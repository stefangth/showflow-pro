import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// The Cast/Offers booking-flow gate used to live in two exported subcomponents
// (BookingCardSection / BookingStatusSection). The cockpit splits that gate
// across tab panels, so these tests render the whole sheet and drive the tabs,
// asserting the SAME invariants:
//   - booking_flow on, Offers tab  -> the offers UI is present
//   - booking_flow off, Offers tab -> the module notice replaces the offers UI
//   - booking_flow off, Cast tab   -> the cast is readable, no write controls
//   - the cast renders exactly once
//   - the header slot meter (booking-engine status) shows only when on
//
// Mock scaffold mirrors ShowDateDetailSheet.test.tsx: the shared client is
// stubbed and seeded per test; heavy/unrelated children are stubbed so this file
// stays focused on the tab gating.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));
vi.mock("@/hooks/useEntitlements", async (orig) => {
  const useFeature = vi.fn();
  return {
    ...(await orig<typeof import("@/hooks/useEntitlements")>()),
    useFeature,
    // ModuleGate + the sheet's own useModuleGate('booking_flow') both derive from
    // the mocked useFeature so a single per-test setup drives every gate.
    useModuleGate: (f: string) => ({ allow: useFeature(f), pending: false }),
  };
});
vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false, getCustomFieldDefs: () => [] }) }));
vi.mock("@/hooks/useEligibleArtists", () => ({
  useEligibleArtists: () => ({ data: { artistIds: null, castIds: [] }, isError: false }),
}));
vi.mock("@/hooks/useSkills", () => ({ useSkills: () => ({ data: [] }) }));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }), // -> BOOKING_FLOW_DEFAULTS (artist_acceptance: true)
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
vi.mock("@/components/shows/date/TierTimeline", () => ({
  TierTimeline: () => <div data-testid="offers-ui">offers</div>,
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
  airtable_record_id: null,
  custom: null,
  show: { id: "show-1", program: "Aurora", sub_program: null, main_cast_slots: 2, understudy_slots: 1 },
  city: null,
};

const CONFIRMED = {
  id: "bk-1",
  show_date_id: "sd-1",
  artist_id: "ar-1",
  status: "confirmed",
  is_understudy: false,
  offer_expires_at: null,
  confirmed_at: null,
  artist: { id: "ar-1", name: "Ada Lovelace" },
};

function seedWith(bookings: unknown[]) {
  seedClient({
    show_dates: { data: SHOW_DATE, error: null },
    bookings: { data: bookings, error: null },
    casts: { data: [], error: null },
    show_date_cast_eligibility: { data: [], error: null },
  });
}

function renderSheet() {
  return renderWithProviders(
    <ShowDateDetailSheet showDateId="sd-1" open onOpenChange={vi.fn()} />,
  );
}

const clickTab = async (name: RegExp) =>
  fireEvent.click(await screen.findByRole("button", { name }));

describe("ShowDateDetailSheet cockpit booking_flow gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      hasRole: (r: string) => r === "producer",
      roles: ["producer"],
      user: { id: "u1" },
      currentOrg: { id: "org-1", name: "Aurora Productions" },
    } as never);
    vi.mocked(useCan).mockReturnValue(true);
    seedWith([CONFIRMED]);
  });

  it("booking_flow on: the Offers tab shows the offers UI", async () => {
    vi.mocked(useFeature).mockImplementation((f) => f === "booking_flow");
    renderSheet();
    await clickTab(/^asks$/i);
    expect(await screen.findByTestId("offers-ui")).toBeInTheDocument();
    expect(screen.queryByTestId("module-gate-booking_flow")).not.toBeInTheDocument();
  });

  it("booking_flow off: the Offers tab replaces the offers UI with the module notice", async () => {
    vi.mocked(useFeature).mockReturnValue(false);
    renderSheet();
    await clickTab(/^asks$/i);
    expect(await screen.findByTestId("module-gate-booking_flow")).toBeInTheDocument();
    expect(screen.queryByTestId("offers-ui")).not.toBeInTheDocument();
  });

  it("booking_flow off: the Cast tab keeps the confirmed cast readable with no write controls", async () => {
    vi.mocked(useFeature).mockReturnValue(false);
    renderSheet();
    // Cast is the default tab.
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^confirm$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument();
  });

  it("renders the confirmed cast exactly once whether booking_flow is on or off", async () => {
    vi.mocked(useFeature).mockImplementation((f) => f === "booking_flow");
    const on = renderSheet();
    expect(await on.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(on.getAllByText("Ada Lovelace")).toHaveLength(1);
    on.unmount();

    vi.mocked(useFeature).mockReturnValue(false);
    renderSheet();
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(1);
  });

  it("shows the header slot meter when booking_flow is on and hides it when off", async () => {
    vi.mocked(useFeature).mockImplementation((f) => f === "booking_flow");
    const on = renderSheet();
    expect(await on.findByTestId("cockpit-slot-meter")).toBeInTheDocument();
    on.unmount();

    vi.mocked(useFeature).mockReturnValue(false);
    renderSheet();
    // The sheet still renders (venue reads from the rail) but the booking-engine
    // meter is gated off.
    expect(await screen.findByText("Main Hall")).toBeInTheDocument();
    expect(screen.queryByTestId("cockpit-slot-meter")).not.toBeInTheDocument();
  });
});
