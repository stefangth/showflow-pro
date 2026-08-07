import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

/**
 * Plan B Task 2: the producer Shows & Bookings list must default to the
 * "Upcoming" timeframe (past hidden, one click away) and tint past-dated rows
 * with PAST_DATE_TINT while keeping them clickable.
 *
 * ShowsBookingsPage has no prior test file. The producer branch pulls in a
 * large hook surface (editor config, capability gates, hire-order readiness,
 * the setup rail); everything unrelated to the timeframe/tint behavior under
 * test is stubbed to its simplest inert shape, mirroring the pattern in
 * ProductionsPage.test.tsx (mock the data-layer fetch, not the supabase
 * client, and stub EditorContext/ColumnLayoutEditor).
 */

const PAST_DATE = "2020-01-01";
const FUTURE_DATE = "2030-01-01";

const SHOW_DATES = [
  {
    id: "sd-past", date: PAST_DATE, session_1: "19:00", session_2: null, session_3: null,
    venue: "Old Hall", status: "open" as const, notes: null, cancellation_reason: null,
    city_id: null, show_id: "s1", custom: null,
    show: { id: "s1", program: "Past Show", sub_program: null, status: "active" as const, main_cast_slots: 2, understudy_slots: 1 },
    city: null,
  },
  {
    id: "sd-future", date: FUTURE_DATE, session_1: "19:00", session_2: null, session_3: null,
    venue: "New Hall", status: "open" as const, notes: null, cancellation_reason: null,
    city_id: null, show_id: "s2", custom: null,
    show: { id: "s2", program: "Future Show", sub_program: null, status: "active" as const, main_cast_slots: 2, understudy_slots: 1 },
    city: null,
  },
];

// A no-op realtime channel stand-in: ShowsBookingsPage subscribes to
// bookings/show_dates changes on mount, which needs `.channel().on().subscribe()`
// and `.removeChannel()` to not throw (this page has no other supabase reads --
// its data comes through the mocked @/data/showDates and @/data/bookings below).
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const chan: Record<string, unknown> = {};
      chan.on = () => chan;
      chan.subscribe = () => chan;
      return chan;
    },
    removeChannel: () => {},
  },
}));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: (r: string) => r === "producer", currentOrg: { id: "org-1" } }),
}));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock("@/data/showDates", async (orig) => ({
  ...(await orig<typeof import("@/data/showDates")>()),
  fetchShowDatesList: () => Promise.resolve(SHOW_DATES),
}));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchBookingCountsByDate: () => Promise.resolve(new Map()),
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
  useBookingSetupRailVisible: () => false,
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

import ShowsBookingsPage from "./ShowsBookingsPage";

describe("ShowsBookingsPage — producer timeframe default + past tint (Plan B Task 2)", () => {
  it("defaults to Upcoming: shows the future date, hides the past one", async () => {
    renderWithProviders(<ShowsBookingsPage />);
    expect(await screen.findByText("Future Show")).toBeInTheDocument();
    expect(screen.queryByText("Past Show")).not.toBeInTheDocument();
  });

  it("reveals the past date, tinted, when Any time is selected — and it stays clickable", async () => {
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByText("Future Show");

    fireEvent.click(screen.getByRole("button", { name: /^Upcoming$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Any time" }));

    const pastCell = await screen.findByText("Past Show");
    const row = pastCell.closest("tr")!;
    expect(row.className).toMatch(/opacity-60/);
    expect(row.className).not.toMatch(/pointer-events-none/);

    // Future row stays untinted.
    expect(screen.getByText("Future Show").closest("tr")!.className).not.toMatch(/opacity-60/);

    // Still clickable: opens the detail sheet for this show_date.
    fireEvent.click(row);
    const sheet = screen.getByTestId("detail-sheet");
    expect(sheet.getAttribute("data-show-date-id")).toBe("sd-past");
    expect(sheet.getAttribute("data-open")).toBe("true");
  });

  it("also reveals the past date under the Past preset specifically", async () => {
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByText("Future Show");

    fireEvent.click(screen.getByRole("button", { name: /^Upcoming$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Past" }));

    expect(await screen.findByText("Past Show")).toBeInTheDocument();
    expect(screen.queryByText("Future Show")).not.toBeInTheDocument();
  });
});
