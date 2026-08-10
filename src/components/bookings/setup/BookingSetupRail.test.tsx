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
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }),
  useFlowTimes: () => ({ data: undefined }),
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
import { bookingOnboarding } from "@/lib/dashboard/moduleOnboarding";

beforeEach(() => {
  localStorage.clear();
  canRef.value = {};
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
    expect(container.textContent?.match(/emailed at the address on their card/gi)).toHaveLength(1);
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
});
