import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ROUTES } from "@/config/app.config";

// The "Add or import artists" affordance is the `add_artists` capability, not a booking
// setting, so the panel has to ask for that one specifically. Mocked rather than seeded so
// the ON/OFF states are one line each (the same pattern as SettingsPage.test.tsx).
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useCan } from "@/hooks/useCapabilities";
import { buttonVariants } from "@/components/ui/button";
import { PeopleStep } from "./PeopleStep";

beforeEach(() => {
  vi.mocked(useCan).mockReturnValue(true);
});

describe("PeopleStep", () => {
  it("says there is nobody to book while the roster is empty", () => {
    renderWithProviders(<MemoryRouter><PeopleStep count={0} /></MemoryRouter>);
    expect(screen.getByText(/nobody to book/i)).toBeInTheDocument();
  });

  it("states the consequence in terms every flow shares, not just offers", () => {
    // A direct-book org (artist_acceptance false) never opens a tier, so wording the
    // blocker as "no offers can go out" would describe a pipeline it does not run. What
    // is true under every preset is that an empty roster leaves nobody to book.
    renderWithProviders(<MemoryRouter><PeopleStep count={0} /></MemoryRouter>);
    expect(screen.queryByText(/offer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\btier\b/i)).not.toBeInTheDocument();
    expect(screen.getByText(/can be booked/i)).toBeInTheDocument();
  });

  it("reports the roster size as ACTIVE artists, the ones a tier can reach", () => {
    // fetchArtistCount is scoped to status = 'active' to match the offer engine, so the
    // panel must not overstate it as the whole roster.
    renderWithProviders(<MemoryRouter><PeopleStep count={4} /></MemoryRouter>);
    expect(screen.getByText(/4 active artists on your roster/i)).toBeInTheDocument();
    expect(screen.queryByText(/nobody to book/i)).not.toBeInTheDocument();
  });

  it("singularizes a one-artist roster", () => {
    renderWithProviders(<MemoryRouter><PeopleStep count={1} /></MemoryRouter>);
    expect(screen.getByText(/1 active artist on your roster/i)).toBeInTheDocument();
  });

  it("does not claim an empty roster while the count is still unread", () => {
    renderWithProviders(<MemoryRouter><PeopleStep count={null} /></MemoryRouter>);
    expect(screen.queryByText(/nobody to book/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/on your roster/i)).not.toBeInTheDocument();
  });

  it("names where the login invite lives instead of leaving it dangling", () => {
    renderWithProviders(<MemoryRouter><PeopleStep count={0} /></MemoryRouter>);
    expect(screen.getByText(/from the artist card/i)).toBeInTheDocument();
  });

  it("does not promise a control an org that revoked invite rights will not show", () => {
    // The artist card's invite button is `invite_artists` (admin, or a producer whose org
    // kept producer_can_invite). Without it the card has no invite control at all, so the
    // promise has to move to whoever can keep it.
    vi.mocked(useCan).mockImplementation((action: string) => action !== "invite_artists");
    renderWithProviders(<MemoryRouter><PeopleStep count={0} /></MemoryRouter>);
    expect(screen.queryByText(/from the artist card/i)).not.toBeInTheDocument();
    expect(screen.getByText(/an admin can send login invites later/i)).toBeInTheDocument();
    // Adding is a different right and is unaffected.
    expect(screen.getByRole("link", { name: /add or import artists/i })).toBeInTheDocument();
  });

  it("still says an account is not a prerequisite when invites are someone else's job", () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "invite_artists");
    renderWithProviders(<MemoryRouter><PeopleStep count={0} /></MemoryRouter>);
    expect(screen.getByText(/no account is needed/i)).toBeInTheDocument();
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
    // so only the card address exists, so no account is needed to add one.
    renderWithProviders(<MemoryRouter><PeopleStep count={0} /></MemoryRouter>);
    expect(screen.queryByText(/reach(es)?\s+them/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/anything the app emails/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/an artist with no account is emailed at the address on their card/i),
    ).toBeInTheDocument();
  });

  it("links to the artists page, where both adding and importing live", () => {
    renderWithProviders(<MemoryRouter><PeopleStep count={0} /></MemoryRouter>);
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
    renderWithProviders(<MemoryRouter><PeopleStep count={0} /></MemoryRouter>);
    const classes = screen.getByRole("link", { name: /add or import artists/i }).className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(buttonVariants({ size: "sm" }).split(/\s+/)));
  });

  it("does not call an all-parked roster a roster that was never started", () => {
    // fetchArtistCount counts ACTIVE artists only, so this branch also covers an org whose
    // whole roster is set inactive between seasons. "No active artists yet" would tell them
    // they never added anyone.
    renderWithProviders(<MemoryRouter><PeopleStep count={0} /></MemoryRouter>);
    expect(screen.queryByText(/yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No active artists, so there is nobody to book/i)).toBeInTheDocument();
  });

  it("offers no add link to a viewer who may not add artists", () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "add_artists");
    renderWithProviders(<MemoryRouter><PeopleStep count={0} /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: /add or import artists/i })).not.toBeInTheDocument();
    // The consequence still has to be readable: they need to know why booking is stuck.
    expect(screen.getByText(/nobody to book/i)).toBeInTheDocument();
  });
});
