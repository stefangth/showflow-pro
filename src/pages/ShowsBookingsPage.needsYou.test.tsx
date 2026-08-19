import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type RecordedCall } from "@/test/supabaseFake";

/**
 * Task 8: ProducerShowsBookings feeds the "Needs you" queue (default lens)
 * from real data — `buildNeedsYouQueue` over `producerEntries` +
 * `useBookingsWithArtist`'s people rows + `useDatesReadyForHireOrder`'s
 * `readyIds` — and wires its per-item actions to the real data-access
 * functions. Three fixture dates each land in a different queue group
 * (cancelled+unnotified, at-risk, ready-to-issue) so the lens renders three
 * group sections by default (no tab click needed — "Needs you" is now the
 * producer default lens).
 */

const SHOW_DATE_CANCELLED = {
  id: "sd-cancelled", date: "2030-03-05", session_1: "19:00", session_2: null, session_3: null,
  venue: "Opera House", status: "cancelled" as const, notes: null, cancellation_reason: "Illness",
  city_id: null, show_id: "s1", custom: null, cast_notified_at: null,
  show: { id: "s1", program: "Nutcracker", sub_program: null, status: "active" as const, main_cast_slots: 4, understudy_slots: 2 },
  city: null,
};
const SHOW_DATE_AT_RISK = {
  id: "sd-at-risk", date: "2030-03-20", session_1: "19:00", session_2: null, session_3: null,
  venue: "Opera House", status: "partially_filled" as const, notes: null, cancellation_reason: null,
  city_id: null, show_id: "s2", custom: null, cast_notified_at: null,
  show: { id: "s2", program: "Swan Lake", sub_program: null, status: "active" as const, main_cast_slots: 4, understudy_slots: 2 },
  city: null,
};
const SHOW_DATE_READY = {
  id: "sd-ready", date: "2030-03-15", session_1: "19:00", session_2: null, session_3: null,
  venue: "Opera House", status: "fully_filled" as const, notes: null, cancellation_reason: null,
  city_id: null, show_id: "s3", custom: null, cast_notified_at: null,
  show: { id: "s3", program: "Giselle", sub_program: null, status: "active" as const, main_cast_slots: 4, understudy_slots: 2 },
  city: null,
};
// A fourth date with a soft_booked offer expiring today (Berlin) — the only
// group with a "Confirm all" bulk button, needed to cover the confirmAll
// receipt fix (Finding 2).
const SHOW_DATE_EXPIRES = {
  id: "sd-expires", date: "2030-03-12", session_1: "19:00", session_2: null, session_3: null,
  venue: "Opera House", status: "partially_filled" as const, notes: null, cancellation_reason: null,
  city_id: null, show_id: "s4", custom: null, cast_notified_at: null,
  show: { id: "s4", program: "Coppelia", sub_program: null, status: "active" as const, main_cast_slots: 4, understudy_slots: 2 },
  city: null,
};
const SHOW_DATES = [SHOW_DATE_CANCELLED, SHOW_DATE_AT_RISK, SHOW_DATE_READY, SHOW_DATE_EXPIRES];

const COUNTS = new Map([
  ["sd-cancelled", { confirmedMain: 0, confirmedUs: 0, acceptedMain: 0, acceptedUs: 0, pendingMain: 0, pendingUs: 0, total: 0 }],
  ["sd-at-risk", { confirmedMain: 1, confirmedUs: 0, acceptedMain: 0, acceptedUs: 0, pendingMain: 0, pendingUs: 0, total: 1 }],
  ["sd-ready", { confirmedMain: 4, confirmedUs: 0, acceptedMain: 0, acceptedUs: 0, pendingMain: 0, pendingUs: 0, total: 4 }],
  ["sd-expires", { confirmedMain: 1, confirmedUs: 0, acceptedMain: 0, acceptedUs: 0, pendingMain: 1, pendingUs: 0, total: 2 }],
]);

const PEOPLE = [
  {
    id: "b-cancelled-1", showDateId: "sd-cancelled", status: "confirmed" as const,
    isUnderstudy: false, offerExpiresAt: null, artist: { id: "a1", name: "Alex Artist" },
  },
  // 18:00 UTC on "today" (2030-03-10) is 19:00 Berlin (pre-DST) — safely the
  // same Berlin calendar day regardless of the test runner's own timezone.
  {
    id: "b-expires-1", showDateId: "sd-expires", status: "soft_booked" as const,
    isUnderstudy: false, offerExpiresAt: "2030-03-10T18:00:00.000Z", artist: { id: "a2", name: "Sam Soft" },
  },
];

const { hireOrderMutate } = vi.hoisted(() => ({ hireOrderMutate: vi.fn() }));

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
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock("@/data/showDates", async (orig) => ({
  ...(await orig<typeof import("@/data/showDates")>()),
  fetchShowDatesList: () => Promise.resolve(SHOW_DATES),
}));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchBookingCountsByDate: () => Promise.resolve(COUNTS),
  fetchBookingsWithArtistForDates: () => Promise.resolve(PEOPLE),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (f: string) => f === "booking_flow" || f === "hire_orders",
  useEntitlements: () => ({ features: new Set(["booking_flow", "hire_orders"]), isLoading: false }),
}));
vi.mock("@/hooks/useCapabilities", () => ({
  useCan: () => true,
}));
vi.mock("@/hooks/useBookingSetup", () => ({
  useBookingSetupStatus: () => ({
    status: blankOrgStatus(),
    coverage: undefined, isLoading: false, isError: false,
  }),
  useProducerCount: () => null,
}));
vi.mock("@/hooks/useHireOrders", () => ({
  useDatesReadyForHireOrder: () => ({ data: { readyIds: ["sd-ready"], orderByDate: {} } }),
  useHireOrderAction: () => ({ mutate: hireOrderMutate, isPending: false, variables: undefined }),
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

import { toast } from "sonner";
import ShowsBookingsPage from "./ShowsBookingsPage";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";

function blankOrgStatus() {
  return computeBookingSetupStatus({
    flowChosen: false, hasAnyShows: false, shows: [], timingChosen: false,
    coverage: null, artistCount: 0, artistAcceptance: null,
  });
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

describe("ShowsBookingsPage — needs-you queue wiring (Task 8)", () => {
  it("defaults to the Needs-you lens and renders its four groups", async () => {
    renderWithProviders(<ShowsBookingsPage />);

    expect(await screen.findByTestId("needs-you-lens")).toBeInTheDocument();
    expect(screen.getByTestId("lens-tab-needs-you")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("needs-you-group-expires-today")).toBeInTheDocument();
    expect(screen.getByTestId("needs-you-group-cancelled")).toBeInTheDocument();
    expect(screen.getByTestId("needs-you-group-at-risk")).toBeInTheDocument();
    expect(screen.getByTestId("needs-you-group-ready-to-issue")).toBeInTheDocument();
  });

  it("clicking the cancelled item's Notify cast invokes the notify-cast edge function", async () => {
    renderWithProviders(<ShowsBookingsPage />);

    const btn = await screen.findByTestId("needs-you-primary-sd-cancelled");
    expect(btn).toHaveTextContent("Notify cast");
    fireEvent.click(btn);

    await waitFor(() => {
      const calls = client.calls as RecordedCall[];
      const call = calls.find((c) => c.table === "fn:notify-cast");
      expect(call?.args[0]).toEqual({ show_date_id: "sd-cancelled" });
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("clicking the ready item's Generate hire order triggers the draft action", async () => {
    renderWithProviders(<ShowsBookingsPage />);

    const btn = await screen.findByTestId("needs-you-primary-sd-ready");
    expect(btn).toHaveTextContent("Draft the contract");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(hireOrderMutate).toHaveBeenCalledWith(
        expect.objectContaining({ action: "draft", org_id: "org-1", show_date_id: "sd-ready" }),
      );
    });
  });

  // Finding 1 (Task 8 review): the ready-to-issue "Preview" secondary has no
  // real per-date document to render (the edge `preview` action only supports
  // `order_id`/a generic sample) — it must open the sheet, never fire a
  // misleading `preview` mutation.
  it("clicking the ready item's Preview opens the sheet instead of firing a preview mutation", async () => {
    renderWithProviders(<ShowsBookingsPage />);

    const btn = await screen.findByTestId("needs-you-secondary-sd-ready-preview");
    expect(btn).toHaveTextContent("Preview");
    fireEvent.click(btn);

    const sheet = await screen.findByTestId("detail-sheet");
    expect(sheet.getAttribute("data-show-date-id")).toBe("sd-ready");
    expect(sheet.getAttribute("data-open")).toBe("true");
    expect(hireOrderMutate).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "preview" }),
    );
  });

  // Finding 2 (Task 8 review): confirmAll/generateAll must push a "Cleared
  // today" receipt too, not just extend/release/notify/offer.
  it("the ready-to-issue bulk 'Generate' button pushes a Cleared today receipt", async () => {
    renderWithProviders(<ShowsBookingsPage />);

    const bulkBtn = await screen.findByTestId("needs-you-bulk-ready-to-issue");
    fireEvent.click(bulkBtn);

    await waitFor(() => {
      expect(hireOrderMutate).toHaveBeenCalledWith(
        expect.objectContaining({ action: "draft", show_date_id: "sd-ready" }),
      );
    });
    expect(await screen.findByTestId("needs-you-receipt-0")).toBeInTheDocument();
  });

  it("the expires-today bulk 'Confirm all' button pushes a Cleared today receipt", async () => {
    renderWithProviders(<ShowsBookingsPage />);

    const bulkBtn = await screen.findByTestId("needs-you-bulk-expires-today");
    fireEvent.click(bulkBtn);

    expect(await screen.findByTestId("needs-you-receipt-0")).toBeInTheDocument();
  });

  // Finding 2 (whole-branch review): the shortlist's per-artist "Offer" button
  // used to call openOfferTier, which offers the WHOLE eligible tier for the
  // date — clicking Offer next to one name silently offered everyone. It must
  // instead route to the casting UI (open the date on the Offers tab) so the
  // producer picks who to offer explicitly, and must NOT invoke the
  // open-offer-tier mutation at all.
  it("shortlist 'Offer' opens the date on the Offers tab instead of offering the whole tier", async () => {
    seedClient({
      "fn:open-offer-tier": { data: { candidates: [{ id: "art-1", name: "Casey Candidate" }] }, error: null },
    });
    renderWithProviders(<ShowsBookingsPage />);

    const offerBtn = await screen.findByTestId("queue-offer-art-1");
    // Only the (possibly-refetched) dry-run shortlist query should have hit
    // open-offer-tier so far — capture that baseline before clicking.
    const callsBeforeClick = (client.calls as RecordedCall[]).filter((c) => c.table === "fn:open-offer-tier").length;
    fireEvent.click(offerBtn);

    const sheet = await screen.findByTestId("detail-sheet");
    await waitFor(() => {
      expect(sheet.getAttribute("data-show-date-id")).toBe("sd-at-risk");
      expect(sheet.getAttribute("data-open")).toBe("true");
      expect(sheet.getAttribute("data-initial-tab")).toBe("offers");
    });

    // The Offer click must not have fired a NEW, mutating open-offer-tier call
    // (the whole-tier offer) — only opening the sheet.
    const callsAfterClick = (client.calls as RecordedCall[]).filter((c) => c.table === "fn:open-offer-tier").length;
    expect(callsAfterClick).toBe(callsBeforeClick);
  });
});
