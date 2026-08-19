import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
// The per-row confirm success toast is asserted directly (Booked ${name}.), so sonner's
// toast is a plain spy rather than the real module (which has nothing to observe without a
// mounted <Toaster/>).
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// ShowDateDetailSheet reaches the shared client through several raw
// supabase.from(...) queries plus data-access helpers (fetchOfferTiers,
// fetchRequiredSkillIds, resolveOrgSetting, ...). Everything not seeded below
// resolves to the fake's benign empty-array default, which every one of those
// helpers already degrades to gracefully. Heavy/unrelated child surfaces
// (chat, hire orders, the edit dialog, dry-run, direct-book list) are stubbed
// out so this file stays focused on the sheet's own capability gates.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
// The sheet calls useNavigate() (the header's read-only flow indicator links to
// Settings). renderWithProviders mounts no Router, so stub the hook; every other
// react-router export stays real.
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));
vi.mock("@/hooks/useEntitlements", async (orig) => {
  const useFeature = vi.fn();
  return {
    ...(await orig<typeof import("@/hooks/useEntitlements")>()),
    useFeature,
    // ModuleGate reads useModuleGate; derive it from the mocked useFeature so the
    // existing per-test vi.mocked(useFeature) setup drives both.
    useModuleGate: (f: string) => ({ allow: useFeature(f), pending: false }),
  };
});
vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false, getCustomFieldDefs: () => [] }) }));
vi.mock("@/hooks/useEligibleArtists", () => ({
  useEligibleArtists: () => ({ data: { artistIds: null, castIds: [] }, isError: false }),
}));
vi.mock("@/hooks/useSkills", () => ({ useSkills: () => ({ data: [] }) }));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }), // falls back to BOOKING_FLOW_DEFAULTS (artist_acceptance: true)
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));
vi.mock("@/hooks/useAllCities", () => ({ useAllCities: () => ({ data: [] }) }));
vi.mock("@/hooks/useShowDates", () => ({
  useCancelShowDate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteShowDate: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/chat/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/shows/hireOrders/HireOrdersCard", () => ({ HireOrdersCard: () => null }));
vi.mock("@/components/shows/ShowDateFormDialog", () => ({ ShowDateFormDialog: () => null }));
vi.mock("@/components/shows/date/DryRunDialog", () => ({ DryRunDialog: () => null }));
vi.mock("@/components/shows/date/EligibilityBookList", () => ({ EligibilityBookList: () => null }));
// Stub exposes the exact `canManage` prop it was handed so the open/close-tier
// gate (run_offer_engine) can be asserted without needing TierTimeline's own deps.
// Also surfaces `nextTier` (the prop that gates the real NextOfferHero's
// visibility: `canManage && nextTier != null && ...`) so the gap-aware
// derivation can be asserted here without re-implementing the real component.
vi.mock("@/components/shows/date/TierTimeline", () => ({
  TierTimeline: ({ canManage, nextTier }: { canManage: boolean; nextTier: number | null }) =>
    <div data-testid="tier-timeline-can-manage" data-next-tier={String(nextTier)}>{String(canManage)}</div>,
}));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useFeature } from "@/hooks/useEntitlements";
import { toast } from "sonner";
import { ShowDateDetailSheet } from "./ShowDateDetailSheet";

const SHOW_DATE = {
  id: "sd-1",
  date: "2026-03-01",
  session_1: "20:00:00",
  session_2: null,
  session_3: null,
  venue: "Main Hall",
  status: "open",
  notes: null,
  city_id: null,
  show_id: "show-1",
  cancellation_reason: null,
  airtable_record_id: null, // manual (non-synced) date -> hard-delete-eligible
  custom: null,
  show: { id: "show-1", program: "Aurora", sub_program: null, main_cast_slots: 2, understudy_slots: 1 },
  city: null,
};

const SOFT_BOOKED = {
  id: "bk-1",
  show_date_id: "sd-1",
  artist_id: "ar-1",
  status: "soft_booked",
  is_understudy: false,
  offer_expires_at: null,
  artist: { id: "ar-1", name: "Ada Lovelace" },
};

function authAs(role: "producer" | "admin") {
  vi.mocked(useAuth).mockReturnValue({
    hasRole: (r: string) => r === role,
    roles: [role],
    user: { id: "u1" },
    currentOrg: { id: "org-1", name: "Aurora Productions" },
  } as never);
}

function renderSheet() {
  return renderWithProviders(
    <ShowDateDetailSheet showDateId="sd-1" open onOpenChange={vi.fn()} />,
  );
}

// Controls that used to be one long scroll now live behind cockpit tabs. The
// capability-gate assertions are unchanged; each test just activates the owning
// tab first. (Cast is the default tab, and the Generate hire order button lives
// in the header, so those tests need no navigation.)
const clickTab = async (name: RegExp) =>
  fireEvent.click(await screen.findByRole("button", { name }));

describe("ShowDateDetailSheet capability gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAs("producer");
    // No active bookings by default so the hard-delete-eligibility calc (0 bookings
    // required) isn't entangled with the confirm_bookings tests below, which reseed
    // a soft_booked row explicitly.
    seedClient({
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    vi.mocked(useCan).mockReturnValue(true); // all capabilities on by default
    // hire_orders off by default; booking_flow on by default so the booking
    // card's own ModuleGate stays transparent for tests that aren't about it.
    vi.mocked(useFeature).mockImplementation((feature) => feature === "booking_flow");
  });

  it("hire_orders on + fully filled + no order: Generate hire order shows and drafts on click", async () => {
    vi.mocked(useFeature).mockReturnValue(true);
    seedClient({
      show_dates: { data: { ...SHOW_DATE, status: "fully_filled" }, error: null },
      bookings: { data: [], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
      hire_orders: { data: [], error: null },
      "fn:generate-hire-orders": { data: { created: ["ho-x"], skipped: [] }, error: null },
    });
    renderSheet();
    // Fully filled surfaces the CTA in both the header and the persistent footer
    // (both fire the same draft action); assert it exists and click the first.
    const btns = await screen.findAllByRole("button", { name: /draft the contract/i });
    expect(btns[0]).toBeEnabled();
    fireEvent.click(btns[0]);
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      expect(invoke).toBeDefined();
      const body = invoke!.args[0] as { action: string; show_date_id: string };
      expect(body.action).toBe("draft");
      expect(body.show_date_id).toBe("sd-1");
    });
  });

  it("hire_orders off: no Generate hire order CTA in the header", async () => {
    seedClient({
      show_dates: { data: { ...SHOW_DATE, status: "fully_filled" }, error: null },
      bookings: { data: [], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    renderSheet();
    await screen.findByText("Main Hall");
    expect(screen.queryByRole("button", { name: /draft the contract/i })).not.toBeInTheDocument();
  });

  it("manage_show_dates on: Edit schedule is enabled", async () => {
    renderSheet();
    await clickTab(/^setup$/i);
    expect(await screen.findByRole("button", { name: /edit schedule/i })).toBeEnabled();
  });

  it("manage_show_dates off: Edit schedule is disabled, the date still reads", async () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "manage_show_dates");
    renderSheet();
    await clickTab(/^setup$/i);
    expect(await screen.findByRole("button", { name: /edit schedule/i })).toBeDisabled();
    // The venue reads from the always-visible rail regardless of the active tab.
    expect(screen.getByText("Main Hall")).toBeInTheDocument();
  });

  it("hard_delete_show_dates on: a producer (not admin) sees an enabled Delete for a manual, booking-free date", async () => {
    renderSheet();
    await clickTab(/^setup$/i);
    expect(await screen.findByRole("button", { name: /^delete$/i })).toBeEnabled();
  });

  it("hard_delete_show_dates off: Delete control is absent, Cancel date still available", async () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "hard_delete_show_dates");
    renderSheet();
    await clickTab(/^setup$/i);
    expect(await screen.findByRole("button", { name: /cancel date/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it("run_offer_engine off: TierTimeline receives canManage=false", async () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "run_offer_engine");
    renderSheet();
    await clickTab(/^asks$/i);
    expect(await screen.findByTestId("tier-timeline-can-manage")).toHaveTextContent("false");
  });

  it("run_offer_engine on: TierTimeline receives canManage=true", async () => {
    renderSheet();
    await clickTab(/^asks$/i);
    expect(await screen.findByTestId("tier-timeline-can-manage")).toHaveTextContent("true");
  });

  it("confirm_bookings off: Confirm is hidden on a soft_booked row, Cancel stays available", async () => {
    seedClient({
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [SOFT_BOOKED], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    vi.mocked(useCan).mockImplementation((action: string) => action !== "confirm_bookings");
    renderSheet();
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^book$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  it("confirm_bookings on: Confirm is shown on a soft_booked row", async () => {
    seedClient({
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [SOFT_BOOKED], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    renderSheet();
    expect(await screen.findByRole("button", { name: /^book$/i })).toBeInTheDocument();
  });

  // The per-row Confirm on the cockpit cast list used to report a bare "Booking updated",
  // so clicking Confirm on a busy date's cast list gave no receipt of WHICH artist just
  // moved. updateBookingStatus's onSuccess now looks the booking up in bookingsForDate to
  // name the artist.
  it("names the artist in the per-row confirm success toast", async () => {
    seedClient({
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [SOFT_BOOKED], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: /^book$/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Booked Ada Lovelace."));
  });

  // I1 regression: bookingFlowFeatureEnabled used to come from useFeature('booking_flow'),
  // which fails OPEN to the feature's registry default (true for booking_flow) while
  // entitlements are loading, and this file's own useModuleGate mock (line ~38) derives
  // bookingModuleAllowed from a plain, synchronous vi.fn() -- independent of the REAL,
  // async useEntitlements() query this suite deliberately leaves unmocked. So
  // CockpitCastList can (and, per this test's seed, does) mount and let a producer open the
  // cancel dialog before that real query resolves. The fix reads useEntitlements() directly
  // and gates on `!isLoading`, so the value is honest once the query resolves to a real
  // org_entitlements row -- proven here with an explicit `enabled: false` row, which the old
  // fail-open path would have overridden with the (true) registry default.
  it("the cancel dialog's who-hears line reflects the org's real booking_flow entitlement, not the registry default", async () => {
    seedClient({
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [SOFT_BOOKED], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
      // The registry default for booking_flow is true; this row overrides it to false, so any
      // remaining fail-open path (a stale useFeature read, or no !isLoading gate) would still
      // show the digest-email sentence here instead of the honest fallback.
      org_entitlements: { data: [{ feature: "booking_flow", enabled: false }], error: null },
    });
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => {
      expect(within(dialog).getByText(/The artist is notified in the app\./)).toBeInTheDocument();
    });
    expect(within(dialog).queryByText(/session times/i)).not.toBeInTheDocument();
  });

  it("booking_flow on: the header shows 'Confirm N accepted' for a soft_booked booking", async () => {
    seedClient({
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [SOFT_BOOKED], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    renderSheet();
    expect(await screen.findByRole("button", { name: /book 1 who said yes/i })).toBeInTheDocument();
  });

  it("booking_flow off: no header 'Confirm accepted' CTA even with a soft_booked booking (module gate)", async () => {
    vi.mocked(useFeature).mockReturnValue(false); // booking_flow (and hire_orders) off
    seedClient({
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [SOFT_BOOKED], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    renderSheet();
    await screen.findByText("Main Hall");
    expect(screen.queryByRole("button", { name: /confirm .*accepted/i })).not.toBeInTheDocument();
  });

  // M-2: a non-contiguous ladder (tiers 1 and 3, no tier 2) used to leave the
  // Offers-tab hero hidden and the header with no way to escalate to tier 3 once
  // tier 1 closed short, because nextTier was derived as `(highestOpenedTier ?? 0)
  // + 1` clamped to an exact ladder-row match. It's now the smallest ladder tier
  // strictly greater than the highest opened tier, mirroring the escalation
  // engine's nextTierAfter.
  it("gap-aware next tier: ladder tiers {1, 3}, tier 1 closed -> nextTier skips the gap to 3", async () => {
    seedClient({
      show_dates: {
        data: { ...SHOW_DATE, city_id: "city-1", city: { id: "city-1", name: "Berlin" } },
        error: null,
      },
      bookings: { data: [], error: null },
      casts: {
        data: [
          { id: "cast-1", name: "Cast A" },
          { id: "cast-3", name: "Cast C" },
        ],
        error: null,
      },
      show_date_cast_eligibility: { data: [], error: null },
      // No show-specific priorities -> fetchTierCastMap falls back to the
      // org-wide city ladder (tiers 1 and 3; nothing at 2).
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: {
        data: [
          { cast_id: "cast-1", priority: 1, city_id: "city-1" },
          { cast_id: "cast-3", priority: 3, city_id: "city-1" },
        ],
        error: null,
      },
      // Tier 1 was opened and has since closed short -> highestOpenedTier=1,
      // highestOpenTier=null (currentTierOpen=false), so the header is free to
      // escalate.
      show_date_offer_tiers: {
        data: [{ tier: 1, opened_at: "2026-02-20T10:00:00Z", closed_at: "2026-02-21T10:00:00Z" }],
        error: null,
      },
      "fn:open-offer-tier": { data: { candidates: [], excluded: {} }, error: null },
    });
    renderSheet();
    await clickTab(/^asks$/i);
    // nextTier reaches the (mocked) TierTimeline as 3, not null -- the prop that
    // gates the real NextOfferHero's visibility, so this proves the hero would
    // render instead of disappearing into the gap.
    expect(await screen.findByTestId("tier-timeline-can-manage")).toHaveAttribute("data-next-tier", "3");

    // Tier 3 maps to exactly one cast (Cast C), so the RELABEL rule names it.
    // Clicking it previews (dry-runs) tier 3 -- the real "open" action's target.
    const cta = await screen.findByRole("button", { name: /ask cast c/i });
    fireEvent.click(cta);
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:open-offer-tier" && c.method === "invoke");
      expect(invoke).toBeDefined();
      const body = invoke!.args[0] as { show_date_id: string; tier: number; dry_run: boolean };
      expect(body.tier).toBe(3);
      expect(body.show_date_id).toBe("sd-1");
    });
  });
});
