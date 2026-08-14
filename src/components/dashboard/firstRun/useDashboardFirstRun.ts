import { useTranslation } from "react-i18next";
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
import type { DashboardRole } from "@/lib/dashboard/types";
import type { QueueRow, StageChainInput, StageChainResult } from "@/lib/dashboard/stageChain.types";
import { useArtistOnboardingStatus } from "./useArtistOnboardingStatus";

/** The return shape of {@link useDashboardFirstRun}. Supersedes the pre-stage-chain
 *  `DashboardFirstRunState` that used to live in `@/lib/dashboard/types` (retired in
 *  task C3 alongside the old welcome/rail/sample surface it described). */
export interface DashboardFirstRunState {
  show: boolean;
  result: StageChainResult;
  queueRows: QueueRow[];
  dismissed: boolean;
  dismiss: () => void;
  undismiss: () => void;
}

/**
 * The dashboard first-run integration hook: assembles a `StageChainInput` from the org's
 * live entitlement/role/setup-status/metrics state and feeds it through the pure
 * `composeStageChain` composer (`@/lib/dashboard/stageChain`), which returns the full
 * `StageChainResult` the `DashboardFirstRun` surface renders. The composer stays pure, so
 * this hook owns what it cannot: assembling `queueRows` (the composer emits queue COPY,
 * never live/sample rows) and the dismiss plumbing.
 *
 * All status hooks are called unconditionally (hook rules) in the same order every
 * render; only each underlying QUERY's `enabled`/id argument is gated by role and
 * entitlement, exactly as before this rewire (`bookingOrgId`/`hireOrgId` below) — an org
 * that has not licensed a module must not pay for its settings reads on every dashboard
 * load, and artists never consume the org-setup reads at all (their slice is the
 * query-free `useArtistOnboardingStatus`).
 */
export function useDashboardFirstRun(role: DashboardRole): DashboardFirstRunState {
  const { t } = useTranslation("dashboard");
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const orgName = currentOrg?.name ?? "your workspace";

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
  const artistQueueRows: QueueRow[] = imported
    ? [
        {
          dot: "accent",
          title: offers
            ? t("artistQueue.offersArriving", { count: metrics.arriving })
            : t("artistQueue.datesBookedAppearHere"),
          hint: t("artistQueue.producerSchedule"),
          when: `${String(timing.digestHourBerlin).padStart(2, "0")}:00`,
          cta: t("artistQueue.open"),
        },
        {
          dot: "faint",
          title: t("artistQueue.blockedTitle", { count: metrics.blockedDates }),
          hint: t("artistQueue.keptOutOfList"),
          when: "",
          cta: t("artistQueue.edit"),
        },
      ]
    : [
        {
          dot: "faint",
          title: t("artistQueue.nothingYet"),
          hint: offers
            ? t("artistQueue.firstOfferHint", { orgName })
            : t("artistQueue.firstBookingHint", { orgName }),
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

  return {
    show,
    result,
    queueRows,
    dismissed,
    dismiss,
    undismiss,
  };
}
