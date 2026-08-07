import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * Plan B fix wave (finding: inconsistency). AvailabilityPage's
 * `activeBookedDates` query used to be gated only on `!!artist?.id`, while the
 * IDENTICAL query in ArtistBookingsView is gated on `!!artist?.id &&
 * bookingFlowEnabled`. The two surfaces should agree: a super-admin previewing
 * an org with booking_flow off still reaches this route (ProtectedRoute's
 * route-level feature gate exempts super-admins — see godmode-must-be-symmetric),
 * so the ungated version fired a needless read every time.
 */

const ELIGIBLE: unknown[] = [];

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
function seedClient(seed: Record<string, unknown>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed as never));
}

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

const { bookingFlowOn } = vi.hoisted(() => ({ bookingFlowOn: { value: true } }));
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (key: string) => (key === "booking_flow" ? bookingFlowOn.value : true),
}));

vi.mock("@/features/editor/EditorContext", () => ({
  useColumnTemplate: () => ({
    orderedColumns: [{ columnId: "show_dates.date", visible: true, order: 0 }],
    visibleCount: 1,
  }),
  useEditorConfig: () => ({ isEditorMode: false, getColumnLabel: (id: string) => id }),
}));
vi.mock("@/features/editor/useColumnHeaders", () => ({
  useColumnHeaders: () => [{ columnId: "show_dates.date", headerLabel: "Date" }],
}));
vi.mock("@/features/editor/ColumnLayoutEditor", () => ({ ColumnLayoutEditor: () => null }));

import AvailabilityPage from "./AvailabilityPage";

/** The exact select string fetchMyActiveBookedDates issues -- distinguishes its
 *  read from the page's other `bookings` read (`artist-offers`, a flat select
 *  with no show_date join), which stays ungated per this fix's scope. */
const ACTIVE_BOOKED_SELECT =
  "show_date_id, status, is_understudy, show_date:show_dates(id, date, venue, session_1, session_2, session_3, show:shows(program, sub_program))";

function activeBookedQueryFired(): boolean {
  const calls = (client as { calls?: { table: string; method: string; args: unknown[] }[] }).calls ?? [];
  return calls.some((c) => c.table === "bookings" && c.method === "select" && c.args[0] === ACTIVE_BOOKED_SELECT);
}

describe("AvailabilityPage — activeBookedDates query gating (Plan B fix wave)", () => {
  it("does not fire the active-booked query when booking_flow is off", async () => {
    bookingFlowOn.value = false;
    seedClient({ bookings: { data: [], error: null }, blocked_dates: { data: [], error: null } });
    renderWithProviders(<AvailabilityPage />);
    await screen.findByText(/no eligible dates yet/i);
    expect(activeBookedQueryFired()).toBe(false);
  });

  it("fires the active-booked query when booking_flow is on", async () => {
    bookingFlowOn.value = true;
    seedClient({ bookings: { data: [], error: null }, blocked_dates: { data: [], error: null } });
    renderWithProviders(<AvailabilityPage />);
    await screen.findByText(/no eligible dates yet/i);
    expect(activeBookedQueryFired()).toBe(true);
  });
});
