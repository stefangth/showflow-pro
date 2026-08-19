import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * `?date=<show_date_id>` deep-links straight into the detail sheet — this is
 * what the Autopilot Today board's "Open the date" / "Read it first" CTAs use
 * to open a specific date instead of dropping the user on the unfiltered board.
 * `?tab=offers` lands the sheet on the Offers tab. Closing the sheet strips
 * both params so an in-tab reload doesn't reopen a dismissed date. Uses a real
 * MemoryRouter (like the lens deep-link test) so useSearchParams round-trips.
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

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
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
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (f: string) => f === "booking_flow",
  useEntitlements: () => ({ features: new Set(["booking_flow"]), isLoading: false }),
}));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => true }));
vi.mock("@/hooks/useBookingSetup", () => ({
  useBookingSetupStatus: () => ({
    status: { steps: [], doneCount: 0, totalCount: 0, canOffer: true, complete: true },
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
  ShowDateDetailSheet: ({
    showDateId, open, initialTab, onOpenChange,
  }: { showDateId: string | null; open: boolean; initialTab?: string; onOpenChange: (o: boolean) => void }) => (
    <div
      data-testid="detail-sheet"
      data-show-date-id={showDateId ?? ""}
      data-open={String(open)}
      data-initial-tab={initialTab ?? ""}
    >
      <button data-testid="close-sheet" onClick={() => onOpenChange(false)}>close</button>
    </div>
  ),
}));
vi.mock("@/components/shows/ShowDateFormDialog", () => ({ ShowDateFormDialog: () => null }));
vi.mock("@/components/hireOrders/NewOrderWizard", () => ({ NewOrderWizard: () => null }));

import ShowsBookingsPage from "./ShowsBookingsPage";

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

describe("ShowsBookingsPage — ?date= deep link opens the detail sheet", () => {
  it("?date=sd-1 opens the sheet for that date on the default tab", async () => {
    renderAt("/bookings?date=sd-1");
    const sheet = await screen.findByTestId("detail-sheet");
    expect(sheet.getAttribute("data-show-date-id")).toBe("sd-1");
    expect(sheet.getAttribute("data-open")).toBe("true");
    expect(sheet.getAttribute("data-initial-tab")).toBe("");
  });

  it("?date=sd-1&tab=offers opens the sheet on the Offers tab", async () => {
    renderAt("/bookings?date=sd-1&tab=offers");
    const sheet = await screen.findByTestId("detail-sheet");
    expect(sheet.getAttribute("data-show-date-id")).toBe("sd-1");
    expect(sheet.getAttribute("data-initial-tab")).toBe("offers");
  });

  it("closing the sheet strips the ?date=/?tab= params from the URL", async () => {
    renderAt("/bookings?date=sd-1&tab=offers");
    await screen.findByTestId("detail-sheet");
    fireEvent.click(screen.getByTestId("close-sheet"));
    await waitFor(() => {
      const search = new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");
      expect(search.has("date")).toBe(false);
      expect(search.has("tab")).toBe(false);
    });
    expect(screen.getByTestId("detail-sheet").getAttribute("data-open")).toBe("false");
  });
});
