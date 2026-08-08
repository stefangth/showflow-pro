// src/lib/dashboard/types.ts
import type { ReactNode } from "react";
import type { FeatureKey } from "@/lib/entitlements";

/** The two capability actions this feature's step CTAs gate on. Kept as a local
 *  union (useCan takes a bare string; capabilities.ts exports no action type). */
export type StepCapability = "edit_booking_settings" | "edit_hire_order_settings";

export type DashboardRole = "admin" | "producer" | "artist";

/** Booking BlockKind ("offers"/"filling") plus "issuing" for hire-order steps
 *  (letterhead/terms) that block issuing, so the rail chips them for parity. */
export type SetupBlock = "offers" | "filling" | "issuing" | null;

export interface OnboardingStepMeta {
  title: string;
  todoHint: string;
  doneHint: string;
  ctaLabel: string;
  ctaRoute: string; // a ROUTES.* value
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

export interface DashboardFirstRunState {
  show: boolean;
  complete: boolean;
  dismissed: boolean;
  steps: ComposedStep[];
  rules: InheritedRule[];
  offFooters: string[];
  welcome: WelcomeCopy;
  // Admin/producer only (the empty-org sample preview). Absent for the artist role,
  // whose dashboard body always renders live.
  sample?: SamplePreviewData;
  sectionTitle?: string;
  sectionHint?: string;
  railEyebrow: string;
  railTitle: string;
  railBody: string;
  collapsedLabel: string;
  collapsedHint: string;
  collapsedCta: string;
  railOpen: boolean;
  openRail: () => void;
  closeRail: () => void;
  dismiss: () => void;
}

// Component prop contracts (Wave A components bind to these).
export interface DashboardWelcomeProps { welcome: WelcomeCopy; onPrimary: () => void; onSecondary: () => void; }
export interface DashboardWelcomeCollapsedProps { label: string; hint: string; ctaLabel: string; onOpen: () => void; }
export interface DashboardSetupRailProps {
  eyebrow: string; title: string; body: string; complete: boolean;
  steps: ComposedStep[]; rules: InheritedRule[]; offFooters: string[];
  onClose: () => void; onDismiss: () => void;
}
export interface SamplePreviewProps {
  // `sample` (with its section copy) is optional: when absent the component renders
  // its live children, so an artist surface can mount it without a sample fixture.
  complete: boolean; sample?: SamplePreviewData;
  sectionTitle?: string; sectionHint?: string; children: ReactNode;
}
