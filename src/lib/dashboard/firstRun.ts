// src/lib/dashboard/firstRun.ts
import type { TFunction } from "i18next";
import { TEAM_STEP_KEY, teamStepMeta, type OnboardingModuleKey } from "./moduleOnboarding";
import type {
  ComposeInput, ComposeResult, ComposedStep, DashboardRole, InheritedRule,
  ModuleOnboardingDef, ModuleStatusLite, OnboardingCtx, OnboardingStepMeta,
  WelcomeCopy,
} from "./types";

/** Namespace-bound translator the copy builders below read from (the `onboarding` catalog). */
type OnbT = TFunction<"onboarding">;

/** Whether the org has at least one producer-role member — the "Add your production team"
 *  step's done-state. Single-sourced so `adminTeamStep` and BookingSetupRail's hand-rolled
 *  count agree on when the nudge is satisfied. */
export function hasProducerTeam(producerCount: number | null): boolean {
  return (producerCount ?? 0) > 0;
}

/** The admin-only production-team nudge as a ComposedStep, so the dashboard rail (which
 *  renders ComposedStep generically) and any other consumer get title/hints/CTA for free.
 *  moduleKey is booking_flow (it rides the booking setup surface); block is null (non-gating). */
export function adminTeamStep(producerCount: number | null, t: OnbT): ComposedStep {
  return { ...teamStepMeta(t), key: TEAM_STEP_KEY, moduleKey: "booking_flow", done: hasProducerTeam(producerCount), block: null };
}

/** The single rule for whether the admin-only production-team nudge shows alongside the
 *  booking steps: admins only, booking module only, and only WHILE INCOMPLETE (so a complete
 *  org's hero/rules view never over-counts). Shared by injectAdminTeamStep (the dashboard rail
 *  and Shows & Bookings banner) and BookingSetupRail (the checklist sheet), so the three
 *  surfaces cannot drift — the whole-branch review found the banner had drifted when the gate
 *  was inlined per-surface. */
export function showAdminTeamStep(opts: { role: DashboardRole; bookingEnabled: boolean; complete: boolean }): boolean {
  return opts.role === "admin" && opts.bookingEnabled && !opts.complete;
}

/** Prepend the admin-only, non-gating production-team nudge to a composed step list and
 *  return the augmented list plus its counts. The gate keys on `opts.complete`, which must
 *  be the BOOKING module's completeness, NOT `composed.complete`: the dashboard composes
 *  ALL entitled modules, so its `composed.complete` also waits on hire_orders — keying the
 *  booking-scoped nudge on that made it linger on the dashboard (team already invited, booking
 *  done) while the Shows & Bookings banner and the checklist sheet, both booking-only, had
 *  already retired it. The single-module surfaces pass their own `composed.complete`, which
 *  IS booking-only, so they are unaffected. */
export function injectAdminTeamStep(
  composed: ComposeResult,
  opts: { role: DashboardRole; bookingEnabled: boolean; producerCount: number | null; complete: boolean },
  t: OnbT,
): { steps: ComposedStep[]; filled: number; total: number } {
  const show = showAdminTeamStep({ role: opts.role, bookingEnabled: opts.bookingEnabled, complete: opts.complete });
  const steps = show ? [adminTeamStep(opts.producerCount, t), ...composed.steps] : composed.steps;
  return { steps, filled: steps.filter((s) => s.done).length, total: steps.length };
}

export function composeOnboarding(
  input: ComposeInput,
  // Keyed by OnboardingModuleKey, not the full FeatureKey: not every entitlement has an
  // onboarding module (language_packages is a settings toggle, not a setup checklist — see
  // moduleOnboarding.ts). Iterating the registry's own keys, rather than every FeatureKey,
  // keeps this in sync with the registry without depending on it covering every entitlement.
  registry: Record<OnboardingModuleKey, ModuleOnboardingDef<string>>,
): ComposeResult {
  const { enabled, role, moduleStatuses, ctx } = input;
  const steps: ComposedStep[] = [];
  const rules: ComposeResult["rules"] = [];
  let complete = true;

  const moduleKeys = Object.keys(registry) as OnboardingModuleKey[];
  for (const key of moduleKeys) {
    const def = registry[key];
    if (!enabled.has(key)) continue;
    const status = moduleStatuses[key];
    if (!status) { complete = false; continue; } // unread status => not complete
    for (const s of status.steps) {
      const meta = def.steps[s.key];
      if (!meta) continue; // defensive; parity test guarantees coverage
      steps.push({ ...meta, key: s.key, moduleKey: key, done: s.done, block: s.block });
    }
    if (!status.complete) complete = false;
    rules.push(...def.rules(role, ctx));
  }

  const offFooters = moduleKeys.filter((k) => !enabled.has(k)).map((k) => registry[k].offFooter);
  return { steps, complete, rules, offFooters };
}

/**
 * Artist composition path. Artists have no org-engine setup, so their `booking_flow`
 * slice never goes through `MODULE_ONBOARDING` (whose booking steps are keyed by the
 * engine keys). Their step metadata + rules come from `ARTIST_ONBOARDING`, and only
 * `booking_flow` ever contributes — so a hire-orders entitlement can never leak the
 * admin letterhead/terms/countersign steps into an artist's rail.
 */
export function composeArtist(
  status: ModuleStatusLite,
  def: { steps: Record<string, OnboardingStepMeta>; rules: (ctx: OnboardingCtx) => InheritedRule[] },
  ctx: OnboardingCtx,
): ComposeResult {
  const steps: ComposedStep[] = [];
  for (const s of status.steps) {
    const meta = def.steps[s.key];
    if (!meta) continue;
    steps.push({ ...meta, key: s.key, moduleKey: "booking_flow", done: s.done, block: s.block });
  }
  return { steps, complete: status.complete, rules: def.rules(ctx), offFooters: [] };
}

// ---- Copy (ported from the prototype's renderVals; org name + counts interpolated).
export function welcomeCopy(
  role: DashboardRole, complete: boolean, ctx: OnboardingCtx,
  progress: { filled: number; total: number },
  // A producer granted edit_booking_settings / edit_hire_order_settings can actually
  // do the org setup, so the "only an admin" framing must not apply to them.
  canEditSetup: boolean,
  t: OnbT,
): WelcomeCopy {
  const org = ctx.orgName;
  const base = { eyebrow: t("welcome.base.eyebrow"), progressFilled: progress.filled, progressTotal: progress.total };
  if (role === "admin") {
    return complete
      ? { ...base, headline: t("welcome.admin.completeHeadline"), body: t("welcome.admin.completeBody"), primaryLabel: t("welcome.admin.completePrimary"), secondaryLabel: t("welcome.admin.completeSecondary"), progressLabel: t("welcome.admin.completeProgressLabel", { total: progress.total }), progressHint: t("welcome.admin.completeProgressHint") }
      // No firstness or emptiness claims: `complete` only says setup steps are
      // outstanding, which is equally true for the second admin joining an org that
      // already holds shows, dates, and artists.
      : { ...base, headline: t("welcome.admin.incompleteHeadline", { org }), body: t("welcome.admin.incompleteBody"), primaryLabel: t("welcome.admin.incompletePrimary"), secondaryLabel: t("welcome.admin.incompleteSecondary"), progressLabel: t("welcome.admin.incompleteProgressLabel", { filled: progress.filled, total: progress.total }), progressHint: t("welcome.admin.incompleteProgressHint") };
  }
  if (role === "producer") {
    const pending = ctx.counts.pendingConfirmations;
    const pendingBody = pending === 0
      ? t("welcome.producer.pendingNone")
      : t("welcome.producer.pendingBody", { count: pending });
    // Branched, not flattened: this function DOES take ctx (the artist branch below already
    // reads it), so an org that runs offers keeps the fuller list. A direct-book org never
    // opens a tier, so listing offers among what "appears here" named a stage of a pipeline
    // it does not run, on the card sitting on top of a rail whose chips say "Blocks booking".
    const emptyBody = ctx.artistAcceptance
      ? t("welcome.producer.emptyOffers")
      : t("welcome.producer.emptyDirect");
    return complete
      ? { ...base, headline: t("welcome.producer.completeHeadline", { org }), body: pendingBody, primaryLabel: t("welcome.producer.completePrimary"), secondaryLabel: t("welcome.producer.completeSecondary"), progressLabel: t("welcome.producer.completeProgressLabel", { total: progress.total }), progressHint: t("welcome.producer.completeProgressHint") }
      : { ...base, headline: t("welcome.producer.incompleteHeadline", { org }), body: emptyBody, primaryLabel: canEditSetup ? t("welcome.producer.incompletePrimaryCanEdit") : t("welcome.producer.incompletePrimaryReadOnly"), secondaryLabel: t("welcome.producer.incompleteSecondary"), progressLabel: t("welcome.producer.incompleteProgressLabel", { filled: progress.filled, total: progress.total }), progressHint: canEditSetup ? t("welcome.producer.incompleteProgressHintCanEdit") : t("welcome.producer.incompleteProgressHintReadOnly") };
  }
  // artist
  //
  // Branched on the flow, because this card sits directly on top of the rules block and
  // that block already branches: at a direct-book org (artist_acceptance false) no tier is
  // ever opened, so the artist rules tell this artist "You are booked directly" while the
  // headline above it announced offers on their way. One surface, two products.
  //
  // The primary label carries no flow at all. It opens the rules block, and it renders in
  // both, so naming a pipeline there would be the same claim in a place that cannot branch.
  const offers = ctx.artistAcceptance;
  return complete
    ? {
        ...base,
        headline: offers ? t("welcome.artist.completeHeadlineOffers") : t("welcome.artist.completeHeadlineDirect"),
        body: offers ? t("welcome.artist.completeBodyOffers") : t("welcome.artist.completeBodyDirect"),
        primaryLabel: t("welcome.artist.completePrimary"), secondaryLabel: t("welcome.artist.completeSecondary"),
        progressLabel: t("welcome.artist.completeProgressLabel", { total: progress.total }), progressHint: t("welcome.artist.completeProgressHint"),
      }
    : {
        ...base,
        headline: t("welcome.artist.incompleteHeadline", { org }),
        body: offers ? t("welcome.artist.incompleteBodyOffers") : t("welcome.artist.incompleteBodyDirect"),
        primaryLabel: t("welcome.artist.incompletePrimary"), secondaryLabel: t("welcome.artist.incompleteSecondary"),
        progressLabel: t("welcome.artist.incompleteProgressLabel", { filled: progress.filled, total: progress.total }), progressHint: t("welcome.artist.incompleteProgressHint"),
      };
}

// The artist strings below take no flow, and neither of these functions receives ctx, so
// they render unchanged at a direct-book org. That is exactly why they name no pipeline:
// "How offers work here" is itself a claim that offers exist, and it labelled a rules list
// whose first line said they do not. "Booking" is true under every preset.
// (The admin/producer strings are untouched: their rails cover the whole org, and both
// roles can see a direct-book org's offer settings are simply unused.)
export function railHeaderCopy(role: DashboardRole, complete: boolean, canEditSetup: boolean, t: OnbT) {
  if (complete) {
    return {
      eyebrow: role === "artist" ? t("railHeaderCopy.completeArtistEyebrow") : t("railHeaderCopy.completeOrgEyebrow"),
      title: t("railHeaderCopy.completeTitle"),
      // Admins can always reach Settings; a producer can too when granted the edit_*
      // capabilities. Everyone else (producer without the grant, artist) cannot.
      body: role === "admin" || (role === "producer" && canEditSetup)
        ? t("railHeaderCopy.completeBodyCanEdit")
        : role === "producer"
          ? t("railHeaderCopy.completeBodyProducer")
          : t("railHeaderCopy.completeBodyArtist"),
    };
  }
  // Flow-neutral for the same reason the artist labels above are: this function takes no
  // ctx, so these bodies render unchanged at a direct-book org, which never opens a tier.
  // They sit directly on top of step rows the engine chips "Blocks booking" for that org
  // (blockFor, src/lib/bookings/setupStatus.ts), so naming an offer here contradicted the
  // rows underneath. "The first booking" is the same gate under every preset.
  if (role === "admin") return { eyebrow: t("railHeaderCopy.adminEyebrow"), title: t("railHeaderCopy.adminTitle"), body: t("railHeaderCopy.adminBody") };
  if (role === "producer") return canEditSetup
    ? { eyebrow: t("railHeaderCopy.producerEyebrow"), title: t("railHeaderCopy.producerTitle"), body: t("railHeaderCopy.producerBodyCanEdit") }
    : { eyebrow: t("railHeaderCopy.producerEyebrow"), title: t("railHeaderCopy.producerTitle"), body: t("railHeaderCopy.producerBodyReadOnly") };
  return { eyebrow: t("railHeaderCopy.artistEyebrow"), title: t("railHeaderCopy.artistTitle"), body: t("railHeaderCopy.artistBody") };
}

export function collapsedCopy(role: DashboardRole, complete: boolean, remaining: number, t: OnbT) {
  if (complete) return { label: t("collapsed.completeLabel"), hint: role === "artist" ? t("collapsed.completeHintArtist") : t("collapsed.completeHintOrg"), cta: role === "artist" ? t("collapsed.completeCtaArtist") : t("collapsed.completeCtaOrg") };
  return {
    label: role === "producer" ? t("collapsed.incompleteLabelProducer") : t("collapsed.incompleteLabelOther"),
    hint: t("collapsed.incompleteHint", { count: remaining }),
    cta: role === "producer" ? t("collapsed.incompleteCtaProducer") : t("collapsed.incompleteCtaOther"),
  };
}

