import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * H4 regression: when the artist offers query fails, AvailabilityPage must enter
 * the error state (render an Alert) — it must NOT render an empty success that
 * shows "No offer yet" and offers the block-date affordance for a date that may
 * actually have a pending offer.
 */

// One eligible date so the list body would otherwise render a row with the
// blocked/offer cell (which is where the "Block date" affordance lives).
const ELIGIBLE = [
  {
    id: "sd-1",
    date: "2026-08-01",
    session_1: null,
    session_2: null,
    session_3: null,
    status: "active",
    city_id: "c1",
    show_id: "s1",
    venue: "Main Stage",
    show: { id: "s1", program: "Show A", sub_program: null, status: "active" },
  },
];

// vi.mock is hoisted above imports; populate the fake via a hoisted holder.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
// The bookings (offers) read fails; blocked_dates reads fine.
Object.assign(
  client,
  createFakeSupabase({
    bookings: { data: null, error: { message: "boom" } },
    blocked_dates: { data: [], error: null },
  }),
);

// useSearchParams needs a Router; mock it to a stable pair (the effect that
// writes the filter param is a no-op here).
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

// Keep the editor/columns machinery inert but with a template that includes the
// blocked/offer column, so the block-date button would render without the fix.
vi.mock("@/features/editor/EditorContext", () => ({
  useColumnTemplate: () => ({
    orderedColumns: [
      { columnId: "show_dates.date", visible: true, order: 0 },
      { columnId: "_computed.blocked", visible: true, order: 1 },
    ],
    visibleCount: 2,
  }),
  useEditorConfig: () => ({ isEditorMode: false, getColumnLabel: (id: string) => id }),
}));
vi.mock("@/features/editor/useColumnHeaders", () => ({
  useColumnHeaders: () => [
    { columnId: "show_dates.date", headerLabel: "Date" },
    { columnId: "_computed.blocked", headerLabel: "Availability" },
  ],
}));
vi.mock("@/features/editor/ColumnLayoutEditor", () => ({ ColumnLayoutEditor: () => null }));

import AvailabilityPage from "./AvailabilityPage";

describe("AvailabilityPage — offers query error", () => {
  it("renders an error Alert and never the block-date affordance when the offers fetch fails", async () => {
    renderWithProviders(<AvailabilityPage />);

    // The error Alert (role="alert") is shown.
    await waitFor(() => {
      expect(screen.getByText(/failed to load your offers/i)).toBeInTheDocument();
    });

    // Critically: the block-date button must NOT be offered for a date whose
    // real status we could not load.
    expect(screen.queryByText("Block date")).not.toBeInTheDocument();
    expect(screen.queryByText(/no offer yet/i)).not.toBeInTheDocument();
  });
});
