import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * Task 14: ArtistBookingsView shows a "Hire order" chip (FileText icon,
 * linking to ROUTES.HIRE_ORDER_DETAIL) inside the `_computed.my_status` cell
 * for any row whose date has an issued/countersigned hire order for this
 * artist (matched via useMyHireOrders' show_date_id). Hidden when the
 * hire_orders feature is off, or when there's no matching order.
 */

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

function seedClient(seed: Record<string, unknown>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed as never));
}

vi.mock("@/hooks/useMyArtist", () => ({
  useMyArtist: () => ({ data: { id: "artist-1" } }),
}));
vi.mock("@/hooks/useArtistEligibleDates", () => ({
  useArtistEligibleDates: () => ({ data: ELIGIBLE, isLoading: false }),
}));

// Task 4 added a booking_flow gate around the whole list region; keep it on
// independently of hireOrdersEnabled so toggling hire_orders in these tests
// doesn't also hide the booking rows the assertions read.
const featureHolder = { hireOrdersEnabled: true };
vi.mock("@/hooks/useEntitlements", () => {
  const useFeature = (feature: string) =>
    feature === "hire_orders" ? featureHolder.hireOrdersEnabled : true;
  // ModuleGate reads useModuleGate; derive it from the same rule so the two stay in step.
  return { useFeature, useModuleGate: (f: string) => ({ allow: useFeature(f), pending: false }) };
});

vi.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

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
vi.mock("@/components/shows/ShowDateDetailSheet", () => ({ ShowDateDetailSheet: () => null }));

vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }),
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));

import { ArtistBookingsView } from "./ArtistBookingsView";

describe("ArtistBookingsView hire-order chip (Task 14)", () => {
  it("shows a Hire order chip linking to the detail route for a date with an issued order", async () => {
    featureHolder.hireOrdersEnabled = true;
    seedClient({
      bookings: [
        {
          when: { artist_id: "artist-1" },
          data: [
            { id: "bk-1", artist_id: "artist-1", show_date_id: "d1", status: "confirmed", is_understudy: false },
          ],
          error: null,
        },
      ],
      hire_orders: {
        data: [
          { id: "ho-1", show_date_id: "d1", artist_id: "artist-1", status: "issued", order_no: "HO-1" },
        ],
        error: null,
      },
    });

    renderWithProviders(<ArtistBookingsView />);

    const chip = await screen.findByText("Hire order");
    expect(chip.closest("a")?.getAttribute("href")).toBe("/hire-orders/ho-1");
    // Only one row has an order, so only one chip renders.
    expect(screen.getAllByText("Hire order")).toHaveLength(1);
  });

  it("does not show a chip when there is no matching hire order for a date", async () => {
    featureHolder.hireOrdersEnabled = true;
    seedClient({
      bookings: [
        {
          when: { artist_id: "artist-1" },
          data: [],
          error: null,
        },
      ],
      hire_orders: { data: [], error: null },
    });

    renderWithProviders(<ArtistBookingsView />);

    await screen.findByText("10/08/2028");
    expect(screen.queryByText("Hire order")).not.toBeInTheDocument();
  });

  it("hides the chip when the hire_orders feature is off, even with a matching order", async () => {
    featureHolder.hireOrdersEnabled = false;
    seedClient({
      bookings: [
        {
          when: { artist_id: "artist-1" },
          data: [
            { id: "bk-1", artist_id: "artist-1", show_date_id: "d1", status: "confirmed", is_understudy: false },
          ],
          error: null,
        },
      ],
      hire_orders: {
        data: [
          { id: "ho-1", show_date_id: "d1", artist_id: "artist-1", status: "issued", order_no: "HO-1" },
        ],
        error: null,
      },
    });

    renderWithProviders(<ArtistBookingsView />);

    await screen.findByText("10/08/2028");
    expect(screen.queryByText("Hire order")).not.toBeInTheDocument();
  });
});
