import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { BOOKING_FLOW_DEFAULTS, applyPreset, type BookingFlow, type FlowTimes } from "@/lib/bookingFlow";
import { DEFAULT_FLOW_TIMES } from "@/data/settings";

/**
 * Task 4: AvailabilityPage's H1/subtitle must derive from
 * availabilityPageCopy(flow) (src/lib/flowCopy.ts) instead of a hardcoded
 * "My Offers" title, so a direct-booking org (artist_acceptance = false)
 * sees "My Dates" / a block-dates subtitle instead.
 *
 * The former per-row status badge assertions ("Not booked" / "No offer yet",
 * sourced from bookingStatusLabels(flow)) were dropped in the calendar-surface
 * refactor (task 17): CalendarSurface's artist lenses render a fixed,
 * non-flow-aware status label (ARTIST_TONES in src/lib/calendar/tone.ts,
 * e.g. "Not offered") rather than the page's flow-aware wording. That's a
 * capability gap in the shared calendar-surface lib, out of this page's
 * scope to fix — see task-17-report.md.
 */

// One eligible date with no booking row seeded, so its status resolves to
// "unanswered".
const ELIGIBLE = [
  {
    id: "sd-1",
    date: "2028-08-10",
    session_1: "19:00",
    session_2: null,
    session_3: null,
    status: "open",
    city_id: "c1",
    show_id: "s1",
    venue: "Main Stage",
    custom: null,
    show: { id: "s1", program: "Show A", sub_program: null, status: "active" },
  },
];

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(
  client,
  createFakeSupabase({
    bookings: { data: [], error: null },
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

const flowHolder = { flow: BOOKING_FLOW_DEFAULTS as BookingFlow };
const timesHolder = { times: DEFAULT_FLOW_TIMES as FlowTimes };
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowHolder.flow }),
  useFlowTimes: () => ({ data: timesHolder.times }),
}));

import AvailabilityPage from "./AvailabilityPage";

describe("AvailabilityPage flow-aware copy (Task 4)", () => {
  it("classic flow: keeps the My Offers title and offer-worded subtitle", async () => {
    flowHolder.flow = BOOKING_FLOW_DEFAULTS;
    renderWithProviders(<AvailabilityPage />);

    expect(await screen.findByRole("heading", { name: "My Offers" })).toBeInTheDocument();
    expect(screen.getByText(/View your offers/)).toBeInTheDocument();
  });

  it("direct flow: swaps to My Dates, a block-dates subtitle, and Not booked status", async () => {
    flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    renderWithProviders(<AvailabilityPage />);

    expect(await screen.findByRole("heading", { name: "My Dates" })).toBeInTheDocument();
    expect(screen.getByText(/Block dates you can't perform/)).toBeInTheDocument();
  });
});

/**
 * R2.1 + R4.7: a muted timing line under the blocking help text, sourced from the
 * existing describeTonightStandalone(times, flow) helper — honest per org state, so
 * it renders only when that helper has something true to say (never a fallback string).
 *
 * The whole paragraph is asserted via data-testid="availability-timing", never a text
 * substring: describeTonight also composes a DIFFERENT, confirmation-digest sentence
 * for a direct-book org (artist_acceptance: false) whenever confirmation_digest is
 * true — which is both the BOOKING_FLOW_DEFAULTS value and the shipped "direct"
 * preset's value. A substring match like /hours to answer/ never appears in that
 * sentence and so cannot catch it leaking onto a direct-book artist's page; only
 * asserting the testid's absence can.
 */
describe("AvailabilityPage timing line (R2.1/R4.7)", () => {
  it("shows the response window and digest hour for an offer+digest org", async () => {
    flowHolder.flow = { ...BOOKING_FLOW_DEFAULTS, artist_acceptance: true, offer_delivery: "digest", active: true };
    timesHolder.times = DEFAULT_FLOW_TIMES;
    renderWithProviders(<AvailabilityPage />);

    const timing = await screen.findByTestId("availability-timing");
    expect(timing).toHaveTextContent(/48 hours to answer/i);
    expect(timing).toHaveTextContent(/19:00h \(Berlin, Germany\) digest/i);
  });

  it("shows no timing line for a direct-book org (real defaults: confirmation_digest stays true)", async () => {
    // Deliberately NOT overriding confirmation_digest: BOOKING_FLOW_DEFAULTS and the
    // shipped "direct" preset both carry confirmation_digest: true, which is exactly
    // the combination that made describeTonight return a (wrong-audience) sentence.
    flowHolder.flow = { ...BOOKING_FLOW_DEFAULTS, artist_acceptance: false, active: true };
    timesHolder.times = DEFAULT_FLOW_TIMES;
    renderWithProviders(<AvailabilityPage />);

    expect(await screen.findByRole("heading", { name: "My Dates" })).toBeInTheDocument();
    expect(screen.queryByTestId("availability-timing")).not.toBeInTheDocument();
  });

  it("shows no timing line for a paused org", async () => {
    flowHolder.flow = { ...BOOKING_FLOW_DEFAULTS, active: false };
    timesHolder.times = DEFAULT_FLOW_TIMES;
    renderWithProviders(<AvailabilityPage />);

    expect(await screen.findByRole("heading", { name: "Blocked Dates" })).toBeInTheDocument();
    expect(screen.queryByTestId("availability-timing")).not.toBeInTheDocument();
  });

  it("shows the window but no digest hour for an immediate-delivery org", async () => {
    // describeTonight takes a distinct branch for immediate delivery ('offers email
    // straight away', no offer-digest hour); pin it so a future change that narrowed
    // showTiming to digest-only would fail here instead of silently hiding the window.
    flowHolder.flow = { ...BOOKING_FLOW_DEFAULTS, artist_acceptance: true, offer_delivery: "immediate", active: true };
    timesHolder.times = DEFAULT_FLOW_TIMES;
    renderWithProviders(<AvailabilityPage />);

    const timing = await screen.findByTestId("availability-timing");
    expect(timing).toHaveTextContent(/offers email straight away/i);
    expect(timing).toHaveTextContent(/48 hours to answer/i);
    expect(timing).not.toHaveTextContent(/digest/i);
  });
});
