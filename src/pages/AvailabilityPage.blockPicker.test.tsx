import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * M3: the "Blocked Dates" date picker on AvailabilityPage must offer ONLY
 * dates the artist can actually block — i.e. eligible dates that are not already
 * blocked and have no active (non-cancelled) booking. This mirrors the
 * server-side blocked_dates trigger so a legitimate choice is never rejected and
 * an ineligible/booked/blocked date can't even be selected.
 */

// Three eligible dates:
//   d-free    — eligible, no booking, not blocked → SELECTABLE
//   d-booked  — eligible but has an active (soft_booked) booking → NOT selectable
//   d-blocked — eligible but already blocked → NOT selectable
const ELIGIBLE = [
  {
    id: "sd-free",
    date: "2099-08-10",
    session_1: "19:00",
    session_2: null,
    session_3: null,
    status: "open",
    city_id: "c1",
    show_id: "s1",
    venue: "Free Stage",
    show: { id: "s1", program: "Show A", sub_program: null, status: "active" },
  },
  {
    id: "sd-booked",
    date: "2099-08-11",
    session_1: "19:00",
    session_2: null,
    session_3: null,
    status: "open",
    city_id: "c1",
    show_id: "s1",
    venue: "Booked Stage",
    show: { id: "s1", program: "Show A", sub_program: null, status: "active" },
  },
  {
    id: "sd-blocked",
    date: "2099-08-12",
    session_1: "19:00",
    session_2: null,
    session_3: null,
    status: "open",
    city_id: "c1",
    show_id: "s1",
    venue: "Blocked Stage",
    show: { id: "s1", program: "Show A", sub_program: null, status: "active" },
  },
];

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(
  client,
  createFakeSupabase({
    // Active booking on sd-booked (soft_booked) — keyed by show_date_id.
    bookings: {
      data: [{ id: "bk-1", show_date_id: "sd-booked", status: "soft_booked" }],
      error: null,
    },
    // sd-blocked is already blocked.
    blocked_dates: {
      data: [{ id: "blk-1", date: "2099-08-12", reason: "vacation" }],
      error: null,
    },
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

// Keep the list column machinery minimal/inert.
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

describe("AvailabilityPage — blocked-date picker (M3)", () => {
  it("offers only eligible, unbooked, not-already-blocked dates as block options", async () => {
    renderWithProviders(<AvailabilityPage />);

    // The "Block date" select lives in the Blocked Dates card. It's a native
    // <select>; the page also renders Radix comboboxes (sort/timeframe/view), so
    // scope to this one by its accessible name to avoid an ambiguous match.
    const select = await waitFor(() =>
      screen.getByRole("combobox", { name: "Block date" }),
    );

    const options = within(select as HTMLElement)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== ""); // drop the placeholder option

    // Only the free eligible date is offered.
    expect(options).toEqual(["2099-08-10"]);
    expect(options).not.toContain("2099-08-11"); // has an active booking
    expect(options).not.toContain("2099-08-12"); // already blocked
  });
});
