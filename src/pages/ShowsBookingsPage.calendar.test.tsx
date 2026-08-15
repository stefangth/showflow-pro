import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type RecordedCall } from "@/test/supabaseFake";

/**
 * Task 16: ProducerShowsBookings renders `<CalendarSurface role="producer">`
 * in place of the old table/EntityCalendar + `ViewToggle`, wired to the real
 * data-access functions (not re-implemented in the test — the confirm-holds
 * flow below exercises the actual `fetchSoftBookedIdsForDate`/
 * `bulkConfirmSoftBooked` calls against a call-recording fake Supabase
 * client, mirroring what the old row-peek test covered for the table).
 */

const SHOW_DATE = {
  id: "sd-1", date: "2030-03-14", session_1: "19:00", session_2: null, session_3: null,
  venue: "Opera House", status: "partially_filled" as const, notes: null, cancellation_reason: null,
  city_id: null, show_id: "s1", custom: null,
  show: { id: "s1", program: "Nutcracker", sub_program: null, status: "active" as const, main_cast_slots: 4, understudy_slots: 2 },
  city: null,
};

// acceptedMain: 2 -> ProducerDateEntry.acceptedMain > 0, so the Month lens's
// DayRail defaults its primary action to "Confirm holds" for this date.
const COUNTS = new Map([
  ["sd-1", { confirmedMain: 1, confirmedUs: 0, acceptedMain: 2, acceptedUs: 0, pendingMain: 0, pendingUs: 0, total: 4 }],
]);

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, unknown>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed as never));
}

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: (r: string) => r === "producer", currentOrg: { id: "org-1" } }),
}));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock("@/data/showDates", async (orig) => ({
  ...(await orig<typeof import("@/data/showDates")>()),
  fetchShowDatesList: () => Promise.resolve([SHOW_DATE]),
}));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchBookingCountsByDate: () => Promise.resolve(COUNTS),
}));
vi.mock("@/components/filters/useFilterVisibility", () => ({
  useFilterVisibility: () => ({ canSee: () => true, isAdmin: true }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  // booking_flow on so Confirm holds is offered; hire_orders off.
  useFeature: (f: string) => f === "booking_flow",
  useEntitlements: () => ({ features: new Set(["booking_flow"]), isLoading: false }),
}));
vi.mock("@/hooks/useCapabilities", () => ({
  useCan: () => true,
}));
vi.mock("@/components/bookings/setup/useBookingSetupRailVisible", () => ({
  useBookingSetupRailVisible: () => ({ mode: "hidden" }),
}));
vi.mock("@/components/bookings/setup/BookingSetupRail", () => ({
  BookingSetupRail: () => <div data-testid="booking-setup-rail" />,
}));
vi.mock("@/hooks/useBookingSetup", () => ({
  // Full status object: useModuleOnboardingRail composes the banner rail off status.steps
  // and its "N of M" label off the counts. Composed by the real engine rather than listed
  // by hand so a new step cannot leave this fixture describing a rail that no longer exists.
  useBookingSetupStatus: () => ({
    status: blankOrgStatus(),
    coverage: undefined, isLoading: false, isError: false,
  }),
  useProducerCount: () => null,
}));
vi.mock("@/hooks/useHireOrders", () => ({
  useDatesReadyForHireOrder: () => ({ data: undefined }),
  useHireOrderAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));
vi.mock("@/features/editor/EditorContext", () => ({
  useEditorConfig: () => ({ isEditorMode: false, getColumnLabel: (id: string) => id, getCustomFieldDefs: () => [] }),
}));
vi.mock("@/components/shows/ShowDateDetailSheet", () => ({
  ShowDateDetailSheet: ({ showDateId, open }: { showDateId: string | null; open: boolean }) => (
    <div data-testid="detail-sheet" data-show-date-id={showDateId ?? ""} data-open={String(open)} />
  ),
}));
vi.mock("@/components/shows/ShowDateFormDialog", () => ({ ShowDateFormDialog: () => null }));
vi.mock("@/components/hireOrders/NewOrderWizard", () => ({ NewOrderWizard: () => null }));

import { toast } from "sonner";
import ShowsBookingsPage from "./ShowsBookingsPage";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";

/** A never-configured org, straight from the engine: every step outstanding. A hoisted
 *  function declaration so the vi.mock factory above can call it at render time. */
function blankOrgStatus() {
  return computeBookingSetupStatus({
    flowChosen: false, hasAnyShows: false, shows: [], timingChosen: false,
    coverage: null, artistCount: 0, artistAcceptance: null,
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  seedClient({});
  // Pin "today" inside SHOW_DATE's month — the surface defaults to the current
  // real month (no `today` override is threaded from the page), so the fixture
  // date must fall within it to render as a chip.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-10T12:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ShowsBookingsPage — producer calendar surface (Task 16)", () => {
  it("renders the CalendarSurface's Month lens and drops the old list/calendar ViewToggle", async () => {
    renderWithProviders(<ShowsBookingsPage />);
    expect(await screen.findByTestId("calendar-surface")).toBeInTheDocument();
    expect(screen.getByTestId("month-grid")).toBeInTheDocument();
    // The old view toggle offered "List"/"Calendar" buttons; the surface offers
    // lens tabs ("Month"/"Agenda") instead.
    expect(screen.queryByRole("button", { name: /^list$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Month" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Agenda" })).toBeInTheDocument();
  });

  it("selecting the date's day and clicking the rail's Confirm holds bulk-confirms via the real data layer", async () => {
    seedClient({ bookings: { data: [{ id: "b1" }, { id: "b2" }], error: null } });
    renderWithProviders(<ShowsBookingsPage />);
    const chip = await screen.findByText("Nutcracker");

    const cell = chip.closest('[data-testid^="month-grid-cell-"]')!;
    fireEvent.click(cell);

    const confirmBtn = await screen.findByTestId("day-rail-primary");
    expect(confirmBtn).toHaveTextContent("Confirm holds");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Confirmed 2"));

    const calls = client.calls as RecordedCall[];
    const selectCall = calls.find((c) => c.table === "bookings" && c.method === "eq" && c.args[0] === "show_date_id");
    expect(selectCall?.args).toEqual(["show_date_id", "sd-1"]);

    const updateCall = calls.find((c) => c.table === "bookings" && c.method === "update");
    expect(updateCall).toBeDefined();
    const patch = updateCall!.args[0] as { status?: string; confirmed_at?: string };
    expect(patch.status).toBe("confirmed");
    expect(typeof patch.confirmed_at).toBe("string");

    const inCall = calls.find((c) => c.table === "bookings" && c.method === "in");
    expect(inCall?.args).toEqual(["id", ["b1", "b2"]]);
  });

  it("double-clicking the date's day opens the full ShowDateDetailSheet", async () => {
    renderWithProviders(<ShowsBookingsPage />);
    const chip = await screen.findByText("Nutcracker");
    const cell = chip.closest('[data-testid^="month-grid-cell-"]')!;

    fireEvent.doubleClick(cell);
    const sheet = screen.getByTestId("detail-sheet");
    expect(sheet.getAttribute("data-show-date-id")).toBe("sd-1");
    expect(sheet.getAttribute("data-open")).toBe("true");
  });
});
