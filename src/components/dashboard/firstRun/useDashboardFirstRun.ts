import { useState } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useBookingSetupStatus, useProducerCount } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useNavCounts } from "@/hooks/useNavCounts";
import { useBookingFlow } from "@/hooks/useBookingFlow";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import {
  adminTeamStep,
  composeArtist,
  composeOnboarding,
  welcomeCopy,
  railHeaderCopy,
  collapsedCopy,
  SAMPLE_PREVIEW,
} from "@/lib/dashboard/firstRun";
import { ARTIST_ONBOARDING, MODULE_ONBOARDING } from "@/lib/dashboard/moduleOnboarding";
import type { FeatureKey } from "@/lib/entitlements";
import type {
  ComposeResult,
  DashboardFirstRunState,
  DashboardRole,
  ModuleStatusLite,
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
  // Gate each module's readiness reads on BOTH role and the module's entitlement.
  // Artists never consume these org-setup reads (their slice composes via
  // ARTIST_ONBOARDING); and an org that has not licensed a module must not pay for its
  // settings reads on every dashboard load (hire_orders ships dark, so most orgs would).
  // `composeOnboarding` already drops an unlicensed module, so disabling its query never
  // changes the output. Mirrors the `featureOn ? orgId : null` gate in ShowsBookingsPage.
  const bookingOrgId = role !== "artist" && features.has("booking_flow") ? orgId : null;
  const hireOrgId = role !== "artist" && features.has("hire_orders") ? orgId : null;
  const booking = useBookingSetupStatus(bookingOrgId); // admin/producer slice
  const artist = useArtistOnboardingStatus(); // artist slice (called unconditionally)
  const hire = useHireOrderSetupStatus(hireOrgId);
  const counts = useNavCounts();
  // Not gated to `bookingOrgId`: an ARTIST needs this read too. Their welcome copy and
  // their rules block both branch on `artist_acceptance`, so it is the org's flow, not the
  // artist's own readiness, that decides whether this card talks about offers at all.
  // `flowQ.isLoading` is folded into `statusLoading` below for the same reason.
  const flowQ = useBookingFlow();
  const flow = flowQ.data ?? BOOKING_FLOW_DEFAULTS;
  // Admin-only nudge (injected below), so only an admin dashboard pays for this read.
  // Called unconditionally; `role === "admin"` is its enabled gate.
  const producerCount = useProducerCount(orgId, role === "admin");

  const [railOpen, setRailOpen] = useState(false);
  const [dismissed, dismiss] = useRailDismissed("dashboardWelcome", orgId);

  const ctx: OnboardingCtx = { orgName, artistAcceptance: flow.artist_acceptance, counts };
  // A producer granted either edit_* capability can actually do the org setup, so the
  // copy drops the "only an admin can do these" framing for them (admins always can;
  // artists never have these capabilities, so their branch is unaffected). Both hooks
  // are read unconditionally — `||` would short-circuit the second call (rules-of-hooks).
  const canEditBookingSettings = useCan("edit_booking_settings");
  const canEditHireSettings = useCan("edit_hire_order_settings");
  const canEditSetup = canEditBookingSettings || canEditHireSettings;

  // Only the admin/producer branch reads `moduleStatuses`; the artist branch composes
  // its own booking_flow slice via ARTIST_ONBOARDING and never touches it. Typed as an
  // exhaustive `Record<FeatureKey, …>` (not the Partial `ModuleStatuses`) so adding a
  // third module is a compile error here, not a silently-dropped rail — the same
  // anti-drift stance as MODULE_ONBOARDING's parity test.
  const moduleStatuses: Record<FeatureKey, ModuleStatusLite> = {
    booking_flow: booking.status,
    hire_orders: {
      // hire-order steps carry `blocksIssue` (not offers/filling); map it to the
      // "issuing" block so letterhead/terms chip in the rail like booking's blockers.
      steps: hire.status.steps.map((s) => ({ key: s.key, done: s.done, block: s.blocksIssue ? ("issuing" as const) : null })),
      complete: hire.status.complete,
    },
  };

  const composed: ComposeResult = role === "artist"
    ? (features.has("booking_flow")
        ? composeArtist(artist.status, ARTIST_ONBOARDING, ctx)
        : { steps: [], complete: true, rules: [], offFooters: [] })
    : composeOnboarding({ enabled: features, role, moduleStatuses, ctx }, MODULE_ONBOARDING);
  // The admin-only "Add your production team" nudge is prepended here, outside the engine, so
  // it never touches composed.complete (non-gating). Only WHILE INCOMPLETE, so the
  // complete-state hero/rules view is unaffected and never over-counts. Producers/artists
  // never get it (role gate). `filled`/`total`/`remaining` now run over the augmented list so
  // the progress copy counts the extra step for admins.
  const showTeam = role === "admin" && features.has("booking_flow") && !composed.complete;
  const steps = showTeam ? [adminTeamStep(producerCount), ...composed.steps] : composed.steps;
  const filled = steps.filter((s) => s.done).length;
  const total = steps.length;
  const remaining = total - filled;

  const welcome = welcomeCopy(role, composed.complete, ctx, { filled, total }, canEditSetup);
  const railHead = railHeaderCopy(role, composed.complete, canEditSetup);
  const collapsed = collapsedCopy(role, composed.complete, remaining);

  // No-flicker: hidden while entitlements load, and when no licensed module contributes
  // a step there is nothing to onboard. The relevant module-status loading is also
  // folded in so a configured org never briefly renders the "database is empty" +
  // greyed Sample state while the heavier setup reads are still resolving.
  //
  // The flow read is folded in for EVERY role, because the fallback while it is in flight
  // is BOOKING_FLOW_DEFAULTS, which runs offers. For admin and producer that was already
  // covered by accident: useBookingSetupStatus issues the identical
  // ["app-settings","booking-flow",orgId] query, so booking.isLoading held the card until
  // the same row landed. An artist has every booking query disabled (bookingOrgId is null),
  // so nothing held it: a direct-book artist read "Your first offers are on their way"
  // above a rules block saying there are no offers, until the flow resolved.
  const statusLoading = flowQ.isLoading || (role === "artist"
    ? artist.isLoading
    : ((features.has("booking_flow") && booking.isLoading) || (features.has("hire_orders") && hire.isLoading)));
  const show = !isLoading && !statusLoading && composed.steps.length > 0;

  // The greyed sample fixture is an admin/producer concept (the empty-org preview).
  // Artists always render their real per-user body, so they carry no sample and these
  // three fields stay absent for that role.
  const samplePreview = role === "artist"
    ? {}
    : {
        sample: SAMPLE_PREVIEW[role],
        sectionTitle: composed.complete ? "Today" : "What this page becomes",
        sectionHint: composed.complete
          ? "Live. Everything below is yours to act on."
          : "Sample rows. Yours replace them once the org has dates.",
      };

  return {
    show,
    complete: composed.complete,
    dismissed,
    steps,
    rules: composed.rules,
    offFooters: composed.offFooters,
    welcome,
    ...samplePreview,
    railEyebrow: railHead.eyebrow,
    railTitle: railHead.title,
    railBody: railHead.body,
    collapsedLabel: collapsed.label,
    collapsedHint: collapsed.hint,
    collapsedCta: collapsed.cta,
    railOpen,
    openRail: () => setRailOpen(true),
    closeRail: () => setRailOpen(false),
    // Dismiss only collapses the panel; it never marks a step done. For artists the two
    // optional steps reach "done" solely from real data (a blocked date / a phone), so
    // "Later" stays honest and resumable via the collapsed chip's "Resume".
    dismiss: () => {
      setRailOpen(false);
      dismiss();
    },
  };
}
