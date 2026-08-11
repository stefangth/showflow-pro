import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useBookingSetupStatus, useProducerCount } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useBookingFlow } from "@/hooks/useBookingFlow";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import { useFirstRunMetrics } from "@/hooks/useFirstRunMetrics";
import { useBookingFlowProvenance } from "@/hooks/useBookingFlowProvenance";
import { composeStageChain } from "@/lib/dashboard/stageChain";
import { SAMPLE_PREVIEW, hasProducerTeam } from "@/lib/dashboard/firstRun";
import type { FeatureKey } from "@/lib/entitlements";
import type { DashboardRole } from "@/lib/dashboard/types";
import type { QueueRow, StageChainInput, StageChainResult } from "@/lib/dashboard/stageChain.types";
import { useArtistOnboardingStatus } from "./useArtistOnboardingStatus";

/** The return shape of {@link useDashboardFirstRun}. Supersedes the pre-stage-chain
 *  `DashboardFirstRunState` in `@/lib/dashboard/types` (still on disk, unused by this
 *  hook as of this rewire, pending its retirement alongside the old welcome/rail/sample
 *  surface in task C3). */
export interface DashboardFirstRunState {
  show: boolean;
  result: StageChainResult;
  queueRows: QueueRow[];
  dismissed: boolean;
  dismiss: () => void;
  undismiss: () => void;
  openSetupAt: (feature: FeatureKey, step: string) => void;
}

/**
 * The dashboard first-run integration hook: assembles a `StageChainInput` from the org's
 * live entitlement/role/setup-status/metrics state and feeds it through the pure
 * `composeStageChain` composer (`@/lib/dashboard/stageChain`), which returns the full
 * `StageChainResult` the `DashboardFirstRun` surface renders. The composer stays pure, so
 * this hook owns the two things it cannot: assembling `queueRows` (the composer emits
 * queue COPY, never live/sample rows) and the dismiss plumbing.
 *
 * All status hooks are called unconditionally (hook rules) in the same order every
 * render; only each underlying QUERY's `enabled`/id argument is gated by role and
 * entitlement, exactly as before this rewire (`bookingOrgId`/`hireOrgId` below) — an org
 * that has not licensed a module must not pay for its settings reads on every dashboard
 * load, and artists never consume the org-setup reads at all (their slice is the
 * query-free `useArtistOnboardingStatus`).
 *
 * `openSetupAt` here is a same-shaped PASSTHROUGH, not a working implementation: the
 * setup-checklist sheet's open/step state has always lived on the page (`DashboardPage`'s
 * local `setupOpen`/`setupSel`), not in this hook, and this rewire does not move it —
 * only the page can reach that state. `DashboardPage` supplies its own
 * `(feature, step) => void` opener to `<DashboardFirstRun onOpenSetup={...}>` (task C3);
 * this field exists only so the return shape stays complete for a caller that
 * destructures it before that wiring lands.
 */
export function useDashboardFirstRun(role: DashboardRole): DashboardFirstRunState {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const orgName = currentOrg?.name ?? "";

  const { features, isLoading } = useEntitlements();
  const bookingEntitled = features.has("booking_flow");
  const hireEntitled = features.has("hire_orders");
  const isNonArtist = role !== "artist";

  // Gate each module's readiness reads on BOTH role and the module's entitlement, same
  // plumbing as before this rewire (mirrors the `featureOn ? orgId : null` gate in
  // ShowsBookingsPage).
  const bookingOrgId = isNonArtist && bookingEntitled ? orgId : null;
  const hireOrgId = isNonArtist && hireEntitled ? orgId : null;
  const booking = useBookingSetupStatus(bookingOrgId);
  const artist = useArtistOnboardingStatus();
  const hire = useHireOrderSetupStatus(hireOrgId);
  // Not gated to bookingOrgId: an ARTIST needs this read too — `offers` below is the
  // org's flow, not the artist's own readiness, and decides whether the chain talks
  // about offers at all. `flowQ.isLoading` is folded into `statusLoading` for the same
  // reason, for every role.
  const flowQ = useBookingFlow();
  const flow = flowQ.data ?? BOOKING_FLOW_DEFAULTS;
  // Admin-only nudge, folded into `bookingSteps.team` below (the composer's own team
  // step keys on it) — booking-only, so only an admin dashboard at a booking_flow org
  // pays for this read.
  const producerCount = useProducerCount(orgId, role === "admin" && bookingEntitled);

  const [dismissed, dismiss, undismiss] = useRailDismissed("dashboardWelcome", orgId);

  // A producer granted either edit_* capability can actually do the org setup, so the
  // composer drops the "only an admin can do these" framing for them. Both hooks are
  // read unconditionally — a `||` short-circuit would skip the second call (rules of
  // hooks).
  const canEditBooking = useCan("edit_booking_settings");
  const canEditHire = useCan("edit_hire_order_settings");

  const { metrics, timing, isLoading: metricsLoading } = useFirstRunMetrics(role);
  const provenance = useBookingFlowProvenance(role);

  // Only meaningful for a non-artist org that has licensed the module — the composer
  // never docks a step it has no key for, so `{}` is a safe "nothing to report" value.
  const bookingSteps: Record<string, { done: boolean }> = isNonArtist && bookingEntitled
    ? {
        ...Object.fromEntries(booking.status.steps.map((s) => [s.key, { done: s.done }])),
        // "team" is not one of computeBookingSetupStatus's engine steps
        // (STEP_TITLES has no "team" entry) — same single-sourced done-ness
        // (`hasProducerTeam`) the old injectAdminTeamStep nudge used, now fed straight
        // into the composer's own `mkStep("team", ..., bDone("team"), ...)`.
        team: { done: hasProducerTeam(producerCount) },
      }
    : {};
  const hireSteps: Record<string, { done: boolean }> = isNonArtist && hireEntitled
    ? Object.fromEntries(hire.status.steps.map((s) => [s.key, { done: s.done }]))
    : {};
  const artistBlockDatesDone = artist.status.steps.find((s) => s.key === "blockDates")?.done ?? false;

  // "Has this org/artist got real data yet": a non-artist keys on dates having landed;
  // an artist keys on their own eligible-dates count (the org has dates for their cast).
  const imported = isNonArtist ? metrics.datesIn > 0 : metrics.eligibleDates > 0;
  const offers = flow.artist_acceptance;

  const input: StageChainInput = {
    role,
    orgName,
    bookingEntitled,
    hireEntitled,
    offers,
    imported,
    canEditBooking,
    canEditHire,
    bookingSteps,
    hireSteps,
    artistBlockDatesDone,
    metrics,
    provenance,
    timing,
  };
  const result: StageChainResult = composeStageChain(input);

  // The composer stays pure and emits queue COPY (queueTitle/queueHint/sample/
  // queueOpacity) but never rows. Admin/producer always see the sample fixture (their
  // real content lives in the KPI cards below the chain, not this queue); an artist
  // sees a live two-line summary built straight from their own metrics — no per-offer
  // fetch needed.
  const arrivingPlural = metrics.arriving === 1 ? "" : "s";
  const artistQueueRows: QueueRow[] = imported
    ? [
        {
          dot: "accent",
          title: offers
            ? `${metrics.arriving} offer${arrivingPlural} arriving in tomorrow's digest`
            : `${metrics.confirmed || metrics.arriving} dates booked for you`,
          hint: "Your producer's schedule",
          when: "09:00",
          cta: "Open",
        },
        {
          dot: "faint",
          title: `${metrics.blockedDates} dates blocked`,
          hint: "Kept out of every list before anyone books you",
          when: "",
          cta: "Edit",
        },
      ]
    : [
        {
          dot: "faint",
          title: "Nothing yet",
          hint: offers
            ? `Your first offer lands here once ${orgName} has dates for your cast.`
            : `Your first booking lands here once ${orgName} has dates.`,
          when: "",
          cta: "",
        },
      ];
  const queueRows: QueueRow[] = role === "artist"
    ? artistQueueRows
    : SAMPLE_PREVIEW[role].queue.map((q) => ({
        dot: q.tone === "faint" ? "faint" : "accent",
        title: q.title,
        hint: q.hint,
        when: q.when,
        cta: q.cta,
      }));

  // No-flicker: hidden while entitlements or any status/metrics read is still in flight.
  // Once settled, the chain is shown when licensed modules produced one
  // (`result.hasChain`) OR when nothing is licensed at all (`result.nothingOn`) — this is
  // the fix for the bug this task exists to close. The old gate
  // (`composed.steps.length > 0`) hid the surface entirely for a no-modules org, when it
  // should render the floor state explaining why nothing is here. `hasChain` and
  // `nothingOn` are always exactly complementary, so this condition is always true once
  // loading settles; it is written as the OR of both named cases (rather than simplified
  // away) to document that both are deliberately covered, not just the common one.
  const statusLoading = flowQ.isLoading || metricsLoading || (role === "artist"
    ? artist.isLoading
    : ((bookingEntitled && booking.isLoading) || (hireEntitled && hire.isLoading)));
  const show = !isLoading && !statusLoading && (result.hasChain || result.nothingOn);

  // Passthrough placeholder — see the hook-level doc comment above. DashboardPage owns
  // the real setup-sheet state and wires its own (feature, step) opener into
  // `<DashboardFirstRun onOpenSetup={...}>` (task C3); nothing here can reach that state
  // from inside a hook.
  const openSetupAt = (_feature: FeatureKey, _step: string) => {};

  return {
    show,
    result,
    queueRows,
    dismissed,
    dismiss,
    undismiss,
    openSetupAt,
  };
}
