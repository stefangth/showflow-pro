import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * AvailabilityPage defaults to All time and merges the artist's past active
 * bookings (`fetchMyActiveBookedDates`) into the rendered set, since
 * `useArtistEligibleDates` only ever returns upcoming show_dates. A past
 * merged row shows by default, is read-only (no AvailabilityPicker /
 * OfferResponseButtons — past dates aren't actionable for availability
 * declaration) and grayed via PAST_DATE_TINT; switching to Upcoming hides it.
 */

const ELIGIBLE: unknown[] = [];
const PAST_DATE = "2026-01-15"; // strictly before the real system clock's "today"

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(
  client,
  createFakeSupabase({
    // Backs both AvailabilityPage's own `myBookings` query (flat shape) and
    // the new fetchMyActiveBookedDates query (needs the show_date join) — the
    // fake matches on `.eq()` args only, not select shape.
    bookings: [
      {
        when: { artist_id: "artist-1" },
        data: [
          {
            id: "bk-1",
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
              show: { program: "Show A", sub_program: null },
            },
          },
        ],
        error: null,
      },
    ],
    blocked_dates: { data: [], error: null },
  }),
);

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));
vi.mock("@/hooks/useMyArtist", () => ({
  useMyArtist: () => ({ data: { id: "artist-1" } }),
}));
vi.mock("@/hooks/useArtistEligibleDates", () => ({
  useArtistEligibleDates: () => ({ data: ELIGIBLE, isLoading: false }),
}));

vi.mock("@/features/editor/EditorContext", () => ({
  useColumnTemplate: () => ({
    orderedColumns: [
      { columnId: "show_dates.date", visible: true, order: 0 },
      { columnId: "show_dates.venue", visible: true, order: 1 },
      { columnId: "_computed.my_status", visible: true, order: 2 },
      { columnId: "_computed.blocked", visible: true, order: 3 },
    ],
    visibleCount: 4,
  }),
  useEditorConfig: () => ({ isEditorMode: false, getColumnLabel: (id: string) => id }),
}));
vi.mock("@/features/editor/useColumnHeaders", () => ({
  useColumnHeaders: () => [
    { columnId: "show_dates.date", headerLabel: "Date" },
    { columnId: "show_dates.venue", headerLabel: "Venue" },
    { columnId: "_computed.my_status", headerLabel: "Status" },
    { columnId: "_computed.blocked", headerLabel: "Availability" },
  ],
}));
vi.mock("@/features/editor/ColumnLayoutEditor", () => ({ ColumnLayoutEditor: () => null }));

import AvailabilityPage from "./AvailabilityPage";

describe("AvailabilityPage — past active booking merge (Plan B Task 2)", () => {
  it("shows the past soft_booked booking by default (All time), grayed and read-only", async () => {
    renderWithProviders(<AvailabilityPage />);

    // The artist view defaults to All time, so a past hold is visible without
    // touching the filter.
    const venueCell = await screen.findByText("Old Hall");
    const row = venueCell.closest("tr")!;
    expect(row.className).toMatch(/opacity-60/);
    expect(row.className).not.toMatch(/pointer-events-none/);

    // Read-only: no interactive availability control for a past row.
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /available|unavailable/i })).not.toBeInTheDocument();
  });

  it("hides the past soft_booked booking when the Upcoming preset is selected", async () => {
    renderWithProviders(<AvailabilityPage />);
    // Visible by default (All time)...
    await screen.findByText("Old Hall");

    // ...but switching to Upcoming excludes the past row (trigger reads "Any time").
    fireEvent.click(screen.getByRole("button", { name: /^Any time$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Upcoming" }));

    await screen.findByText(/no eligible dates yet/i);
    expect(screen.queryByText("Old Hall")).not.toBeInTheDocument();
  });
});
