import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  return React.createElement(
    QueryClientProvider,
    { client: qc },
    React.createElement(TooltipProvider, null, children),
  );
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

/**
 * ArtistAvailabilityCalendar renders its own bespoke month grid rather than
 * the shadcn `Calendar` that EntityCalendar (Shows&Bookings / Bookings) uses,
 * so it never picked up the shared `PAST_DATE_TINT` past-date dimming those
 * calendars get from DayPicker's `modifiersClassNames`. Past days here must
 * be visibly dimmed but never made non-interactive (no `pointer-events-none`,
 * no `disabled`), matching that same "dimmed but clickable" contract.
 */
describe("ArtistAvailabilityCalendar — past-date tint (Plan B Task 3)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  function eligible(date: string) {
    return {
      id: `sd-${date}`,
      date,
      session_1: null,
      session_2: null,
      session_3: null,
      status: "open",
      city_id: null,
      show_id: "show-1",
      venue: null,
      custom: null,
      show: { id: "show-1", program: "Test Show", sub_program: null, status: "active" },
    };
  }

  it("tints a past eligible day with the past-date class and leaves a future eligible day untinted", async () => {
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));

    render(
      React.createElement(ArtistAvailabilityCalendar, {
        artistId: "artist-1",
        eligibleDates: [eligible("2026-03-10"), eligible("2026-03-20")],
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText("10")).toBeTruthy();
    });

    const pastCell = screen.getByText("10").closest("button")!;
    const futureCell = screen.getByText("20").closest("button")!;

    expect(pastCell.className).toMatch(/opacity-60/);
    expect(futureCell.className).not.toMatch(/opacity-60/);
  });

  it("keeps a past eligible day fully interactive (not disabled, no pointer-events-none)", async () => {
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));

    render(
      React.createElement(ArtistAvailabilityCalendar, {
        artistId: "artist-1",
        eligibleDates: [eligible("2026-03-10")],
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText("10")).toBeTruthy();
    });

    const pastCell = screen.getByText("10").closest("button")!;
    expect(pastCell).not.toBeDisabled();
    expect(pastCell.className).not.toMatch(/pointer-events-none/);
  });
});

/**
 * R3.4 + R3.5: an ineligible day gives no reason it's disabled (no title/aria-label
 * on its non-interactive wrapper), and an artist with zero eligible dates sees a
 * bare grid with no explanation that nothing is offered yet.
 */
describe("ArtistAvailabilityCalendar — ineligible-day explanation + empty state (R3.4/R3.5)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  function eligible(date: string) {
    return {
      id: `sd-${date}`,
      date,
      session_1: null,
      session_2: null,
      session_3: null,
      status: "open",
      city_id: null,
      show_id: "show-1",
      venue: null,
      custom: null,
      show: { id: "show-1", program: "Test Show", sub_program: null, status: "active" },
    };
  }

  // Both the mouse-hover title and the screen-reader-only text must name skills as
  // well as casts: useArtistEligibleDates filters by cast membership AND by unmet
  // hard skill requirements, so "offered dates come from your casts" alone is an
  // inaccurate (half the story) explanation for why a day is disabled.
  const INELIGIBLE_REASON =
    "This date is not offered to you. Offered dates come from your casts and their required skills.";

  it("labels an ineligible day with why it is disabled, for sighted and assistive-tech users alike", async () => {
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));

    render(
      React.createElement(ArtistAvailabilityCalendar, {
        artistId: "artist-1",
        // Only the 20th is eligible, so every other day in March renders ineligible.
        eligibleDates: [eligible("2026-03-20")],
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText("10")).toBeTruthy();
    });

    // Mouse hover: a title attribute on the non-interactive wrapper (one per ineligible cell).
    expect(document.querySelector(`[title="${INELIGIBLE_REASON}"]`)).toBeTruthy();
    // Assistive tech: the reason is stated ONCE for the whole grid (a single sr-only note
    // after the legend), not repeated as a text node on every disabled cell.
    expect(
      screen.getByText(
        /dimmed dates are not offered to you\. offered dates come from your casts and their required skills\./i,
      ),
    ).toBeInTheDocument();
    // The per-cell full sentence is no longer a repeated text node (only the hover title).
    expect(screen.queryByText(INELIGIBLE_REASON)).not.toBeInTheDocument();
    // With at least one eligible date, the "Eligible" legend entry is shown.
    expect(screen.getByText("Eligible")).toBeInTheDocument();
  });

  it("shows an empty state when there are zero eligible dates", async () => {
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));

    render(
      React.createElement(ArtistAvailabilityCalendar, {
        artistId: "artist-1",
        eligibleDates: [],
      }),
      { wrapper }
    );

    expect(
      await screen.findByText(/no eligible dates yet\. once you are added to a cast/i)
    ).toBeInTheDocument();
    // With nothing eligible, the "Eligible" legend swatch (which would match no cell)
    // is hidden so the legend does not advertise a state the grid never shows.
    expect(screen.queryByText("Eligible")).not.toBeInTheDocument();
  });
});
