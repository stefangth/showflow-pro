import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * Plan B Task 2 — regression test for the July 31 bug: an artist's past
 * `soft_booked` booking was invisible on this view because
 * `useArtistEligibleDates` only returns UPCOMING show_dates, and the view had
 * nothing else feeding it past dates. `fetchMyActiveBookedDates` (Task 1) now
 * gets merged in so a past active booking surfaces under Past/All, grayed via
 * PAST_DATE_TINT, and stays hidden under the new default (Upcoming).
 */

// No upcoming eligible dates at all — isolates the merged past-booking row.
const ELIGIBLE: unknown[] = [];

const PAST_DATE = "2026-01-15"; // strictly before the real system clock's "today"

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(
  client,
  createFakeSupabase({
    // Backs two reads on `bookings`: fetchMyCancelledDateBookings (filters this
    // row out client-side because the joined show_date.status below is "open",
    // not "cancelled") and fetchMyActiveBookedDates (needs the show_date join;
    // also now the sole source of `bookingByDateId`, since Plan B Task 5
    // removed the view's separate flat `myBookings` query). One seeded row
    // serves both since the fake matches on `.eq()` args only, not on select
    // shape or `.neq()`.
    bookings: [
      {
        when: { artist_id: "artist-1" },
        data: [
          {
            show_date_id: "d-past",
            status: "soft_booked",
            is_understudy: false,
            show_date: {
              id: "d-past",
              date: PAST_DATE,
              venue: "Old Hall",
              session_1: "19:00:00",
              session_2: null,
              session_3: null,
              status: "open",
              show: { program: "Show A", sub_program: null },
            },
          },
        ],
        error: null,
      },
    ],
  }),
);

vi.mock("@/hooks/useMyArtist", () => ({
  useMyArtist: () => ({ data: { id: "artist-1" } }),
}));
vi.mock("@/hooks/useArtistEligibleDates", () => ({
  useArtistEligibleDates: () => ({ data: ELIGIBLE, isLoading: false }),
}));
vi.mock("@/hooks/useEntitlements", () => {
  const useFeature = () => true;
  return { useFeature, useModuleGate: () => ({ allow: true, pending: false }) };
});
vi.mock("@/hooks/useHireOrders", () => ({
  useMyHireOrders: () => ({ data: [] }),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }),
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));

vi.mock("@/features/editor/EditorContext", () => ({
  useColumnTemplate: () => ({
    orderedColumns: [
      { columnId: "show_dates.date", visible: true, order: 0 },
      { columnId: "show_dates.venue", visible: true, order: 1 },
      { columnId: "_computed.my_status", visible: true, order: 2 },
    ],
    visibleCount: 3,
  }),
  useEditorConfig: () => ({ isEditorMode: false, getColumnLabel: (id: string) => id }),
}));
vi.mock("@/features/editor/useColumnHeaders", () => ({
  useColumnHeaders: () => [
    { columnId: "show_dates.date", headerLabel: "Date" },
    { columnId: "show_dates.venue", headerLabel: "Venue" },
    { columnId: "_computed.my_status", headerLabel: "Status" },
  ],
}));
vi.mock("@/features/editor/ColumnLayoutEditor", () => ({ ColumnLayoutEditor: () => null }));

// A minimal stand-in that reports whether/what it was opened with, so the
// "still clickable" assertion can verify the row's onClick actually fired.
vi.mock("@/components/shows/ShowDateDetailSheet", () => ({
  ShowDateDetailSheet: ({ showDateId, open }: { showDateId: string | null; open: boolean }) => (
    <div data-testid="detail-sheet" data-show-date-id={showDateId ?? ""} data-open={String(open)} />
  ),
}));

import { ArtistBookingsView } from "./ArtistBookingsView";

describe("ArtistBookingsView — past active booking merge (July 31 regression)", () => {
  it("hides the past soft_booked booking under the default (Upcoming) timeframe", async () => {
    renderWithProviders(<ArtistBookingsView />);
    await screen.findByText(/no eligible dates yet/i);
    expect(screen.queryByText("Old Hall")).not.toBeInTheDocument();
    expect(screen.queryByText("15/01/2026")).not.toBeInTheDocument();
  });

  it("reveals the past soft_booked booking, grayed, when Past/All is selected — and it stays clickable", async () => {
    renderWithProviders(<ArtistBookingsView />);
    await screen.findByText(/no eligible dates yet/i);

    // Open the timeframe popover (trigger reads "Upcoming" by default) and
    // switch to "Any time" so the past row is no longer excluded.
    fireEvent.click(screen.getByRole("button", { name: /Upcoming/ }));
    fireEvent.click(screen.getByRole("button", { name: "Any time" }));

    const dateCell = await screen.findByText("15/01/2026");
    expect(screen.getByText("Old Hall")).toBeInTheDocument();
    expect(screen.getByText("Hold placed")).toBeInTheDocument();

    // Grayed but interactive: PAST_DATE_TINT on the row, no pointer-events change.
    const row = dateCell.closest("tr");
    expect(row).toBeTruthy();
    expect(row!.className).toMatch(/opacity-60/);
    expect(row!.className).not.toMatch(/pointer-events-none/);

    // Still clickable: opens the detail sheet for this show_date.
    fireEvent.click(row!);
    const sheet = screen.getByTestId("detail-sheet");
    expect(sheet.getAttribute("data-show-date-id")).toBe("d-past");
    expect(sheet.getAttribute("data-open")).toBe("true");
  });

  it("also reveals it under the Past preset specifically", async () => {
    renderWithProviders(<ArtistBookingsView />);
    await screen.findByText(/no eligible dates yet/i);

    fireEvent.click(screen.getByRole("button", { name: /Upcoming/ }));
    fireEvent.click(screen.getByRole("button", { name: "Past" }));

    expect(await screen.findByText("15/01/2026")).toBeInTheDocument();
  });
});
