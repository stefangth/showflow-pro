import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { SetupRailMode } from "@/components/setup/setupRailMode";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

/**
 * Task 16: ProducerShowsBookings now renders `<CalendarSurface>` instead of
 * the table/EntityCalendar + `ViewToggle`. This file covers two things:
 *
 *  - The producer filter bar no longer pre-windows the calendar surface by
 *    timeframe (the `TimeframeFilter` control was removed — the surface's
 *    own PeriodNavigator already owns the visible Month/Agenda window, and
 *    the two conflicted: navigating to a past/future month showed nothing
 *    because the Upcoming-only pre-filter had already dropped those dates).
 *    Both a past and a future date in the same calendar month now render
 *    together by default, with the past one dimmed via the Month grid
 *    cell's own `isPast` styling (`bg-muted`) rather than being hidden.
 *  - The setup-rail/checklist behavior (module onboarding), which is
 *    orthogonal to the table-vs-calendar surface and untouched by task 16.
 *
 * `SHOW_DATES` here is a mutable ref (`showDatesRef`) so different describe
 * blocks can seed different fixtures without re-mocking the module.
 */

type ShowDateFixture = {
  id: string;
  date: string;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  venue: string | null;
  status: "open" | "partially_filled" | "fully_filled" | "cancelled";
  notes: string | null;
  cancellation_reason: string | null;
  city_id: string | null;
  show_id: string;
  custom: null;
  show: {
    id: string;
    program: string;
    sub_program: string | null;
    status: "active";
    main_cast_slots: number;
    understudy_slots: number;
  };
  city: null;
};

const { showDatesRef } = vi.hoisted(() => ({
  showDatesRef: { value: [] as ShowDateFixture[] },
}));

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
  fetchShowDatesList: () => Promise.resolve(showDatesRef.value),
}));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchBookingCountsByDate: () => Promise.resolve(new Map()),
}));
vi.mock("@/components/filters/useFilterVisibility", () => ({
  useFilterVisibility: () => ({ canSee: () => true, isAdmin: true }),
}));
const { featureFlags } = vi.hoisted(() => ({ featureFlags: { value: {} as Record<string, boolean> } }));
// Settable entitlements-loading flag so a test can exercise the "loading window must not
// fail open" write-gate on the setup rail.
const { entLoading } = vi.hoisted(() => ({ entLoading: { value: false } }));
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (key: string) => featureFlags.value[key] ?? false,
  // The setup rail's write gate reads the raw entitlement set AND the loading flag (no
  // fail-open), so mirror featureFlags into a Set for `features.has(...)`.
  useEntitlements: () => ({
    features: new Set(Object.keys(featureFlags.value).filter((k) => featureFlags.value[k])),
    isLoading: entLoading.value,
  }),
}));
const { canRef } = vi.hoisted(() => ({ canRef: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({
  useCan: () => canRef.value,
}));
// `visible` drives the inline callout, `reinvocable` drives the header
// re-invoke button -- both read off this one mocked hook (Plan B fix wave:
// the button used to be gated independently and could drift from the rail's
// own eligibility).
const { railState } = vi.hoisted(() => ({
  railState: { value: { mode: "hidden" } as { mode: SetupRailMode } },
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
  // The banner rail now also reads this for the admin-only team nudge; this page's role is
  // producer throughout (see the useAuth mock above), so it is always called disabled and
  // only needs to exist here, not vary.
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

function showDate(overrides: Partial<ShowDateFixture> & Pick<ShowDateFixture, "id" | "date" | "show_id">): ShowDateFixture {
  return {
    session_1: "19:00", session_2: null, session_3: null,
    venue: "Opera House", status: "open", notes: null, cancellation_reason: null,
    city_id: null, custom: null,
    show: { id: overrides.show_id, program: "A Show", sub_program: null, status: "active", main_cast_slots: 2, understudy_slots: 1 },
    city: null,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  featureFlags.value = {};
  entLoading.value = false;
  canRef.value = true;
  railState.value = { mode: "hidden" };
  bookingSetupStatus.value = makeBookingStatus(0, false);
});

describe("ShowsBookingsPage — producer no default timeframe bound + past-day dimming (calendar surface)", () => {
  // Pin "today" mid-month so both fixture dates land in the same Month-lens
  // grid (the surface defaults to the current real month, and neither the
  // page nor the surface is given a `today` override in production).
  const TODAY = new Date("2030-06-15T12:00:00");
  const FUTURE_DATE = "2030-06-20";
  const PAST_DATE = "2030-06-05";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TODAY);
    showDatesRef.value = [
      showDate({ id: "sd-past", date: PAST_DATE, show_id: "s1", show: { id: "s1", program: "Past Show", sub_program: null, status: "active", main_cast_slots: 2, understudy_slots: 1 } }),
      showDate({ id: "sd-future", date: FUTURE_DATE, show_id: "s2", show: { id: "s2", program: "Future Show", sub_program: null, status: "active", main_cast_slots: 2, understudy_slots: 1 } }),
    ];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows both the past and future date's chips in the same month by default, past one dimmed — and it stays clickable", async () => {
    renderWithProviders(<ShowsBookingsPage />);
    // "Needs you" is the producer default lens (Task 8); switch to Month to
    // exercise the grid's past-day dimming.
    fireEvent.click(await screen.findByRole("tab", { name: "Month" }));

    // Match the exact `bg-muted` class token — the cell also carries an
    // unrelated `hover:bg-muted/50` class that a loose /bg-muted/ regex
    // would false-match on every cell, past or future.
    const futureChip = await screen.findByText("Future Show");
    const futureCell = futureChip.closest('[data-testid^="month-grid-cell-"]')!;
    expect(futureCell.classList.contains("bg-muted")).toBe(false);

    const pastChip = screen.getByText("Past Show");
    const pastCell = pastChip.closest('[data-testid^="month-grid-cell-"]')!;
    expect(pastCell.classList.contains("bg-muted")).toBe(true);

    // Still clickable: double-clicking the day opens the detail sheet for this show_date.
    fireEvent.doubleClick(pastCell);
    const sheet = screen.getByTestId("detail-sheet");
    expect(sheet.getAttribute("data-show-date-id")).toBe("sd-past");
    expect(sheet.getAttribute("data-open")).toBe("true");
  });

  it("has no TimeframeFilter control in the filter bar", async () => {
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByText("Future Show");

    // The period navigator (Month lens) owns the calendar window now; the
    // separate timeframe popover (its trigger read "Any time"/a preset name)
    // is gone from the filter bar.
    expect(screen.queryByRole("button", { name: /^Any time$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Upcoming$/ })).not.toBeInTheDocument();
  });
});

/**
 * Fix round 1: the old table/EntityCalendar showed `t('producer.emptyState')`
 * when `filtered.length === 0`; the calendar surface must too (a blank
 * month/agenda grid gives no explanation for a filter combo that matches
 * nothing, or a brand-new org with zero show dates).
 */
describe("ShowsBookingsPage — empty state on the calendar surface", () => {
  it("shows the empty-state message and no month grid when there are no show dates", async () => {
    showDatesRef.value = [];
    renderWithProviders(<ShowsBookingsPage />);
    expect(await screen.findByText("No show dates match the current filters.")).toBeInTheDocument();
    expect(screen.queryByTestId("month-grid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calendar-surface")).not.toBeInTheDocument();
  });
});

/**
 * Plan B Task 3: the setup rail moved out of the cramped 340px grid column into
 * a right-side Sheet, and a dismissed-but-incomplete rail is now re-invokable
 * from a persistent header button (previously there was no way back once
 * "Hide" was clicked). booking_flow must be on for any of this to matter --
 * the page's own gate nulls out the org id (and therefore the rail) otherwise.
 *
 * These tests don't care what the calendar surface renders (its fixture dates
 * are arbitrary and won't fall in the real current month), only that the page
 * has finished loading and mounted the surface — so they wait on the
 * `calendar-surface` testid rather than on any particular chip text.
 */
describe("ShowsBookingsPage — setup checklist uncramp + re-invoke (Plan B Task 3)", () => {
  beforeEach(() => {
    showDatesRef.value = [
      showDate({ id: "sd-1", date: "2020-01-01", show_id: "s1", show: { id: "s1", program: "Past Show", sub_program: null, status: "active", main_cast_slots: 2, understudy_slots: 1 } }),
      showDate({ id: "sd-2", date: "2030-01-01", show_id: "s2", show: { id: "s2", program: "Future Show", sub_program: null, status: "active", main_cast_slots: 2, understudy_slots: 1 } }),
    ];
  });

  it("shows no re-invoke button and no inline callout by default (not dismissed, rail not visible)", async () => {
    featureFlags.value = { booking_flow: true };
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByTestId("calendar-surface");
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("booking-setup-rail")).not.toBeInTheDocument();
    // The hidden mode must not render the collapsed bar either (symmetric with
    // HireOrdersPage's hidden-state test).
    expect(screen.queryByText(/set up in progress/i)).not.toBeInTheDocument();
  });

  it("labels the collapsed bar 'Org setup' for a viewer who cannot edit", async () => {
    // Both other setup tests run with useCan -> true; this exercises the non-editor
    // collapsed label the adapter derives from canEdit.
    featureFlags.value = { booking_flow: true };
    canRef.value = false;
    railState.value = { mode: "collapsed" };
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByTestId("calendar-surface");
    expect(await screen.findByText(/org setup in progress/i)).toBeInTheDocument();
  });

  it("shows a full-width inline callout (not a cramped side column) while setup is incomplete and visible", async () => {
    featureFlags.value = { booking_flow: true };
    railState.value = { mode: "banner" };
    renderWithProviders(<ShowsBookingsPage />);
    expect(await screen.findByText(/get bookings running/i)).toBeInTheDocument();
    // No fixed side-column grid track left anywhere on the page.
    expect(document.querySelector(".lg\\:grid-cols-\\[1fr_340px\\]")).toBeNull();
  });

  it("does not mount the setup rail while entitlements are still loading (no fail-open on default-on booking_flow)", async () => {
    // booking_flow defaults ON, so `features.has('booking_flow')` reads true during the
    // load window; the write-gate must still withhold the rail until loading resolves.
    featureFlags.value = { booking_flow: true };
    railState.value = { mode: "banner" };
    entLoading.value = true;
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByTestId("calendar-surface");
    expect(screen.queryByText(/get bookings running/i)).not.toBeInTheDocument();
  });

  it("opens the checklist Sheet at the clicked step, and drops the old dashed callout button", async () => {
    featureFlags.value = { booking_flow: true };
    railState.value = { mode: "banner" };
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByText(/get bookings running/i);
    // The old dashed "Open checklist" button is gone; each step opens the Sheet in place.
    expect(screen.queryByRole("button", { name: /open checklist/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose flow" }));
    expect(await screen.findByTestId("booking-setup-rail")).toBeInTheDocument();
  });

  it("collapses to a bar, not the checklist button, when dismissed while setup is incomplete", async () => {
    featureFlags.value = { booking_flow: true };
    railState.value = { mode: "collapsed" };
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByTestId("calendar-surface");
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/get bookings running/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/set up in progress/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("the collapsed bar's Resume clears the dismissal so the wizard re-expands", async () => {
    featureFlags.value = { booking_flow: true };
    railState.value = { mode: "collapsed" };
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    renderWithProviders(<ShowsBookingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /resume/i }));
    expect(localStorage.getItem("showflow.bookingSetup.hidden.org-1")).toBeNull();
  });

  it("shows the permanent checklist button once setup is complete, and it opens the Sheet", async () => {
    featureFlags.value = { booking_flow: true };
    railState.value = { mode: "button" };
    bookingSetupStatus.value = makeBookingStatus(5, true);
    renderWithProviders(<ShowsBookingsPage />);
    const btn = await screen.findByRole("button", { name: /setup checklist/i });
    expect(screen.queryByText(/set up in progress/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/get bookings running/i)).not.toBeInTheDocument();
    fireEvent.click(btn);
    expect(await screen.findByTestId("booking-setup-rail")).toBeInTheDocument();
  });
});

/**
 * Task K: STATUS_LABEL (and STATUS_OPTIONS, derived from it) was `useMemo`d on
 * `[t]` only. react-i18next's `t` reference is stable across
 * `i18n.changeLanguage()` calls (only a re-render is triggered), so the memo
 * never recomputed on a real language change and stayed frozen in whatever
 * language was active on first render — reproducing the bug seen when
 * `AppLayout` force-resets a dark-entitlement org to English after i18next
 * initially detected a non-English browser locale.
 */
describe("ShowsBookingsPage — STATUS_LABEL recomputes on language change (Task K)", () => {
  beforeEach(() => {
    showDatesRef.value = [
      showDate({ id: "sd-1", date: "2030-06-20", show_id: "s1" }),
    ];
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("re-renders the status filter options in the new language after i18n.changeLanguage", async () => {
    // Match LanguageProvider's mount-time sync (`detectInitialLang` reads this
    // key): without it, the provider's own effect would immediately revert
    // our `de` back to whatever the browser/localStorage default is.
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    renderWithProviders(<ShowsBookingsPage />);

    fireEvent.click(await screen.findByTestId("add-filter"));
    fireEvent.click(screen.getByTestId("add-filter-option-status"));
    expect(screen.getByTestId("add-filter-status-open")).toHaveTextContent("Offen");

    // Simulate AppLayout's dark-entitlement reset: a direct `i18n.changeLanguage`
    // call, not a LanguageProvider `setLang` (see AppLayout.tsx ~line 89).
    await act(async () => {
      await i18n.changeLanguage("en");
    });

    expect(screen.getByTestId("add-filter-status-open")).toHaveTextContent("Open");
  });
});
