import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { BOOKING_FLOW_DEFAULTS, applyPreset, type BookingFlow } from "@/lib/bookingFlow";

/**
 * Task 4: ArtistBookingsView's subtitle and per-row status badge must derive
 * from bookingsViewCopy(flow) / bookingStatusLabels(flow) (src/lib/flowCopy.ts)
 * instead of the hardcoded offer-worded subtitle and the local STATUS_LABEL
 * map, so a direct-booking org (artist_acceptance = false) sees a
 * booked-worded subtitle and "Booked" / "Not booked" instead of
 * "Confirmed" / "No offer yet".
 */

// Two eligible dates: d1 has a confirmed booking, d2 has none (unbooked).
const ELIGIBLE = [
  {
    id: "d1",
    date: "2028-08-10",
    session_1: "19:00",
    session_2: null,
    session_3: null,
    status: "open",
    city_id: "c1",
    show_id: "s1",
    venue: "Stage 1",
    custom: null,
    show: { id: "s1", program: "Show A", sub_program: null, status: "active" },
  },
  {
    id: "d2",
    date: "2028-08-11",
    session_1: "19:00",
    session_2: null,
    session_3: null,
    status: "open",
    city_id: "c1",
    show_id: "s1",
    venue: "Stage 1",
    custom: null,
    show: { id: "s1", program: "Show A", sub_program: null, status: "active" },
  },
];

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(
  client,
  createFakeSupabase({
    // Backs both fetchMyCancelledDateBookings and fetchMyActiveBookedDates
    // (both read the `bookings` table; the dedicated `myBookings` query this
    // view used to run in parallel was removed -- Plan B Task 5). The row's
    // `show_date` join is required for fetchMyActiveBookedDates to resolve it
    // at all (it drops any row with no joined show_date), which is what makes
    // d1's "confirmed" status reach `bookingByDateId` below. Its `show_date`
    // carries no `status` field, so fetchMyCancelledDateBookings (which only
    // keeps rows whose joined show_date.status is "cancelled") still resolves
    // to an empty cancelled list, same as before this join was added.
    bookings: [
      {
        when: { artist_id: "artist-1" },
        data: [
          {
            id: "bk-1", artist_id: "artist-1", show_date_id: "d1", status: "confirmed", is_understudy: false,
            show_date: {
              id: "d1", date: "2028-08-10", venue: "Stage 1",
              session_1: "19:00", session_2: null, session_3: null,
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
// Task 14 added a hire-orders chip gated on useFeature; this file only cares
// about flow-driven copy, so keep that feature off (no hire_orders table is
// seeded here anyway, so the chip would never show regardless). Task 4 added
// a booking_flow gate around the whole list/calendar region, so that one
// must stay on independently or every assertion below (which reads the
// gated table) would see the module notice instead.
vi.mock("@/hooks/useEntitlements", () => {
  const useFeature = (feature: string) => feature === "booking_flow";
  // ModuleGate reads useModuleGate; derive it from the same rule so the two stay in step.
  return { useFeature, useModuleGate: (f: string) => ({ allow: useFeature(f), pending: false }) };
});

// Keep the list column machinery minimal but include the status column so the
// per-row status badge (bookingStatusLabels) actually renders.
vi.mock("@/features/editor/EditorContext", () => ({
  useColumnTemplate: () => ({
    orderedColumns: [
      { columnId: "show_dates.date", visible: true, order: 0 },
      { columnId: "_computed.my_status", visible: true, order: 1 },
    ],
    visibleCount: 2,
  }),
  useEditorConfig: () => ({ isEditorMode: false, getColumnLabel: (id: string) => id }),
}));
vi.mock("@/features/editor/useColumnHeaders", () => ({
  useColumnHeaders: () => [
    { columnId: "show_dates.date", headerLabel: "Date" },
    { columnId: "_computed.my_status", headerLabel: "Status" },
  ],
}));
vi.mock("@/features/editor/ColumnLayoutEditor", () => ({ ColumnLayoutEditor: () => null }));

// ShowDateDetailSheet pulls in useAuth (hasRole/user/roles) plus a large
// producer-facing surface unrelated to this copy check; stub it inert like
// the AvailabilityPage tests stub ColumnLayoutEditor.
vi.mock("@/components/shows/ShowDateDetailSheet", () => ({
  ShowDateDetailSheet: () => null,
}));

const flowHolder = { flow: BOOKING_FLOW_DEFAULTS as BookingFlow };
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowHolder.flow }),
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));

import { ArtistBookingsView } from "./ArtistBookingsView";

describe("ArtistBookingsView flow-aware copy (Task 4)", () => {
  it("classic flow: keeps the been-offered-for subtitle", async () => {
    flowHolder.flow = BOOKING_FLOW_DEFAULTS;
    renderWithProviders(<ArtistBookingsView />);

    expect(await screen.findByText(/been offered for/)).toBeInTheDocument();
  });

  it("direct flow: swaps to a booked-for subtitle and Booked/Not booked status labels", async () => {
    flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    renderWithProviders(<ArtistBookingsView />);

    expect(await screen.findByText(/you're booked for/)).toBeInTheDocument();
    expect(await screen.findByText("Booked")).toBeInTheDocument();
    expect(screen.getByText("Not booked")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
    expect(screen.queryByText("No offer yet")).not.toBeInTheDocument();
  });

  it("signposts how to cancel a confirmed date (R5.1)", async () => {
    flowHolder.flow = BOOKING_FLOW_DEFAULTS;
    renderWithProviders(<ArtistBookingsView />);

    expect(
      await screen.findByText(/need to cancel a date you confirmed\? message your producer in the date's chat/i),
    ).toBeInTheDocument();
  });

  // Runs last: reseeds the shared fake client to an artist with no bookings, so it
  // must not disturb the confirmed-booking fixture the tests above rely on.
  it("hides the cancel signpost when the artist has no confirmed booking (R5.1)", async () => {
    for (const k of Object.keys(client)) delete (client as Record<string, unknown>)[k];
    Object.assign(
      client,
      createFakeSupabase({ bookings: [{ when: { artist_id: "artist-1" }, data: [], error: null }] } as never),
    );
    flowHolder.flow = BOOKING_FLOW_DEFAULTS;
    renderWithProviders(<ArtistBookingsView />);

    // The page (and its eligible-date table) still renders; only the confirm-cancel
    // signpost is gated away because there is no confirmed booking to cancel.
    expect(await screen.findByRole("heading", { name: "My Bookings" })).toBeInTheDocument();
    expect(
      screen.queryByText(/need to cancel a date you confirmed/i),
    ).not.toBeInTheDocument();
  });

  // A confirmed booking that already happened is not something to cancel, so the
  // signpost stays hidden even though activeBookedDates still includes past dates.
  it("hides the cancel signpost when the only confirmed booking is in the past (R5.1)", async () => {
    for (const k of Object.keys(client)) delete (client as Record<string, unknown>)[k];
    Object.assign(
      client,
      createFakeSupabase({
        bookings: [
          {
            when: { artist_id: "artist-1" },
            data: [
              {
                id: "bk-past", artist_id: "artist-1", show_date_id: "dp", status: "confirmed", is_understudy: false,
                show_date: {
                  id: "dp", date: "2020-01-01", venue: "Stage 1",
                  session_1: "19:00", session_2: null, session_3: null,
                  show: { program: "Show A", sub_program: null },
                },
              },
            ],
            error: null,
          },
        ],
      } as never),
    );
    flowHolder.flow = BOOKING_FLOW_DEFAULTS;
    renderWithProviders(<ArtistBookingsView />);

    expect(await screen.findByRole("heading", { name: "My Bookings" })).toBeInTheDocument();
    expect(
      screen.queryByText(/need to cancel a date you confirmed/i),
    ).not.toBeInTheDocument();
  });
});
