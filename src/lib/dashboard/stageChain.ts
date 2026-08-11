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
// timing literals, provenance line, em-dash stripping).
//
// Stays pure: no react/hooks/supabase imports. The caller (DashboardFirstRun)
// maps `StageAction` to navigate()/openSetup().

import { ROUTES } from "@/config/app.config";
import { STEP_TITLES } from "@/lib/bookings/setupStatus";
import {
  ARTIST_ONBOARDING,
  TEAM_STEP_META,
  bookingOnboarding,
  hireOrderOnboarding,
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
function rulesByLine(p: FirstRunProvenance): string {
  if (p.byYou) return "Rules set by you · Settings · Booking flow";
  if (p.actorName && p.changedAt) return `Rules set by ${p.actorName} · ${fmtDate(p.changedAt)}`;
  if (p.actorName) return `Rules set by ${p.actorName}`;
  return "Rules set in Settings · Booking flow";
}

/** Seam: strip every em/en dash from emitted copy. The strings below are
 *  authored without dashes already; this is a defensive backstop so nothing
 *  can slip through. */
function stripDash(s: string): string {
  return s.replace(/[—–]/g, ".");
}

function deepStripDash<T>(value: T): T {
  if (typeof value === "string") return stripDash(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepStripDash(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepStripDash(v);
    }
    return out as T;
  }
  return value;
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

/** over10()'s stuck-demotion + hot/plain/dim triage, ported verbatim. */
function finalizeStage(raw: RawStage): Stage {
  const outstanding = raw.steps.filter((s) => !s.done);
  const stuck = !raw.keepAction && !raw.done && outstanding.length > 0 && outstanding.every((s) => s.admin);
  const s = stuck && (raw.act || raw.primary)
    ? { ...raw, card: false, act: false, primary: "", chip: "", badge: "Waits", needs: "Waits on Mara Kessler", action: null }
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

const NOT_ON = { badge: "Not on", needs: "" };

// ---------------------------------------------------------------------------
// composeStageChain
// ---------------------------------------------------------------------------

export function composeStageChain(input: StageChainInput): StageChainResult {
  const { role, orgName } = input;
  const artist = role === "artist";
  const admin = role === "admin";
  const bf = input.bookingEntitled;
  const ho = input.hireEntitled;
  const offers = input.offers;
  const imported = input.imported;
  const m = input.metrics;
  const hour = fmtHour(input.timing.digestHourBerlin);
  const answerWindow = `${input.timing.responseWindowHours} hours`;

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
  const hardLabel = offers ? "Blocks offers" : "Blocks booking";
  const ladderStep = mkStep("ladder", STEP_TITLES.ladder, bDone("ladder"), bookingOnboarding.steps.ladder.todoHint, { hard: offers, hardLabel, admin: isAdminBlocked("ladder") });
  const eligibilityStep = mkStep("eligibility", STEP_TITLES.eligibility, bDone("eligibility"), bookingOnboarding.steps.eligibility.todoHint, { admin: isAdminBlocked("eligibility") });
  const timingStep = mkStep("timing", STEP_TITLES.timing, bDone("timing"), bookingOnboarding.steps.timing.todoHint, { admin: isAdminBlocked("timing") });
  const teamStep = mkStep("team", TEAM_STEP_META.title, bDone("team"), TEAM_STEP_META.todoHint);

  const letterheadStep = mkStep("letterhead", hireOrderOnboarding.steps.letterhead.title, hDone("letterhead"), hireOrderOnboarding.steps.letterhead.todoHint, { hard: true, hardLabel: "Blocks issuing", admin: isAdminBlocked("letterhead") });
  const termsStep = mkStep("terms", hireOrderOnboarding.steps.terms.title, hDone("terms"), hireOrderOnboarding.steps.terms.todoHint, { hard: true, hardLabel: "Blocks issuing", admin: isAdminBlocked("terms") });
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
        ? rawStage({ key: "eligibility", n: "01", name: "Eligibility", card: true, done: true, tag: "Ensemble A · your cast", line: "Your casts decide which dates can be offered to you.", metric: imported ? String(m.eligibleDates) : "0", metricLabel: "eligible dates" })
        : rawStage({ key: "eligibility", n: "01", name: "Eligibility", tag: "Booking flow · off", line: "No booking module, so no dates reach you here.", ...NOT_ON }),
      bf
        ? (input.artistBlockDatesDone
            ? rawStage({ key: "availability", n: "02", name: "Availability", card: true, done: true, tag: "Booking flow", line: "Blocked dates are never offered.", metric: String(m.blockedDates), metricLabel: "blocked dates", steps: [blockDatesStep], chip: "Open availability", action: { kind: "route", to: ROUTES.AVAILABILITY } })
            : rawStage({ key: "availability", n: "02", name: "Availability", card: true, act: true, tag: "Booking flow", line: "The one step that is yours.", metric: "0", metricLabel: "blocked dates", steps: [blockDatesStep], primary: "Block dates", action: { kind: "route", to: ROUTES.AVAILABILITY } }))
        : rawStage({ key: "availability", n: "02", name: "Availability", tag: "Booking flow · off", line: "Nothing to block against.", ...NOT_ON }),
      bf
        ? (offers
            ? (imported
                ? rawStage({ key: "offer", n: "03", name: "Offer", card: true, done: true, tag: "Booking flow", line: `One digest at ${hour} Berlin. ${answerWindow} to answer.`, metric: String(m.arriving), metricLabel: `arriving ${hour}` })
                : rawStage({ key: "offer", n: "03", name: "Offer", badge: "Waits", tag: "Booking flow", line: `One digest at ${hour} Berlin, never a mail per date.`, needs: "Needs dates for Ensemble A" }))
            : rawStage({ key: "offer", n: "03", name: "Booked directly", card: true, done: true, tag: "Booking flow · direct", line: "There is no offer step. A booked date appears as confirmed.", metric: imported ? String(m.confirmed) : "0", metricLabel: "confirmed" }))
        : rawStage({ key: "offer", n: "03", name: "Offer", tag: "Booking flow · off", line: "No offers are sent from ShowFlow.", ...NOT_ON }),
      ho
        ? rawStage({ key: "hire", n: "04", name: "Hire order", card: true, done: true, tag: "Hire orders", line: "You sign in the browser. The countersigned PDF lands in your mail.", metric: imported ? String(m.toSign) : "0", metricLabel: "to sign" })
        : rawStage({ key: "hire", n: "04", name: "Hire order", tag: "Hire orders · off", line: "The office emails your paperwork after a confirm.", ...NOT_ON, needs: "Nothing for you to do here" }),
    ];
  } else {
    const s2Name = offers ? "Offers" : "Book directly";
    const s2Tag = offers ? "Booking flow" : "Booking flow · direct";
    const s2Line = offers
      ? `Tier 1 goes out at ${hour}, tier 2 opens 24h later if unfilled.`
      : "A producer books straight from the eligibility list. Nothing to accept.";
    const s2Steps = [flowStep, peopleStep, ladderStep, eligibilityStep, timingStep];
    const datesChipIsBlocked = !input.canEditBooking;

    rawStages = [
      bf
        ? (imported
            ? rawStage({ key: "dates", n: "01", name: "Dates", card: true, done: true, tag: "Shows and bookings", line: `${m.datesIn} dates synced from Airtable overnight.`, metric: String(m.datesIn), metricLabel: "dates in", steps: [showsStep, slotsStep], chip: datesChipIsBlocked ? "Open dates" : "Set slots", action: datesChipIsBlocked ? { kind: "route", to: ROUTES.PRODUCTIONS } : { kind: "openSetup", feature: bookingOnboarding.key, step: "slots" } })
            : rawStage({ key: "dates", n: "01", name: "Dates", card: true, act: true, tag: "Shows and bookings", line: "Nothing downstream can mean anything until shows exist.", metric: "0", metricLabel: "dates in", steps: [showsStep, slotsStep], primary: admin ? "Import dates" : "Add a show", action: { kind: "route", to: ROUTES.PRODUCTIONS } }))
        : rawStage({ key: "dates", n: "01", name: "Dates", tag: "Booking flow · off", line: "Dates and bookings do not run in ShowFlow for this org.", ...NOT_ON }),
      bf
        ? (imported
            ? rawStage({ key: "offers", n: "02", name: s2Name, tag: s2Tag, line: s2Line, steps: s2Steps, card: true, act: offers, done: !offers, metric: offers ? String(m.readyToOffer) : String(m.bookableDates), metricLabel: offers ? "ready to offer" : "bookable dates", primary: offers ? "Send tier 1" : "", chip: offers ? "" : "Open the picker", action: { kind: "route", to: ROUTES.BOOKINGS } })
            : rawStage({ key: "offers", n: "02", name: s2Name, tag: s2Tag, line: s2Line, steps: s2Steps, badge: "Waits", needs: "Needs a date with slots set" }))
        : rawStage({ key: "offers", n: "02", name: "Offers", tag: "Booking flow · off", line: "No tiers, no digest, no direct picker.", ...NOT_ON }),
      bf
        ? (offers
            ? rawStage({ key: "confirm", n: "03", name: "Confirm", tag: role === "producer" ? "Booking flow · yours" : "Booking flow", badge: "Waits", line: "An accepted offer is not a booking until a producer confirms it.", needs: "Needs an acceptance", steps: admin ? [teamStep] : [], chip: admin ? TEAM_STEP_META.ctaLabel : "", action: admin ? { kind: "openSetup", feature: bookingOnboarding.key, step: "team" } : null })
            : rawStage({ key: "confirm", n: "03", name: "Confirmed on the spot", card: true, done: true, tag: "Booking flow · direct", line: "A direct booking is confirmed as it is made. No queue.", metric: imported ? String(m.confirmed) : "0", metricLabel: "confirmed", steps: admin ? [teamStep] : [], chip: admin ? TEAM_STEP_META.ctaLabel : "", action: admin ? { kind: "openSetup", feature: bookingOnboarding.key, step: "team" } : null }))
        : rawStage({ key: "confirm", n: "03", name: "Confirm", tag: "Booking flow · off", line: "Nothing to confirm here.", ...NOT_ON }),
      ho
        ? (bf
            ? rawStage({ key: "hire", n: "04", name: "Hire order", card: true, tag: "Hire orders", line: "You can draft orders right now. These are only needed before the first one goes out.", metric: imported ? String(m.hireDrafts) : "0", metricLabel: "drafts", steps: hireSteps3, chip: "Draft an order", keepAction: true, action: { kind: "openSetup", feature: hireOrderOnboarding.key, step: firstOutstandingKey(hireSteps3, "letterhead") } })
            : rawStage({ key: "hire", n: "04", name: "Hire order", card: true, act: true, tag: "Hire orders · manual", line: "With no booking module, every order is a manual engagement with no linked date.", metric: "0", metricLabel: "orders", steps: hireSteps3, primary: "New order", keepAction: true, action: { kind: "route", to: ROUTES.HIRE_ORDERS } }))
        : rawStage({ key: "hire", n: "04", name: "Hire order", tag: "Hire orders · off", line: "Confirmed dates leave ShowFlow as a CSV.", ...NOT_ON, needs: "Switched on by your account manager" }),
    ];
  }

  const stages = rawStages.map(finalizeStage);

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
    headline = `No modules are switched on for ${orgName}`;
    body = "There is nothing to set up and nothing to run yet. Your ShowFlow account manager switches modules on; nobody inside the org can.";
    ghost = "What the modules do";
    hint = "Nothing here is blocked by you";
    progressLabel = "Nothing to set up";
    progressHint = "Steps appear the moment a module is switched on.";
    side = [
      { title: "Read what each role covers", where: "Settings · Docs" },
      { title: "Message your account manager", where: "Chats" },
    ];
    queueTitle = "What this page becomes";
    queueHint = "Sample rows, shown once a module is on.";
    sample = true;
    queueOpacity = 0.4;
  } else if (artist) {
    progressLabel = `Set up · ${filled} of ${total}`;
    if (imported) {
      headline = offers ? `Your first offer arrives tomorrow at ${hour}` : "Your producer books you directly";
      body = offers
        ? `You have ${m.blockedDates} dates blocked, so the digest only asks about dates that work.`
        : "Blocked dates come out of the list your producer books from. That is where your say goes.";
      hint = offers ? `You get ${answerWindow} to answer` : "Nothing to accept";
      progressHint = "Also counts as done once you have opened Availability. An empty calendar is a valid answer.";
    } else {
      headline = `${orgName} added you to the roster`;
      body = "One step is yours, and it is two minutes. Everything else on this page is set by the org.";
      hint = "About 2 minutes";
      progressHint = "None of this blocks anything. It keeps unplayable dates out of the way.";
    }
    ghost = "How booking works here";
    side = offers
      ? [{ title: "How booking works here", where: "The rules you inherited" }, { title: "Message the office", where: "Chats" }]
      : [{ title: "Blocking is how you say no", where: "Availability" }, { title: "Message the office", where: "Chats" }];
    queueTitle = "Your dates";
    queueHint = "Live. This is your real content, not a preview.";
    sample = false;
    queueOpacity = 1;
  } else {
    progressLabel = `${admin ? "Set up · " : "Org setup · "}${filled} of ${total}`;
    if (!bf && ho) {
      headline = "Hire orders is the only module running";
      body = "No dates, offers or confirms in ShowFlow. Every order is a manual engagement, so the three steps below are all the setup there is.";
      ghost = "How this org works";
      hint = "Two of the three block issuing";
      progressHint = "You can draft an order now. These are only needed before the first one goes out.";
    } else if (imported) {
      headline = offers
        ? `${m.datesIn} dates landed. ${m.readyToOffer} of them can be offered tonight.`
        : `${m.datesIn} dates landed. ${m.bookableDates} are bookable now.`;
      body = offers
        ? "Stage 01 is running. The remaining dates have no slot counts, so the digest will skip them."
        : "Stage 01 is running. A producer books straight from the eligibility list. There is no offer step.";
      ghost = admin || input.canEditBooking ? "Change the flow in Settings" : "What is still outstanding";
      hint = offers ? `Tier 1 goes out at ${hour} Berlin` : "Direct booking · nothing to accept";
      progressHint = !input.canEditBooking ? "The steps marked Admin are not yours. The rest are." : "The steps left sit in the stage they hold up.";
    } else {
      headline = role === "producer" ? `${orgName} is still being set up` : "The chain is not running yet. One thing starts it: dates.";
      body = role === "producer"
        ? "Booking flow is on, but no dates exist yet. That is why this page is empty, not a bug."
        : "Booking flow is on and chosen. Every step it still needs is docked in the stage it unblocks.";
      ghost = admin || input.canEditBooking ? "How this org will work" : "What is still outstanding";
      hint = admin ? "About 15 minutes" : (input.canEditBooking ? "You can do these too" : "Adding shows is yours; the settings are not");
      progressHint = !input.canEditBooking ? "The steps marked Admin are not yours. The rest are." : "Nothing here stops you using the rest of the app.";
    }
    side = admin
      ? [{ title: "See it as your artists do", where: "The pencil top right opens the editor bar, where you can switch to the artist view." }, { title: "Read what each role covers", where: "Settings · Docs" }]
      : [{ title: "See what each role can do", where: "Settings · Docs" }, { title: "Message the admin", where: "Chats" }];
    queueTitle = "What this page becomes";
    queueHint = "Sample rows. Yours replace them once the org has dates.";
    sample = true;
    queueOpacity = 0.55;
  }

  const ticks = Array.from({ length: Math.max(total, 1) }, (_, i) => i < filled);

  const result: StageChainResult = {
    eyebrow: `${orgName} · first run`,
    headline,
    body,
    ghost,
    hint,
    progressLabel,
    progressHint,
    hasSteps,
    ticks,
    modules: [
      { label: "Booking flow", on: bf },
      { label: "Hire orders", on: ho },
    ],
    offFooters,
    hasChain: !nothingOn,
    chainTitle: artist ? "How a date reaches you" : "How a date will move",
    rulesBy: rulesByLine(input.provenance),
    stages,
    sideTitle: nothingOn ? "The app is open, there is just nothing to run" : "Nothing here blocks the rest of the app",
    sideBody: role === "producer" && !nothingOn
      ? "You are on the Production Team. You plan dates, run offers and confirm bookings. Inviting people, casts and settings stay with the admin."
      : (artist
          ? "Blocking is how you say no. Blocked dates come out of the list before anyone books you."
          : "Some steps above block the first booking. The app itself is open, and two things worth doing are not steps at all."),
    side,
    queueTitle,
    queueHint,
    sample,
    queueOpacity,
    nothingOn,
  };

  return deepStripDash(result);
}
