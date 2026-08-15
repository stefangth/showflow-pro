import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
// Per-action, not a single boolean: the rail body gates on `edit_booking_settings` while
// the roster panel inside it gates on `add_artists`, and the whole point of the producer
// path below is that those two answers differ.
const { canRef } = vi.hoisted(() => ({ canRef: { value: {} as Record<string, boolean> } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: (action: string) => canRef.value[action] ?? true }));
// Rehearsal makes an edge call; stub it out for the shell test.
vi.mock("./RehearsalBlock", () => ({ RehearsalBlock: () => null }));
// FlowStep (the default-open step) reads useBookingFlow, which calls useAuth() for
// currentOrg. Real AuthContext requires an AuthProvider this shell test doesn't wrap.
// Same stub FlowStep.test.tsx and RehearsalBlock.test.tsx use for the same reason.
// Held in hoisted refs (and spied) because the rail's own footer sentence is composed from
// both: it states the org's real schedule, and it must not be paid for by a viewer who
// never sees it.
const { flowRef, timesRef, timesSpy } = vi.hoisted(() => ({
  flowRef: { value: undefined as unknown },
  timesRef: { value: undefined as unknown },
  timesSpy: vi.fn(),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowRef.value }),
  useFlowTimes: (orgId?: string | null) => { timesSpy(orgId); return { data: timesRef.value }; },
}));
// Editor Mode is admin-or-super-admin (editorAccess.canUseEditor) and the roster panel's
// team-invite line is admin-only, so both read the role rather than a capability: no
// capability separates an admin from a producer who was granted one.
const { authRef } = vi.hoisted(() => ({
  authRef: { value: { roles: ["admin"] as string[], isSuperAdmin: false } },
}));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({
    roles: authRef.value.roles,
    isSuperAdmin: authRef.value.isSuperAdmin,
    hasRole: (r: string) => authRef.value.roles.includes(r),
  }),
}));

import { createFakeSupabase, type TableSeed, type RecordedCall } from "@/test/supabaseFake";
function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}
const calls = () => client.calls as RecordedCall[];

/** An org whose whole roster is parked: the array seed routes the readiness read
 *  (eq status = 'active') to 0 and the people panel's own read (neq) to 6. */
const parkedRoster: Record<string, TableSeed> = {
  app_settings: { data: [], error: null },
  shows: { data: [], error: null },
  show_dates: { data: [], error: null },
  show_cast_eligibility: { data: [], error: null },
  cast_city_priority: { data: [], error: null },
  artists: [
    { when: { status: "active" }, data: null, error: null, count: 0 },
    { data: null, error: null, count: 6 },
  ],
};

import { BookingSetupRail } from "./BookingSetupRail";
import { bookingOnboarding, VIEW_AS_ARTIST_TIP, TEAM_STEP_META } from "@/lib/dashboard/moduleOnboarding";
import { describeTonight, describeTonightStandalone } from "@/lib/bookings/timingCopy";
import { BOOKING_FLOW_DEFAULTS, applyPreset, type FlowTimes } from "@/lib/bookingFlow";
import i18n from "@/i18n";

// timingCopy now sources its strings from the `bookingCopy` namespace; bind an English `t`
// so these assertions match the component's rendered (byte-identical) English output.
const tBooking = i18n.getFixedT("en", "bookingCopy");

/** A real normalized flow and a real set of hours, so the footer sentence is the engine's
 *  own rather than a literal this test agrees with itself about. */
const classic = applyPreset(BOOKING_FLOW_DEFAULTS, "classic");
const direct = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
const hours: FlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };

beforeEach(() => {
  localStorage.clear();
  canRef.value = {};
  authRef.value = { roles: ["admin"], isSuperAdmin: false };
  flowRef.value = undefined;
  timesRef.value = undefined;
  timesSpy.mockClear();
  seed({
    app_settings: { data: [], error: null },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
    artists: { data: null, error: null, count: 0 },
  });
});

describe("BookingSetupRail", () => {
  it("renders the six steps with a blocking chip on people, ladder and slots", async () => {
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText("Booking flow")).toBeInTheDocument();
    expect(screen.getByText("Add your artists")).toBeInTheDocument();
    expect(screen.getByText("Slots per show")).toBeInTheDocument();
    expect(screen.getByText("Cast priorities per city")).toBeInTheDocument();
    expect(screen.getByText("Who is eligible")).toBeInTheDocument();
    expect(screen.getByText("Email timing")).toBeInTheDocument();
    // people and ladder both block offers HERE, because this org runs them. Awaited, not
    // read synchronously: both chips follow the org's flow, and until that read lands
    // people carries the flow-neutral "Blocks booking" while ladder carries none at all
    // (it is a blocker for an offers org only).
    await waitFor(() => expect(screen.getAllByText("Blocks offers")).toHaveLength(2));
    expect(screen.getByText("Blocks filling")).toBeInTheDocument();
  });

  // The chip is the one line a direct-book admin reads next to "Add your artists", and it
  // used to promise them an offer pipeline their org does not run: their flow never opens a
  // tier, so nothing they do here unblocks an offer.
  it("chips a direct-book org only where it is really blocked, and never as offers", async () => {
    // Two different claims, and only one of them survives this flow.
    //
    // The empty roster is a hard gate under every preset (nobody to offer to, nobody to
    // book), so it is chipped, in the wording that is true for an org which never opens a
    // tier: "Blocks booking".
    //
    // The unranked ladder is NOT. cast_city_priority and the priority column on
    // show_cast_eligibility are read by resolveTierLadder and fetchOfferTiers, both
    // offer-only; the direct-book picker is deriveDirectBookList over useEligibleArtists,
    // which reads the cast rows and ignores their priority. This org books every date with
    // nothing ranked, so a chip there was a definite falsehood on the rail.
    seed({
      app_settings: {
        data: [{ key: "booking_flow", org_id: "org-1", value: { artist_acceptance: false } }],
        error: null,
      },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: { data: null, error: null, count: 0 },
    });
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText("Add your artists")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Blocks booking")).toHaveLength(1));
    expect(screen.queryByText("Blocks offers")).not.toBeInTheDocument();
  });

  it("opens the people panel with the empty-roster consequence and an artists link", async () => {
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" initialStep="people" /></MemoryRouter>);
    expect(await screen.findByText(/nobody to book/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add or import artists/i })).toBeInTheDocument();
  });

  it("says each thing once across the row hint and the panel under it", async () => {
    // The duplication this guards is only visible once composed: SetupStepRow keeps the row
    // hint on screen while the panel is expanded beneath it, and this is the DEFAULT first
    // run state (FlowStep's onDone opens `people`, and the dashboard's "Add artists" opens
    // the sheet here). The row printed "Nobody to book until your roster has active
    // artists." and the panel answered "No active artists, so there is nobody to book." two
    // lines lower, plus the same card-address sentence verbatim in both.
    const { container } = renderWithProviders(
      <MemoryRouter><BookingSetupRail orgId="org-1" initialStep="people" /></MemoryRouter>,
    );
    // The row owns the consequence.
    expect(await screen.findByText(/nobody to book/i)).toBeInTheDocument();
    expect(container.textContent?.match(/nobody to book/gi)).toHaveLength(1);
    // The panel owns the state and the mechanism, and says neither of them twice.
    expect(await screen.findByText(/no active artists right now/i)).toBeInTheDocument();
    expect(container.textContent?.match(/the address on their card/gi)).toHaveLength(1);
  });

  it("reconciles the people panel's active count with the roster its own CTA opens", async () => {
    // End to end for the two head counts: the rail's CTA goes to ArtistsPage, which lists
    // every artist with no default status filter, so an all-parked org must not be sent
    // there having just been told there is nobody on the roster. The array seed routes the
    // eq('status','active') query to 0 and the neq one to 6.
    seed(parkedRoster);
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" initialStep="people" /></MemoryRouter>);
    expect(await screen.findByText(/nobody to book/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/the artists page lists 6 artists on this roster whose status is not active/i),
    ).toBeInTheDocument();
  });

  it("only pays for the parked-roster count while the panel that prints it is open", async () => {
    // The parked count decorates one sentence inside a collapsed panel, so it is read on
    // demand rather than folded into the readiness hook every admin and producer surface
    // calls. `neq` is that read's signature (the readiness count eq's status = 'active').
    seed(parkedRoster);
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" initialStep="flow" /></MemoryRouter>);
    expect(await screen.findByText("Add your artists")).toBeInTheDocument();
    // Everything else the rail reads has settled by now, so a missing neq is a real absence.
    await waitFor(() => expect(screen.getAllByText("Blocks offers").length).toBeGreaterThan(0));
    expect(calls().some((c) => c.table === "artists" && c.method === "neq")).toBe(false);

    // ...and it does fire once the admin opens that panel.
    fireEvent.click(screen.getByRole("button", { name: /Add your artists/ }));
    expect(
      await screen.findByText(/the artists page lists 6 artists on this roster whose status is not active/i),
    ).toBeInTheDocument();
  });

  it("does not pay for the parked count for a non-editor whose roster step is already done", async () => {
    // The non-editor branch renders BookingProducerWaitingCard, which embeds PeopleStep only
    // while the roster step is OUTSTANDING. Gating the read on `!canEdit` alone billed every
    // producer for a head count whose sentence their card was never going to print.
    seed({
      app_settings: { data: [], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: [
        { when: { status: "active" }, data: null, error: null, count: 3 },
        { data: null, error: null, count: 6 },
      ],
    });
    canRef.value = { edit_booking_settings: false };
    authRef.value = { roles: ["producer"], isSuperAdmin: false };
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    // A locked row proves the readiness reads have all landed, so a missing neq is a real
    // absence rather than a race.
    expect(await screen.findByText("Slots per show")).toBeInTheDocument();
    expect(screen.queryByText(/no active artists right now/i)).not.toBeInTheDocument();
    expect(calls().some((c) => c.table === "artists" && c.method === "neq")).toBe(false);
  });

  it("says what the engine will do without anyone opening the timing row", async () => {
    // The gap this closes: `describeTonight` renders inside TimingStep, the sixth row, and
    // every row is collapsed unless opened (the rail seeds `flow`, and FlowStep's onDone
    // jumps to `people`). An admin who works the rail top to bottom and never expands
    // "Email timing" never reads what the schedule they just configured will actually do.
    flowRef.value = classic;
    timesRef.value = hours;
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText(describeTonightStandalone(hours, classic, tBooking)!)).toBeInTheDocument();
  });

  it("hands the sentence back to the panel that owns it once that panel is open", async () => {
    // TimingStep prints the same narrative from the LIVE field values, next to a scope note
    // that carries the timezone. Printing the saved version underneath would put the fact on
    // one card twice and, mid-edit, in two different versions.
    flowRef.value = classic;
    timesRef.value = hours;
    renderWithProviders(
      <MemoryRouter><BookingSetupRail orgId="org-1" initialStep="timing" /></MemoryRouter>,
    );
    expect(await screen.findByText(describeTonight(hours, classic, tBooking)!)).toBeInTheDocument();
    expect(screen.getAllByText(describeTonight(hours, classic, tBooking)!)).toHaveLength(1);
  });

  it("prints the direct-book org's one live hour, which nothing else on this rail states", async () => {
    // The shipped "direct" preset keeps confirmation_digest on, so send-confirmation-digest
    // mails its artists daily. RehearsalBlock returns null for that org (no tier to
    // rehearse) and the timing row is collapsed, so the rail used to say nothing at all
    // about the one thing this org's engine really does.
    flowRef.value = direct;
    timesRef.value = hours;
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText(describeTonightStandalone(hours, direct, tBooking)!)).toBeInTheDocument();
    expect(screen.queryByText(/When a tier opens/)).not.toBeInTheDocument();
  });

  it("says nothing about the pipeline while the org's flow is still unread", async () => {
    // Same rule as every other flow-aware line on this rail: BOOKING_FLOW_DEFAULTS has
    // acceptance on, so defaulting would narrate a digest pipeline to a direct-book or
    // paused org until the settings read lands.
    timesRef.value = hours;
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText("Add your artists")).toBeInTheDocument();
    expect(screen.queryByText(/When a tier opens/)).not.toBeInTheDocument();
  });

  it("does not bill a non-editor for a schedule their card never prints", async () => {
    // A viewer without `edit_booking_settings` gets BookingProducerWaitingCard instead of
    // the rail body, so the footer never renders for them. The reads live in the footer's
    // own component rather than in this one, which is what makes that true of the queries
    // and not just of the pixels.
    canRef.value = { edit_booking_settings: false };
    authRef.value = { roles: ["producer"], isSuperAdmin: false };
    flowRef.value = classic;
    timesRef.value = hours;
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText(/Waiting on your admin/i)).toBeInTheDocument();
    expect(timesSpy).not.toHaveBeenCalled();
  });

  it("suggests viewing the app as an artist while setup is still unfinished", async () => {
    // The research gap is specifically that nothing suggests view-as DURING onboarding. As a
    // `rules` entry the tip only ever reached an admin who had already finished, so it also
    // renders here, on the surface that carries the unfinished steps: this rail is in
    // "banner" mode until `status.complete`, at which point useBookingSetupRailVisible
    // demotes it to the permanent "button" (SetupChecklistSheet then renders this same
    // component, so the tip stays reachable, it just stops being on screen unprompted).
    // Not `canOffer`: that flag gates who the rail is ACTIONABLE for, and an editor stays
    // actionable either way (`canEdit || !status.canOffer`).
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText(VIEW_AS_ARTIST_TIP.title)).toBeInTheDocument();
    expect(screen.getByText(VIEW_AS_ARTIST_TIP.hint)).toBeInTheDocument();
  });

  it("keeps the view-as tip away from a producer who can edit booking settings", async () => {
    // `edit_booking_settings` is grantable to a producer, so the rail body is reachable
    // without being an admin. Editor Mode is not: canUseEditor is admin-or-super-admin, and
    // the pencil is simply absent from their toolbar.
    authRef.value = { roles: ["producer"], isSuperAdmin: false };
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText("Add your artists")).toBeInTheDocument();
    expect(screen.queryByText(VIEW_AS_ARTIST_TIP.title)).not.toBeInTheDocument();
  });

  it("gives the view-as tip to a super-admin who holds no membership in this org", async () => {
    // `roles` is membership-scoped, so a super-admin dropped into an org they never joined
    // has none at all, and canUseEditor's super-admin arm is the whole reason their toolbar
    // survives an org switch. The tip follows the control.
    authRef.value = { roles: [], isSuperAdmin: true };
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText(VIEW_AS_ARTIST_TIP.title)).toBeInTheDocument();
  });

  it("opens the step named by initialStep", async () => {
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" initialStep="timing" /></MemoryRouter>);
    const timingToggle = await screen.findByRole("button", { name: /Email timing/ });
    expect(timingToggle).toHaveAttribute("aria-expanded", "true");
    const flowToggle = screen.getByRole("button", { name: /Booking flow/ });
    expect(flowToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("takes its header from the shared onboarding registry, not a second copy", async () => {
    // The header was a verbatim duplicate of `bookingOnboarding.railHeader`, which the
    // ShowsBookingsPage banner renders through useModuleOnboardingRail. Two copies of one
    // sentence on two surfaces of the same module is how the direct-book org ended up being
    // told about "the first offer" on this card after the chips beneath it had been fixed.
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText(bookingOnboarding.railHeader.title)).toBeInTheDocument();
    expect(screen.getByText(bookingOnboarding.railHeader.body)).toBeInTheDocument();
  });

  it("takes every step hint from the shared onboarding registry, not a second copy", async () => {
    // Two copies of this string existed; the rail must read the registry so a reworded hint
    // cannot land on the dashboard rail and not here.
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText(bookingOnboarding.steps.people.todoHint)).toBeInTheDocument();
    expect(screen.getByText(bookingOnboarding.steps.slots.todoHint)).toBeInTheDocument();
    expect(screen.getByText(bookingOnboarding.steps.timing.todoHint)).toBeInTheDocument();
  });

  it("shows the waiting card to a viewer who cannot edit booking settings", async () => {
    canRef.value = { edit_booking_settings: false };
    // Force an offers-blocking gap so a non-editor is shown the card at all.
    seed({
      app_settings: { data: [], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [{ show_id: "s1", city_id: "c1" }], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: { data: null, error: null, count: 0 },
    });
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText(/Waiting on your admin/i)).toBeInTheDocument();
    expect(screen.queryByText("Blocks filling")).not.toBeInTheDocument();
  });

  // Regression: both setup rails hand a producer an ENABLED "Add artists" CTA (the step is
  // gated on add_artists, which they have), and that CTA opens the setup sheet onto this
  // component. Gating the whole body on edit_booking_settings sent them to a padlocked
  // "Add your artists" row instead of the panel the button promised.
  it("gives a producer the actionable roster panel, not a padlock, behind the artists CTA", async () => {
    canRef.value = { edit_booking_settings: false, add_artists: true };
    seed({
      app_settings: { data: [], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [{ show_id: "s1", city_id: "c1" }], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: { data: null, error: null, count: 0 },
    });
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" initialStep="people" /></MemoryRouter>);
    // The waiting card renders the panel without the rail's step rows, so it carries no
    // hint: the reason has to be readable from the panel's own lines.
    expect(await screen.findByText(/no active artists right now/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add or import artists/i })).toBeInTheDocument();
  });

  it("shows the admin the production-team row and augments the count to 8 while incomplete", async () => {
    // beforeEach seeds an admin + a blank (incomplete) org, so the admin-only, non-gating team
    // nudge is the first row and the header counts the seven engine steps plus it.
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText(TEAM_STEP_META.title)).toBeInTheDocument();
    expect(screen.getByText(/Set up · \d+ of 8/)).toBeInTheDocument();
  });

  it("hides the production-team row from a producer and keeps the count at seven", async () => {
    // A producer with edit_booking_settings (default) sees the full rail, but the team nudge is
    // admin-only, so their step set and count are unchanged from the pre-nudge seven.
    authRef.value = { roles: ["producer"], isSuperAdmin: false };
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText("Get your shows in")).toBeInTheDocument();
    expect(screen.queryByText(TEAM_STEP_META.title)).not.toBeInTheDocument();
    expect(screen.getByText(/Set up · \d+ of 7/)).toBeInTheDocument();
  });

  it("hides the team row and drops the admin count back to seven once setup is complete", async () => {
    // Non-gating: SetupChecklistSheet renders this rail even when complete (button mode), so the
    // team nudge must vanish there too, matching the dashboard rail + banner (injectAdminTeamStep)
    // rather than perpetually showing "7 of 8" for an admin org with no producer. A direct-book
    // flow (active) + a fully-slotted show + no upcoming dates + a roster clears every engine step.
    seed({
      app_settings: {
        data: [
          { key: "booking_flow", org_id: "org-1", value: { active: true, artist_acceptance: false } },
          { key: "offer_response_window_hours", org_id: "org-1", value: 48 },
          { key: "offer_digest_hour_berlin", org_id: "org-1", value: 19 },
          { key: "confirmation_digest_hour_berlin", org_id: "org-1", value: 20 },
        ],
        error: null,
      },
      shows: { data: [{ id: "s1", program: "X", sub_program: null, main_cast_slots: 4, understudy_slots: 2, status: "active" }], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: { data: null, error: null, count: 3 },
    });
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Set up · 7 of 7/)).toBeInTheDocument());
    expect(screen.queryByText(TEAM_STEP_META.title)).not.toBeInTheDocument();
  });
});
