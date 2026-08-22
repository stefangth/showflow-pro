// src/lib/dashboard/moduleOnboarding.ts
import type { TFunction } from "i18next";
import { ROUTES } from "@/config/app.config";
import { type BookingSetupStepKey } from "@/lib/bookings/setupStatus";
import type { SetupStepKey } from "@/lib/hireOrders/setupStatus";
import type {
  InheritedRule,
  ModuleOnboardingDef,
  OnboardingCtx,
  OnboardingStepMeta,
} from "./types";

/** Namespace-bound translator every builder below reads from (the `onboarding` catalog). */
type OnbT = TFunction<"onboarding">;

/**
 * The one place this tip is worded, because two surfaces render it and they render it at
 * OPPOSITE times.
 *
 * As a `rules` entry (below) it belongs to the rail's COMPLETE state, so on its own it only
 * ever reached an admin who had already finished setup. The gap it answers is the other one:
 * nothing suggests looking at the app as an artist WHILE you are still building it, which is
 * exactly when the decisions it would inform are being made. So `BookingSetupRail` also
 * prints it in its footer, which is on screen from the first unfinished step onward.
 *
 * Admin (or super-admin) only, wherever it renders: Editor Mode is gated by
 * editorAccess.canUseEditor, so a producer told to use it would be sent to a control that is
 * not in their toolbar.
 *
 * Why the copy (now in the `onboarding` catalog under `viewAsArtist`) is worded the way it
 * is: the hint stops at what the toolbar can deliver. Its "as user" picker is filled from
 * admin-list-users, an auth.users enumeration, so an artist who is on the roster but holds no
 * account is not selectable at all; the always-available fallback is the "Viewing as: Artist"
 * role option, which switches the shell but leaves the admin as themselves, so useMyArtist
 * finds no artist row. Both surfaces sit next to a roster panel that has just said an artist
 * needs no account, which is precisely when the picker is empty, so the precondition is
 * stated rather than assumed.
 *
 * That precondition is the ACCOUNT, not a recent sign-in: the picker enumerates auth.users,
 * so an artist who accepted their invitation and never came back is still in it. "Account" is
 * also the word the product already uses at the one place an admin can check, the artist
 * card's account-status chip (AccountStatusChip: "Active account" / "No account").
 */
export function viewAsArtistTip(t: OnbT): InheritedRule {
  return { title: t("viewAsArtist.title"), hint: t("viewAsArtist.hint") };
}

/**
 * A producer's reachable explanation of what "Production Team" covers versus the admin.
 * Co-located here, the one place a role's narrative already lives (see viewAsArtistTip
 * above), and imported into BookingProducerWaitingCard so both surfaces state it the same
 * way instead of drifting into two versions of the same fact.
 *
 * Rendered by the rules block below regardless of ctx.artistAcceptance: unlike the rules
 * around it, this one describes what the ROLE does in general, not this org's pipeline, so
 * it does not belong to either branch.
 */
export function producerRoleNote(t: OnbT): string {
  return t("producerRole.note");
}

/** Where the note points a producer who wants the full picture: every role's scope, side
 *  by side. Points at the Help center rather than Settings, Documentation: that tab is
 *  super-admin-only (see settingsTabs.ts's SUPER_ADMIN_ONLY list), so it is no longer a
 *  destination a producer can land on.
 *
 *  roleExplainerLinkLabel is the text of an actual `<Link>` — only BookingProducerWaitingCard,
 *  which renders one, may use it as clickable text. The rail's complete-state rules render
 *  title + hint as static text with no href, so the producer rule below takes a declarative
 *  title (producerRoleRuleTitle) instead: a CTA-phrased "See what each role can do" with
 *  nothing to click reads as a broken affordance there. */
export function roleExplainerLinkLabel(t: OnbT): string {
  return t("roleExplainer.linkLabel");
}
export const ROLE_EXPLAINER_LINK_ROUTE = ROUTES.HELP;
export function producerRoleRuleTitle(t: OnbT): string {
  return t("producerRole.ruleTitle");
}

/** The admin-only "Add your production team" nudge. NOT an engine step (not in
 *  bookingOnboarding.steps / STEP_ORDER, so the parity test and producer counts stay clean);
 *  injected at the admin render sites. Producers plan/run/confirm; inviting the team is the
 *  admin's job, which is why this step is admin-only. */
export const TEAM_STEP_KEY = "team";
export function teamStepMeta(t: OnbT): OnboardingStepMeta {
  return {
    title: t("steps.team.title"),
    todoHint: t("steps.team.todoHint"),
    doneHint: t("steps.team.doneHint"),
    ctaLabel: t("steps.team.ctaLabel"),
    ctaRoute: `${ROUTES.ADMIN}?tab=people`,
  };
}

export function buildBookingOnboarding(t: OnbT): ModuleOnboardingDef<BookingSetupStepKey> {
  return {
    key: "booking_flow",
    // Flow-neutral, unlike the steps and rules below it. `railHeader` is a flat pair of
    // strings and neither consumer has a ctx to branch on: useModuleOnboardingRail prints it
    // as the ShowsBookingsPage banner, BookingSetupRail as its own card header.
    railHeader: {
      title: t("railHeader.booking.title"),
      body: t("railHeader.booking.body"),
    },
    steps: {
      // First in the org's actual sequence: slots, cast priorities and eligibility all read
      // from the shows already in the catalog. No `ctaCapability`: both admins and producers
      // can add shows via ProductionsPage, so the CTA should always render.
      shows: { title: t("steps.shows.title"), todoHint: t("steps.shows.todoHint"), doneHint: t("steps.shows.doneHint"), ctaLabel: t("steps.shows.ctaLabel"), ctaRoute: ROUTES.PRODUCTIONS },
      // Deep-linked, like the coverage links in LadderStep/EligibilityStep: the flow control
      // lives in Settings, Booking engine, and a bare ROUTES.SETTINGS opens Organization for an
      // admin and Scheduling for a producer, so "Choose flow" landed on a pane without it.
      flow: { title: t("steps.flow.title"), todoHint: t("steps.flow.todoHint"), doneHint: t("steps.flow.doneHint"), ctaLabel: t("steps.flow.ctaLabel"), ctaRoute: `${ROUTES.SETTINGS}?tab=booking`, ctaCapability: "edit_booking_settings" },
      // Gated on `add_artists`, not `edit_booking_settings`: adding artists is roster work, so
      // a producer who cannot change booking settings still gets an actionable CTA here.
      people: { title: t("steps.people.title"), todoHint: t("steps.people.todoHint"), doneHint: t("steps.people.doneHint"), ctaLabel: t("steps.people.ctaLabel"), ctaRoute: ROUTES.ARTISTS, ctaCapability: "add_artists" },
      slots: { title: t("steps.slots.title"), todoHint: t("steps.slots.todoHint"), doneHint: t("steps.slots.doneHint"), ctaLabel: t("steps.slots.ctaLabel"), ctaRoute: ROUTES.PRODUCTIONS, ctaCapability: "edit_booking_settings" },
      // These two hints name what the row HOLDS, not what one flow does with it; the
      // consequence that really differs is stated by LadderStep/EligibilityStep (coverageCopy).
      ladder: { title: t("steps.ladder.title"), todoHint: t("steps.ladder.todoHint"), doneHint: t("steps.ladder.doneHint"), ctaLabel: t("steps.ladder.ctaLabel"), ctaRoute: ROUTES.BOOKINGS, ctaCapability: "edit_booking_settings" },
      eligibility: { title: t("steps.eligibility.title"), todoHint: t("steps.eligibility.todoHint"), doneHint: t("steps.eligibility.doneHint"), ctaLabel: t("steps.eligibility.ctaLabel"), ctaRoute: ROUTES.BOOKINGS, ctaCapability: "edit_booking_settings" },
      // Deep-linked for the same reason as `flow`: the send hours live in Settings, Booking engine.
      timing: { title: t("steps.timing.title"), todoHint: t("steps.timing.todoHint"), doneHint: t("steps.timing.doneHint"), ctaLabel: t("steps.timing.ctaLabel"), ctaRoute: `${ROUTES.SETTINGS}?tab=booking`, ctaCapability: "edit_booking_settings" },
    },
    // This block is the rail's COMPLETE state: it narrates how this org works, as fact. Rule
    // one already branches on the flow, so every rule under it has to branch too. A
    // direct-book org (artist_acceptance false) never opens a tier, so the offer/window/queue
    // rules must not be printed to it.
    rules: (role, ctx) => ([
      { title: ctx.artistAcceptance ? t("bookingRules.offersWithTiers.title") : t("bookingRules.directBooking.title"), hint: ctx.artistAcceptance ? t("bookingRules.offersWithTiers.hint") : t("bookingRules.directBooking.hint") },
      ...(ctx.artistAcceptance
        ? [
            { title: t("bookingRules.offersByEmail.title"), hint: t("bookingRules.offersByEmail.hint") },
            { title: t("bookingRules.responseWindow.title"), hint: t("bookingRules.responseWindow.hint") },
            { title: role === "producer" ? t("bookingRules.confirmProducer.title") : t("bookingRules.confirmManual.title"), hint: t("bookingRules.confirmHint") },
          ]
        : [
            { title: t("bookingRules.nothingToAccept.title"), hint: t("bookingRules.nothingToAccept.hint") },
          ]),
      // Admins only, and the same object BookingSetupRail's footer renders.
      ...(role === "admin" ? [viewAsArtistTip(t)] : []),
      // Producer only: the rail renders this as static title + hint (no href), so the title is
      // declarative, not the clickable link label; the actual link lives on BookingProducerWaitingCard.
      ...(role === "producer" ? [{ title: producerRoleRuleTitle(t), hint: producerRoleNote(t) }] : []),
    ]),
    offFooter: t("offFooter.booking"),
  };
}

export function buildHireOrderOnboarding(t: OnbT): ModuleOnboardingDef<SetupStepKey> {
  return {
    key: "hire_orders",
    railHeader: {
      title: t("railHeader.hire.title"),
      body: t("railHeader.hire.body"),
    },
    steps: {
      letterhead: { title: t("steps.letterhead.title"), todoHint: t("steps.letterhead.todoHint"), doneHint: t("steps.letterhead.doneHint"), ctaLabel: t("steps.letterhead.ctaLabel"), ctaRoute: `${ROUTES.SETTINGS}?tab=hire-orders`, ctaCapability: "edit_hire_order_settings" },
      terms: { title: t("steps.terms.title"), todoHint: t("steps.terms.todoHint"), doneHint: t("steps.terms.doneHint"), ctaLabel: t("steps.terms.ctaLabel"), ctaRoute: `${ROUTES.SETTINGS}?tab=hire-orders`, ctaCapability: "edit_hire_order_settings" },
      countersign: { title: t("steps.countersign.title"), todoHint: t("steps.countersign.todoHint"), doneHint: t("steps.countersign.doneHint"), ctaLabel: t("steps.countersign.ctaLabel"), ctaRoute: `${ROUTES.SETTINGS}?tab=hire-orders`, ctaCapability: "edit_hire_order_settings" },
    },
    rules: () => ([
      { title: t("hireRules.autoDrafted.title"), hint: t("hireRules.autoDrafted.hint") },
      { title: t("hireRules.issuingManual.title"), hint: t("hireRules.issuingManual.hint") },
    ]),
    offFooter: t("offFooter.hire"),
  };
}

// `language_packages` has no onboarding module (no steps, no rail): it is a settings-page
// toggle, not a setup checklist, so it deliberately has no entry here. `FeatureKey` is the
// full entitlement registry; this narrower union is the subset that actually onboards.
export type OnboardingModuleKey = "booking_flow" | "hire_orders";

export function buildModuleOnboarding(t: OnbT): Record<OnboardingModuleKey, ModuleOnboardingDef<string>> {
  return {
    booking_flow: buildBookingOnboarding(t),
    hire_orders: buildHireOrderOnboarding(t),
  };
}

// ---- Artist personal readiness. Artists have no org-engine setup, so they do NOT go
// through the module registry (whose booking_flow steps are keyed by the engine keys).
// They get their own step metadata and rules, booking_flow only. Just one actionable
// step: blocking dates you cannot play.
export const ARTIST_STEP_KEYS = ["blockDates"] as const;
export type ArtistStepKey = typeof ARTIST_STEP_KEYS[number];

export function buildArtistOnboarding(t: OnbT): {
  steps: Record<ArtistStepKey, OnboardingStepMeta>;
  rules: (ctx: OnboardingCtx) => InheritedRule[];
} {
  return {
    steps: {
      // Flow-neutral on purpose. Blocked dates are honoured on BOTH paths, so the mechanism
      // is what it says.
      blockDates: { title: t("steps.blockDates.title"), todoHint: t("steps.blockDates.todoHint"), doneHint: t("steps.blockDates.doneHint"), ctaLabel: t("steps.blockDates.ctaLabel"), ctaRoute: ROUTES.AVAILABILITY },
    },
    // Same rule as the org-side registry above: an artist whose org books directly never
    // sees an offer, so nothing here may describe one as theirs.
    rules: (ctx) => ([
      ...(ctx.artistAcceptance
        ? [
            { title: t("artistRules.eligibilityFromCast.title"), hint: t("artistRules.eligibilityFromCast.hint") },
            { title: t("artistRules.offersArriveByEmail.title"), hint: t("artistRules.offersArriveByEmail.hint") },
            { title: t("artistRules.responseWindow.title"), hint: t("artistRules.responseWindow.hint") },
          ]
        : [
            { title: t("artistRules.bookedDirectly.title"), hint: t("artistRules.bookedDirectly.hint") },
            { title: t("artistRules.blockingIsNo.title"), hint: t("artistRules.blockingIsNo.hint") },
          ]),
    ]),
  };
}
