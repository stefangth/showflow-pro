// Pure composer for the Wireflow v3 /get-running board: 16-step / 3-phase model built on
// top of the two existing setup-readiness modules (src/lib/bookings/setupStatus.ts,
// src/lib/hireOrders/setupStatus.ts) plus a handful of new signals those modules don't
// carry yet (dates source/connect/map/cities split, skills, team, fee, document).
//
// This is a NEW, independent module. It deliberately does NOT import from v1
// (src/lib/getRunning/tasks.ts) so v1 stays byte-stable; it mirrors v1's `makeBookingTask`/
// `makeHireTask`/`withActionability` idioms instead of sharing code with them.
//
// All 16 steps now carry real signals. Phase 2 wired the get_dates split (source/connect/map/cities/productions);
// Phase 3 wired skills/fee/document. See the task briefs for the exact per-step signal source.
// The booking/hiring setups + get_dates/skills/fee/document signals compose the whole board.
//
// No React, no hooks, no data fetching here — a later task wires this to live queries.

import type { BookingSetupStatus, BookingSetupStepKey } from "@/lib/bookings/setupStatus";
import type { HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

export type GetRunningPhaseKey = "get_dates" | "bookable" | "paperwork";
export type GetRunningStepKey =
  | "source"
  | "connect"
  | "map"
  | "cities"
  | "productions"
  | "artists"
  | "skills"
  | "coverage"
  | "flow"
  | "timing"
  | "team"
  | "letterhead"
  | "fee"
  | "terms"
  | "document"
  | "countersign";
export type StepBlock = "offers" | "booking" | "issuing" | "filling" | null;

export interface GetRunningStep {
  key: GetRunningStepKey;
  phase: GetRunningPhaseKey;
  done: boolean;
  block: StepBlock;
  adminOnly: boolean;
  actionableByViewer: boolean;
  placeholder: boolean;
  /** Not shown, and excluded from doneCount/totalCount/nextStep. Used when a source choice makes a step moot. */
  hidden?: boolean;
}

export interface GetRunningPhaseV3 {
  key: GetRunningPhaseKey;
  steps: GetRunningStep[];
  done: boolean;
  doneCount: number;
  totalCount: number;
  block: StepBlock;
  waitsOn: GetRunningPhaseKey | null;
}

export interface GetRunningModelV3 {
  phases: GetRunningPhaseV3[];
  doneCount: number;
  totalCount: number;
  canFirstOffer: boolean;
  complete: boolean;
  bookingOn: boolean;
  hireOrdersOn: boolean;
  /** Non-blocking advisory: count of future dates with no city set. Mirrors v1's field. */
  datesWithoutCity: number;
  nextStep: { phase: GetRunningPhaseKey; key: GetRunningStepKey } | null;
}

export interface GetRunningInputV3 {
  role: "admin" | "producer";
  bookingOn: boolean;
  hireOrdersOn: boolean;
  booking: BookingSetupStatus | null; // null while unread or module off
  hire: HireOrderSetupStatus | null;
  datesSource: "airtable" | "sheet" | "manual" | null;
  datesConnectDone: boolean;
  datesMapDone: boolean;
  datesCitiesDone: boolean;
  /** The org has at least one non-cancelled date. Guards the two get_dates steps that
   *  would otherwise be vacuously true on a blank org: "every date has a city" holds
   *  trivially with no dates, and "review your productions" says nothing about dates. */
  hasAnyDates: boolean;
  producerCount: number | null; // team step done when > 0
  skillsDone: boolean; // real signal: the org's skill catalog is non-empty (useSkills)
  feeDone: boolean; // real signal: org owns its hire_order_defaults row (useHireOrderExtraSetup)
  documentDone: boolean; // real signal: org owns its hire_order_numbering row (useHireOrderExtraSetup)
  canManageShows: boolean;
  canEditScheduling: boolean;
  canEditBooking: boolean;
  // The `skills` step edits the skill CATALOG, which `SkillsTab` (and RLS) gate on
  // `manage_skills` — a different capability from `edit_booking_settings` (booking-engine
  // settings), with a different producer default. Keep them separate so the step's
  // actionability matches what the reused SkillsTab actually enforces.
  canManageSkills: boolean;
  canEditHire: boolean;
  canAddArtists: boolean;
  canInvite: boolean;
}

export const MINUTES_PER_STEP = 3;

export type GetRunningV3State = "blocking" | "ready" | "complete";
export function getRunningV3State(m: GetRunningModelV3): GetRunningV3State {
  return m.complete ? "complete" : m.canFirstOffer ? "ready" : "blocking";
}

function bookingStep(booking: BookingSetupStatus | null, key: BookingSetupStepKey) {
  return booking?.steps.find((s) => s.key === key) ?? null;
}

function hireStep(hire: HireOrderSetupStatus | null, key: "letterhead" | "terms" | "countersign") {
  return hire?.steps.find((s) => s.key === key) ?? null;
}

interface StepConfig {
  key: GetRunningStepKey;
  done: boolean;
  block: StepBlock;
  adminOnly: boolean;
  placeholder: boolean;
  /** Producer capability required to act on this step, beyond `!adminOnly`. */
  capability: boolean;
  hidden?: boolean;
}

function finalizeStep(phase: GetRunningPhaseKey, cfg: StepConfig, role: GetRunningInputV3["role"]): GetRunningStep {
  return {
    key: cfg.key,
    phase,
    done: cfg.done,
    block: cfg.block,
    adminOnly: cfg.adminOnly,
    actionableByViewer: role === "admin" ? true : !cfg.adminOnly && cfg.capability,
    placeholder: cfg.placeholder,
    hidden: cfg.hidden,
  };
}

/** Steps not marked `hidden` (a source choice made them moot). Used for counts, done rollups, and nextStep. */
export function visibleSteps(steps: GetRunningStep[]): GetRunningStep[] {
  return steps.filter((s) => !s.hidden);
}

export function composeGetRunningV3(input: GetRunningInputV3): GetRunningModelV3 {
  const phases: GetRunningPhaseV3[] = [];

  // Board-level hard block for the four "dates are in" steps, mirroring v1 `hardBlock`:
  // taken from the booking module's own `people` step so the board never disagrees with
  // the softer booking-rail contract about which flow the org runs.
  const hardBlock: StepBlock = bookingStep(input.booking, "people")?.block ?? "booking";

  if (input.bookingOn) {
    const isManualSource = input.datesSource === "manual";
    const getDatesConfigs: StepConfig[] = [
      { key: "source", done: input.datesSource != null, block: hardBlock, adminOnly: false, placeholder: false, capability: input.canManageShows },
      { key: "connect", done: input.datesConnectDone, block: hardBlock, adminOnly: false, placeholder: false, capability: input.canManageShows, hidden: isManualSource },
      { key: "map", done: input.datesMapDone, block: hardBlock, adminOnly: false, placeholder: false, capability: input.canManageShows, hidden: isManualSource },
      { key: "cities", done: input.hasAnyDates && input.datesCitiesDone, block: hardBlock, adminOnly: false, placeholder: false, capability: input.canManageShows },
      {
        key: "productions",
        done: input.hasAnyDates && (bookingStep(input.booking, "slots")?.done ?? false),
        block: bookingStep(input.booking, "slots")?.block ?? null,
        adminOnly: false,
        placeholder: false,
        capability: input.canEditScheduling,
      },
    ];
    const getDatesSteps = getDatesConfigs.map((c) => finalizeStep("get_dates", c, input.role));
    const getDatesVisible = visibleSteps(getDatesSteps);
    const getDatesDone = getDatesVisible.every((s) => s.done);
    phases.push({
      key: "get_dates",
      steps: getDatesSteps,
      done: getDatesDone,
      doneCount: getDatesVisible.filter((s) => s.done).length,
      totalCount: getDatesVisible.length,
      block: hardBlock,
      waitsOn: null,
    });

    // `coverage` merges the booking module's `ladder` (coverage-only) and `eligibility`
    // (coverage AND null-city) steps into one board step. Its `done`-ness is the AND of
    // both, and it carries `ladder`'s block (the one signal that actually gates a tier).
    const ladderStep = bookingStep(input.booking, "ladder");
    const eligibilityStep = bookingStep(input.booking, "eligibility");
    const productionsDone = bookingStep(input.booking, "slots")?.done ?? false;

    const bookableConfigs: StepConfig[] = [
      {
        key: "artists",
        done: bookingStep(input.booking, "people")?.done ?? false,
        block: bookingStep(input.booking, "people")?.block ?? null,
        adminOnly: false,
        placeholder: false,
        capability: input.canAddArtists,
      },
      {
        key: "skills",
        done: input.skillsDone,
        block: null,
        adminOnly: false,
        placeholder: false,
        capability: input.canManageSkills,
      },
      {
        key: "coverage",
        done: (ladderStep?.done ?? false) && (eligibilityStep?.done ?? false),
        block: ladderStep?.block ?? null,
        adminOnly: false,
        placeholder: false,
        capability: input.canEditBooking,
      },
      {
        key: "flow",
        done: bookingStep(input.booking, "flow")?.done ?? false,
        block: bookingStep(input.booking, "flow")?.block ?? null,
        adminOnly: false,
        placeholder: false,
        capability: input.canEditBooking,
      },
      {
        key: "timing",
        done: bookingStep(input.booking, "timing")?.done ?? false,
        block: bookingStep(input.booking, "timing")?.block ?? null,
        adminOnly: false,
        placeholder: false,
        capability: input.canEditBooking,
      },
      {
        key: "team",
        done: (input.producerCount ?? 0) > 0,
        block: null,
        adminOnly: true, // always — inviting producers is inherently an admin action
        placeholder: false,
        capability: input.canInvite,
      },
    ];
    const bookableSteps = bookableConfigs.map((c) => finalizeStep("bookable", c, input.role));
    const bookableDone = bookableSteps.every((s) => s.done);
    phases.push({
      key: "bookable",
      steps: bookableSteps,
      done: bookableDone,
      doneCount: bookableSteps.filter((s) => s.done).length,
      totalCount: bookableSteps.length,
      block: null,
      // Waits on get_dates until one production can be cast (the `productions` step done).
      waitsOn: productionsDone ? null : "get_dates",
    });
  }

  if (input.hireOrdersOn) {
    const paperworkConfigs: StepConfig[] = [
      {
        key: "letterhead",
        done: hireStep(input.hire, "letterhead")?.done ?? false,
        block: hireStep(input.hire, "letterhead")?.blocksIssue ? "issuing" : null,
        adminOnly: true,
        placeholder: false,
        capability: input.canEditHire,
      },
      {
        key: "fee",
        done: input.feeDone,
        block: null,
        adminOnly: true,
        placeholder: false,
        capability: input.canEditHire,
      },
      {
        key: "terms",
        done: hireStep(input.hire, "terms")?.done ?? false,
        block: hireStep(input.hire, "terms")?.blocksIssue ? "issuing" : null,
        adminOnly: true,
        placeholder: false,
        capability: input.canEditHire,
      },
      {
        key: "document",
        done: input.documentDone,
        block: null,
        adminOnly: true,
        placeholder: false,
        capability: input.canEditHire,
      },
      {
        key: "countersign",
        done: hireStep(input.hire, "countersign")?.done ?? false,
        block: hireStep(input.hire, "countersign")?.blocksIssue ? "issuing" : null,
        adminOnly: true,
        placeholder: false,
        capability: input.canEditHire,
      },
    ];
    const paperworkSteps = paperworkConfigs.map((c) => finalizeStep("paperwork", c, input.role));
    const paperworkDone = paperworkSteps.every((s) => s.done);
    phases.push({
      key: "paperwork",
      steps: paperworkSteps,
      done: paperworkDone,
      doneCount: paperworkSteps.filter((s) => s.done).length,
      totalCount: paperworkSteps.length,
      block: null,
      waitsOn: null, // independent
    });
  }

  const allSteps = phases.flatMap((p) => p.steps);
  const allVisibleSteps = visibleSteps(allSteps);
  const totalCount = allVisibleSteps.length;
  const doneCount = allVisibleSteps.filter((s) => s.done).length;
  const canFirstOffer = allVisibleSteps
    .filter((s) => s.block === "offers" || s.block === "booking")
    .every((s) => s.done);
  const complete = allVisibleSteps.every((s) => s.done);

  let nextStep: { phase: GetRunningPhaseKey; key: GetRunningStepKey } | null = null;
  for (const phase of phases) {
    const firstNotDone = visibleSteps(phase.steps).find((s) => !s.done);
    if (firstNotDone) {
      nextStep = { phase: phase.key, key: firstNotDone.key };
      break;
    }
  }

  return {
    phases,
    doneCount,
    totalCount,
    canFirstOffer,
    complete,
    bookingOn: input.bookingOn,
    hireOrdersOn: input.hireOrdersOn,
    datesWithoutCity: input.bookingOn ? (input.booking?.datesWithoutCity ?? 0) : 0,
    nextStep,
  };
}
