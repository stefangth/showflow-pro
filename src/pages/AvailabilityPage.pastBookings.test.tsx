import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * Finding 3 regression: the calendar-surface rewrite of AvailabilityPage
 * (Task 17) fed `artistEntries` only from `useArtistEligibleDates`, which is
 * upcoming-only — so a past confirmed booking (and its hire-order link)
 * silently dropped off the artist's calendar. This mirrors
 * ArtistBookingsView.pastBookings.test.tsx's regression coverage, re-expressed
 * against the All dates lens: `fetchMyActiveBookedDates` is merged into
 * `artistEntries` so the past date still renders, with the same hire-order
 * link the old table view surfaced.
 */

// No upcoming eligible dates at all — isolates the merged past-booking row.
const ELIGIBLE: unknown[] = [];
const PAST_DATE = "2026-01-15"; // strictly before the real system clock's "today"

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(
  client,
  createFakeSupabase({
    // Backs both AvailabilityPage's own `myBookings` query (flat shape) and
    // `fetchMyActiveBookedDates` (needs the show_date join) — the fake matches
    // on `.eq()` args only, not on select shape or `.neq()`.
    bookings: [
      {
        when: { artist_id: "artist-1" },
        data: [
          {
            id: "bk-1",
            show_date_id: "d-past",
            status: "confirmed",
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
vi.mock("@/components/minis/PageMini", () => ({ PageMini: () => null }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));
vi.mock("@/hooks/useMyArtist", () => ({
  useMyArtist: () => ({ data: { id: "artist-1" } }),
}));
vi.mock("@/hooks/useArtistEligibleDates", () => ({
  useArtistEligibleDates: () => ({ data: ELIGIBLE, isLoading: false }),
}));
// hire_orders + booking_flow both on, so the past confirmed date's hire-order
// link resolves and the active-booked query isn't gated off.
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: () => true,
}));
vi.mock("@/hooks/useHireOrders", () => ({
  useMyHireOrders: () => ({ data: [{ id: "ho-1", show_date_id: "d-past" }] }),
}));

import AvailabilityPage from "./AvailabilityPage";

describe("AvailabilityPage — past active booking merge (calendar surface)", () => {
  it("shows a past confirmed date in All dates, with its hire-order link", async () => {
    renderWithProviders(<AvailabilityPage />);

    // Switch to the All dates lens — the past row isn't in Offers (nothing to
    // answer) or the current Month view (it's a past date).
    fireEvent.click(await screen.findByRole("tab", { name: "All dates" }));

    const row = await screen.findByTestId("all-dates-row-d-past");
    expect(row).toHaveTextContent("Show A");
    expect(row).toHaveTextContent("Old Hall");

    const link = screen.getByTestId("all-dates-link-d-past");
    expect(link).toHaveAttribute("href", "/hire-orders/ho-1");
  });
});
