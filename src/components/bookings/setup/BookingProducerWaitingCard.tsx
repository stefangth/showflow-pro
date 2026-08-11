import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useOrgAdminNames } from "@/hooks/useOrgAdminNames";
import { adminAskLine } from "@/data/orgAdmins";
import { STEP_TITLES, type BookingSetupStep } from "@/lib/bookings/setupStatus";
import { PRODUCER_ROLE_NOTE, ROLE_EXPLAINER_LINK_LABEL, ROLE_EXPLAINER_LINK_ROUTE } from "@/lib/dashboard/moduleOnboarding";
import { PeopleStep } from "./PeopleStep";

/** Shown instead of the rail when the viewer lacks `edit_booking_settings`. Lists only
 *  steps that actually block something. Names the org's real admins where it can
 *  (`list_org_admin_names`, unlike `list_org_members`, is not admin-guarded: any member
 *  may call it), falling back to the generic "an admin" line when nobody has a display
 *  name yet. Adding dates and sessions is unaffected, which is the point.
 *
 *  `people` is deliberately NOT in the locked list. Adding artists is roster work gated by
 *  `add_artists`, not by booking settings, and a producer reaches this card by pressing the
 *  step's own "Add artists" CTA: every DashboardSetupRail host that composes the booking
 *  steps (DashboardPage, the ShowsBookingsPage banner, HireOrdersPage) passes
 *  `onStepAction`, so that CTA renders as a button that opens SetupChecklistSheet at this
 *  step rather than as the `ctaRoute` Link it falls back to elsewhere. Rendering `people`
 *  as a padlock would make that button land on a locked row. It gets the real panel
 *  instead. (ArtistDashboard renders the rail with no `onStepAction`, but it composes
 *  ARTIST_ONBOARDING, which has no booking steps and never reaches this card.) */
export function BookingProducerWaitingCard({
  steps,
  artistCount,
  inactiveArtistCount,
}: {
  steps: BookingSetupStep[];
  artistCount: number | null;
  /** The parked rest of the roster, carried straight through to the embedded PeopleStep:
   *  this card sends the producer to the same unfiltered ArtistsPage the admin rail does,
   *  so it owes them the same reconciliation. */
  inactiveArtistCount: number | null;
}) {
  // Same capability PeopleStep asks for, and for the same reason: with
  // producer_can_add_artists off this viewer has no add control anywhere, so the roster is
  // an admin's job too and the card must not claim otherwise.
  const canAdd = useCan("add_artists");
  // Real names for the waiting body: any member (incl. producer) may call
  // list_org_admin_names, unlike the admin-guarded list_org_members. adminAskLine returns
  // null with no admin names yet (nobody has set a display name), so the fallback below
  // keeps the card's original generic wording rather than going blank.
  const { currentOrg, hasRole } = useAuth();
  const { data: adminNames } = useOrgAdminNames(currentOrg?.id);
  const askLine = adminAskLine(adminNames ?? []);
  const peopleOutstanding = steps.some((s) => s.key === "people" && !s.done);
  const outstanding = steps.filter((s) => !s.done && s.block !== null && s.key !== "people");
  // "Your move" is earned, not assumed: the roster has to be the only thing left AND
  // something this viewer may actually do. Everything else keeps the waiting framing. A
  // card with nothing outstanding at all does not arise: useBookingSetupRailVisible hides
  // this surface for a non-editor the moment canOffer flips true.
  const yourMove = outstanding.length === 0 && peopleOutstanding && canAdd;
  const waitingOnAdmin = !yourMove;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          {/* Amber is the "blocked on someone else" colour; when the only thing left is
              theirs it is not a warning, so it takes the accent the rail's own actionable
              blocks use. */}
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${waitingOnAdmin ? "text-[var(--amber-600)]" : "text-accent-700"}`}>
            {waitingOnAdmin ? "Waiting on your admin" : "Your move"}
          </p>
          {/* Worded for every flow. This card takes no flow of its own, and a direct-book
              org (artist_acceptance false) never opens a tier or sends an offer, so
              "offer later" / "before a tier can open" would name a pipeline it does not
              run. What holds under every preset is that setup has to finish before anyone
              is booked. PeopleStep below states its consequence the same way. */}
          <p className="mt-1.5 font-display text-base font-semibold">Plan dates now, book later</p>
          <p className="mt-1 text-xs leading-[19px] text-muted-foreground">
            {/* "Blocking", not "needs": `outstanding` above filters to steps that actually
                block something (block !== null), so flow, eligibility and timing are never
                in it and can still be unfinished when this branch renders. The first
                booking also needs a chosen flow; what this viewer can be told is that the
                roster is the last thing standing in its way. */}
            {waitingOnAdmin
              ? `Nothing stops you adding dates and sessions. ${askLine ?? "An admin has to finish setup before anyone can be booked."}`
              : "Nothing stops you adding dates and sessions. The roster is the last thing blocking the first booking, and that one is yours."}
          </p>
        </div>
        {/* A producer's reachable explanation of what "Production Team" covers versus the
            admin (see PRODUCER_ROLE_NOTE). Gated on role rather than assumed: nothing in
            CAPABILITY_DEFS lets an org revoke edit_booking_settings from an admin
            (useCan short-circuits true for hasRole("admin")), so in practice only a
            producer ever reaches this card, but the note stays keyed to the role it is
            actually true for. */}
        {!hasRole("admin") && (
          <div className="rounded-md border border-border p-2.5">
            <p className="text-xs text-muted-foreground">
              {PRODUCER_ROLE_NOTE}{" "}
              <Link to={ROLE_EXPLAINER_LINK_ROUTE} className="text-primary underline">
                {ROLE_EXPLAINER_LINK_LABEL}
              </Link>
            </p>
          </div>
        )}
        {peopleOutstanding && (
          <div className="rounded-md border border-border p-2.5">
            <p className="text-sm">{STEP_TITLES.people}</p>
            <div className="mt-2">
              <PeopleStep count={artistCount} inactiveCount={inactiveArtistCount} />
            </div>
          </div>
        )}
        <div className="space-y-2">
          {outstanding.map((s) => (
            <div key={s.key} className="flex items-center gap-2 rounded-md border border-border p-2.5">
              <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{STEP_TITLES[s.key] ?? s.key}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
