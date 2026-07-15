import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { BOOKING_FLOW_DEFAULTS, applyPreset, type BookingFlow } from "@/lib/bookingFlow";

/**
 * Task 3: ArtistDashboard's response/booked-share meter and header sentence
 * must derive from artistMeter(flow) (src/lib/flowCopy.ts) instead of a
 * hardcoded "Response rate" label, so a direct-booking org (artist_acceptance
 * = false) sees "Booked dates" / confirmed-only share instead of a response
 * rate that conflates soft_booked with a real answer.
 */

// Four eligible dates: d1 confirmed, d2 soft_booked, d3 suggested, d4 unbooked.
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
  {
    id: "d3",
    date: "2099-08-12",
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
    id: "d4",
    date: "2099-08-13",
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
    // ArtistDashboard's `myBookings` query: .eq('artist_id', artist.id).neq('status','cancelled').
    // d1 confirmed, d2 soft_booked, d3 suggested; d4 has no row → unbooked.
    bookings: [
      {
        when: { artist_id: "artist-1" },
        data: [
          { id: "bk-1", artist_id: "artist-1", show_date_id: "d1", status: "confirmed" },
          { id: "bk-2", artist_id: "artist-1", show_date_id: "d2", status: "soft_booked" },
          { id: "bk-3", artist_id: "artist-1", show_date_id: "d3", status: "suggested" },
        ],
        error: null,
      },
    ],
  }),
);

vi.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));
vi.mock("@/hooks/useMyArtist", () => ({
  useMyArtist: () => ({ data: { id: "artist-1", name: "A" } }),
}));
vi.mock("@/hooks/useArtistEligibleDates", () => ({
  useArtistEligibleDates: () => ({ data: ELIGIBLE, isLoading: false }),
}));

const flowHolder = { flow: BOOKING_FLOW_DEFAULTS as BookingFlow };
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowHolder.flow }),
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));

import { ArtistDashboard } from "./ArtistDashboard";

describe("ArtistDashboard — flow-aware meter (Task 3)", () => {
  it("classic flow: keeps the Response rate meter (confirmed + soft_booked count)", async () => {
    flowHolder.flow = BOOKING_FLOW_DEFAULTS;
    renderWithProviders(<ArtistDashboard />);

    expect(await screen.findByText("Response rate")).toBeInTheDocument();
    expect(
      screen.getByText("Your response rate on dates you've been offered."),
    ).toBeInTheDocument();
    expect(await screen.findByText("2 of 4 dates")).toBeInTheDocument();
  });

  it("direct flow: swaps to Booked dates (confirmed-only count, no unanswered filter)", async () => {
    flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    renderWithProviders(<ArtistDashboard />);

    expect(await screen.findByText("Booked dates")).toBeInTheDocument();
    expect(
      screen.getByText("Your booked share of the dates you're eligible for."),
    ).toBeInTheDocument();
    expect(await screen.findByText("1 of 4 dates")).toBeInTheDocument();

    const meterLink = screen.getByText("1 of 4 dates").closest("a");
    expect(meterLink?.getAttribute("href")).not.toContain("filter=unanswered");
  });

  // Spec correction: the card does NOT self-hide on empty (it renders an
  // offer-worded empty state), so direct mode must gate it off entirely.
  it("classic flow shows the awaiting-response card; direct flow hides it", async () => {
    flowHolder.flow = BOOKING_FLOW_DEFAULTS;
    const classic = renderWithProviders(<ArtistDashboard />);
    expect(await classic.findByText("Awaiting your response")).toBeInTheDocument();
    classic.unmount();

    flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    renderWithProviders(<ArtistDashboard />);
    expect(await screen.findByText("Booked dates")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting your response")).not.toBeInTheDocument();
  });
});
