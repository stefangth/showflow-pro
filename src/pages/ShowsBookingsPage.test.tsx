import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
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
 *    cell's own `isPast` styling (`bg-well-tint`) rather than being hidden.
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
// Settable stand-ins for the split-button import options (below): the caller's roles,
// the router's navigate spy, the org's dates source, and the Airtable console's
// connection + sync spy. Defaults keep every pre-existing test unchanged (producer,
// no source, disconnected Airtable).
const { authRef, navigateSpy, datesSourceRef, airtableReadyRef, sheetRef } = vi.hoisted(() => ({
  authRef: { value: { roles: ["producer"] as string[] } },
  navigateSpy: vi.fn(),
  datesSourceRef: { value: null as null | "airtable" | "sheet" | "manual" },
  airtableReadyRef: { value: false },
  sheetRef: { value: { settings: { url: "", map: {} } } },
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
  useAuth: () => ({ hasRole: (r: string) => authRef.value.roles.includes(r), currentOrg: { id: "org-1" } }),
}));
vi.mock("@/hooks/useDatesSource", () => ({
  useDatesSource: () => ({ source: datesSourceRef.value, isLoading: false, save: vi.fn(), saving: false }),
}));
vi.mock("@/hooks/useAirtableDatesReady", () => ({
  useAirtableDatesReady: () => airtableReadyRef.value,
}));
vi.mock("@/hooks/useSheetImport", () => ({
  useSheetImport: () => sheetRef.value,
}));
// v3 is the app default now; pin it off so the finish-setup affordance test genuinely
// exercises the v1 path (this page's supabase mock has no `.from`, so the flag query can
// not resolve a real value here).
vi.mock("@/hooks/useGetRunningV3Enabled", () => ({ useGetRunningV3Enabled: () => ({ enabled: false, isLoading: false }) }));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => navigateSpy,
}));
vi.mock("@/data/showDates", async (orig) => ({
  ...(await orig<typeof import("@/data/showDates")>()),
  fetchShowDatesList: () => Promise.resolve(showDatesRef.value),
}));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchBookingCountsByDate: () => Promise.resolve(new Map()),
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
  authRef.value = { roles: ["producer"] };
  datesSourceRef.value = null;
  airtableReadyRef.value = false;
  sheetRef.value = { settings: { url: "", map: {} } };
  navigateSpy.mockClear();
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

    // Match the exact `bg-well-tint` class token — the cell also carries an
    // unrelated `hover:bg-hover-tint` class that a loose /bg-.*-tint/ regex
    // would false-match on every cell, past or future.
    const futureChip = await screen.findByText("Future Show");
    const futureCell = futureChip.closest('[data-testid^="month-grid-cell-"]')!;
    expect(futureCell.classList.contains("bg-well-tint")).toBe(false);

    const pastChip = screen.getByText("Past Show");
    const pastCell = pastChip.closest('[data-testid^="month-grid-cell-"]')!;
    expect(pastCell.classList.contains("bg-well-tint")).toBe(true);

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

  it("v3 off: no finish-setup affordance in the producer header", async () => {
    showDatesRef.value = [];
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByText("No show dates match the current filters.");
    expect(screen.queryByRole("link", { name: /finish setup/i })).not.toBeInTheDocument();
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

/**
 * "New date" split button (Option A): the primary click still opens the manual
 * ShowDateFormDialog, and a chevron menu surfaces the two existing import flows
 * (Airtable, sheet). Routing rules: once a source is set up, its item opens that
 * source's importer/import settings (Airtable → Settings, sheet → the Get Running
 * connect step); otherwise it routes into Get Running to set the source up.
 */
describe("ShowsBookingsPage — New date split button import options", () => {
  beforeEach(() => {
    showDatesRef.value = [showDate({ id: "sd-1", date: "2030-06-20", show_id: "s1" })];
  });

  // Radix's DropdownMenuTrigger opens on pointerdown or Enter/Space, not a plain
  // synthetic click; jsdom has no PointerEvent, so use the keyboard path.
  async function openMenu() {
    fireEvent.keyDown(await screen.findByRole("button", { name: "More ways to add dates" }), { key: "Enter" });
  }

  it("surfaces by-hand, Airtable, and sheet in the chevron menu", async () => {
    renderWithProviders(<ShowsBookingsPage />);
    await openMenu();
    expect(await screen.findByText("New date by hand")).toBeInTheDocument();
    expect(screen.getByText("Import from Airtable")).toBeInTheDocument();
    expect(screen.getByText("Import from sheet")).toBeInTheDocument();
  });

  it("routes Airtable import to setup when the org's Airtable source is not connected", async () => {
    datesSourceRef.value = "airtable";
    airtableReadyRef.value = false;
    renderWithProviders(<ShowsBookingsPage />);
    await openMenu();
    fireEvent.click(await screen.findByText("Import from Airtable"));
    expect(navigateSpy).toHaveBeenCalledWith("/get-running");
  });

  it("opens the Airtable import settings once the Airtable source is set up", async () => {
    datesSourceRef.value = "airtable";
    airtableReadyRef.value = true;
    renderWithProviders(<ShowsBookingsPage />);
    await openMenu();
    fireEvent.click(await screen.findByText("Import from Airtable"));
    expect(navigateSpy).toHaveBeenCalledWith("/settings?tab=airtable");
  });

  it("routes sheet import to setup when no sheet is configured", async () => {
    datesSourceRef.value = "sheet";
    sheetRef.value = { settings: { url: "", map: {} } };
    renderWithProviders(<ShowsBookingsPage />);
    await openMenu();
    fireEvent.click(await screen.findByText("Import from sheet"));
    expect(navigateSpy).toHaveBeenCalledWith("/get-running");
  });

  it("opens the sheet importer once a sheet is configured", async () => {
    datesSourceRef.value = "sheet";
    sheetRef.value = { settings: { url: "https://docs.google.com/spreadsheets/d/x/pub?output=csv", map: {} } };
    renderWithProviders(<ShowsBookingsPage />);
    await openMenu();
    fireEvent.click(await screen.findByText("Import from sheet"));
    expect(navigateSpy).toHaveBeenCalledWith("/get-running?step=connect");
  });
});
