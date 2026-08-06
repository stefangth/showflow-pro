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
    date: "2099-08-10",
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
    date: "2099-08-11",
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
    // Backs both ArtistBookingsView's own `myBookings` query and the
    // fetchMyCancelledDateBookings query (both read the `bookings` table).
    // The cancelled-entries query's rows lack a `show_date` field so it
    // resolves to an empty cancelled list, which is what we want here.
    bookings: [
      {
        when: { artist_id: "artist-1" },
        data: [
          { id: "bk-1", artist_id: "artist-1", show_date_id: "d1", status: "confirmed", is_understudy: false },
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
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (feature: string) => feature === "booking_flow",
}));

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
});
