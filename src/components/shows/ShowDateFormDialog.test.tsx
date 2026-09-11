import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { BOOKING_FLOW_DEFAULTS, type FlowTimes } from "@/lib/bookingFlow";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";

const createShowDate = vi.fn((..._a: unknown[]) => Promise.resolve({ id: "d-new" }));
const updateShowDate = vi.fn((..._a: unknown[]) => Promise.resolve({}));
const openOfferTier = vi.fn((..._a: unknown[]) => Promise.resolve({ offersCreated: 1 }));
const fetchOpenedTiers = vi.fn((..._a: unknown[]) => Promise.resolve([]));
let mockFlow: typeof BOOKING_FLOW_DEFAULTS | undefined = undefined;
let mockFlowTimes: FlowTimes | undefined = undefined;
let mockBookingFlowEnabled = true;
let mockBookingFlowPending = false;
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: () => true }) }));
vi.mock("@/data/showDates", async (orig) => ({ ...(await orig<typeof import("@/data/showDates")>()), createShowDate: (...a: unknown[]) => createShowDate(...a), updateShowDate: (...a: unknown[]) => updateShowDate(...a), fetchShowDatesForShow: () => Promise.resolve(mockExistingDates) }));
vi.mock("@/data/bookings", async (orig) => ({ ...(await orig<typeof import("@/data/bookings")>()), openOfferTier: (...a: unknown[]) => openOfferTier(...a), fetchOpenedTiers: (...a: unknown[]) => fetchOpenedTiers(...a) }));
vi.mock("@/hooks/useBookingFlow", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useBookingFlow")>()),
  useBookingFlow: () => ({ data: mockFlow }),
  useFlowTimes: () => ({ data: mockFlowTimes }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => ({
    features: new Set(mockBookingFlowEnabled ? ["booking_flow"] : []),
    isLoading: mockBookingFlowPending,
  }),
}));
vi.mock("@/hooks/useShows", async (orig) => ({ ...(await orig<typeof import("@/hooks/useShows")>()), useShows: () => ({ data: [
  { id: "s1", program: "Configured", sub_program: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 1, category: null, description: null, dateCount: 0 },
  { id: "s2", program: "NoSlots", sub_program: null, status: "active", main_cast_slots: null, understudy_slots: null, airtable_program_key: null, sort_order: 2, category: null, description: null, dateCount: 0 },
], isLoading: false }) }));
let mockExistingDates: unknown[] = [];
let mockCities: Array<{ id: string; name: string; airtable_city_key: string | null }> = [];
let mockCitiesState = { isLoading: false, isError: false };
vi.mock("@/hooks/useCities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCities")>()), useCities: () => ({ data: mockCities, ...mockCitiesState }) }));

import { ShowDateFormDialog } from "./ShowDateFormDialog";

describe("ShowDateFormDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlow = undefined;
    mockFlowTimes = undefined;
    mockBookingFlowEnabled = true;
    mockBookingFlowPending = false;
    mockCities = [{ id: "c1", name: "Berlin", airtable_city_key: null }];
    mockCitiesState = { isLoading: false, isError: false };
    mockExistingDates = [];
  });

  // The create-mode tier-1 default mirrors the org's booking flow (Settings > Booking flow >
  // "Open tier 1 automatically when a new date is ready"): checked when the flow auto-opens
  // tier 1, unchecked when it does not. This replaces the old always-opt-in (unchecked) default.
  it("checks opening tier-1 offers for a new date when the org's flow auto-opens tier 1", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, auto_open_tier1: true, artist_acceptance: true };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />);
    expect(screen.getByRole("checkbox", { name: /start asking now/i })).toBeChecked();
  });

  it("leaves opening tier-1 offers unchecked for a new date when the org's flow does not auto-open tier 1", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, auto_open_tier1: false, artist_acceptance: true };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />);
    expect(screen.getByRole("checkbox", { name: /start asking now/i })).not.toBeChecked();
  });

  it("references the booking flow setting the tier-1 default follows", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, auto_open_tier1: true, artist_acceptance: true };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />);
    expect(screen.getByText(/Start asking automatically when a new date is ready/i)).toBeInTheDocument();
  });

  // The default re-seeds from the flow when the query resolves, but a producer who toggles the
  // box by hand owns their choice for this date: a later flow refetch must not clobber it.
  it("does not re-seed the create-mode offer choice from the flow once the user toggles it", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, auto_open_tier1: true, artist_acceptance: true };
    const props = { open: true, onOpenChange: () => {}, mode: "create" as const, defaultShowId: "s1" };
    const { rerender } = renderWithProviders(<ShowDateFormDialog {...props} />);
    const checkbox = screen.getByRole("checkbox", { name: /start asking now/i });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    mockFlow = { ...BOOKING_FLOW_DEFAULTS, auto_open_tier1: true, artist_acceptance: true };
    rerender(<ShowDateFormDialog {...props} />);

    expect(screen.getByRole("checkbox", { name: /start asking now/i })).not.toBeChecked();
  });

  it("create requires a production and a date", async () => {
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" />);
    fireEvent.click(screen.getByRole("button", { name: /create date/i }));
    expect(await screen.findByText(/production is required/i)).toBeInTheDocument();
    expect(createShowDate).not.toHaveBeenCalled();
  });

  it("synced date locks the date field, keeps notes editable", () => {
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={{ id: "d1", show_id: "s1", date: "2026-07-01", session_1: null, session_2: null, session_3: null, venue: null, city_id: null, notes: "n", airtable_record_id: "rec1", status: "open" }} />);
    expect(screen.getByText(/synced from airtable/i)).toBeInTheDocument();
    expect(screen.getByTestId("date-trigger")).toBeDisabled();
    expect(screen.getByLabelText(/notes/i)).not.toBeDisabled();
  });

  // Regression: the edit-mode auto-open (sessions just filled in, satisfying
  // shouldAutoOpenTier1) called openOfferTier directly via data/bookings, bypassing the
  // useCreateShowDate/useUpdateShowDate hooks' own cache invalidation, so a freshly opened
  // tier's offers/bookings never showed up without a manual refresh. It must invalidate the
  // same keys the sheet's own open-tier mutation does: ['bookings'] and
  // ['offer-tiers', 'opened', <dateId>].
  it("invalidates bookings and opened-tiers after an edit-mode auto-open succeeds", async () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, auto_open_tier1: true, artist_acceptance: true };
    const { queryClient } = renderWithProviders(
      <ShowDateFormDialog
        open
        onOpenChange={() => {}}
        mode="edit"
        showDate={{
          id: "d1", show_id: "s1", date: "2026-07-01",
          session_1: null, session_2: null, session_3: null,
          venue: null, city_id: null, notes: null,
          airtable_record_id: null, status: "open",
        }}
      />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.change(screen.getByLabelText(/session 1/i), { target: { value: "19:00" } });
    fireEvent.click(screen.getByRole("button", { name: /save date/i }));

    await waitFor(() => expect(openOfferTier).toHaveBeenCalledWith(expect.anything(), { showDateId: "d1", tier: 1 }));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["bookings"] }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["offer-tiers", "opened", "d1"] });
  });

  const editShowDate = {
    id: "d1", show_id: "s1", date: "2026-07-01",
    session_1: null, session_2: null, session_3: null,
    venue: null, city_id: null, notes: null,
    airtable_record_id: null, status: "open",
  };

  // Regression: `log_show_date_schedule_change` (supabase/migrations/20260620140000_
  // schedule_change_notifications.sql) only fires `AFTER UPDATE OF session_1, session_2,
  // session_3, status` — editing the date, production, venue, city, or notes logs nothing
  // and notifies nobody. The note must name the field that actually notifies (a session
  // time) rather than promise a blanket "changes" guarantee the trigger doesn't back up.
  //
  // Also regression: the in-app `schedule_change` row is inserted ONLY for artists who
  // already have a linked account (`send-confirmation-digest`, `if (b.artists?.user_id)`).
  // Email resolves a recipient from the artist record itself, so it is the channel that
  // actually reaches an account-less booked artist. A blended "in the app and by email"
  // claim would overstate what the in-app row covers, so the two channels get separate
  // clauses.
  it("edit mode splits the email and in-app claims, and names the residual gap, when the confirmation digest is on", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(screen.getByText(/session times go out in the daily summary at 21:00h \(Berlin, Germany\)\./i)).toBeInTheDocument();
    expect(screen.getByText(/artists with an account are also notified in the app/i)).toBeInTheDocument();
    expect(screen.getByText(/anyone with no email and no account is not told/i)).toBeInTheDocument();
  });

  // Regression: `send-confirmation-digest` only inserts the in-app `schedule_change`
  // notification AND sends the email once the org's Berlin hour matches its configured
  // `confirmation_digest_hour_berlin` (`if (berlinHour !== targetHour) continue`), up to
  // ~24h after the edit. Neither channel is immediate, so the note must never claim it is.
  it("never claims the in-app notice is immediate", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    const note = screen.getByText(/session times/i);
    expect(note.textContent).not.toMatch(/right away|immediately|instantly|at once/i);
  });

  // Regression: the note used to fall back to BOOKING_ENGINE_DEFAULTS.confirmation_digest_
  // hour_berlin while useFlowTimes was still loading, so a dialog opened before that query
  // resolved briefly stated the PLATFORM DEFAULT hour even for an org configured to a
  // different one. A plausible but wrong hour is worse than a brief silence, so the note
  // must wait for the real setting instead of guessing.
  it("shows no schedule note while the confirmation hour setting is still loading", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true };
    // mockFlowTimes is left at its default (undefined) to simulate useFlowTimes still
    // in flight — BOOKING_ENGINE_DEFAULTS is imported only to spell out the exact stale
    // value this test proves never renders.
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(screen.queryByText(/session times/i)).not.toBeInTheDocument();
    expect(screen.queryByText(
      new RegExp(`at ${BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin}:00 berlin`, "i"),
    )).not.toBeInTheDocument();
  });

  it("shows the schedule note once the confirmation hour setting finishes loading", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(screen.getByText(/session times/i)).toBeInTheDocument();
  });

  // send-confirmation-digest gates the per-artist EMAIL loop on flow.confirmation_digest
  // specifically (the in-app notification insert above it is not gated on that field), so
  // with the digest off the note must drop the email clause rather than state an hour
  // nothing is sent at. Both channels still wait for the same daily hour, so the note
  // keeps naming it.
  //
  // Regression: with the email off, the in-app row is STILL only inserted for artists who
  // already have an account (see send-confirmation-digest's `if (b.artists?.user_id)`).
  // The old copy said "in the app" as if every booked artist were covered, which is false
  // for an artist added to the roster but not yet invited: with email off, nobody tells
  // them. The note must name the account condition and the resulting gap.
  //
  // Regression: it must also not say "the daily summary" — that is the product's own name
  // for the confirmation digest EMAIL (FlowTimeline's toggle subtitle), which is exactly
  // what this branch's admin just turned off.
  it("names the account condition and the residual gap when the confirmation digest is off", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: false };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(screen.getByText(/session times reach booked artists in the app at 21:00h \(Berlin, Germany\)\./i)).toBeInTheDocument();
    expect(screen.getByText(/anyone without one is not told/i)).toBeInTheDocument();
    expect(screen.queryByText(/by email/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/daily summary/i)).not.toBeInTheDocument();
  });

  // Regression: `log_show_date_schedule_change` fires `AFTER UPDATE OF session_1,
  // session_2, session_3, status` only, so THIS dialog's most prominent field, the date
  // itself, notifies nobody when moved to a different day. The schedule note names session
  // times as the thing that notifies, but a dialog titled "Edit date" leaves that gap easy
  // to miss without saying so directly next to the date field.
  it("states next to the date field that moving the date itself does not notify anyone", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(screen.getByText(/moving the date itself does not notify booked artists/i)).toBeInTheDocument();
  });

  it("does not state the date-move caveat in create mode, since there is no schedule note either", () => {
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" />);
    expect(screen.queryByText(/moving the date itself/i)).not.toBeInTheDocument();
  });

  it("does not state the date-move caveat while the booking flow is off, since nothing notifies then either", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, active: false };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(screen.queryByText(/moving the date itself/i)).not.toBeInTheDocument();
  });

  // send-confirmation-digest `continue`s the whole per-org loop (in-app AND email) when
  // flow.active is false: the shipped "Off" preset. Asserting a schedule the org's own
  // flow has paused would be false, so the note must fall silent instead.
  it("shows no schedule note while the booking flow is off", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, active: false };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(screen.queryByText(/session times/i)).not.toBeInTheDocument();
  });

  // send-confirmation-digest only ever iterates orgs entitled to booking_flow
  // (filterEntitledOrgs); an org without the module has no schedule-change pipeline at all.
  it("shows no schedule note when the org has no booking_flow entitlement", () => {
    mockBookingFlowEnabled = false;
    mockFlow = { ...BOOKING_FLOW_DEFAULTS };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(screen.queryByText(/session times/i)).not.toBeInTheDocument();
  });

  // Regression: the note used to read the org's booking_flow entitlement via `useFeature`,
  // which fails OPEN (reports the registry default, true) while entitlements are still
  // loading. On a cold open for an org that is NOT actually entitled, if `useBookingFlow` +
  // `useFlowTimes` happened to resolve before entitlements did, the note briefly asserted a
  // digest pipeline that org does not have. Reading `useEntitlements().isLoading` fails
  // CLOSED instead (no note while unresolved), matching the same "a plausible but wrong
  // claim is worse than a brief silence" standard the flowTimes-loading test above already
  // holds the note to.
  it("shows no schedule note while the booking_flow entitlement itself is still resolving", () => {
    mockBookingFlowPending = true;
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(screen.queryByText(/session times/i)).not.toBeInTheDocument();
  });

  // Regression: the note used to read the org's booking_flow entitlement through
  // `useModuleGate`, which exempts a non-impersonating super-admin unconditionally
  // (`allow: true` regardless of the org's real entitlement row). That gate is correct for
  // "may this user use the write controls" but wrong for THIS note's factual claim about
  // what send-confirmation-digest will actually do for the org: a super-admin editing a date
  // in a genuinely unentitled org would have seen the note assert a digest pipeline that
  // does not run. `useEntitlements().features` carries no such exemption, so an org with
  // no booking_flow row shows no note even though the mocked useAuth in this suite always
  // reports a non-super-admin caller (super-admin status plays no part in the hook this
  // component now reads).
  it("shows no schedule note for an unentitled org regardless of who is viewing it", () => {
    mockBookingFlowEnabled = false;
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(screen.queryByText(/session times/i)).not.toBeInTheDocument();
  });

  // A synced date's session inputs are disabled here (Airtable owns them), so a note about
  // the consequence of changing a session time in THIS dialog would be untrue.
  it("shows no schedule note for a synced date, since session times cannot be edited here", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={{ ...editShowDate, airtable_record_id: "rec1" }} />);
    expect(screen.queryByText(/session times/i)).not.toBeInTheDocument();
  });

  it("does not show the schedule note in create mode", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" />);
    expect(screen.queryByText(/session times/i)).not.toBeInTheDocument();
  });

  // P3.1: a producer adding a date by hand has no cue that an Airtable-synced workspace
  // keeps syncing independently of what they just typed in here.
  it("states the dates-source note in create mode", () => {
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" />);
    expect(
      screen.getByText(/You can add a date by hand here\. If your workspace syncs from Airtable/),
    ).toBeInTheDocument();
  });

  it("does not state the dates-source note in edit mode", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS };
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(screen.queryByText(/You can add a date by hand here/)).not.toBeInTheDocument();
  });

  // Radix wires DialogDescription to the dialog's aria-describedby. Two descriptions in one
  // dialog would either emit two ids or (worse) two nodes sharing one id. The create-only
  // dates-source note and the edit-only schedule note are mutually exclusive, so a single
  // description must back aria-describedby: assert the referenced id resolves to exactly one
  // node in each mode.
  const describedByCount = (baseElement: HTMLElement) => {
    const dialog = baseElement.querySelector('[role="dialog"]');
    const id = dialog?.getAttribute("aria-describedby");
    if (!id) return 0;
    return baseElement.querySelectorAll(`[id="${id}"]`).length;
  };

  it("backs the dialog's aria-describedby with exactly one description in edit mode", () => {
    mockFlow = { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true };
    mockFlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 21 };
    const { baseElement } = renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={editShowDate} />);
    expect(describedByCount(baseElement)).toBe(1);
  });

  it("backs the dialog's aria-describedby with exactly one description in create mode", () => {
    const { baseElement } = renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" />);
    expect(describedByCount(baseElement)).toBe(1);
    expect(screen.getByText(/You can add a date by hand here/)).toBeInTheDocument();
  });

  // Finding 08: the picker rendered with no `disabled`, so a date could be created in the
  // PAST with no cue at all (a real first-run audit created 28/07/2026 while "today" was
  // 24/08/2026 and nothing objected). The product decision is WARN, not block: back-filling
  // a historical date for records is legitimate and the Airtable sync creates past dates on
  // a path that never touches this dialog. So these tests assert an inline warning and,
  // deliberately, that submit stays enabled.
  describe("past-date warning", () => {
    // Only Date is faked: Radix Popover's open transition rides requestAnimationFrame, and
    // faking timers wholesale would leave the picker's content unmounted.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    // react-day-picker names each day button with its full date, so this picks by calendar
    // day rather than by DOM position. The dialog opens the picker on the selected month,
    // or on today's month when nothing is selected yet, so every day used here is in
    // August 2026.
    const pickDay = (name: RegExp) => {
      fireEvent.click(screen.getByTestId("date-trigger"));
      fireEvent.click(screen.getByRole("button", { name }));
    };

    const PAST = /this date is in the past/i;

    it("warns when the chosen date is in the past", () => {
      renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />);
      pickDay(/August 4th, 2026/);
      // Two nodes now: the persistent sr-only live region and the visible copy.
      expect(screen.getAllByText(PAST).length).toBeGreaterThan(0);
    });

    it("shows no warning for a future date", () => {
      renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />);
      pickDay(/August 28th, 2026/);
      expect(screen.queryByText(PAST)).toBeNull();
    });

    // A date scheduled for later today is not in the past. This is the boundary the naive
    // `new Date(str) < new Date()` comparison gets wrong, since the stored value parses to
    // local midnight, which is always "before now" for any wall clock after 00:00.
    it("shows no warning for today itself", () => {
      renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />);
      pickDay(/August 24th, 2026/);
      expect(screen.queryByText(PAST)).toBeNull();
    });

    // Warn, do not block: the producer must still be able to record a show that already ran.
    it("leaves submit enabled for a past date", () => {
      renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />);
      pickDay(/August 4th, 2026/);
      expect(screen.getByRole("button", { name: /create date/i })).toBeEnabled();
    });

    // An existing historical date is normal data. Nagging every time someone opens the
    // dialog to fix a venue typo would be noise about something they did not do and cannot
    // usefully act on, so the warning stays silent until the date is actually moved.
    it("does not nag about an already-historical date on open in edit mode", () => {
      mockFlow = { ...BOOKING_FLOW_DEFAULTS };
      renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={{ ...editShowDate, date: "2026-07-01" }} />);
      expect(screen.queryByText(PAST)).toBeNull();
    });

    // Moving a date INTO the past in edit mode is the same typo the create path guards
    // against, so the warning must fire there.
    it("warns when an edit moves the date into the past", () => {
      mockFlow = { ...BOOKING_FLOW_DEFAULTS };
      renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={{ ...editShowDate, date: "2026-08-30" }} />);
      expect(screen.queryByText(PAST)).toBeNull();
      pickDay(/August 4th, 2026/);
      // Two nodes now: the persistent sr-only live region and the visible copy.
      expect(screen.getAllByText(PAST).length).toBeGreaterThan(0);
    });

    // A synced date's date field is disabled here (Airtable owns it), so the producer cannot
    // act on the warning at all. Airtable also legitimately syncs past dates. Warning there
    // would be pure noise about something this dialog cannot change.
    it("shows no warning for a synced past date, whose date cannot be edited here", () => {
      mockFlow = { ...BOOKING_FLOW_DEFAULTS };
      renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={{ ...editShowDate, date: "2026-07-01", airtable_record_id: "rec1" }} />);
      expect(screen.queryByText(PAST)).toBeNull();
    });
  });
  // The City select is a plain picker over an org-wide catalog. When that catalog is empty
  // it offered nothing and pointed nowhere, so a producer had no way to learn where cities
  // come from. Cities are managed in Settings > Casts & coverage (the production dialog's
  // inline creator is a second door onto the SAME org catalog, not a per-date one).
  describe("empty city catalog", () => {
    const HINT = /cities are managed for the whole organization in settings|no cities yet/i;

    it("points at where cities are managed when the catalog is empty", () => {
      mockCities = [];
      renderWithProviders(
        <MemoryRouter>
          <ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />
        </MemoryRouter>,
      );
      expect(screen.getByText(HINT)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /casts/i })).toHaveAttribute("href", "/settings?tab=casts-coverage");
    });

    it("shows no hint when the catalog has cities", () => {
      renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />);
      expect(screen.queryByText(HINT)).toBeNull();
    });

    // An empty ARRAY and an unread catalog are different facts. A failed or in flight read
    // must never render as a reassuring "no cities yet".
    it("claims nothing while the catalog read is in flight or failed", () => {
      mockCities = [];
      mockCitiesState = { isLoading: true, isError: false };
      const { unmount } = renderWithProviders(
        <MemoryRouter>
          <ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />
        </MemoryRouter>,
      );
      expect(screen.queryByText(HINT)).toBeNull();
      unmount();

      mockCitiesState = { isLoading: false, isError: true };
      renderWithProviders(
        <MemoryRouter>
          <ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />
        </MemoryRouter>,
      );
      expect(screen.queryByText(HINT)).toBeNull();
    });
  });

  // Both date warnings render inside an open Radix popover, under the calendar. Without a
  // live region a screen-reader user picking a past or duplicate day hears nothing at all.
  // The region has to PRE-EXIST the text: several assistive technologies only announce
  // mutations inside a region that was already there, so a role="status" element that
  // mounts together with its own text is unreliable (PeopleTab has the same pattern).
  describe("date warning announcements", () => {
    const region = () => screen.getByTestId("date-warning-status");

    it("keeps the live region mounted and empty when there is nothing to warn about", () => {
      renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />);
      expect(region()).toHaveAttribute("aria-live", "polite");
      expect(region()).toHaveTextContent("");
    });

    it("announces the past-date warning through that region", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0));
      try {
        renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />);
        fireEvent.click(screen.getByTestId("date-trigger"));
        fireEvent.click(screen.getByRole("button", { name: /August 4th, 2026/ }));
        expect(region()).toHaveTextContent(/this date is in the past/i);
      } finally {
        vi.useRealTimers();
      }
    });
  });
  // The duplicate-date warning shares the past-date warning's spot under the calendar and
  // had the identical gap: rendered inside an open popover with no live region.
  it("announces the duplicate-date warning as a live status", async () => {
    // Pin the clock so the calendar always opens on August 2026 and the "August 28th, 2026" day is
    // a selectable (non-past) button — matching the sibling past-date test above. Without this the
    // test only passed while the real "today" was still in August 2026; it broke once the month rolled over.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0));
    try {
      mockExistingDates = [{ id: "d9", show_id: "s1", date: "2026-08-28", status: "open" }];
      renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" defaultShowId="s1" />);
      fireEvent.click(screen.getByTestId("date-trigger"));
      fireEvent.click(screen.getByRole("button", { name: /August 28th, 2026/ }));
      await screen.findAllByText(/a non-cancelled date already exists/i);
      expect(screen.getByTestId("date-warning-status")).toHaveTextContent(
        /a non-cancelled date already exists/i,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
