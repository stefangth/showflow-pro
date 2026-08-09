import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useBookingSetupRailVisible } from "@/components/bookings/setup/useBookingSetupRailVisible";
import { useSetupRailVisible } from "@/components/hireOrders/setup/useSetupRailVisible";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import { collapsedCopy, composeOnboarding } from "@/lib/dashboard/firstRun";
import { MODULE_ONBOARDING } from "@/lib/dashboard/moduleOnboarding";
import type { FeatureKey } from "@/lib/entitlements";
import type { SetupRailMode } from "@/components/setup/setupRailMode";
import type {
  ComposedStep, DashboardRole, InheritedRule, ModuleStatuses, ModuleStatusLite, OnboardingCtx,
} from "@/lib/dashboard/types";

export interface ModuleOnboardingRail {
  /** Which onboarding surface to render on the module page. */
  mode: SetupRailMode;
  steps: ComposedStep[];
  rules: InheritedRule[];
  offFooters: string[];
  eyebrow: string;
  title: string;
  body: string;
  progressFilled: number;
  progressTotal: number;
  progressLabel: string;
  /** Hide the rail on this surface (module dismiss key). */
  dismiss: () => void;
  /** Collapsed-bar copy (used when mode === "collapsed"). Mirrors the dashboard bar. */
  collapsedLabel: string;
  collapsedHint: string;
  collapsedCta: string;
  /** Re-expand the collapsed bar into the full banner (clears the dismissal). */
  expand: () => void;
}

const DISMISS_KEY: Record<FeatureKey, string> = {
  booking_flow: "bookingSetup",
  hire_orders: "hireOrderSetup",
};

/**
 * Module-scoped adapter over the dashboard's pure onboarding composition, for the rail
 * rendered on a module page (admin/producer surfaces).
 *
 * Completion comes from the same status hooks the dashboard reads, so a step done on the
 * dashboard reads done here. Visibility and dismissal reuse the module's existing
 * rail-visibility hook and its localStorage key, so show/hide behaves exactly as the
 * page's previous callout did. `orgId` is the caller's already-entitlement-gated org
 * (null keeps every read idle), matching how the pages gate their setup reads.
 *
 * Both modules' status + visibility hooks are called unconditionally (rules of hooks) with
 * the non-selected one gated to a null org so its queries stay idle.
 *
 * `ctx.rules` are computed but only rendered by DashboardSetupRail in its complete state,
 * which the module rail never shows (it retires when complete), so `artistAcceptance` and
 * `counts` here are inert placeholders rather than live reads.
 */
export function useModuleOnboardingRail(feature: FeatureKey, orgId: string | null): ModuleOnboardingRail {
  const { currentOrg, hasRole } = useAuth();
  const role: DashboardRole = hasRole("admin") ? "admin" : "producer";
  // Whether the viewer can actually do this module's setup. Producers default to false
  // for both edit_* capabilities, and the visibility hook still shows them the rail while
  // a blocker exists — so the header must explain that, not imply an action they lack.
  const canEdit = useCan(feature === "hire_orders" ? "edit_hire_order_settings" : "edit_booking_settings");

  const bookingOrg = feature === "booking_flow" ? orgId : null;
  const hireOrg = feature === "hire_orders" ? orgId : null;

  const bookingViz = useBookingSetupRailVisible(bookingOrg);
  const booking = useBookingSetupStatus(bookingOrg);
  const hireViz = useSetupRailVisible(hireOrg);
  const hire = useHireOrderSetupStatus(hireOrg);

  const [, dismiss, expand] = useRailDismissed(DISMISS_KEY[feature], orgId);

  const ctx: OnboardingCtx = {
    orgName: currentOrg?.name ?? "your workspace",
    artistAcceptance: false,
    counts: { pendingConfirmations: 0, openOffers: 0, awaitingCountersign: 0 },
  };

  // hire-order steps carry `blocksIssue`; map to the "issuing" block for parity with the
  // dashboard rail, exactly as useDashboardFirstRun does.
  const status: ModuleStatusLite = feature === "hire_orders"
    ? {
        steps: hire.status.steps.map((s) => ({ key: s.key, done: s.done, block: s.blocksIssue ? ("issuing" as const) : null })),
        complete: hire.status.complete,
      }
    : {
        steps: booking.status.steps.map((s) => ({ key: s.key, done: s.done, block: s.block })),
        complete: booking.status.complete,
      };

  const moduleStatuses: ModuleStatuses = { [feature]: status };
  const composed = composeOnboarding(
    { enabled: new Set<FeatureKey>([feature]), role, moduleStatuses, ctx },
    MODULE_ONBOARDING,
  );
  const filled = composed.steps.filter((s) => s.done).length;
  const total = composed.steps.length;
  const remaining = total - filled;
  const railHeader = MODULE_ONBOARDING[feature].railHeader;
  const viz = feature === "hire_orders" ? hireViz : bookingViz;
  // One label word drives both the eyebrow and the progress rail so they never disagree,
  // matching the dashboard's own non-editor "Org setup · N of M" convention (firstRun.ts).
  const setupWord = canEdit ? "Set up" : "Org setup";

  return {
    mode: viz.mode,
    steps: composed.steps,
    rules: composed.rules,
    // Deliberately empty: composeOnboarding derives off-footers from every feature NOT in
    // `enabled`, and this hook forces a single-module set, so composed.offFooters would
    // always claim the *sibling* module is off. The page only renders this rail when the
    // scoped module is entitled, so there is no off-state upsell to show here at all.
    offFooters: [],
    // Role-aware header: an editor gets the action-framed module copy; a viewer who cannot
    // edit (a default producer) gets an honest "an admin finishes these" explanation
    // instead of a "Get X running" header whose step buttons are all hidden from them.
    eyebrow: setupWord,
    title: railHeader.title,
    body: canEdit
      ? railHeader.body
      : "Only an admin can finish these. They are listed so you know why the module is not ready yet.",
    progressFilled: filled,
    progressTotal: total,
    progressLabel: `${setupWord} · ${filled} of ${total}`,
    collapsedLabel: `${setupWord} in progress`,
    // Reuse the dashboard collapsed-bar's own "N steps left" pluralization so the two
    // bars can't drift; the label stays canEdit-based (matches eyebrow/progressLabel)
    // and the CTA is a deliberate "Resume" override (the bar re-expands, not open-steps).
    collapsedHint: collapsedCopy(role, false, remaining).hint,
    collapsedCta: "Resume",
    dismiss,
    expand,
  };
}
