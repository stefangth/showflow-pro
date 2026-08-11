// src/lib/dashboard/types.ts
import type { FeatureKey } from "@/lib/entitlements";

/** The capability actions this feature's step CTAs gate on. Kept as a local union
 *  (useCan takes a bare string; capabilities.ts exports no action type); every member is
 *  checked against CAPABILITY_DEFS in moduleOnboarding.test.ts, since an action that does
 *  not exist resolves to `false` for every non-admin and silently hides the CTA. */
export type StepCapability = "edit_booking_settings" | "edit_hire_order_settings" | "add_artists";

export type DashboardRole = "admin" | "producer" | "artist";

/** Booking BlockKind ("offers"/"booking"/"filling") plus "issuing" for hire-order steps
 *  (letterhead/terms) that block issuing, so the rail chips them for parity.
 *  "booking" is the direct-book org's wording of the same hard gate "offers" names for an
 *  offers org: see `blockFor` in src/lib/bookings/setupStatus.ts. */
export type SetupBlock = "offers" | "booking" | "filling" | "issuing" | null;

export interface OnboardingStepMeta {
  title: string;
  todoHint: string;
  doneHint: string;
  ctaLabel: string;
  /** A `ROUTES.*` value, optionally with a query string (`${ROUTES.SETTINGS}?tab=booking`)
   *  so a CTA lands on the section its label names. DashboardSetupRail passes it straight
   *  to `<Link to>`, which takes a path plus search. */
  ctaRoute: string;
  /** When set and the viewer lacks it, the step renders read-only (no CTA). */
  ctaCapability?: StepCapability;
}

/** The normalized, module-agnostic status shape the composition consumes.
 *  Every module's status hook is adapted to this ({ steps, complete }). */
export interface ModuleStepState { key: string; done: boolean; block: SetupBlock; }
export interface ModuleStatusLite { steps: ModuleStepState[]; complete: boolean; }
export type ModuleStatuses = Partial<Record<FeatureKey, ModuleStatusLite>>;

export interface ComposedStep extends OnboardingStepMeta {
  key: string;
  moduleKey: FeatureKey;
  done: boolean;
  block: SetupBlock;
}

export interface InheritedRule { title: string; hint: string; }

export interface OnboardingCtx {
  orgName: string;
  /** Resolved booking flow: true = offers with acceptance, false = direct booking. */
  artistAcceptance: boolean;
  counts: { pendingConfirmations: number; openOffers: number; awaitingCountersign: number };
}

export interface ModuleOnboardingDef<StepKey extends string> {
  key: FeatureKey;
  /** Exhaustive per engine step key — a missing/renamed key is a compile error. */
  steps: Record<StepKey, OnboardingStepMeta>;
  /** Header copy for the module-scoped rail rendered on the module page. */
  railHeader: { title: string; body: string };
  rules: (role: DashboardRole, ctx: OnboardingCtx) => InheritedRule[];
  /** Shown when the module is NOT licensed (the upsell nudge). */
  offFooter: string;
}

export interface WelcomeCopy {
  eyebrow: string;
  headline: string;
  body: string;
  primaryLabel: string;
  secondaryLabel: string;
  progressLabel: string;
  progressFilled: number;
  progressTotal: number;
  progressHint: string;
}

export interface SampleStat { title: string; value: string; label: string; }
export interface SampleQueueRow {
  title: string; hint: string; when: string; cta: string;
  tone: "accent" | "warning" | "faint";
}
export interface SampleWeekRow { date: string; ref: string; status: string; }
export interface SamplePreviewData { stats: SampleStat[]; queue: SampleQueueRow[]; week: SampleWeekRow[]; }

export interface ComposeInput {
  enabled: Set<FeatureKey>;
  role: DashboardRole;
  moduleStatuses: ModuleStatuses;
  ctx: OnboardingCtx;
}
export interface ComposeResult {
  steps: ComposedStep[];
  complete: boolean;
  rules: InheritedRule[];
  offFooters: string[];
}

// Component prop contracts (Wave A components bind to these).
export interface DashboardWelcomeCollapsedProps { label: string; hint: string; ctaLabel: string; onOpen: () => void; }
export interface DashboardSetupRailProps {
  eyebrow: string; title: string; body: string; complete: boolean;
  steps: ComposedStep[]; rules: InheritedRule[]; offFooters: string[];
  onClose: () => void; onDismiss: () => void;
  /** "rail" (default) = dashboard side column; "banner" = full-width module header. */
  layout?: "rail" | "banner";
  /** When set, a not-done step renders a button that calls this instead of a Link. */
  onStepAction?: (step: ComposedStep) => void;
  /** Banner layout only: the top-right segmented progress rail. */
  progressLabel?: string;
  progressFilled?: number;
  progressTotal?: number;
  progressHint?: string;
}
