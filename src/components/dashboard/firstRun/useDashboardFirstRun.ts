import { useState } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useNavCounts } from "@/hooks/useNavCounts";
import { useBookingFlow } from "@/hooks/useBookingFlow";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import {
  composeArtist,
  composeOnboarding,
  welcomeCopy,
  railHeaderCopy,
  collapsedCopy,
  SAMPLE_PREVIEW,
} from "@/lib/dashboard/firstRun";
import { ARTIST_ONBOARDING, MODULE_ONBOARDING } from "@/lib/dashboard/moduleOnboarding";
import type {
  ComposeResult,
  DashboardFirstRunState,
  DashboardRole,
  ModuleStatuses,
  OnboardingCtx,
} from "@/lib/dashboard/types";
import { useArtistOnboardingStatus } from "./useArtistOnboardingStatus";

/**
 * The dashboard first-run integration hook: it fans the org's entitlements and each
 * module's readiness status through the pure `composeOnboarding` and copy helpers, and
 * returns a single `DashboardFirstRunState` the four presentational components bind to.
 *
 * All status hooks are called unconditionally (hook rules). For the artist role the
 * `booking_flow` slice is the query-free `useArtistOnboardingStatus().status`; for
 * admin/producer it is the org-scoped `useBookingSetupStatus`. The hire-order status is
 * adapted to the module-agnostic `{ steps, complete }` shape (its steps carry
 * `blocksIssue`, not the rail's offers/filling `block`, so `block` is nulled).
 */
export function useDashboardFirstRun(role: DashboardRole): DashboardFirstRunState {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const orgName = currentOrg?.name ?? "your workspace";

  const { features, isLoading } = useEntitlements();
  // Artists never consume these org-setup readiness reads (their slice composes via
  // ARTIST_ONBOARDING), so pass null to disable the queries and avoid firing/retrying
  // org-config reads (cast priorities, hire-order settings) an artist has no RLS access to.
  const setupOrgId = role === "artist" ? null : orgId;
  const booking = useBookingSetupStatus(setupOrgId); // admin/producer slice
  const artist = useArtistOnboardingStatus(); // artist slice (called unconditionally)
  const hire = useHireOrderSetupStatus(setupOrgId);
  const counts = useNavCounts();
  const flow = useBookingFlow().data ?? BOOKING_FLOW_DEFAULTS;

  const [railOpen, setRailOpen] = useState(false);
  const [dismissed, dismiss, undismiss] = useRailDismissed("dashboardWelcome", orgId);

  const ctx: OnboardingCtx = { orgName, artistAcceptance: flow.artist_acceptance, counts };

  // Only the admin/producer branch reads `moduleStatuses`; the artist branch composes
  // its own booking_flow slice via ARTIST_ONBOARDING and never touches it.
  const moduleStatuses: ModuleStatuses = {
    booking_flow: booking.status,
    hire_orders: {
      steps: hire.status.steps.map((s) => ({ key: s.key, done: s.done, block: null })),
      complete: hire.status.complete,
    },
  };

  const composed: ComposeResult = role === "artist"
    ? (features.has("booking_flow")
        ? composeArtist(artist.status, ARTIST_ONBOARDING, ctx)
        : { steps: [], complete: true, rules: [], offFooters: [] })
    : composeOnboarding({ enabled: features, role, moduleStatuses, ctx }, MODULE_ONBOARDING);
  const filled = composed.steps.filter((s) => s.done).length;
  const total = composed.steps.length;
  const remaining = total - filled;

  const welcome = welcomeCopy(role, composed.complete, ctx, { filled, total });
  const railHead = railHeaderCopy(role, composed.complete);
  const collapsed = collapsedCopy(role, composed.complete, remaining);

  // No-flicker: hidden while entitlements load, and when no licensed module contributes
  // a step there is nothing to onboard. The relevant module-status loading is also
  // folded in so a configured org never briefly renders the "database is empty" +
  // greyed Sample state while the heavier setup reads are still resolving.
  const statusLoading = role === "artist"
    ? artist.isLoading
    : ((features.has("booking_flow") && booking.isLoading) || (features.has("hire_orders") && hire.isLoading));
  const show = !isLoading && !statusLoading && composed.steps.length > 0;

  return {
    show,
    complete: composed.complete,
    dismissed,
    steps: composed.steps,
    rules: composed.rules,
    offFooters: composed.offFooters,
    welcome,
    sample: SAMPLE_PREVIEW[role],
    sectionTitle: composed.complete ? "Today" : "What this page becomes",
    sectionHint: composed.complete
      ? "Live. Everything below is yours to act on."
      : "Sample rows. Yours replace them once the org has dates.",
    railEyebrow: railHead.eyebrow,
    railTitle: railHead.title,
    railBody: railHead.body,
    collapsedLabel: collapsed.label,
    collapsedHint: collapsed.hint,
    collapsedCta: collapsed.cta,
    railOpen,
    openRail: () => setRailOpen(true),
    closeRail: () => setRailOpen(false),
    dismiss: () => {
      setRailOpen(false);
      if (role === "artist") { artist.ackBlock(); artist.ackNotify(); }
      dismiss();
    },
    undismiss,
  };
}
