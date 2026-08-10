import { Link } from "react-router-dom";
import { ROUTES } from "@/config/app.config";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { Button } from "@/components/ui/button";

/** Read-only: how many ACTIVE artists the roster holds, and what it takes to add one. The
 *  count is scoped to active in `fetchArtistCount` because that is the population
 *  open-offer-tier reads, so this panel states it that way rather than overselling a roster
 *  full of parked records.
 *
 *  Restates the row hint nowhere. `bookingOnboarding.steps.people.todoHint` ("Nobody to book
 *  until your roster has active artists.") is printed by SetupStepRow in the row header and
 *  stays there while this panel is expanded underneath it, and the default first-run path
 *  arrives with the row already open. Answering it here ("No active artists, so there is
 *  nobody to book.") printed one fact twice, two lines apart, and the card-address sentence
 *  was in both verbatim. One owner per fact: the row states what is broken, this panel
 *  states the mechanism, the numbers and how an artist gets added. Held by the
 *  no-reprint test in PeopleStep.test.tsx and end to end in BookingSetupRail.test.tsx.
 *
 *  BookingProducerWaitingCard embeds this panel with no step row at all, so the mechanism
 *  line has to stand on its own there: it opens with what makes an artist bookable rather
 *  than assuming a hint above it.
 *
 *  Worded for every flow, not just the offer ones. A direct-book org (artist_acceptance
 *  false) never opens a tier, so "no offers can go out" would describe a pipeline it does
 *  not run; what an empty roster costs under every preset is that there is nobody to book.
 *
 *  `count` is null while the read is loading or failed, in which case the panel states
 *  neither a size nor an emptiness it cannot vouch for.
 *
 *  `inactiveCount` is the rest of the roster (every status that is not active). It closes
 *  the gap between this panel and the page its own CTA opens: ArtistsPage lists every
 *  artist with no default status filter, so without it an org that parked its roster reads
 *  "no active artists" here and sees six people there. Required (a host that forgot it
 *  would silently drop the reconciliation rather than fail to compile) but nullable for the
 *  same reason as `count`: it is a reconciliation, not a blocker, so a failed or absent read
 *  drops the line rather than blocking or distorting the rest of the panel. It arrives as a
 *  prop rather than being read here because this panel is composed by two different hosts
 *  and only one of them knows whether it is on screen (see `useInactiveArtistCount`). */
export function PeopleStep({
  count,
  inactiveCount,
}: {
  count: number | null;
  inactiveCount: number | null;
}) {
  // Adding artists is roster work, not a booking-settings edit, so it has its own
  // capability. A producer without it still reads the mechanism, just without the CTA.
  const canAdd = useCan("add_artists");
  // The artist card's invite control is `invite_artists` (admin, or a producer whose org
  // kept producer_can_invite). Promising it to a viewer whose card has no invite button
  // would send them looking for a control that is not there.
  const canInvite = useCan("invite_artists");
  // Read as a ROLE, not as a capability: CAPABILITY_DEFS only ever grants a producer
  // something an admin already has, so no `useCan` answer separates the two, and
  // ROUTES.ADMIN is `requiredRoles={['admin']}` in App.tsx.
  const { hasRole } = useAuth();
  const isOrgAdmin = hasRole("admin");
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Only artists on this roster whose status is active can be booked.
      </p>
      {count === null ? null : count === 0 ? (
        // A state, not a restatement of the row hint above it, and not "no active artists
        // YET": this branch also covers an established org that parked its whole roster
        // between seasons, and telling them they never added anyone would be wrong.
        <p className="text-xs text-muted-foreground">
          Your roster has no active artists right now.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {count} active artist{count === 1 ? "" : "s"} on your roster.
        </p>
      )}
      {/* Reads under either branch above, which is why it is worded as a standalone fact
          rather than as "N more" or "N others": at count 0 there is nothing for it to be
          more than. Built as one string so the sentence cannot be split across text nodes.

          Names the artists page rather than ending "...and cannot be booked". That clause
          was entailed by the panel's first line, three rows up, so it restated the rule at
          the exact distance where saying something twice reads as two different facts. What
          is NOT entailed, and is the only reason this line exists, is which surface the
          second number belongs to: the CTA below opens ArtistsPage, which applies no default
          status filter, so an org told "no active artists" here lands on a page listing six.

          Gated on the ACTIVE count as well as its own: the two counts are separate reads and
          this one sits outside the other's loading/error handling, so "active unreadable,
          parked readable" is reachable, and on its own this line is a number with nothing to
          reconcile it against. That is the confusion it exists to remove. */}
      {count != null && inactiveCount != null && inactiveCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {inactiveCount === 1
            ? "The artists page lists 1 artist on this roster whose status is not active."
            : `The artists page lists ${inactiveCount} artists on this roster whose status is not active.`}
        </p>
      )}
      {/* Scoped twice over: to the artist the claim is true for, and to routing rather than
          to sending.

          WHO: the address is not universal. resolveContactEmail (identity.ts, ADR-0011)
          returns the AUTH email first and falls back to the card, so a registered artist is
          reached at their login address, which create-invitation can set to something other
          than the card. The unregistered artist is where the claim holds, and that is the
          case being made: no account, so only the card address exists.

          WHETHER: this is the one sentence on the panel that cannot branch on the org's flow,
          so it must hold under every preset, and two shipped states email an artist nothing
          at all (the "off" preset, which every digest function skips, and a direct-book org
          with confirmation_digest off). "An artist with no account IS EMAILED at ..." reads
          as a send. "Any email for an artist with no account GOES TO ..." is a routing rule:
          true whether or not this org ever sends one.

          The subject is named ("add an artist") rather than left as "add one", which read
          as either the account or the artist. */}
      <p className="text-xs text-muted-foreground">
        Any email for an artist with no account goes to the address on their card, so you can
        add an artist before they ever sign in.{" "}
        {canInvite
          ? "You can send a login invite from the artist card whenever you like."
          : "An admin can send login invites later."}
      </p>
      {/* The step is titled "Add your artists" and everything above is the roster, so an
          admin who works this rail end to end is never told the rest of their team is a
          thing to invite. They are two different objects: an artist is a catalog row (which
          is why an account is optional, three lines up), while a producer or a fellow admin
          is an org MEMBERSHIP, created from Admin, People and from nowhere else. One clause,
          because this panel is not that surface; it just stops the roster from reading as
          the whole answer to "invite my people".

          Admin-gated, because ROUTES.ADMIN is admin-only: for a producer this would name a
          page they get bounced off. */}
      {isOrgAdmin && (
        <p className="text-xs text-muted-foreground">
          This roster is artists only. Producers and fellow admins are invited from{" "}
          <Link to={ROUTES.ADMIN} className="text-primary underline">Admin, People</Link>.
        </p>
      )}
      {/* A real primary action, not a text link in a paragraph. Every host that composes
          the booking steps (DashboardPage, ShowsBookingsPage, HireOrdersPage) passes
          onStepAction, so the step's "Add artists" CTA opens this panel instead of
          navigating: if the panel then only explains, that CTA promised an action and
          delivered reading. FlowStep, SlotsStep and TimingStep all close the same way.
          (ArtistDashboard also renders DashboardSetupRail without onStepAction, but it
          composes ARTIST_ONBOARDING and never reaches this panel.) */}
      {canAdd && (
        <Button size="sm" asChild>
          <Link to={ROUTES.ARTISTS}>Add or import artists</Link>
        </Button>
      )}
    </div>
  );
}
