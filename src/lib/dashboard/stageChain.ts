// src/lib/dashboard/stageChain.ts
//
// Pure composer for the dashboard first-run "stage chain": turns the org's
// config, per-viewer capability and live metrics into the full
// StageChainResult the DashboardFirstRun surface renders.
//
// This is a faithful port of over10() from
// docs/superpowers/plans/assets/2026-08-11-dashboard-first-run-5c.reproduction.html.
// Every stage name, tag, line, badge and hint below is that function's copy,
// verbatim, with the demo's hardcoded toggle-harness state (role10/bf10/ho10/
// canEdit10/...) replaced by real reads from `input`. See the task brief for
// the exact seam list (done-ness, step labels/hints, admin marker, metrics,
// timing literals, provenance line). Every authored string below is dash-free
// by construction (house rule: no em/en dashes in copy). There is no
// post-hoc stripping step, so a future edit that introduces one fails the
// "no em-dashes anywhere in composed copy" test directly instead of being
// silently rewritten.
//
// Stays pure: no react/hooks/supabase imports. The caller (DashboardFirstRun)
// maps `StageAction` to navigate()/openSetup().

import type { TFunction } from "i18next";
import { ROUTES } from "@/config/app.config";
import { berlinTime } from "@/lib/bookingFlow";
import { stepTitles } from "@/lib/bookings/setupStatus";
import {
  buildArtistOnboarding,
  buildBookingOnboarding,
  buildHireOrderOnboarding,
  teamStepMeta,
} from "@/lib/dashboard/moduleOnboarding";
import type {
  DockedStep,
  FirstRunProvenance,
  Stage,
  StageAction,
  StageChainInput,
  StageChainResult,
  StageVariant,
} from "./stageChain.types";

/** Namespace-bound translator the composer reads all copy from (the `onboarding` catalog). */
type OnbT = TFunction<"onboarding">;

// ---------------------------------------------------------------------------
// Small copy helpers
// ---------------------------------------------------------------------------

/** Seam: `09:00` in the demo copy becomes the org's configured digest hour. */
function fmtHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-04T00:00:00Z" -> "4 Aug". UTC getters so the result is timezone-safe. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** Seam: the provenance line, ported from the task brief. */
function rulesByLine(p: FirstRunProvenance, t: OnbT): string {
  if (p.byYou) return t("stageChain.provenance.byYou");
  if (p.actorName && p.changedAt) return t("stageChain.provenance.byActorWithDate", { actor: p.actorName, date: fmtDate(p.changedAt) });
  if (p.actorName) return t("stageChain.provenance.byActor", { actor: p.actorName });
  return t("stageChain.provenance.inSettings");
}

// ---------------------------------------------------------------------------
// Docked steps (mirrors the demo's mk())
// ---------------------------------------------------------------------------

function mkStep(
  key: string,
  label: string,
  done: boolean,
  todoHint: string,
  opts: { hard?: boolean; hardLabel?: string; soft?: boolean; admin?: boolean } = {},
): DockedStep {
  const step: DockedStep = {
    key,
    label,
    done,
    hard: opts.hard ?? false,
    hardLabel: opts.hardLabel ?? "",
    soft: opts.soft ?? false,
    admin: opts.admin ?? false,
    hint: done ? "" : todoHint,
  };
  if (done) {
    step.hard = false;
    step.soft = false;
  }
  return step;
}

function firstOutstandingKey(steps: DockedStep[], fallback: string): string {
  return steps.find((s) => !s.done)?.key ?? steps[0]?.key ?? fallback;
}

// ---------------------------------------------------------------------------
// Stages: internal working shape before the demo's card/act/primary triage
// collapses it into a `Stage`.
// ---------------------------------------------------------------------------

interface RawStage {
  key: string;
  n: string;
  name: string;
  card: boolean;
  act: boolean;
  done: boolean;
  primary: string;
  chip: string;
  tag: string;
  line: string;
  badge: string;
  metric: string | null;
  metricLabel: string;
  needs: string;
  steps: DockedStep[];
  keepAction: boolean;
  action: StageAction | null;
}

function rawStage(overrides: Partial<RawStage> & { key: string; n: string; name: string }): RawStage {
  return {
    card: false,
    act: false,
    done: false,
    primary: "",
    chip: "",
    tag: "",
    line: "",
    badge: "",
    metric: null,
    metricLabel: "",
    needs: "",
    steps: [],
    keepAction: false,
    action: null,
    ...overrides,
  };
}

/** over10()'s stuck-demotion + hot/plain/dim triage, ported verbatim except the
 *  demoted `needs` line, which is now the real provenance actor (Fix 1), not the
 *  demo's hardcoded admin name. */
function finalizeStage(raw: RawStage, adminActorName: string | null, t: OnbT): Stage {
  const outstanding = raw.steps.filter((s) => !s.done);
  const stuck = !raw.keepAction && !raw.done && outstanding.length > 0 && outstanding.every((s) => s.admin);
  const waitsOn = adminActorName ? t("stageChain.waitsOnActor", { name: adminActorName }) : t("stageChain.waitsOnAdmin");
  const s = stuck && (raw.act || raw.primary)
    ? { ...raw, card: false, act: false, primary: "", chip: "", badge: t("stageChain.badge.waits"), needs: waitsOn, action: null }
    : raw;

  const hot = s.card && (s.act || !!s.primary);
  const plain = s.card && !hot;
  const variant: StageVariant = hot ? "hot" : plain ? "plain" : "dim";
  const ctaLabel = s.primary || s.chip || "";

  return {
    key: s.key,
    n: s.n,
    variant,
    name: s.name,
    tag: s.tag,
    line: s.line,
    running: variant === "plain" && s.done,
    badge: s.badge,
    needs: s.needs,
    metric: s.metric,
    metricLabel: s.metricLabel,
    steps: s.steps,
    ctaLabel,
    ctaIsPrimary: !!s.primary,
    action: ctaLabel ? s.action : null,
  };
}

// ---------------------------------------------------------------------------
// composeStageChain
// ---------------------------------------------------------------------------

export function composeStageChain(input: StageChainInput, t: OnbT): StageChainResult {
  const { role, orgName } = input;
  const artist = role === "artist";
  const admin = role === "admin";
  const bf = input.bookingEntitled;
  const ho = input.hireEntitled;
  const offers = input.offers;
  const imported = input.imported;
  const m = input.metrics;
  const hour = fmtHour(input.timing.digestHourBerlin);
  const responseWindowHours = input.timing.responseWindowHours;

  // Registries + shared metadata, resolved once through the passed translator.
  const bookingOnboarding = buildBookingOnboarding(t);
  const hireOrderOnboarding = buildHireOrderOnboarding(t);
  const ARTIST_ONBOARDING = buildArtistOnboarding(t);
  const TEAM_STEP_META = teamStepMeta(t);
  const STEP_TITLES = stepTitles(t);

  const NOT_ON = { badge: t("stageChain.badge.notOn"), needs: "" };

  // Seam: the real per-step admin marker, replacing the demo's coarse capBlocked().
  const stepCap: Record<string, "booking" | "hire" | null> = {
    shows: null, people: null, flow: "booking", slots: "booking", ladder: "booking",
    eligibility: "booking", timing: "booking", letterhead: "hire", terms: "hire",
    countersign: "hire", team: null, blockDates: null,
  };
  const isAdminBlocked = (key: string) =>
    (stepCap[key] === "booking" && !input.canEditBooking) ||
    (stepCap[key] === "hire" && !input.canEditHire);

  const bDone = (key: string) => input.bookingSteps[key]?.done ?? false;
  const hDone = (key: string) => input.hireSteps[key]?.done ?? false;

  // ---- docked steps ------------------------------------------------------
  const blockDatesStep = mkStep(
    "blockDates",
    ARTIST_ONBOARDING.steps.blockDates.title,
    input.artistBlockDatesDone,
    ARTIST_ONBOARDING.steps.blockDates.todoHint,
  );

  const showsStep = mkStep("shows", STEP_TITLES.shows, bDone("shows"), bookingOnboarding.steps.shows.todoHint);
  const slotsStep = mkStep("slots", STEP_TITLES.slots, bDone("slots"), bookingOnboarding.steps.slots.todoHint, { soft: true, admin: isAdminBlocked("slots") });
  const flowStep = mkStep("flow", STEP_TITLES.flow, bDone("flow"), bookingOnboarding.steps.flow.todoHint, { admin: isAdminBlocked("flow") });
  const peopleStep = mkStep("people", STEP_TITLES.people, bDone("people"), bookingOnboarding.steps.people.todoHint);
  const hardLabel = offers ? t("stageChain.docked.blocksOffers") : t("stageChain.docked.blocksBooking");
  const ladderStep = mkStep("ladder", STEP_TITLES.ladder, bDone("ladder"), bookingOnboarding.steps.ladder.todoHint, { hard: offers, hardLabel, admin: isAdminBlocked("ladder") });
  const eligibilityStep = mkStep("eligibility", STEP_TITLES.eligibility, bDone("eligibility"), bookingOnboarding.steps.eligibility.todoHint, { admin: isAdminBlocked("eligibility") });
  const timingStep = mkStep("timing", STEP_TITLES.timing, bDone("timing"), bookingOnboarding.steps.timing.todoHint, { admin: isAdminBlocked("timing") });
  const teamStep = mkStep("team", TEAM_STEP_META.title, bDone("team"), TEAM_STEP_META.todoHint);

  const letterheadStep = mkStep("letterhead", hireOrderOnboarding.steps.letterhead.title, hDone("letterhead"), hireOrderOnboarding.steps.letterhead.todoHint, { hard: true, hardLabel: t("stageChain.docked.blocksIssuing"), admin: isAdminBlocked("letterhead") });
  const termsStep = mkStep("terms", hireOrderOnboarding.steps.terms.title, hDone("terms"), hireOrderOnboarding.steps.terms.todoHint, { hard: true, hardLabel: t("stageChain.docked.blocksIssuing"), admin: isAdminBlocked("terms") });
  const countersignStep = mkStep("countersign", hireOrderOnboarding.steps.countersign.title, hDone("countersign"), hireOrderOnboarding.steps.countersign.todoHint, { admin: isAdminBlocked("countersign") });
  const hireSteps3 = [letterheadStep, termsStep, countersignStep];

  // ---- flat step list (drives progress label / ticks) -------------------
  let steps: DockedStep[] = [];
  if (artist) {
    if (bf) steps = [blockDatesStep];
  } else if (bf) {
    const b = [showsStep, slotsStep, flowStep, peopleStep, ladderStep, eligibilityStep, timingStep];
    steps = admin ? [teamStep, ...b] : b;
  }
  if (!artist && ho) {
    steps = steps.concat(hireSteps3);
  }
  const total = steps.length;
  const filled = steps.filter((s) => s.done).length;
  const hasSteps = total > 0;

  // ---- off footers --------------------------------------------------------
  const offFooters: string[] = [];
  if (!bf) offFooters.push(bookingOnboarding.offFooter);
  if (!ho) offFooters.push(hireOrderOnboarding.offFooter);

  // ---- stages -------------------------------------------------------------
  let rawStages: RawStage[];
  if (artist) {
    rawStages = [
      bf
        ? rawStage({ key: "eligibility", n: "01", name: t("stageChain.artist.eligibilityName"), card: true, done: true, tag: t("stageChain.tag.yourCast"), line: t("stageChain.artist.eligibilityOnLine"), metric: imported ? String(m.eligibleDates) : "0", metricLabel: t("stageChain.artist.eligibilityOnMetricLabel") })
        : rawStage({ key: "eligibility", n: "01", name: t("stageChain.artist.eligibilityName"), tag: t("stageChain.tag.bookingEngineOff"), line: t("stageChain.artist.eligibilityOffLine"), ...NOT_ON }),
      bf
        ? (input.artistBlockDatesDone
            ? rawStage({ key: "availability", n: "02", name: t("stageChain.artist.availabilityName"), card: true, done: true, tag: t("stageChain.tag.bookingEngine"), line: t("stageChain.artist.availabilityDoneLine"), metric: String(m.blockedDates), metricLabel: t("stageChain.artist.availabilityMetricLabel"), steps: [blockDatesStep], chip: t("stageChain.artist.availabilityDoneChip"), action: { kind: "route", to: ROUTES.AVAILABILITY } })
            : rawStage({ key: "availability", n: "02", name: t("stageChain.artist.availabilityName"), card: true, act: true, tag: t("stageChain.tag.bookingEngine"), line: t("stageChain.artist.availabilityActLine"), metric: "0", metricLabel: t("stageChain.artist.availabilityMetricLabel"), steps: [blockDatesStep], primary: t("stageChain.artist.availabilityActPrimary"), action: { kind: "route", to: ROUTES.AVAILABILITY } }))
        : rawStage({ key: "availability", n: "02", name: t("stageChain.artist.availabilityName"), tag: t("stageChain.tag.bookingEngineOff"), line: t("stageChain.artist.availabilityOffLine"), ...NOT_ON }),
      bf
        ? (offers
            ? (imported
                ? rawStage({ key: "offer", n: "03", name: t("stageChain.artist.offerName"), card: true, done: true, tag: t("stageChain.tag.bookingEngine"), line: t("stageChain.artist.offerImportedLine", { time: berlinTime(input.timing.digestHourBerlin), hours: responseWindowHours }), metric: String(m.arriving), metricLabel: t("stageChain.artist.offerMetricLabel", { hour }) })
                : rawStage({ key: "offer", n: "03", name: t("stageChain.artist.offerName"), badge: t("stageChain.badge.waits"), tag: t("stageChain.tag.bookingEngine"), line: t("stageChain.artist.offerWaitsLine", { time: berlinTime(input.timing.digestHourBerlin) }), needs: t("stageChain.artist.offerWaitsNeeds") }))
            : rawStage({ key: "offer", n: "03", name: t("stageChain.artist.bookedDirectlyName"), card: true, done: true, tag: t("stageChain.tag.bookingEngineDirect"), line: t("stageChain.artist.bookedDirectlyLine"), metric: imported ? String(m.confirmed) : "0", metricLabel: t("stageChain.artist.bookedDirectlyMetricLabel") }))
        : rawStage({ key: "offer", n: "03", name: t("stageChain.artist.offerName"), tag: t("stageChain.tag.bookingEngineOff"), line: t("stageChain.artist.offerOffLine"), ...NOT_ON }),
      ho
        ? rawStage({ key: "hire", n: "04", name: t("stageChain.artist.hireName"), card: true, done: true, tag: t("stageChain.tag.hireOrders"), line: t("stageChain.artist.hireOnLine"), metric: imported ? String(m.toSign) : "0", metricLabel: t("stageChain.artist.hireOnMetricLabel") })
        : rawStage({ key: "hire", n: "04", name: t("stageChain.artist.hireName"), tag: t("stageChain.tag.hireOrdersOff"), line: t("stageChain.artist.hireOffLine"), ...NOT_ON, needs: t("stageChain.artist.hireOffNeeds") }),
    ];
  } else {
    const s2Name = offers ? t("stageChain.org.offersName") : t("stageChain.org.bookDirectlyName");
    const s2Tag = offers ? t("stageChain.tag.bookingEngine") : t("stageChain.tag.bookingEngineDirect");
    const s2Line = offers
      ? t("stageChain.org.offersLine", { hour })
      : t("stageChain.org.directLine");
    const s2Steps = [flowStep, peopleStep, ladderStep, eligibilityStep, timingStep];
    const datesChipIsBlocked = !input.canEditBooking;

    rawStages = [
      bf
        ? (imported
            ? rawStage({ key: "dates", n: "01", name: t("stageChain.org.datesName"), card: true, done: true, tag: t("stageChain.tag.showsAndBookings"), line: t("stageChain.org.datesImportedLine", { count: m.datesIn }), metric: String(m.datesIn), metricLabel: t("stageChain.org.datesMetricLabel"), steps: [showsStep, slotsStep], chip: datesChipIsBlocked ? t("stageChain.org.datesChipOpen") : t("stageChain.org.datesChipSlots"), action: datesChipIsBlocked ? { kind: "route", to: ROUTES.PRODUCTIONS } : { kind: "openSetup", feature: bookingOnboarding.key, step: "slots" } })
            : rawStage({ key: "dates", n: "01", name: t("stageChain.org.datesName"), card: true, act: true, tag: t("stageChain.tag.showsAndBookings"), line: t("stageChain.org.datesActLine"), metric: "0", metricLabel: t("stageChain.org.datesMetricLabel"), steps: [showsStep, slotsStep], primary: admin ? t("stageChain.org.datesActPrimaryImport") : t("stageChain.org.datesActPrimaryAdd"), action: { kind: "route", to: ROUTES.PRODUCTIONS } }))
        : rawStage({ key: "dates", n: "01", name: t("stageChain.org.datesName"), tag: t("stageChain.tag.bookingEngineOff"), line: t("stageChain.org.datesOffLine"), ...NOT_ON }),
      bf
        ? (imported
            ? rawStage({ key: "offers", n: "02", name: s2Name, tag: s2Tag, line: s2Line, steps: s2Steps, card: true, act: offers, done: !offers, metric: offers ? String(m.readyToOffer) : String(m.bookableDates), metricLabel: offers ? t("stageChain.org.offersReadyMetricLabel") : t("stageChain.org.bookableMetricLabel"), primary: offers ? t("stageChain.org.offersPrimary") : "", chip: offers ? "" : t("stageChain.org.offersChip"), action: { kind: "route", to: ROUTES.BOOKINGS } })
            : rawStage({ key: "offers", n: "02", name: s2Name, tag: s2Tag, line: s2Line, steps: s2Steps, badge: t("stageChain.badge.waits"), needs: t("stageChain.org.offersWaitsNeeds") }))
        : rawStage({ key: "offers", n: "02", name: t("stageChain.org.offersOffName"), tag: t("stageChain.tag.bookingEngineOff"), line: t("stageChain.org.offersOffLine"), ...NOT_ON }),
      bf
        ? (offers
            ? rawStage({ key: "confirm", n: "03", name: t("stageChain.org.confirmName"), tag: role === "producer" ? t("stageChain.tag.bookingEngineYours") : t("stageChain.tag.bookingEngine"), badge: t("stageChain.badge.waits"), line: t("stageChain.org.confirmLine"), needs: t("stageChain.org.confirmNeeds"), steps: admin ? [teamStep] : [], chip: admin ? TEAM_STEP_META.ctaLabel : "", action: admin ? { kind: "openSetup", feature: bookingOnboarding.key, step: "team" } : null })
            : rawStage({ key: "confirm", n: "03", name: t("stageChain.org.confirmedName"), card: true, done: true, tag: t("stageChain.tag.bookingEngineDirect"), line: t("stageChain.org.confirmedLine"), metric: imported ? String(m.confirmed) : "0", metricLabel: t("stageChain.org.confirmedMetricLabel"), steps: admin ? [teamStep] : [], chip: admin ? TEAM_STEP_META.ctaLabel : "", action: admin ? { kind: "openSetup", feature: bookingOnboarding.key, step: "team" } : null }))
        : rawStage({ key: "confirm", n: "03", name: t("stageChain.org.confirmName"), tag: t("stageChain.tag.bookingEngineOff"), line: t("stageChain.org.confirmOffLine"), ...NOT_ON }),
      ho
        ? (bf
            ? rawStage({ key: "hire", n: "04", name: t("stageChain.org.hireName"), card: true, tag: t("stageChain.tag.hireOrders"), line: t("stageChain.org.hireOnLine"), metric: imported ? String(m.hireDrafts) : "0", metricLabel: t("stageChain.org.hireMetricLabel"), steps: hireSteps3, chip: t("stageChain.org.hireChip"), keepAction: true, action: { kind: "openSetup", feature: hireOrderOnboarding.key, step: firstOutstandingKey(hireSteps3, "letterhead") } })
            : rawStage({ key: "hire", n: "04", name: t("stageChain.org.hireName"), card: true, act: true, tag: t("stageChain.tag.hireOrdersManual"), line: t("stageChain.org.hireManualLine"), metric: "0", metricLabel: t("stageChain.org.hireManualMetricLabel"), steps: hireSteps3, primary: t("stageChain.org.hireManualPrimary"), keepAction: true, action: { kind: "route", to: ROUTES.HIRE_ORDERS } }))
        : rawStage({ key: "hire", n: "04", name: t("stageChain.org.hireName"), tag: t("stageChain.tag.hireOrdersOff"), line: t("stageChain.org.hireOffLine"), ...NOT_ON, needs: t("stageChain.org.hireOffNeeds") }),
    ];
  }

  const stages = rawStages.map((r) => finalizeStage(r, input.provenance.actorName, t));

  const nothingOn = !bf && !ho;

  // ---- headline copy --------------------------------------------------
  let headline: string;
  let body: string;
  let ghost: string;
  let hint: string;
  let progressLabel: string;
  let progressHint: string;
  let side: { title: string; where: string }[];
  let queueTitle: string;
  let queueHint: string;
  let sample: boolean;
  let queueOpacity: number;

  if (nothingOn) {
    headline = t("stageChain.headline.nothingOnHeadline", { org: orgName });
    body = t("stageChain.headline.nothingOnBody");
    ghost = t("stageChain.headline.nothingOnGhost");
    hint = t("stageChain.headline.nothingOnHint");
    progressLabel = t("stageChain.headline.nothingOnProgressLabel");
    progressHint = t("stageChain.headline.nothingOnProgressHint");
    side = [
      { title: t("stageChain.side.readRoleCovers"), where: t("stageChain.side.helpCenter") },
      { title: t("stageChain.side.messageAccountManager"), where: t("stageChain.side.chats") },
    ];
    queueTitle = t("stageChain.headline.nothingOnQueueTitle");
    queueHint = t("stageChain.headline.nothingOnQueueHint");
    sample = true;
    queueOpacity = 0.4;
  } else if (artist) {
    progressLabel = t("stageChain.headline.artistProgressLabel", { filled, total });
    if (imported) {
      headline = offers ? t("stageChain.headline.artistImportedHeadlineOffers", { hour }) : t("stageChain.headline.artistImportedHeadlineDirect");
      body = offers
        ? t("stageChain.headline.artistImportedBodyOffers", { count: m.blockedDates })
        : t("stageChain.headline.artistImportedBodyDirect");
      hint = offers ? t("stageChain.headline.artistImportedHintOffers", { hours: responseWindowHours }) : t("stageChain.headline.artistImportedHintDirect");
      progressHint = t("stageChain.headline.artistImportedProgressHint");
    } else {
      headline = t("stageChain.headline.artistRosterHeadline", { org: orgName });
      // Guard: "one step is yours" is only true when a step actually exists (bf on).
      // An artist at a booking-off org (e.g. hire-orders-only) has zero docked steps,
      // so the claim would be false.
      body = hasSteps
        ? t("stageChain.headline.artistRosterBodyHasSteps")
        : t("stageChain.headline.artistRosterBodyNoSteps");
      hint = hasSteps ? t("stageChain.headline.artistRosterHintHasSteps") : t("stageChain.headline.artistRosterHintNoSteps");
      progressHint = hasSteps
        ? t("stageChain.headline.artistRosterProgressHintHasSteps")
        : t("stageChain.headline.artistRosterProgressHintNoSteps");
    }
    ghost = t("stageChain.headline.artistGhost");
    side = offers
      ? [{ title: t("stageChain.side.howBookingWorksHere"), where: t("stageChain.side.rulesYouInherited") }, { title: t("stageChain.side.messageOffice"), where: t("stageChain.side.chats") }]
      : [{ title: t("stageChain.side.blockingIsHowYouSayNo"), where: t("stageChain.side.availability") }, { title: t("stageChain.side.messageOffice"), where: t("stageChain.side.chats") }];
    queueTitle = t("stageChain.headline.artistQueueTitle");
    queueHint = t("stageChain.headline.artistQueueHint");
    sample = false;
    queueOpacity = 1;
  } else {
    progressLabel = admin ? t("stageChain.headline.orgProgressLabelAdmin", { filled, total }) : t("stageChain.headline.orgProgressLabelOther", { filled, total });
    if (!bf && ho) {
      headline = t("stageChain.headline.hireOnlyHeadline");
      body = t("stageChain.headline.hireOnlyBody");
      ghost = t("stageChain.headline.hireOnlyGhost");
      hint = t("stageChain.headline.hireOnlyHint");
      progressHint = t("stageChain.headline.hireOnlyProgressHint");
    } else if (imported) {
      headline = offers
        ? `${t("stageChain.headline.orgImportedLanded", { count: m.datesIn })} ${t("stageChain.headline.orgImportedLandedOffersClause", { readyToOffer: m.readyToOffer })}`
        : `${t("stageChain.headline.orgImportedLanded", { count: m.datesIn })} ${t("stageChain.headline.orgImportedLandedBookableClause", { count: m.bookableDates })}`;
      body = offers
        ? t("stageChain.headline.orgImportedBodyOffers")
        : t("stageChain.headline.orgImportedBodyDirect");
      ghost = admin || input.canEditBooking ? t("stageChain.headline.orgGhostHowItWorks") : t("stageChain.headline.orgGhostOutstanding");
      hint = offers ? t("stageChain.headline.orgImportedHintOffers", { time: berlinTime(input.timing.digestHourBerlin) }) : t("stageChain.headline.orgImportedHintDirect");
      progressHint = !input.canEditBooking ? t("stageChain.headline.orgProgressHintReadOnly") : t("stageChain.headline.orgImportedProgressHint");
    } else {
      headline = role === "producer" ? t("stageChain.headline.orgEmptyHeadlineProducer", { org: orgName }) : t("stageChain.headline.orgEmptyHeadlineAdmin");
      body = role === "producer"
        ? t("stageChain.headline.orgEmptyBodyProducer")
        : t("stageChain.headline.orgEmptyBodyAdmin");
      ghost = admin || input.canEditBooking ? t("stageChain.headline.orgEmptyGhostHowItWillWork") : t("stageChain.headline.orgGhostOutstanding");
      hint = admin ? t("stageChain.headline.orgEmptyHintAdmin") : (input.canEditBooking ? t("stageChain.headline.orgEmptyHintCanEdit") : t("stageChain.headline.orgEmptyHintReadOnly"));
      progressHint = !input.canEditBooking ? t("stageChain.headline.orgProgressHintReadOnly") : t("stageChain.headline.orgEmptyProgressHint");
    }
    side = admin
      ? [{ title: t("stageChain.side.seeItAsArtists"), where: t("stageChain.side.editorBarHint") }, { title: t("stageChain.side.readRoleCovers"), where: t("stageChain.side.helpCenter") }]
      : [{ title: t("stageChain.side.seeWhatEachRoleCanDo"), where: t("stageChain.side.helpCenter") }, { title: t("stageChain.side.messageAdmin"), where: t("stageChain.side.chats") }];
    queueTitle = t("stageChain.headline.orgQueueTitle");
    queueHint = t("stageChain.headline.orgQueueHint");
    sample = true;
    queueOpacity = 0.55;
  }

  const ticks = Array.from({ length: Math.max(total, 1) }, (_, i) => i < filled);

  const result: StageChainResult = {
    eyebrow: t("stageChain.result.eyebrow", { org: orgName }),
    headline,
    body,
    ghost,
    hint,
    progressLabel,
    progressHint,
    hasSteps,
    ticks,
    modules: [
      { label: t("stageChain.modules.booking"), on: bf },
      { label: t("stageChain.modules.hire"), on: ho },
    ],
    offFooters,
    hasChain: !nothingOn,
    chainTitle: artist ? t("stageChain.result.chainTitleArtist") : t("stageChain.result.chainTitleOrg"),
    rulesBy: rulesByLine(input.provenance, t),
    stages,
    sideTitle: nothingOn ? t("stageChain.result.sideTitleNothingOn") : t("stageChain.result.sideTitleDefault"),
    sideBody: role === "producer" && !nothingOn
      ? t("stageChain.result.sideBodyProducer")
      : (artist
          ? t("stageChain.result.sideBodyArtist")
          : t("stageChain.result.sideBodyDefault")),
    side,
    queueTitle,
    queueHint,
    sample,
    queueOpacity,
    nothingOn,
  };

  return result;
}
