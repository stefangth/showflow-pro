import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { ArtistAvailabilityCalendar } from "./ArtistAvailabilityCalendar";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockResolvedValue({ data: [], error: null }),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

// Avoid pulling popover internals into the snapshot — we only care about the
// month grid structure here.
vi.mock("@/components/availability/AvailabilityPicker", () => ({
  AvailabilityPicker: () => null,
}));
vi.mock("@/components/availability/OfferResponseButtons", () => ({
  OfferResponseButtons: () => null,
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

/**
 * ArtistAvailabilityCalendar renders its own month grid (not shadcn Calendar)
 * and uses `(monthStart.getDay() + 6) % 7` for the Monday-based lead pad.
 * These tests pin different first-of-month weekdays to verify the pad count
 * across month boundaries (Risk 15).
 */
describe("ArtistAvailabilityCalendar — Monday-first lead pad", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    // Only fake `Date`, not timers — react-query needs microtasks/timeouts
    // to resolve, and faking them all causes async queries to hang.
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  it("renders weekday headers in Mon..Sun order", async () => {
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));

    render(
      React.createElement(ArtistAvailabilityCalendar, {
        artistId: "artist-1",
        eligibleDates: [],
      }),
      { wrapper }
    );

    const headers = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    await waitFor(() => {
      headers.forEach((h) => expect(screen.getByText(h)).toBeTruthy());
    });

    // Order: querying the explicit weekday cells in DOM order must match.
    const grid = screen.getByText("Mon").parentElement!;
    const labels = Array.from(grid.children).map((c) => c.textContent?.trim());
    expect(labels).toEqual(headers);
  });

  it.each([
    // [first-of-month date, expected lead-pad count]
    // 2026-03-01 is Sunday → (0 + 6) % 7 = 6 leading pads
    ["2026-03-15T12:00:00Z", 6],
    // 2026-04-01 is Wednesday → (3 + 6) % 7 = 2 leading pads
    ["2026-04-15T12:00:00Z", 2],
    // 2026-06-01 is Monday → (1 + 6) % 7 = 0 leading pads
    ["2026-06-15T12:00:00Z", 0],
    // 2026-08-01 is Saturday → (6 + 6) % 7 = 5 leading pads
    ["2026-08-15T12:00:00Z", 5],
  ])(
    "renders the correct leading pad count for the month containing %s",
    async (today, expectedPad) => {
      vi.setSystemTime(new Date(today));

      const { container } = render(
        React.createElement(ArtistAvailabilityCalendar, {
          artistId: "artist-1",
          eligibleDates: [],
        }),
        { wrapper }
      );

      await waitFor(() => {
        // The day grid is the second `grid-cols-7` block in the card body.
        const grids = container.querySelectorAll(".grid-cols-7");
        expect(grids.length).toBeGreaterThanOrEqual(2);
      });

      const grids = container.querySelectorAll(".grid-cols-7");
      const dayGrid = grids[1];
      // Pads are empty <div /> placeholders with key="pad-<i>" — they have
      // no other content, so we count empty direct-child divs preceding the
      // first button (day cell or popover trigger).
      const children = Array.from(dayGrid.children);
      const firstDayIdx = children.findIndex(
        (c) => c.querySelector("button") !== null
      );

      expect(firstDayIdx).toBe(expectedPad);
    }
  );
});
