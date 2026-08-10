import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ROUTES } from "@/config/app.config";
import { bookingOnboarding } from "@/lib/dashboard/moduleOnboarding";

// The "Add or import artists" affordance is the `add_artists` capability, not a booking
// setting, so the panel has to ask for that one specifically. Mocked rather than seeded so
// the ON/OFF states are one line each (the same pattern as SettingsPage.test.tsx).
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

// The team-invite line points at /admin, which is an ADMIN-ONLY route (App.tsx), and no
// capability distinguishes an admin from a producer who was granted one: CAPABILITY_DEFS
// only ever grants a producer something an admin already has. So the panel reads the role,
// and the tests drive it from here.
const { rolesRef } = vi.hoisted(() => ({ rolesRef: { value: ["admin"] as string[] } }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: (r: string) => rolesRef.value.includes(r) }),
}));

import { useCan } from "@/hooks/useCapabilities";
import { buttonVariants } from "@/components/ui/button";
import { PeopleStep } from "./PeopleStep";

// Both props are required on the component (a host that forgets the parked count would
// otherwise silently drop the reconciliation the panel exists to make), so the tests that
// do not care about the parked half say so explicitly here rather than in every render.
const renderPeople = (count: number | null, inactiveCount: number | null = null) =>
  renderWithProviders(
    <MemoryRouter><PeopleStep count={count} inactiveCount={inactiveCount} /></MemoryRouter>,
  );

beforeEach(() => {
  vi.mocked(useCan).mockReturnValue(true);
  rolesRef.value = ["admin"];
});

describe("PeopleStep", () => {
  it("says the roster holds no active artists while it is empty", () => {
    renderPeople(0);
    expect(screen.getByText(/no active artists right now/i)).toBeInTheDocument();
  });

  it("does not reprint the row hint it renders directly underneath", () => {
    // SetupStepRow keeps the step's hint in the row header while the panel is expanded, and
    // the default first-run path lands here with the row already open (FlowStep's onDone
    // opens `people`; the dashboard rail's "Add artists" opens the sheet at `people`). So a
    // sentence in both is printed twice, two lines apart. The hint owns the consequence,
    // this panel owns the mechanism, the counts and the address/invite explanation.
    const { container } = renderPeople(0, 6);
    const hint = bookingOnboarding.steps.people.todoHint;
    expect(container.textContent).not.toContain(hint);
    // The opening clause duplicated in meaning too ("Nobody to book until your roster has
    // active artists." over "No active artists, so there is nobody to book."), which no
    // amount of exact-string checking would have caught.
    expect(container.textContent).not.toMatch(/nobody to book/i);
  });

  it("states the consequence in terms every flow shares, not just offers", () => {
    // A direct-book org (artist_acceptance false) never opens a tier, so wording the
    // blocker as "no offers can go out" would describe a pipeline it does not run. What
    // is true under every preset is that only an active artist can be booked.
    renderPeople(0);
    expect(screen.queryByText(/offer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\btier\b/i)).not.toBeInTheDocument();
    expect(screen.getByText(/only artists on this roster whose status is active can be booked/i)).toBeInTheDocument();
  });

  it("reports the roster size as ACTIVE artists, the ones a tier can reach", () => {
    // fetchArtistCount is scoped to status = 'active' to match the offer engine, so the
    // panel must not overstate it as the whole roster.
    renderPeople(4);
    expect(screen.getByText(/4 active artists on your roster/i)).toBeInTheDocument();
    expect(screen.queryByText(/no active artists right now/i)).not.toBeInTheDocument();
  });

  it("singularizes a one-artist roster", () => {
    renderPeople(1);
    expect(screen.getByText(/1 active artist on your roster/i)).toBeInTheDocument();
  });

  it("does not claim an empty roster while the count is still unread", () => {
    renderPeople(null);
    expect(screen.queryByText(/no active artists right now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/on your roster/i)).not.toBeInTheDocument();
  });

  it("names where the login invite lives instead of leaving it dangling", () => {
    renderPeople(0);
    expect(screen.getByText(/from the artist card/i)).toBeInTheDocument();
  });

  it("does not promise a control an org that revoked invite rights will not show", () => {
    // The artist card's invite button is `invite_artists` (admin, or a producer whose org
    // kept producer_can_invite). Without it the card has no invite control at all, so the
    // promise has to move to whoever can keep it.
    vi.mocked(useCan).mockImplementation((action: string) => action !== "invite_artists");
    renderPeople(0);
    expect(screen.queryByText(/from the artist card/i)).not.toBeInTheDocument();
    expect(screen.getByText(/an admin can send login invites later/i)).toBeInTheDocument();
    // Adding is a different right and is unaffected.
    expect(screen.getByRole("link", { name: /add or import artists/i })).toBeInTheDocument();
  });

  it("still says an account is not a prerequisite when invites are someone else's job", () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "invite_artists");
    renderPeople(0);
    expect(screen.getByText(/before they ever sign in/i)).toBeInTheDocument();
  });

  it("scopes the address claim to the artist it is actually true for", () => {
    // Every other sentence on this panel branches on something. This one cannot, so it has
    // to hold in every state, and two separate over-claims are ruled out.
    //
    // Delivery: the "off" preset (every digest function skips a paused org) and a
    // direct-book org with the confirmation digest switched off email an artist nothing at
    // all, so "emails reach them" is false in both.
    //
    // Address: resolveContactEmail (supabase/functions/_shared/identity.ts, ADR-0011)
    // returns the AUTH email first and only falls back to the artist card, so "anything the
    // app emails an artist goes to the address on their card" is false for a registered
    // artist. create-invitation can link an invite to an artist row at a different address,
    // after which every digest goes to the login address, not the card.
    //
    // The unregistered case is what survives, and it is the point being made: no account,
    // so only the card address exists, so the artist can be added before they ever sign in.
    //
    // It is stated as ROUTING, not as a send. "An artist with no account IS EMAILED at the
    // address on their card" reads as a promise that mail goes out, and this is the one
    // sentence on the panel that does not branch on `flow.active`, so under the "off" preset
    // (every digest function skips a paused org) it was the panel's only false claim. "Any
    // email for X goes to Y" is true whether or not this org ever sends one.
    const { container } = renderPeople(0);
    expect(screen.queryByText(/reach(es)?\s+them/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/anything the app emails/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/is emailed/i);
    expect(
      screen.getByText(/any email for an artist with no account goes to the address on their card/i),
    ).toBeInTheDocument();
  });

  it("tells an admin that producers and fellow admins join somewhere else entirely", () => {
    // The step is titled "Add your artists" and every word under it is about the roster, so
    // an admin who works this rail end to end is never told the rest of their team exists as
    // a thing to invite. The roster is not that surface: an artist row is a catalog record,
    // while a producer or admin is an org membership created from Admin, People. Naming it
    // in one clause is the difference between "my org is set up" and "my org is set up and I
    // am the only person in it".
    renderPeople(0);
    expect(screen.getByRole("link", { name: /admin, people/i })).toHaveAttribute("href", ROUTES.ADMIN);
    expect(screen.getByText(/this roster is artists only/i)).toBeInTheDocument();
  });

  it("does not send a producer to the admin-only page that invites them", () => {
    // ROUTES.ADMIN is `requiredRoles={['admin']}` in App.tsx, so for a producer this line
    // would name a control they cannot open, and a page they would be bounced off.
    rolesRef.value = ["producer"];
    renderPeople(0);
    expect(screen.queryByRole("link", { name: /admin, people/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/this roster is artists only/i)).not.toBeInTheDocument();
    // Everything the roster panel is actually for still reads.
    expect(screen.getByText(/only artists on this roster whose status is active can be booked/i)).toBeInTheDocument();
  });

  it("says who can be added rather than what 'one' refers to", () => {
    // "...so no account is needed to add one" left "one" pointing at either the account or
    // the artist. The subject is named instead.
    const { container } = renderPeople(0);
    expect(container.textContent).not.toMatch(/to add one/i);
    expect(screen.getByText(/so you can add an artist before they ever sign in/i)).toBeInTheDocument();
  });

  it("links to the artists page, where both adding and importing live", () => {
    renderPeople(0);
    expect(screen.getByRole("link", { name: /add or import artists/i })).toHaveAttribute("href", ROUTES.ARTISTS);
  });

  it("carries the add control as the panel's primary action, like its sibling panels", () => {
    // Every host that composes the booking steps (DashboardPage, ShowsBookingsPage,
    // HireOrdersPage) passes onStepAction, so the step's "Add artists" CTA opens this panel
    // instead of navigating. If the panel then ends in a paragraph with a text link buried
    // in it, that CTA has promised an action and delivered reading. FlowStep, SlotsStep and
    // TimingStep all close with a primary Button; so does this one.
    //
    // Compared against the real `buttonVariants` output rather than a hardcoded utility
    // string: the claim is "this is a default-variant sm Button", and a token or variant
    // rename should move both sides together instead of failing a test about a class name.
    renderPeople(0);
    const classes = screen.getByRole("link", { name: /add or import artists/i }).className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(buttonVariants({ size: "sm" }).split(/\s+/)));
  });

  it("does not call an all-parked roster a roster that was never started", () => {
    // fetchArtistCount counts ACTIVE artists only, so this branch also covers an org whose
    // whole roster is set inactive between seasons. "No active artists yet" would tell them
    // they never added anyone.
    const { container } = renderPeople(0);
    expect(container.textContent).not.toMatch(/\byet\b/i);
    expect(screen.getByText(/your roster has no active artists right now/i)).toBeInTheDocument();
  });

  it("reconciles its active count with the fuller roster the artists page will show", () => {
    // The panel counts ACTIVE artists; ArtistsPage renders every artist with a status badge
    // and applies no default status filter. Without this line an org reads "no active
    // artists", clicks the CTA, and lands on a page listing six people, left to work out
    // for itself which number is lying. So the line names that page rather than making the
    // reader infer which surface the second number belongs to.
    renderPeople(0, 6);
    expect(screen.getByText(/your roster has no active artists right now/i)).toBeInTheDocument();
    expect(
      screen.getByText(/the artists page lists 6 artists on this roster whose status is not active/i),
    ).toBeInTheDocument();
  });

  it("does not restate the bookability rule the panel already opened with", () => {
    // Line one is the rule ("only ... active can be booked"); this line is a fact about six
    // specific records. Ending it "...and cannot be booked" re-derived the rule from the
    // fact three rows below where the rule was stated, which is the same say-it-twice fault
    // the row hint above the panel was fixed for.
    const { container } = renderPeople(0, 6);
    expect(container.textContent).not.toMatch(/cannot be booked/i);
    expect(
      screen.getByText(/only artists on this roster whose status is active can be booked/i),
    ).toBeInTheDocument();
  });

  it("adds the same reconciliation to a roster that is only partly parked", () => {
    renderPeople(2, 3);
    expect(screen.getByText(/2 active artists on your roster/i)).toBeInTheDocument();
    expect(
      screen.getByText(/the artists page lists 3 artists on this roster whose status is not active/i),
    ).toBeInTheDocument();
  });

  it("singularizes one parked artist", () => {
    renderPeople(2, 1);
    expect(
      screen.getByText(/the artists page lists 1 artist on this roster whose status is not active/i),
    ).toBeInTheDocument();
  });

  it("says nothing about parked artists when there are none, or when the count is unread", () => {
    // Same rule as the active count: the panel states no number it cannot vouch for, and a
    // failed or still-loading read is not a claim that the roster is fully active. The count
    // is decorative, so its absence must not change what the panel says about booking.
    for (const inactive of [0, null]) {
      const { unmount } = renderPeople(2, inactive);
      expect(screen.queryByText(/whose status is not active/i)).not.toBeInTheDocument();
      expect(screen.getByText(/2 active artists on your roster/i)).toBeInTheDocument();
      unmount();
    }
  });

  it("drops the parked line when the active count is the read that failed", () => {
    // The two counts are separate reads and the parked one is deliberately outside the
    // active one's loading/error handling, so "active unreadable, parked readable" is a
    // reachable state. On its own, "the artists page lists 6 artists on this roster whose
    // status is not active." is a number with nothing to reconcile it against, which is the
    // exact confusion the line was added to remove.
    renderPeople(null, 6);
    expect(screen.queryByText(/whose status is not active/i)).not.toBeInTheDocument();
  });

  it("offers no add link to a viewer who may not add artists", () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "add_artists");
    renderPeople(0);
    expect(screen.queryByRole("link", { name: /add or import artists/i })).not.toBeInTheDocument();
    // The consequence still has to be readable: they need to know why booking is stuck.
    expect(screen.getByText(/only artists on this roster whose status is active can be booked/i)).toBeInTheDocument();
    expect(screen.getByText(/no active artists right now/i)).toBeInTheDocument();
  });
});
