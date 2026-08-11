import type { FeatureKey } from "@/lib/entitlements";

export type FirstRunRole = "admin" | "producer" | "artist";
export type StageVariant = "hot" | "plain" | "dim";

/** A setup step docked into the stage it unblocks. Sourced from the existing
 *  registries (title/hint) + setupStatus (done/block) + capability (admin). */
export interface DockedStep {
  key: string;
  label: string;
  done: boolean;
  hard: boolean;
  hardLabel: string;
  soft: boolean;
  admin: boolean;
  hint: string;
}

/** What a stage's single CTA does. The composer stays pure and emits intent;
 *  DashboardFirstRun maps it to navigate() or openSetup(). */
export type StageAction =
  | { kind: "route"; to: string }
  | { kind: "openSetup"; feature: FeatureKey; step: string };

export interface Stage {
  key: string;
  n: string;
  variant: StageVariant;
  name: string;
  tag: string;
  line: string;
  running: boolean;
  badge: string;
  needs: string;
  metric: string | null;
  metricLabel: string;
  steps: DockedStep[];
  ctaLabel: string;
  ctaIsPrimary: boolean;
  action: StageAction | null;
}

export interface FirstRunMetrics {
  datesIn: number;
  readyToOffer: number;
  bookableDates: number;
  confirmed: number;
  hireDrafts: number;
  eligibleDates: number;
  blockedDates: number;
  arriving: number;
  toSign: number;
}

export interface FirstRunProvenance {
  byYou: boolean;
  actorName: string | null;
  changedAt: string | null;
}

export interface FirstRunTiming {
  digestHourBerlin: number;
  responseWindowHours: number;
}

export interface SideLink {
  title: string;
  where: string;
}

export interface QueueRow {
  dot: "accent" | "faint";
  title: string;
  hint: string;
  when: string;
  cta: string;
}

export interface StageChainInput {
  role: FirstRunRole;
  orgName: string;
  bookingEntitled: boolean;
  hireEntitled: boolean;
  offers: boolean;
  imported: boolean;
  canEditBooking: boolean;
  canEditHire: boolean;
  bookingSteps: Record<string, { done: boolean }>;
  hireSteps: Record<string, { done: boolean }>;
  artistBlockDatesDone: boolean;
  metrics: FirstRunMetrics;
  provenance: FirstRunProvenance;
  timing: FirstRunTiming;
}

export interface StageChainResult {
  eyebrow: string;
  headline: string;
  body: string;
  ghost: string;
  hint: string;
  progressLabel: string;
  progressHint: string;
  hasSteps: boolean;
  ticks: boolean[];
  modules: { label: string; on: boolean }[];
  offFooters: string[];
  hasChain: boolean;
  chainTitle: string;
  rulesBy: string;
  stages: Stage[];
  sideTitle: string;
  sideBody: string;
  side: SideLink[];
  queueTitle: string;
  queueHint: string;
  sample: boolean;
  queueOpacity: number;
  nothingOn: boolean;
}
