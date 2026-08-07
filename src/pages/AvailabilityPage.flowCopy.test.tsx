import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { BOOKING_FLOW_DEFAULTS, applyPreset, type BookingFlow } from "@/lib/bookingFlow";

/**
 * Task 4: AvailabilityPage's H1/subtitle and per-row status badge must derive
 * from availabilityPageCopy(flow) / bookingStatusLabels(flow) (src/lib/flowCopy.ts)
 * instead of the hardcoded "My Offers" title and the local BOOKING_STATUS_LABEL
 * map, so a direct-booking org (artist_acceptance = false) sees "My Dates" /
 * a block-dates subtitle and "Not booked" instead of "No offer yet" for an
 * unbooked eligible date.
 */

// One eligible date with no booking row seeded, so its status resolves to
// "unanswered" and exercises the unbooked-status label.
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
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));
vi.mock("@/hooks/useMyArtist", () => ({
  useMyArtist: () => ({ data: { id: "artist-1" } }),
}));
vi.mock("@/hooks/useArtistEligibleDates", () => ({
  useArtistEligibleDates: () => ({ data: ELIGIBLE, isLoading: false }),
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

const flowHolder = { flow: BOOKING_FLOW_DEFAULTS as BookingFlow };
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowHolder.flow }),
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
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

    expect(await screen.findByText("Not booked")).toBeInTheDocument();
    expect(screen.queryByText("No offer yet")).not.toBeInTheDocument();
  });
});
