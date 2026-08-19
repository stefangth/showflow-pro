import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { BOOKING_FLOW_DEFAULTS, applyPreset, type BookingFlow, type FlowTimes } from "@/lib/bookingFlow";
import { DEFAULT_FLOW_TIMES } from "@/data/settings";
import i18n from "@/i18n";

/**
 * Task 4 (superseded by the screen-08 redesign): AvailabilityPage's H1 used to
 * derive from availabilityPageCopy(flow) (src/lib/flowCopy.ts), swapping "My
 * Offers" for "My Dates" on a direct-booking org (artist_acceptance = false).
 * The redesign replaced that flow-aware H1 with a fixed headline
 * (`availability:firstRun.headline`, rendered by AvailabilityFirstRun) — the
 * flow-awareness moved into the "How booking works here" rules card instead:
 * `firstRun.rules.offersBody` ("One digest at {{time}}...") for an
 * offers-by-email org vs `firstRun.rules.offersBodyDirect` ("You are booked
 * directly...") for a direct-book org. The describe block below asserts that
 * relocated copy rather than the removed title.
 *
 * The former per-row status badge assertions ("Not booked" / "No offer yet",
 * sourced from bookingStatusLabels(flow)) were dropped in the calendar-surface
 * refactor (task 17): CalendarSurface's artist lenses rendered a fixed,
 * non-flow-aware status label (ARTIST_TONES in src/lib/calendar/tone.ts,
 * e.g. "Not offered") rather than the page's flow-aware wording — a flagged
 * capability gap, see task-17-report.md. Task 18 closed that gap (an optional
 * `statusLabels` override threaded through CalendarSurface into the artist
 * lenses/rail); the reinstated coverage lives in the describe block below.
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

describe("AvailabilityPage flow-aware copy (Task 4, relocated by the screen-08 redesign)", () => {
  it("offers-by-email flow: fixed headline renders, with the offers-digest rules copy (not the direct-book copy)", async () => {
    flowHolder.flow = BOOKING_FLOW_DEFAULTS;
    renderWithProviders(<AvailabilityPage />);

    expect(await screen.findByRole("heading", { name: i18n.t("availability:firstRun.headline") })).toBeInTheDocument();
    expect(screen.getByText(/One daily send at/)).toBeInTheDocument();
    expect(screen.queryByText(/booked directly/)).not.toBeInTheDocument();
  });

  it("direct flow: fixed headline renders, with the direct-book rules copy", async () => {
    flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    renderWithProviders(<AvailabilityPage />);

    expect(await screen.findByRole("heading", { name: i18n.t("availability:firstRun.headline") })).toBeInTheDocument();
    expect(screen.getByText(/booked directly/)).toBeInTheDocument();
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
    expect(timing).toHaveTextContent(/19:00h \(Berlin, Germany\) send/i);
  });

  it("shows no timing line for a direct-book org (real defaults: confirmation_digest stays true)", async () => {
    // Deliberately NOT overriding confirmation_digest: BOOKING_FLOW_DEFAULTS and the
    // shipped "direct" preset both carry confirmation_digest: true, which is exactly
    // the combination that made describeTonight return a (wrong-audience) sentence.
    flowHolder.flow = { ...BOOKING_FLOW_DEFAULTS, artist_acceptance: false, active: true };
    timesHolder.times = DEFAULT_FLOW_TIMES;
    renderWithProviders(<AvailabilityPage />);

    expect(await screen.findByRole("heading", { name: i18n.t("availability:firstRun.headline") })).toBeInTheDocument();
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
    expect(timing).toHaveTextContent(/asks email straight away/i);
    expect(timing).toHaveTextContent(/48 hours to answer/i);
    expect(timing).not.toHaveTextContent(/digest/i);
  });
});

/**
 * Task 18: closes the flow-aware-wording gap flagged in task-17-report.md.
 * ELIGIBLE's one date has no booking row, so its artist status resolves to
 * 'unanswered'. The Offers lens (the default landing lens) never renders an
 * 'unanswered' status badge at all — those dates sit in its unlabeled
 * "not offered yet" list — so this asserts against the All dates lens, which
 * shows every eligible date's status pill regardless of state.
 */
describe("AvailabilityPage calendar-surface flow-aware status wording (Task 18)", () => {
  it("direct flow: the All dates lens shows the flow-aware wording, not the fixed ARTIST_TONES default", async () => {
    flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    renderWithProviders(<AvailabilityPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "All dates" }));

    const row = await screen.findByTestId("all-dates-row-sd-1");
    // "Not asked yet" is statusLabels.direct.unanswered (src/lib/flowCopy.ts); the
    // fixed ARTIST_TONES.unanswered.label this replaces is "Not offered".
    expect(row).toHaveTextContent("Not asked yet");
    expect(row).not.toHaveTextContent("Not offered");
  });
});
