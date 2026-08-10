import { Link } from "react-router-dom";
import { ROUTES } from "@/config/app.config";
import { useCan } from "@/hooks/useCapabilities";
import { Button } from "@/components/ui/button";

/** Read-only: how many ACTIVE artists the roster holds, and why an empty one stops the
 *  first booking. The count is scoped to active in `fetchArtistCount` because that is the
 *  population open-offer-tier reads, so this panel states it that way rather than
 *  overselling a roster full of parked records.
 *
 *  Worded for every flow, not just the offer ones. A direct-book org (artist_acceptance
 *  false) never opens a tier, so "no offers can go out" would describe a pipeline it does
 *  not run; what an empty roster costs under every preset is that there is nobody to book.
 *
 *  `count` is null while the read is loading or failed, in which case the panel states
 *  neither a size nor an emptiness it cannot vouch for. */
export function PeopleStep({ count }: { count: number | null }) {
  // Adding artists is roster work, not a booking-settings edit, so it has its own
  // capability. A producer without it still reads the consequence, just without the CTA.
  const canAdd = useCan("add_artists");
  // The artist card's invite control is `invite_artists` (admin, or a producer whose org
  // kept producer_can_invite). Promising it to a viewer whose card has no invite button
  // would send them looking for a control that is not there.
  const canInvite = useCan("invite_artists");
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Only artists on this roster whose status is active can be booked.
      </p>
      {/* Scoped to the artist it is true for, and stated as a mechanism rather than as a
          promise of mail. Two shipped states email an artist nothing at all (the "off"
          preset, which every digest function skips, and a direct-book org with
          confirmation_digest off), so "emails reach them" is not true under every flow. And
          the address is not universal either: resolveContactEmail (identity.ts, ADR-0011)
          returns the AUTH email first and falls back to the card, so a registered artist is
          reached at their login address, which create-invitation can set to something other
          than the card. The unregistered artist is where the claim holds, and that is the
          case being made: no account, so only the card address exists. */}
      <p className="text-xs text-muted-foreground">
        An artist with no account is emailed at the address on their card, so no account is
        needed to add one.{" "}
        {canInvite
          ? "You can send a login invite from the artist card whenever you like."
          : "An admin can send login invites later."}
      </p>
      {count === null ? null : count === 0 ? (
        // Not "no active artists YET": this branch also covers an established org that
        // parked its whole roster between seasons, and telling them they never added
        // anyone would be wrong. The count is of active artists either way.
        <p className="text-xs text-muted-foreground">
          No active artists, so there is nobody to book.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {count} active artist{count === 1 ? "" : "s"} on your roster.
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
