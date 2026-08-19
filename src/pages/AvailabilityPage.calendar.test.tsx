import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type RecordedCall } from "@/test/supabaseFake";
import { Toaster } from "@/components/ui/toaster";

/**
 * Task 17: ArtistAvailability renders `<CalendarSurface role="artist">` in
 * place of the old table/`ArtistAvailabilityCalendar` + `ViewToggle` +
 * `ColumnLayoutEditor`, wired to the real `respondToOffer` data-access
 * function (not re-implemented here — the Accept flow below exercises the
 * actual mutation against a call-recording fake Supabase client, mirroring
 * ShowsBookingsPage.calendar.test.tsx's producer coverage).
 */

const ELIGIBLE = [
  {
    id: "sd-1",
    date: "2099-08-10",
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

function seedClient(seed: Record<string, unknown>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed as never));
}

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
// hire_orders is off; useMyHireOrders would otherwise fire a real query against
// an unseeded "hire_orders" table, which the fake client handles fine anyway,
// but pinning it keeps this test's focus on the offers/accept flow.
vi.mock("@/hooks/useHireOrders", () => ({
  useMyHireOrders: () => ({ data: [] }),
}));
// booking_flow must be on for the artist calendar/offers surface to render at all
// (screen 08 shows a single "dates do not run here" line when it is off); hire_orders
// stays off, matching the useMyHireOrders stub above.
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (feature: string) => feature === "booking_flow",
}));

import AvailabilityPage from "./AvailabilityPage";

function seedWithSuggestedOffer() {
  seedClient({
    // Single-object seed: both the page's own `myBookings` read AND the
    // `respondToOffer` update+select resolve against this same fixed row,
    // matching ShowsBookingsPage.calendar.test.tsx's pattern.
    bookings: { data: [{ id: "bk-1", artist_id: "artist-1", show_date_id: "sd-1", status: "suggested" }], error: null },
    blocked_dates: { data: [], error: null },
  });
}

describe("AvailabilityPage — artist calendar surface (Task 17)", () => {
  it("renders the CalendarSurface's Offers lens and drops the old list ViewToggle/ColumnLayoutEditor", async () => {
    seedWithSuggestedOffer();
    renderWithProviders(<AvailabilityPage />);

    expect(await screen.findByTestId("calendar-surface")).toBeInTheDocument();
    // Offers is the artist role's Phase-1 default lens — no click needed.
    expect(await screen.findByTestId("offers-lens")).toBeInTheDocument();
    expect(screen.getByTestId("offer-card-sd-1")).toHaveTextContent("Show A");

    // The old list view's ViewToggle ("List"/"Calendar") and column editor are
    // gone; the surface offers lens tabs instead.
    expect(screen.queryByRole("button", { name: /^list$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^calendar$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Asks" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Month" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All dates" })).toBeInTheDocument();

    // The Blocked-dates management card still renders, below the surface.
    expect(screen.getByText("Blocked Dates")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Block date" })).toBeInTheDocument();
  });

  it("Accept on an offer card calls the real offer-response data flow and toasts", async () => {
    seedWithSuggestedOffer();
    renderWithProviders(
      <>
        <AvailabilityPage />
        <Toaster />
      </>,
    );

    const acceptBtn = await screen.findByTestId("offer-accept-sd-1");
    fireEvent.click(acceptBtn);

    // BOOKING_FLOW_DEFAULTS.producer_confirmation is true (no app_settings
    // override seeded), so accepting places a hold — the real
    // acceptConsequenceNote copy, not a stub.
    expect(await screen.findByText("Said yes")).toBeInTheDocument();

    const calls = (client as { calls?: RecordedCall[] }).calls ?? [];
    const updateCall = calls.find((c) => c.table === "bookings" && c.method === "update");
    expect(updateCall).toBeDefined();
    const patch = updateCall!.args[0] as { status?: string };
    expect(patch.status).toBe("soft_booked");

    const statusEqCall = calls.find(
      (c) => c.table === "bookings" && c.method === "eq" && c.args[0] === "status" && c.args[1] === "suggested",
    );
    expect(statusEqCall).toBeDefined();
  });
});
