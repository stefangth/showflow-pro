// src/lib/dashboard/firstRun.ts
import { FEATURE_KEYS, type FeatureKey } from "@/lib/entitlements";
import { TEAM_STEP_KEY, TEAM_STEP_META } from "./moduleOnboarding";
import type {
  ComposeInput, ComposeResult, ComposedStep, DashboardRole, InheritedRule,
  ModuleOnboardingDef, ModuleStatusLite, OnboardingCtx, OnboardingStepMeta,
  SamplePreviewData, WelcomeCopy,
} from "./types";

/** Whether the org has at least one producer-role member — the "Add your production team"
 *  step's done-state. Single-sourced so `adminTeamStep` and BookingSetupRail's hand-rolled
 *  count agree on when the nudge is satisfied. */
export function hasProducerTeam(producerCount: number | null): boolean {
  return (producerCount ?? 0) > 0;
}

/** The admin-only production-team nudge as a ComposedStep, so the dashboard rail (which
 *  renders ComposedStep generically) and any other consumer get title/hints/CTA for free.
 *  moduleKey is booking_flow (it rides the booking setup surface); block is null (non-gating). */
export function adminTeamStep(producerCount: number | null): ComposedStep {
  return { ...TEAM_STEP_META, key: TEAM_STEP_KEY, moduleKey: "booking_flow", done: hasProducerTeam(producerCount), block: null };
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

/** Prepend the admin-only, non-gating production-team nudge to a composed booking step list
 *  and return the augmented list plus its counts. */
export function injectAdminTeamStep(
  composed: ComposeResult,
  opts: { role: DashboardRole; bookingEnabled: boolean; producerCount: number | null },
): { steps: ComposedStep[]; filled: number; total: number } {
  const show = showAdminTeamStep({ role: opts.role, bookingEnabled: opts.bookingEnabled, complete: composed.complete });
  const steps = show ? [adminTeamStep(opts.producerCount), ...composed.steps] : composed.steps;
  return { steps, filled: steps.filter((s) => s.done).length, total: steps.length };
}

export function composeOnboarding(
  input: ComposeInput,
  registry: Record<FeatureKey, ModuleOnboardingDef<string>>,
): ComposeResult {
  const { enabled, role, moduleStatuses, ctx } = input;
  const steps: ComposedStep[] = [];
  const rules: ComposeResult["rules"] = [];
  let complete = true;

  for (const key of FEATURE_KEYS) {
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

  const offFooters = FEATURE_KEYS.filter((k) => !enabled.has(k)).map((k) => registry[k].offFooter);
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
  canEditSetup = false,
): WelcomeCopy {
  const org = ctx.orgName;
  const base = { eyebrow: "Welcome", progressFilled: progress.filled, progressTotal: progress.total };
  if (role === "admin") {
    return complete
      ? { ...base, headline: "This workspace is already set up", body: "Nothing to configure. Walk the decisions behind it, because every number on this page follows them.", primaryLabel: "How this org works", secondaryLabel: "Dismiss", progressLabel: `Set up · ${progress.total} of ${progress.total}`, progressHint: "The rules you inherited" }
      // No firstness or emptiness claims: `complete` only says setup steps are
      // outstanding, which is equally true for the second admin joining an org that
      // already holds shows, dates, and artists. The old copy ("You are the first
      // admin" / "The database is empty.") was false in exactly that state.
      : { ...base, headline: `Finish setting up ${org}`, body: "A few decisions still shape how this workspace runs. Walk the remaining steps, because every number on this page follows them.", primaryLabel: "Start setup", secondaryLabel: "Later", progressLabel: `Set up · ${progress.filled} of ${progress.total}`, progressHint: "About 15 minutes" };
  }
  if (role === "producer") {
    const pending = ctx.counts.pendingConfirmations;
    const pendingBody = pending === 0
      ? "No confirmations are waiting on you right now."
      : `${pending} artist${pending === 1 ? "" : "s"} ${pending === 1 ? "is" : "are"} waiting on a confirm from you.`;
    // Branched, not flattened: this function DOES take ctx (the artist branch below already
    // reads it), so an org that runs offers keeps the fuller list. A direct-book org never
    // opens a tier, so listing offers among what "appears here" named a stage of a pipeline
    // it does not run, on the card sitting on top of a rail whose chips say "Blocks booking".
    const emptyBody = ctx.artistAcceptance
      ? "Dates, offers and confirmations appear here the moment the first import lands."
      : "Dates and bookings appear here the moment the first import lands.";
    return complete
      ? { ...base, headline: `You have joined ${org}`, body: pendingBody, primaryLabel: "How this org works", secondaryLabel: "Dismiss", progressLabel: `Set up · ${progress.total} of ${progress.total}`, progressHint: "The rules you inherited" }
      : { ...base, headline: `${org} is still being set up`, body: emptyBody, primaryLabel: canEditSetup ? "Start setup" : "See what is outstanding", secondaryLabel: "Later", progressLabel: `Org setup · ${progress.filled} of ${progress.total}`, progressHint: canEditSetup ? "About 15 minutes" : "Only an admin can do these" };
  }
  // artist
  //
  // Branched on the flow, because this card sits directly on top of the rules block and
  // that block already branches: at a direct-book org (artist_acceptance false) no tier is
  // ever opened, so ARTIST_ONBOARDING tells this artist "You are booked directly" while the
  // headline above it announced offers on their way. One surface, two products.
  //
  // The primary label carries no flow at all. It opens the rules block, and it renders in
  // both, so naming a pipeline there would be the same claim in a place that cannot branch.
  const offers = ctx.artistAcceptance;
  return complete
    ? {
        ...base,
        headline: offers ? "Your first offers are on their way" : "Your first dates are on their way",
        body: offers
          ? "Your account is set up. A few rules decide when an offer reaches you and how long you have to answer."
          : "Your account is set up. A few rules decide how this org books you, and blocking dates is your part of it.",
        primaryLabel: "How booking works here", secondaryLabel: "Dismiss",
        progressLabel: `Set up · ${progress.total} of ${progress.total}`, progressHint: "The rules you inherited",
      }
    : {
        ...base,
        headline: `${org} added you to the roster`,
        body: offers
          ? "Offers arrive by email and land on this page. Block the dates you cannot play first, so you only get asked about dates that work."
          : "Your producer books you directly, and confirmed dates land on this page. Block the dates you cannot play first, so they come off the list before anyone books you.",
        primaryLabel: "Start setup", secondaryLabel: "Later",
        progressLabel: `Set up · ${progress.filled} of ${progress.total}`, progressHint: "About 2 minutes",
      };
}

// The artist strings below take no flow, and neither of these functions receives ctx, so
// they render unchanged at a direct-book org. That is exactly why they name no pipeline:
// "How offers work here" is itself a claim that offers exist, and it labelled a rules list
// whose first line said they do not. "Booking" is true under every preset.
// (The admin/producer strings are untouched: their rails cover the whole org, and both
// roles can see a direct-book org's offer settings are simply unused.)
export function railHeaderCopy(role: DashboardRole, complete: boolean, canEditSetup = false) {
  if (complete) {
    return {
      eyebrow: role === "artist" ? "How booking works here" : "How this org works",
      title: "The rules you inherited",
      // Admins can always reach Settings; a producer can too when granted the edit_*
      // capabilities. Everyone else (producer without the grant, artist) cannot.
      body: role === "admin" || (role === "producer" && canEditSetup)
        ? "You can change them in Settings, but every number on this page follows them today."
        : role === "producer"
          ? "You cannot change these, but every number on this page follows them."
          : "You cannot change these. Every date you are booked on follows them.",
    };
  }
  // Flow-neutral for the same reason the artist labels above are: this function takes no
  // ctx, so these bodies render unchanged at a direct-book org, which never opens a tier.
  // They sit directly on top of step rows the engine chips "Blocks booking" for that org
  // (blockFor, src/lib/bookings/setupStatus.ts), so naming an offer here contradicted the
  // rows underneath. "The first booking" is the same gate under every preset.
  if (role === "admin") return { eyebrow: "Set up", title: "Get the workspace running", body: "Some of these block the first booking. Nothing here stops you using the rest of the app." };
  if (role === "producer") return canEditSetup
    ? { eyebrow: "Org setup", title: "What is still outstanding", body: "Some of these block the first booking. Nothing here stops you using the rest of the app." }
    : { eyebrow: "Org setup", title: "What is still outstanding", body: "Only an admin can do these. This is here so you know why the page is empty, not so you can fix it." };
  return { eyebrow: "Set up", title: "Before your first booking", body: "None of this blocks anything. It just keeps the dates you cannot play out of the way." };
}

export function collapsedCopy(role: DashboardRole, complete: boolean, remaining: number) {
  if (complete) return { label: "Set up · done", hint: role === "artist" ? "How this org books you" : "Booking flow, dates, cast slots, your team", cta: role === "artist" ? "How booking works here" : "How this org works" };
  return {
    label: role === "producer" ? "Org setup in progress" : "Set up in progress",
    hint: `${remaining} step${remaining === 1 ? "" : "s"} left`,
    cta: role === "producer" ? "See what is outstanding" : "Resume",
  };
}

// Only admin/producer render the sample preview (the empty-org "what this becomes"
// state). Artists always have real per-user content, so there is no artist fixture.
export const SAMPLE_PREVIEW: Record<Exclude<DashboardRole, "artist">, SamplePreviewData> = {
  admin: {
    stats: [
      { title: "Live dates", value: "34", label: "upcoming" },
      { title: "Waiting on a confirm", value: "6", label: "bookings" },
      { title: "Roster", value: "41", label: "artists" },
    ],
    queue: [
      { title: "6 artists accepted and are waiting on a confirm", hint: "Kammerkonzert 12 Aug, Nachtstück 14 Aug", when: "now", cta: "Confirm", tone: "accent" },
      { title: "2 offers expire at 17:00", hint: "Tier 1 · Nachtstück 14 Aug", when: "17:00", cta: "Open date", tone: "warning" },
      { title: "Airtable sync brought in 4 new dates", hint: "None of them have cast slots set", when: "09:04", cta: "Review", tone: "faint" },
    ],
    week: [
      { date: "10 Aug", ref: "Kammerkonzert · Halle B", status: "Cast complete" },
      { date: "12 Aug", ref: "Kammerkonzert · Halle B", status: "Tier 2 open · 1 of 3" },
      { date: "14 Aug", ref: "Nachtstück · Studio", status: "2 offers expire 17:00" },
    ],
  },
  producer: {
    stats: [
      { title: "Waiting on you", value: "4", label: "confirmations" },
      { title: "Expiring today", value: "2", label: "offers" },
      { title: "Unfilled tiers", value: "3", label: "dates" },
    ],
    queue: [
      { title: "4 artists accepted and are waiting on a confirm", hint: "Kammerkonzert 12 Aug, Nachtstück 14 Aug", when: "now", cta: "Confirm", tone: "accent" },
      { title: "2 offers expire at 17:00", hint: "Tier 1 · Nachtstück 14 Aug", when: "17:00", cta: "Open date", tone: "warning" },
      { title: "1 hire order awaits your countersign", hint: "Nora Lindqvist", when: "today", cta: "Sign", tone: "faint" },
    ],
    week: [
      { date: "10 Aug", ref: "Kammerkonzert · Halle B", status: "Cast complete" },
      { date: "12 Aug", ref: "Kammerkonzert · Halle B", status: "Tier 2 open · 1 of 3" },
      { date: "14 Aug", ref: "Nachtstück · Studio", status: "2 offers expire 17:00" },
    ],
  },
};
