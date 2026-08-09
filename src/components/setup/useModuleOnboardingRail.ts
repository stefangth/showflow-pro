import { useAuth } from "@/features/auth/AuthContext";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useBookingSetupRailVisible } from "@/components/bookings/setup/useBookingSetupRailVisible";
import { useSetupRailVisible } from "@/components/hireOrders/setup/useSetupRailVisible";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import { composeOnboarding } from "@/lib/dashboard/firstRun";
import { MODULE_ONBOARDING } from "@/lib/dashboard/moduleOnboarding";
import type { FeatureKey } from "@/lib/entitlements";
import type {
  ComposedStep, DashboardRole, InheritedRule, ModuleStatuses, ModuleStatusLite, OnboardingCtx,
} from "@/lib/dashboard/types";

export interface ModuleOnboardingRail {
  /** Whether the banner rail should render right now (entitled, actionable, not dismissed,
   *  not complete, not loading — delegated to the module's existing visibility hook). */
  show: boolean;
  /** Dismissed-but-would-otherwise-show: drives the header "Setup checklist" button. */
  reinvocable: boolean;
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

  const bookingOrg = feature === "booking_flow" ? orgId : null;
  const hireOrg = feature === "hire_orders" ? orgId : null;

  const bookingViz = useBookingSetupRailVisible(bookingOrg);
  const booking = useBookingSetupStatus(bookingOrg);
  const hireViz = useSetupRailVisible(hireOrg);
  const hire = useHireOrderSetupStatus(hireOrg);

  const [, dismiss] = useRailDismissed(DISMISS_KEY[feature], orgId);

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
  const railHeader = MODULE_ONBOARDING[feature].railHeader;
  const viz = feature === "hire_orders" ? hireViz : bookingViz;

  return {
    show: viz.visible,
    reinvocable: viz.reinvocable,
    steps: composed.steps,
    rules: composed.rules,
    // Deliberately empty: composeOnboarding derives off-footers from every feature NOT in
    // `enabled`, and this hook forces a single-module set, so composed.offFooters would
    // always claim the *sibling* module is off. The page only renders this rail when the
    // scoped module is entitled, so there is no off-state upsell to show here at all.
    offFooters: [],
    eyebrow: "Set up",
    title: railHeader.title,
    body: railHeader.body,
    progressFilled: filled,
    progressTotal: total,
    progressLabel: `Set up · ${filled} of ${total}`,
    dismiss,
  };
}
