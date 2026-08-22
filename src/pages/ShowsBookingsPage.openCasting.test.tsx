import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

/**
 * Finding 7 regression: the Agenda lens's "Open casting" action (open-status
 * dates) used to just call the same `openShowDate` as "Open date", landing on
 * the default Cast tab despite the label promising casting/offers. It now
 * opens the sheet with `initialTab="offers"` so the label matches the tab it
 * lands on; a plain "Open date" (double-clicking a day) still opens on the
 * default tab.
 */

const SHOW_DATE_OPEN = {
  id: "sd-open", date: "2030-03-14", session_1: "19:00", session_2: null, session_3: null,
  venue: "Opera House", status: "open" as const, notes: null, cancellation_reason: null,
  city_id: null, show_id: "s1", custom: null,
  show: { id: "s1", program: "Nutcracker", sub_program: null, status: "active" as const, main_cast_slots: 4, understudy_slots: 2 },
  city: null,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: (r: string) => r === "producer", currentOrg: { id: "org-1" } }),
}));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock("@/data/showDates", async (orig) => ({
  ...(await orig<typeof import("@/data/showDates")>()),
  fetchShowDatesList: () => Promise.resolve([SHOW_DATE_OPEN]),
}));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchBookingCountsByDate: () => Promise.resolve(new Map()),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (f: string) => f === "booking_flow",
  useEntitlements: () => ({ features: new Set(["booking_flow"]), isLoading: false }),
}));
vi.mock("@/hooks/useCapabilities", () => ({
  useCan: () => true,
}));
vi.mock("@/hooks/useBookingSetup", () => ({
  useBookingSetupStatus: () => ({
    status: { steps: [], doneCount: 0, totalCount: 0, canOffer: true, complete: true, datesWithoutCity: 0 },
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
    showDateId, open, initialTab,
  }: { showDateId: string | null; open: boolean; initialTab?: string }) => (
    <div
      data-testid="detail-sheet"
      data-show-date-id={showDateId ?? ""}
      data-open={String(open)}
      data-initial-tab={initialTab ?? ""}
    />
  ),
}));
vi.mock("@/components/shows/ShowDateFormDialog", () => ({ ShowDateFormDialog: () => null }));
vi.mock("@/components/hireOrders/NewOrderWizard", () => ({ NewOrderWizard: () => null }));

import ShowsBookingsPage from "./ShowsBookingsPage";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-10T12:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ShowsBookingsPage — Agenda 'Open casting' opens straight to the Offers tab", () => {
  it("clicking Open casting on an open-status date opens the sheet with initialTab=offers", async () => {
    renderWithProviders(<ShowsBookingsPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Agenda" }));

    const actionBtn = await screen.findByTestId("agenda-action-sd-open");
    expect(actionBtn).toHaveTextContent("Open casting");
    fireEvent.click(actionBtn);

    const sheet = screen.getByTestId("detail-sheet");
    expect(sheet.getAttribute("data-show-date-id")).toBe("sd-open");
    expect(sheet.getAttribute("data-open")).toBe("true");
    expect(sheet.getAttribute("data-initial-tab")).toBe("offers");
  });

  it("opening the same date via a plain row click (not the action button) lands on the default tab", async () => {
    renderWithProviders(<ShowsBookingsPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Agenda" }));
    const row = await screen.findByTestId("agenda-row-sd-open");
    fireEvent.click(row);

    const sheet = screen.getByTestId("detail-sheet");
    expect(sheet.getAttribute("data-show-date-id")).toBe("sd-open");
    expect(sheet.getAttribute("data-initial-tab")).toBe("");
  });
});
