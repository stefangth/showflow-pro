import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { BlockKind, BookingSetupStep } from "@/lib/bookings/setupStatus";

vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

// The embedded PeopleStep reads the role for its admin-only "invite the rest of your team"
// line (ROUTES.ADMIN is admin-gated), and the card itself now reads it for the producer
// role-explainer note. This card is the NON-editor surface, so its viewer defaults to a
// producer; `authRef.value.role` flips to "admin" in the one test that needs it.
const { authRef } = vi.hoisted(() => ({ authRef: { value: { role: "producer" as "producer" | "admin" } } }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({
    hasRole: (r: string) => r === authRef.value.role,
    currentOrg: { id: "org-1", name: "Test Org", slug: "test-org", status: "active" },
  }),
}));

// list_org_admin_names is fetched through this hook; stubbed rather than routed through the
// real supabase singleton (never vi.mock the client). `namesRef` lets each test pick its own
// admin roster without a new mock factory. `adminNamesSpy` records the (orgId, options) the
// card passes, so the enabled-gating (fetch only while waiting on an admin) can be asserted.
const { namesRef, adminNamesSpy } = vi.hoisted(() => ({
  namesRef: { value: [] as string[] },
  adminNamesSpy: vi.fn(),
}));
vi.mock("@/hooks/useOrgAdminNames", () => ({
  useOrgAdminNames: (orgId: string | undefined, options?: { enabled?: boolean }) => {
    adminNamesSpy(orgId, options);
    return { data: namesRef.value };
  },
}));

import { useCan } from "@/hooks/useCapabilities";
import i18n from "@/i18n";
import { producerRoleNote, roleExplainerLinkLabel, ROLE_EXPLAINER_LINK_ROUTE } from "@/lib/dashboard/moduleOnboarding";

const PRODUCER_ROLE_NOTE = producerRoleNote(i18n.getFixedT("en", "onboarding"));
const ROLE_EXPLAINER_LINK_LABEL = roleExplainerLinkLabel(i18n.getFixedT("en", "onboarding"));
import { BookingProducerWaitingCard } from "./BookingProducerWaitingCard";

// `hard` is the wording computeBookingSetupStatus gives the two hard blockers, and it
// follows the org's flow (blockFor in src/lib/bookings/setupStatus.ts): "offers" for an
// org that runs them, "booking" for a direct-book org and for an unread flow. This card is
// the surface that got reworded for the direct-book case, so its fixtures can produce both.
const steps = (
  over: Partial<Record<string, boolean>> = {},
  hard: BlockKind = "offers",
): BookingSetupStep[] => [
  { key: "flow", done: over.flow ?? true, block: null },
  { key: "people", done: over.people ?? false, block: hard },
  { key: "slots", done: over.slots ?? false, block: "filling" },
  { key: "ladder", done: over.ladder ?? false, block: hard },
  { key: "eligibility", done: over.eligibility ?? true, block: null },
  { key: "timing", done: over.timing ?? true, block: null },
];

const render = (s: BookingSetupStep[], count: number | null, inactive: number | null = null) =>
  renderWithProviders(
    <MemoryRouter>
      <BookingProducerWaitingCard steps={s} artistCount={count} inactiveArtistCount={inactive} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.mocked(useCan).mockReturnValue(true);
  authRef.value.role = "producer";
  namesRef.value = [];
  adminNamesSpy.mockClear();
});

describe("BookingProducerWaitingCard", () => {
  it("lists the admin-gated blockers as locked", () => {
    render(steps(), 0);
    expect(screen.getByText("Slots per show")).toBeInTheDocument();
    expect(screen.getByText("Cast priorities per city")).toBeInTheDocument();
  });

  // The regression this card exists to close: the dashboard and bookings rails render an
  // enabled "Add artists" CTA for a producer (adding artists is not a booking-settings
  // edit), and that CTA opens the setup sheet, which lands here. Before this, the producer
  // was shown "Add your artists" as a LOCKED row: an enabled button leading to a padlock.
  it("makes the roster step actionable rather than locking it behind the admin", () => {
    render(steps(), 0);
    // This card has no step rows, so it carries none of the rail's hints: what the producer
    // reads is the panel's own state and mechanism lines.
    expect(screen.getByText(/no active artists right now/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add or import artists/i })).toBeInTheDocument();
  });

  it("passes the parked-roster count through, so the producer reads the same reconciliation", () => {
    // This card embeds the very same PeopleStep and sends the producer to the very same
    // unfiltered ArtistsPage, so dropping the second count here would leave exactly one of
    // the two roles staring at two numbers that do not add up.
    render(steps(), 0, 6);
    expect(
      screen.getByText(/the artists page lists 6 artists on this roster whose status is not active/i),
    ).toBeInTheDocument();
  });

  it("reports the active roster size once artists exist", () => {
    render(steps({ people: true }), 6);
    // Done, so it is neither a locked row nor an outstanding panel.
    expect(screen.queryByText(/no active artists right now/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /add or import artists/i })).not.toBeInTheDocument();
  });

  it("does not tell a producer to wait on an admin when the roster is the only thing left", () => {
    render(steps({ slots: true, ladder: true }), 0);
    expect(screen.queryByText(/an admin has to finish setup/i)).not.toBeInTheDocument();
    expect(screen.getByText("Your move")).toBeInTheDocument();
    expect(screen.getByText(/that one is yours/i)).toBeInTheDocument();
  });

  it("never calls the roster their move when the org revoked their right to add artists", () => {
    // producer_can_add_artists is a real org toggle. With it off this viewer has no add
    // control anywhere (PeopleStep below drops its link for the same reason), so "Your
    // move" would hand them a job and no way to do it. The roster is an admin's then.
    vi.mocked(useCan).mockImplementation((action: string) => action !== "add_artists");
    render(steps({ slots: true, ladder: true }), 0);
    expect(screen.queryByText("Your move")).not.toBeInTheDocument();
    expect(screen.queryByText(/that one is yours/i)).not.toBeInTheDocument();
    expect(screen.getByText(/an admin has to finish setup/i)).toBeInTheDocument();
    // The panel still renders: they need to read why booking is stuck.
    expect(screen.getByText(/only artists on this roster whose status is active can be booked/i)).toBeInTheDocument();
    expect(screen.getByText(/no active artists right now/i)).toBeInTheDocument();
  });

  it("still says an admin has to finish setup while admin-gated steps are outstanding", () => {
    render(steps(), 0);
    expect(screen.getByText(/an admin has to finish setup/i)).toBeInTheDocument();
  });

  it("words the wait for every flow, not just the offer ones", () => {
    // This card has no flow read of its own, and a direct-book org (artist_acceptance
    // false) never opens a tier or sends an offer, so both variants of its copy have to
    // hold under every preset. PeopleStep inside it already states the consequence that
    // way; a frame that still says "offer later" around it describes a different product
    // from the panel it wraps.
    //
    // Scoped to the eyebrow/heading/description block (the "Plan dates now, book later"
    // paragraph's own parent), not the whole card: the producer role-explainer note added
    // below it is allowed to say "run offers" (a role's general capabilities, not this
    // org's pipeline) without tripping this guard on the framing sentence itself.
    const waitingOnAdmin = render(steps(), 0);
    const waitingIntro = within(waitingOnAdmin.container).getByText("Plan dates now, book later").parentElement;
    expect(waitingIntro?.textContent).not.toMatch(/offer|\btiers?\b/i);
    expect(waitingOnAdmin.container.textContent).toContain("Plan dates now, book later");
    expect(waitingOnAdmin.container.textContent).toContain("before anyone can be booked");

    const yourMove = render(steps({ slots: true, ladder: true }), 0);
    const yourMoveIntro = within(yourMove.container).getByText("Plan dates now, book later").parentElement;
    expect(yourMoveIntro?.textContent).not.toMatch(/offer|\btiers?\b/i);
    expect(yourMove.container.textContent).toContain("blocking the first booking");
  });

  it("reads the same under the booking-worded blockers a direct-book org actually produces", () => {
    // The test above pins this copy against `block: "offers"` fixtures, which is the one
    // flow whose org would never have been shown the reworded sentences in the first place.
    // A direct-book org (artist_acceptance false) reaches this card with `block: "booking"`
    // on the same two rows, so the wording is pinned under those props too.
    //
    // Scoped the same way as the test above, for the same reason: the role-explainer note
    // is allowed to say "run offers" without tripping the framing sentence's own guard.
    const waitingOnAdmin = render(steps({}, "booking"), 0);
    const waitingIntro = within(waitingOnAdmin.container).getByText("Plan dates now, book later").parentElement;
    expect(waitingIntro?.textContent).not.toMatch(/offer|\btiers?\b/i);
    expect(waitingOnAdmin.container.textContent).toContain("Plan dates now, book later");
    expect(waitingOnAdmin.container.textContent).toContain("before anyone can be booked");
    // The hard blockers still list as locked: "booking" and "offers" are one gate, so which
    // word the chip carries must not change what the card counts as outstanding.
    expect(waitingOnAdmin.container.textContent).toContain("Cast priorities per city");

    const yourMove = render(steps({ slots: true, ladder: true }, "booking"), 0);
    const yourMoveIntro = within(yourMove.container).getByText("Plan dates now, book later").parentElement;
    expect(yourMoveIntro?.textContent).not.toMatch(/offer|\btiers?\b/i);
    expect(yourMove.container.textContent).toContain("Your move");
    expect(yourMove.container.textContent).toContain("blocking the first booking");
  });

  it("claims only the blockers, not the whole checklist, when the roster is the last one", () => {
    // `outstanding` filters to steps that actually block something (`block !== null`), so
    // flow, eligibility and timing are never in it. They can still be unfinished while this
    // branch renders, which made "the last thing the first booking needs" false: the first
    // booking also needs a chosen flow. What holds is the narrower claim about blockers.
    const r = render(steps({ slots: true, ladder: true, flow: false, timing: false }), 0);
    expect(r.container.textContent).toContain("Your move");
    expect(r.container.textContent).toContain("the last thing blocking the first booking");
    expect(r.container.textContent).not.toContain("the last thing the first booking needs");
  });

  it("drops the add link for a producer who may not add artists, keeping the reason", () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "add_artists");
    render(steps(), 0);
    expect(screen.queryByRole("link", { name: /add or import artists/i })).not.toBeInTheDocument();
    expect(screen.getByText(/only artists on this roster whose status is active can be booked/i)).toBeInTheDocument();
    expect(screen.getByText(/no active artists right now/i)).toBeInTheDocument();
  });

  // P2.3: today the waiting body names a nameless "an admin". list_org_admin_names gives it
  // the org's real admin display names, via useOrgAdminNames + adminAskLine.
  describe("naming the org's admins", () => {
    it("asks the real admins by name when list_org_admin_names returns them", () => {
      namesRef.value = ["Nadia Okonkwo", "Tom Reeve"];
      render(steps(), 0);
      expect(
        screen.getByText(
          "Nothing stops you adding dates and sessions. Ask Nadia Okonkwo or Tom Reeve to finish setup before anyone can be booked.",
        ),
      ).toBeInTheDocument();
    });

    it("falls back to the existing generic copy, unchanged, when there are no admin names yet", () => {
      namesRef.value = [];
      render(steps(), 0);
      expect(
        screen.getByText(
          "Nothing stops you adding dates and sessions. An admin has to finish setup before anyone can be booked.",
        ),
      ).toBeInTheDocument();
    });

    // Efficiency: the admin names feed only the "waiting on your admin" body, so the query is
    // gated on that state. When the roster is the producer's own move, the fetch is skipped.
    it("fetches admin names only while waiting on an admin", () => {
      render(steps(), 0); // admin-gated blockers outstanding -> waiting on admin
      expect(adminNamesSpy).toHaveBeenLastCalledWith("org-1", { enabled: true });
    });

    it("does not fetch admin names when the roster is the producer's own move", () => {
      render(steps({ slots: true, ladder: true }), 0); // only the roster left, and canAdd -> your move
      expect(adminNamesSpy).toHaveBeenLastCalledWith("org-1", { enabled: false });
    });
  });

  // P0.2: a producer had no reachable explanation of what "Production Team" covers versus
  // the admin. This card is the surface a producer actually lands on while blocked, so it
  // carries the same PRODUCER_ROLE_NOTE the dashboard rail's complete-state rules do
  // (see moduleOnboarding.test.ts), plus a real link to the full breakdown.
  describe("role explainer", () => {
    it("tells a producer what the Production Team role covers, with a link to the full breakdown", () => {
      render(steps(), 0);
      expect(screen.getByText(new RegExp(PRODUCER_ROLE_NOTE.slice(0, 30)))).toBeInTheDocument();
      const link = screen.getByRole("link", { name: ROLE_EXPLAINER_LINK_LABEL });
      expect(link).toHaveAttribute("href", ROLE_EXPLAINER_LINK_ROUTE);
    });

    it("is absent for an admin viewer", () => {
      authRef.value.role = "admin";
      render(steps(), 0);
      expect(screen.queryByText(new RegExp(PRODUCER_ROLE_NOTE.slice(0, 30)))).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: ROLE_EXPLAINER_LINK_LABEL })).not.toBeInTheDocument();
    });
  });
});
