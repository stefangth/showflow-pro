import { useState } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { canUseEditor } from "@/features/editor/editorAccess";
import { useCan } from "@/hooks/useCapabilities";
import { useBookingSetupStatus, useInactiveArtistCount, useProducerCount } from "@/hooks/useBookingSetup";
import { type BookingSetupStepKey } from "@/lib/bookings/setupStatus";
import { bookingOnboarding, VIEW_AS_ARTIST_TIP, TEAM_STEP_META } from "@/lib/dashboard/moduleOnboarding";
import { SETUP_BLOCK_CHIPS } from "@/lib/dashboard/setupBlocks";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SetupStepRow } from "@/components/setup/SetupStepRow";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import { ShowsStep } from "./ShowsStep";
import { FlowStep } from "./FlowStep";
import { PeopleStep } from "./PeopleStep";
import { SlotsStep } from "./SlotsStep";
import { LadderStep } from "./LadderStep";
import { EligibilityStep } from "./EligibilityStep";
import { TimingStep } from "./TimingStep";
import { TeamStep } from "./TeamStep";
import { TonightNote } from "./TonightNote";
import { RehearsalBlock } from "./RehearsalBlock";
import { BookingProducerWaitingCard } from "./BookingProducerWaitingCard";

// Titles and hints come from `bookingOnboarding.steps`, the same registry the dashboard
// rail renders, so the two surfaces cannot word the same step differently. This file used
// to hold a second copy of every string.
const META = bookingOnboarding.steps;
// The header is read the same way, for the same reason. It was a verbatim duplicate of the
// registry's, which the ShowsBookingsPage banner renders through useModuleOnboardingRail:
// two copies of one sentence on two surfaces of the same module, so a fix to either could
// land on one and not the other.
const HEADER = bookingOnboarding.railHeader;

/**
 * The bookings setup rail beside the Shows and bookings table. Renders nothing once setup
 * is complete or the viewer hid it (that decision lives in `useBookingSetupRailVisible`,
 * which the page also reads to choose its grid template). Setup happens here, but every
 * panel writes through the same path as its Settings card.
 */
export function BookingSetupRail({ orgId, initialStep }: { orgId: string | null; initialStep?: BookingSetupStepKey }) {
  const canEdit = useCan("edit_booking_settings");
  // Editor Mode is admin-or-super-admin, never a capability (see editorAccess.canUseEditor),
  // and `roles` is scoped to the active org, so the super-admin arm is what keeps the tip in
  // step with the toolbar for someone visiting an org they never joined.
  const { roles, isSuperAdmin, hasRole } = useAuth();
  // The "Add your production team" nudge is admin-only: producers do the planning/offers/
  // confirming this rail is about, but inviting the team is the admin's job (see TEAM_STEP_META).
  const isAdmin = hasRole("admin");
  const { status, coverage, artistCount, isLoading } = useBookingSetupStatus(orgId);
  const [, dismiss] = useRailDismissed("bookingSetup", orgId);
  const [open, setOpen] = useState<BookingSetupStepKey | "team" | null>(initialStep ?? (isAdmin ? "team" : "shows"));
  // `!isLoading` is load-bearing, not belt-and-braces: an unread roster is reported
  // outstanding (the engine treats a null count as 0), so this is true for every org for the
  // first frame, and firing the read there would defeat the gate for all of them. Waiting
  // costs the panel nothing, since its parked line needs the ACTIVE count to have landed too.
  const peopleOutstanding = !isLoading && status.steps.some((s) => s.key === "people" && !s.done);
  // Read on demand rather than as part of readiness: this count decorates one sentence in
  // PeopleStep, and the condition below is exactly when that sentence is on screen. An
  // editor sees the panel when the roster row is expanded; everyone else gets the waiting
  // card, which embeds the panel only while the roster step is still outstanding. Gating the
  // non-editor arm on `!canEdit` alone billed every producer for a head count their card was
  // never going to print. Declared before the early return so the hook order is fixed.
  const inactiveArtistCount = useInactiveArtistCount(orgId, canEdit ? open === "people" : peopleOutstanding);
  // Admin-only, so a producer/artist rail never pays for this read. Declared before the early
  // return so the hook order is fixed regardless of which branch renders below.
  const producerCount = useProducerCount(orgId, isAdmin);

  // The roster step is not gated by `edit_booking_settings`, so the waiting card gets the
  // count and renders it as real work rather than as one more padlock.
  if (!canEdit) {
    return (
      <BookingProducerWaitingCard
        steps={status.steps}
        artistCount={artistCount}
        inactiveArtistCount={inactiveArtistCount}
      />
    );
  }

  const toggle = (key: BookingSetupStepKey) => setOpen((cur) => (cur === key ? null : key));

  // The team nudge is non-gating: it never enters the engine's status (setupStatus.ts), so it
  // does not affect canOffer/complete. For admins it is displayed as one extra row, so the
  // header count and the progress rail are augmented by hand here (and only here).
  const teamDone = (producerCount ?? 0) > 0;
  const doneCount = status.doneCount + (isAdmin && teamDone ? 1 : 0);
  const totalCount = status.totalCount + (isAdmin ? 1 : 0);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Set up · {doneCount} of {totalCount}
            </p>
            <Button variant="ghost" size="sm" className="h-auto p-1 text-xs" onClick={dismiss}>Hide</Button>
          </div>
          <p className="mt-1.5 font-display text-base font-semibold">{HEADER.title}</p>
          <p className="mt-1 text-xs leading-[19px] text-muted-foreground">{HEADER.body}</p>
          {/* Count-based fill, left to right (mirrors DashboardWelcome's progress dots): the
              first `doneCount` segments light regardless of WHICH steps are done, so the rail
              reads like a normal progress bar. Per-step fill lit a later done step while an
              earlier undone one stayed grey (e.g. artists done, booking flow not), which reads
              as broken. The numbered rows below still show exactly which step is done. */}
          <div className="mt-3 flex gap-1">
            {Array.from({ length: totalCount }).map((_, i) => (
              <span key={i} className={`h-[3px] w-full rounded-full ${i < doneCount ? "bg-accent-500" : "bg-muted"}`} />
            ))}
          </div>
        </div>
        <div>
          {/* Admin-only, non-gating, and first in the list: it precedes the engine rows and
              offsets their 1-based index by one. It has its own inline onToggle because
              `toggle` is typed to the engine keys; `block` is null so it never chips. */}
          {isAdmin && (
            <SetupStepRow
              index={1}
              title={TEAM_STEP_META.title}
              hint={teamDone ? TEAM_STEP_META.doneHint : TEAM_STEP_META.todoHint}
              done={teamDone}
              block={null}
              expanded={open === "team"}
              onToggle={() => setOpen((cur) => (cur === "team" ? null : "team"))}
            >
              <TeamStep />
            </SetupStepRow>
          )}
          {status.steps.map((s, i) => (
            <SetupStepRow
              key={s.key}
              index={i + 1 + (isAdmin ? 1 : 0)}
              title={META[s.key].title}
              hint={s.done ? META[s.key].doneHint : META[s.key].todoHint}
              done={s.done}
              block={s.block ? SETUP_BLOCK_CHIPS[s.block] : null}
              expanded={open === s.key}
              onToggle={() => toggle(s.key)}
            >
              {s.key === "shows" && <ShowsStep />}
              {s.key === "flow" && <FlowStep orgId={orgId} onDone={() => setOpen("people")} />}
              {s.key === "people" && (
                <PeopleStep count={artistCount} inactiveCount={inactiveArtistCount} />
              )}
              {s.key === "slots" && <SlotsStep orgId={orgId} onDone={() => setOpen(null)} />}
              {/* Both coverage panels open with a flow-aware sentence, so they take the
                  rail's own orgId rather than resolving the shell's active org themselves
                  (same rule as TimingStep below them). */}
              {s.key === "ladder" && <LadderStep coverage={coverage} orgId={orgId} />}
              {s.key === "eligibility" && <EligibilityStep coverage={coverage} orgId={orgId} />}
              {s.key === "timing" && <TimingStep orgId={orgId} onDone={() => setOpen(null)} />}
            </SetupStepRow>
          ))}
        </div>
        {/* The schedule the timing row configures, stated where a collapsed row cannot hide
            it. Suppressed while that row is open: TimingStep prints the same narrative from
            its LIVE inputs, under a scope note that carries the timezone, so leaving this
            one up would put the fact on the card twice and, mid-edit, in two versions. */}
        {open !== "timing" && <TonightNote orgId={orgId} />}
        {/* Not a step and not a blocker, so it sits under them rather than among them: it is
            the one thing on this rail that is worth doing WHILE the steps are unfinished
            rather than after. The registry's `rules` block carries the same object, but that
            block is the rail's complete state, so on its own the tip only ever reached an
            admin who had already made every decision it would have informed. This surface is
            the other half: it is on screen from the first unfinished step onward, so the tip
            reaches an admin while the decisions it informs are still open. (It stays
            reachable afterwards too: once setup completes, useBookingSetupRailVisible turns
            the rail into a "button" and SetupChecklistSheet renders this same component.) */}
        {canUseEditor(roles, isSuperAdmin) && (
          <div className="border-t border-border px-4 py-3">
            <p className="text-xs font-medium text-foreground">{VIEW_AS_ARTIST_TIP.title}</p>
            <p className="mt-0.5 text-xs leading-[17px] text-muted-foreground">{VIEW_AS_ARTIST_TIP.hint}</p>
          </div>
        )}
        <RehearsalBlock orgId={orgId} />
      </CardContent>
    </Card>
  );
}
