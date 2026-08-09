import { describe, it, expect, vi, beforeEach } from "vitest";
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
const { featureFlags } = vi.hoisted(() => ({ featureFlags: { value: {} as Record<string, boolean> } }));
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (key: string) => featureFlags.value[key] ?? false,
}));
vi.mock("@/hooks/useCapabilities", () => ({
  useCan: () => true,
}));
// `visible` drives the inline callout, `reinvocable` drives the header
// re-invoke button -- both read off this one mocked hook (Plan B fix wave:
// the button used to be gated independently and could drift from the rail's
// own eligibility).
const { railState } = vi.hoisted(() => ({
  railState: { value: { visible: false, reinvocable: false } as { visible: boolean; reinvocable: boolean } },
}));
vi.mock("@/components/bookings/setup/useBookingSetupRailVisible", () => ({
  useBookingSetupRailVisible: () => railState.value,
}));
// The rail is exercised on its own in BookingSetupRail.test.tsx; stub it here so
// this page's tests don't also have to seed its five app_settings/shows reads.
vi.mock("@/components/bookings/setup/BookingSetupRail", () => ({
  BookingSetupRail: () => <div data-testid="booking-setup-rail" />,
}));
// The banner rail's steps come from useModuleOnboardingRail, which reads this status's
// `steps` + `complete`, so the mock must carry a full steps array (not just counts).
type BookingStatus = {
  steps: { key: string; done: boolean; block: "offers" | "filling" | null }[];
  doneCount: number; totalCount: number; canOffer: boolean; complete: boolean;
};
const { bookingSetupStatus } = vi.hoisted(() => ({
  bookingSetupStatus: {
    value: {
      steps: [
        { key: "flow", done: false, block: null },
        { key: "slots", done: false, block: "filling" },
        { key: "ladder", done: false, block: "offers" },
        { key: "eligibility", done: false, block: null },
        { key: "timing", done: false, block: null },
      ],
      doneCount: 0, totalCount: 5, canOffer: false, complete: false,
    } as BookingStatus,
  },
}));
vi.mock("@/hooks/useBookingSetup", () => ({
  useBookingSetupStatus: () => ({ status: bookingSetupStatus.value, coverage: undefined, isLoading: false, isError: false }),
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

/** Build a booking setup status with `done` of the five steps complete. */
function makeBookingStatus(done: number, complete: boolean): BookingStatus {
  const keys = ["flow", "slots", "ladder", "eligibility", "timing"] as const;
  const block: Record<string, "offers" | "filling" | null> = {
    flow: null, slots: "filling", ladder: "offers", eligibility: null, timing: null,
  };
  return {
    steps: keys.map((k, i) => ({ key: k, done: i < done, block: block[k] })),
    doneCount: done, totalCount: 5, canOffer: done >= 3, complete,
  };
}

beforeEach(() => {
  localStorage.clear();
  featureFlags.value = {};
  railState.value = { visible: false, reinvocable: false };
  bookingSetupStatus.value = makeBookingStatus(0, false);
});

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

/**
 * Plan B Task 3: the setup rail moved out of the cramped 340px grid column into
 * a right-side Sheet, and a dismissed-but-incomplete rail is now re-invokable
 * from a persistent header button (previously there was no way back once
 * "Hide" was clicked). booking_flow must be on for any of this to matter --
 * the page's own gate nulls out the org id (and therefore the rail) otherwise.
 */
describe("ShowsBookingsPage — setup checklist uncramp + re-invoke (Plan B Task 3)", () => {
  it("shows no re-invoke button and no inline callout by default (not dismissed, rail not visible)", async () => {
    featureFlags.value = { booking_flow: true };
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByText("Future Show");
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("booking-setup-rail")).not.toBeInTheDocument();
  });

  it("shows a full-width inline callout (not a cramped side column) while setup is incomplete and visible", async () => {
    featureFlags.value = { booking_flow: true };
    railState.value = { visible: true, reinvocable: false };
    renderWithProviders(<ShowsBookingsPage />);
    expect(await screen.findByText(/get bookings running/i)).toBeInTheDocument();
    // No fixed side-column grid track left anywhere on the page.
    expect(document.querySelector(".lg\\:grid-cols-\\[1fr_340px\\]")).toBeNull();
  });

  it("opens the checklist Sheet at the clicked step, and drops the old dashed callout button", async () => {
    featureFlags.value = { booking_flow: true };
    railState.value = { visible: true, reinvocable: false };
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByText(/get bookings running/i);
    // The old dashed "Open checklist" button is gone; each step opens the Sheet in place.
    expect(screen.queryByRole("button", { name: /open checklist/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose flow" }));
    expect(await screen.findByTestId("booking-setup-rail")).toBeInTheDocument();
  });

  it("shows the header re-invoke button once dismissed while setup is still incomplete, and hides the callout", async () => {
    // The mocked hook reports what the real useBookingSetupRailVisible would
    // compute once dismissed: not visible (the callout is gone), but
    // reinvocable -- there's still something actionable once reopened.
    featureFlags.value = { booking_flow: true };
    railState.value = { visible: false, reinvocable: true };
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    renderWithProviders(<ShowsBookingsPage />);
    expect(await screen.findByRole("button", { name: /setup checklist/i })).toBeInTheDocument();
    expect(screen.queryByText(/get bookings running/i)).not.toBeInTheDocument();
  });

  it("re-invokes on click: clears the dismissal and opens the Sheet with the rail", async () => {
    featureFlags.value = { booking_flow: true };
    railState.value = { visible: false, reinvocable: true };
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    renderWithProviders(<ShowsBookingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /setup checklist/i }));

    expect(await screen.findByTestId("booking-setup-rail")).toBeInTheDocument();
    expect(localStorage.getItem("showflow.bookingSetup.hidden.org-1")).toBeNull();
  });

  it("hides the re-invoke button once setup is complete, even if previously dismissed", async () => {
    // The real hook reports both false once complete, regardless of dismissed.
    featureFlags.value = { booking_flow: true };
    railState.value = { visible: false, reinvocable: false };
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    bookingSetupStatus.value = makeBookingStatus(5, true);
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByText("Future Show");
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
  });

  it("never offers the re-invoke button in a state where the rail itself would render nothing actionable", async () => {
    // Regression for the fix wave's finding: a non-editor once offers are
    // already possible is exactly the state useBookingSetupRailVisible
    // reports `reinvocable: false` for, even while dismissed -- the old
    // independently-gated button (`dismissed && !complete`) would have
    // shown here.
    featureFlags.value = { booking_flow: true };
    railState.value = { visible: false, reinvocable: false };
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    bookingSetupStatus.value = makeBookingStatus(4, false);
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByText("Future Show");
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
  });
});
