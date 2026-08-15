import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * Task 18, item 1: `?lens=` deep link sync for ShowsBookingsPage (producer).
 * Unlike ShowsBookingsPage.calendar.test.tsx (which stubs `useSearchParams`
 * to a fixed, inert pair), this file wraps the page in a real MemoryRouter
 * so `useSearchParams` round-trips for real — needed to prove both the
 * read-on-mount and write-on-change halves of the deep link, and that the
 * existing `?status=` handling is left alone.
 */

const SHOW_DATE = {
  id: "sd-1", date: "2030-03-14", session_1: "19:00", session_2: null, session_3: null,
  venue: "Opera House", status: "partially_filled" as const, notes: null, cancellation_reason: null,
  city_id: null, show_id: "s1", custom: null,
  show: { id: "s1", program: "Nutcracker", sub_program: null, status: "active" as const, main_cast_slots: 4, understudy_slots: 2 },
  city: null,
};

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, unknown>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed as never));
}

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: (r: string) => r === "producer", currentOrg: { id: "org-1" } }),
}));
vi.mock("@/data/showDates", async (orig) => ({
  ...(await orig<typeof import("@/data/showDates")>()),
  fetchShowDatesList: () => Promise.resolve([SHOW_DATE]),
}));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchBookingCountsByDate: () => Promise.resolve(new Map()),
}));
vi.mock("@/components/filters/useFilterVisibility", () => ({
  useFilterVisibility: () => ({ canSee: () => true, isAdmin: true }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (f: string) => f === "booking_flow",
  useEntitlements: () => ({ features: new Set(["booking_flow"]), isLoading: false }),
}));
vi.mock("@/hooks/useCapabilities", () => ({
  useCan: () => true,
}));
vi.mock("@/components/bookings/setup/useBookingSetupRailVisible", () => ({
  useBookingSetupRailVisible: () => ({ mode: "hidden" }),
}));
vi.mock("@/components/bookings/setup/BookingSetupRail", () => ({
  BookingSetupRail: () => <div data-testid="booking-setup-rail" />,
}));
vi.mock("@/hooks/useBookingSetup", () => ({
  useBookingSetupStatus: () => ({
    status: blankOrgStatus(),
    coverage: undefined, isLoading: false, isError: false,
  }),
  useProducerCount: () => null,
}));
vi.mock("@/hooks/useHireOrders", () => ({
  useDatesReadyForHireOrder: () => ({ data: undefined }),
  useHireOrderAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));
vi.mock("@/features/editor/EditorContext", () => ({
  useEditorConfig: () => ({ isEditorMode: false, getColumnLabel: (id: string) => id, getCustomFieldDefs: () => [] }),
}));
vi.mock("@/components/shows/ShowDateDetailSheet", () => ({
  ShowDateDetailSheet: () => null,
}));
vi.mock("@/components/shows/ShowDateFormDialog", () => ({ ShowDateFormDialog: () => null }));
vi.mock("@/components/hireOrders/NewOrderWizard", () => ({ NewOrderWizard: () => null }));

import ShowsBookingsPage from "./ShowsBookingsPage";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";

/** A never-configured org, straight from the engine: every step outstanding. A hoisted
 *  function declaration so the vi.mock factory above can call it at render time. */
function blankOrgStatus() {
  return computeBookingSetupStatus({
    flowChosen: false, hasAnyShows: false, shows: [], timingChosen: false,
    coverage: null, artistCount: 0, artistAcceptance: null,
  });
}

/** Exposes the live URL search string so a test can assert what the page wrote to it. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderAt(path: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <ShowsBookingsPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  seedClient({});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-10T12:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ShowsBookingsPage — ?lens= deep link (Task 18)", () => {
  it("?lens=agenda selects the Agenda lens on load", async () => {
    renderAt("/bookings?lens=agenda");
    expect(await screen.findByTestId("calendar-surface")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Agenda" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "false");
  });

  it("an unrecognised ?lens= value is ignored, keeping the Month default", async () => {
    renderAt("/bookings?lens=bogus");
    expect(await screen.findByTestId("calendar-surface")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true");
  });

  it("changing the lens writes ?lens= to the URL, preserving the existing ?status=", async () => {
    // SHOW_DATE.status is "partially_filled" — matching the deep-linked status filter
    // so the fixture date survives the filter and the surface actually renders.
    renderAt("/bookings?status=partially_filled");
    expect(await screen.findByTestId("calendar-surface")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Agenda" }));

    await waitFor(() => {
      const search = new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");
      expect(search.get("lens")).toBe("agenda");
      expect(search.get("status")).toBe("partially_filled");
    });
  });
});
