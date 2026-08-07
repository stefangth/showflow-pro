import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type RecordedCall } from "@/test/supabaseFake";

/**
 * Milestone 1 Task 4: the bookings-list row peek. Space opens a popover
 * summarizing the date's fill (reusing the real per-status counts + the real
 * computeDatePeek + RowPeek), Enter still opens the full ShowDateDetailSheet,
 * and the peek's Confirm action bulk-confirms the date's soft_booked bookings
 * via the real bulkConfirmSoftBooked data-access function.
 *
 * Mirrors the mocking scaffold in ShowsBookingsPage.test.tsx, with one
 * addition: the supabase client is a real call-recording fake (not a no-op
 * stand-in), because Confirm exercises real reads/writes on `bookings`.
 */

const SHOW_DATE = {
  id: "sd-1", date: "2030-03-14", session_1: "19:00", session_2: null, session_3: null,
  venue: "Opera House", status: "partially_filled" as const, notes: null, cancellation_reason: null,
  city_id: null, show_id: "s1", custom: null,
  show: { id: "s1", program: "Nutcracker", sub_program: null, status: "active" as const, main_cast_slots: 4, understudy_slots: 2 },
  city: null,
};

// counts -> computeDatePeek({confirmedMain:2, acceptedUs:2}, {main_cast:4, understudies:2})
// = "2 accepted waiting on you · 2 main slots open", at-risk, confirmable, acceptedWaiting 2.
const COUNTS = new Map([
  ["sd-1", { confirmedMain: 2, confirmedUs: 0, acceptedMain: 0, acceptedUs: 2, pendingMain: 0, pendingUs: 0, total: 4 }],
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
vi.mock("@/hooks/useBookingFlow", () => ({
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: () => false,
}));
vi.mock("@/hooks/useCapabilities", () => ({
  useCan: () => true,
}));
vi.mock("@/components/bookings/setup/useBookingSetupRailVisible", () => ({
  useBookingSetupRailVisible: () => ({ visible: false, reinvocable: false }),
}));
vi.mock("@/components/bookings/setup/BookingSetupRail", () => ({
  BookingSetupRail: () => <div data-testid="booking-setup-rail" />,
}));
vi.mock("@/hooks/useBookingSetup", () => ({
  useBookingSetupStatus: () => ({ status: { complete: false, doneCount: 0, totalCount: 5 }, coverage: undefined, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useHireOrders", () => ({
  useDatesReadyForHireOrder: () => ({ data: undefined }),
  useHireOrderAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));
vi.mock("@/features/editor/EditorContext", () => ({
  useColumnTemplate: () => ({
    orderedColumns: [
      { columnId: "show_dates.date", visible: true, order: 0 },
      { columnId: "shows.program", visible: true, order: 1 },
      { columnId: "show_dates.venue", visible: true, order: 2 },
    ],
    visibleCount: 3,
  }),
  useEditorConfig: () => ({ isEditorMode: false, getColumnLabel: (id: string) => id, getCustomFieldDefs: () => [] }),
}));
vi.mock("@/features/editor/useColumnHeaders", () => ({
  useColumnHeaders: () => [
    { columnId: "show_dates.date", headerLabel: "Date" },
    { columnId: "shows.program", headerLabel: "Program" },
    { columnId: "show_dates.venue", headerLabel: "Venue" },
  ],
}));
vi.mock("@/features/editor/ColumnLayoutEditor", () => ({ ColumnLayoutEditor: () => null }));
vi.mock("@/components/shows/ShowDateDetailSheet", () => ({
  ShowDateDetailSheet: ({ showDateId, open }: { showDateId: string | null; open: boolean }) => (
    <div data-testid="detail-sheet" data-show-date-id={showDateId ?? ""} data-open={String(open)} />
  ),
}));
vi.mock("@/components/shows/ShowDateFormDialog", () => ({ ShowDateFormDialog: () => null }));
vi.mock("@/components/hireOrders/NewOrderWizard", () => ({ NewOrderWizard: () => null }));

import { toast } from "sonner";
import ShowsBookingsPage from "./ShowsBookingsPage";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  seedClient({});
});

describe("ShowsBookingsPage row peek (Milestone 1 Task 4)", () => {
  it("Space opens the peek with the real per-date summary; Enter opens the full sheet", async () => {
    renderWithProviders(<ShowsBookingsPage />);
    const cell = await screen.findByText("Nutcracker");
    const row = cell.closest("tr")!;

    fireEvent.keyDown(row, { key: " " });
    expect(await screen.findByText("2 accepted waiting on you · 2 main slots open")).toBeInTheDocument();

    fireEvent.keyDown(row, { key: "Enter" });
    const sheet = screen.getByTestId("detail-sheet");
    expect(sheet.getAttribute("data-show-date-id")).toBe("sd-1");
    expect(sheet.getAttribute("data-open")).toBe("true");
    // Enter closes the peek on its way to the full sheet.
    expect(screen.queryByText("2 accepted waiting on you · 2 main slots open")).not.toBeInTheDocument();
  });

  it("Escape closes an open peek without opening the full sheet", async () => {
    renderWithProviders(<ShowsBookingsPage />);
    const cell = await screen.findByText("Nutcracker");
    const row = cell.closest("tr")!;

    fireEvent.keyDown(row, { key: " " });
    expect(await screen.findByText("2 accepted waiting on you · 2 main slots open")).toBeInTheDocument();

    fireEvent.keyDown(row, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByText("2 accepted waiting on you · 2 main slots open")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("detail-sheet").getAttribute("data-open")).toBe("false");
  });

  it("Confirm N bulk-confirms the date's soft_booked bookings and invalidates the bookings domain", async () => {
    seedClient({ bookings: { data: [{ id: "b1" }, { id: "b2" }], error: null } });
    renderWithProviders(<ShowsBookingsPage />);
    const cell = await screen.findByText("Nutcracker");
    const row = cell.closest("tr")!;

    fireEvent.keyDown(row, { key: " " });
    const confirmBtn = await screen.findByRole("button", { name: /confirm 2/i });
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
});
