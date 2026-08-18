// Pure composer for the /get-running onboarding board: one ordered 11-task / 3-phase
// model built on top of the two existing setup-readiness modules
// (src/lib/bookings/setupStatus.ts, src/lib/hireOrders/setupStatus.ts) plus a handful
// of signals those modules don't carry (dates readiness, team size, viewer capabilities).
//
// No React, no hooks, no data fetching here — a later task wires this to live queries.
//
// Resolved ambiguity (letterhead's block): the hire-order setup module gives each step a
// `blocksIssue: boolean`, not a `block` label. Both `letterhead` and `terms` have
// `blocksIssue: true` in src/lib/hireOrders/setupStatus.ts (only `countersign` is false,
// since manual countersign mode issues fine undecided). We derive `block` generically from
// that flag — 'issuing' when blocksIssue is true, else null — so letterhead and terms are
// treated identically and countersign never blocks. This mirrors the underlying data
// 1:1 instead of hardcoding a block per key.

import type { BookingSetupStatus, BookingSetupStepKey } from "@/lib/bookings/setupStatus";
import type { HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

export type GetRunningPhaseKey = "get_dates" | "bookable" | "paperwork";
export type GetRunningTaskKey =
  | "dates"
  | "slots" // phase get_dates
  | "flow"
  | "people"
  | "ladder"
  | "eligibility"
  | "timing"
  | "team" // phase bookable
  | "letterhead"
  | "terms"
  | "countersign"; // phase paperwork
export type TaskBlock = "offers" | "booking" | "issuing" | "filling" | null;

export interface GetRunningTask {
  key: GetRunningTaskKey;
  phase: GetRunningPhaseKey;
  done: boolean;
  block: TaskBlock; // what it holds up, in the org's vocabulary
  adminOnly: boolean; // producer cannot act (team, and admin-only settings)
  actionableByViewer: boolean; // viewer may open+complete it
}

export interface GetRunningPhase {
  key: GetRunningPhaseKey;
  tasks: GetRunningTask[];
}

export interface GetRunningModel {
  phases: GetRunningPhase[];
  doneCount: number; // out of totalCount
  totalCount: number; // 11 when both modules on
  canFirstOffer: boolean; // every offers/booking-blocking task done
  complete: boolean; // every applicable task done → board retires
  bookingOn: boolean;
  hireOrdersOn: boolean;
}

export interface GetRunningInput {
  role: "admin" | "producer";
  bookingOn: boolean;
  hireOrdersOn: boolean;
  booking: BookingSetupStatus | null; // null while unread or module off
  hire: HireOrderSetupStatus | null;
  datesDone: boolean; // Airtable connected+synced OR shows exist by hand
  producerCount: number | null; // team step done when > 0
  canManageShows: boolean; // viewer holds manage_productions (create shows: the `dates` task)
  canEditScheduling: boolean; // viewer holds edit_scheduling (write show_slots: the `slots` task)
  canEditBooking: boolean; // viewer holds edit_booking_settings
  canEditHire: boolean; // viewer holds edit_hire_order_settings
  canAddArtists: boolean; // viewer holds add_artists
  canInvite: boolean; // viewer is admin (invite producers)
}

/** flow/people/ladder/eligibility/timing/slots carry their `done`+`block` straight from the
 *  matching BookingSetupStep. `dates` is NOT one of these: it reads a separate signal
 *  (`datesDone`), not the booking module's own `shows` step, so it isn't listed here. */
const BOOKING_STEP_TASK_KEYS: Record<
  Exclude<GetRunningTaskKey, "dates" | "team" | "letterhead" | "terms" | "countersign">,
  BookingSetupStepKey
> = {
  slots: "slots",
  flow: "flow",
  people: "people",
  ladder: "ladder",
  eligibility: "eligibility",
  timing: "timing",
};

function bookingStep(booking: BookingSetupStatus | null, key: BookingSetupStepKey) {
  return booking?.steps.find((s) => s.key === key) ?? null;
}

function makeBookingTask(
  taskKey: keyof typeof BOOKING_STEP_TASK_KEYS,
  phase: GetRunningPhaseKey,
  booking: BookingSetupStatus | null,
  adminOnly: boolean,
): GetRunningTask {
  const step = bookingStep(booking, BOOKING_STEP_TASK_KEYS[taskKey]);
  return {
    key: taskKey,
    phase,
    done: step?.done ?? false,
    block: step?.block ?? null,
    adminOnly,
    actionableByViewer: false, // filled in by the caller once role is known
  };
}

function makeHireTask(
  key: "letterhead" | "terms" | "countersign",
  hire: HireOrderSetupStatus | null,
  adminOnly: boolean,
): GetRunningTask {
  const step = hire?.steps.find((s) => s.key === key) ?? null;
  return {
    key,
    phase: "paperwork",
    done: step?.done ?? false,
    block: step?.blocksIssue ? "issuing" : null,
    adminOnly,
    actionableByViewer: false,
  };
}

function withActionability(task: GetRunningTask, role: GetRunningInput["role"]): GetRunningTask {
  return {
    ...task,
    // Admin holds every capability, so admin is always actionable regardless of the
    // task's intrinsic adminOnly label (e.g. `team` is adminOnly=true even for the
    // admin viewing it). A producer can act only when the task isn't admin-only.
    actionableByViewer: role === "admin" ? true : !task.adminOnly,
  };
}

export function composeGetRunning(input: GetRunningInput): GetRunningModel {
  const phases: GetRunningPhase[] = [];

  if (input.bookingOn) {
    // The get_dates phase is show authoring, not booking-engine config, but the two tasks
    // write different things and are gated by different capabilities:
    //  - `dates` completes on shows existing (its panel is ShowsStep, which links to
    //    ProductionsPage's create button) → manage_productions.
    //  - `slots` writes show_slots (its panel is SlotsStep, the ShowFormDialog model, which
    //    the show_slots RLS + ShowFormDialog gate on edit_scheduling) → edit_scheduling.
    // Gating slots on manage_productions would let a producer with manage_productions but not
    // edit_scheduling open the panel and hit an RLS failure on save, exactly the dead-action
    // the "Waits on admin" attribution exists to prevent.
    const datesTask: GetRunningTask = withActionability(
      {
        key: "dates",
        phase: "get_dates",
        done: input.datesDone,
        block: null,
        adminOnly: !input.canManageShows,
        actionableByViewer: false,
      },
      input.role,
    );
    const slotsTask = withActionability(
      makeBookingTask("slots", "get_dates", input.booking, !input.canEditScheduling),
      input.role,
    );
    phases.push({ key: "get_dates", tasks: [datesTask, slotsTask] });

    const bookableTasks: GetRunningTask[] = [
      withActionability(makeBookingTask("flow", "bookable", input.booking, !input.canEditBooking), input.role),
      withActionability(makeBookingTask("people", "bookable", input.booking, !input.canAddArtists), input.role),
      withActionability(makeBookingTask("ladder", "bookable", input.booking, !input.canEditBooking), input.role),
      withActionability(
        makeBookingTask("eligibility", "bookable", input.booking, !input.canEditBooking),
        input.role,
      ),
      withActionability(makeBookingTask("timing", "bookable", input.booking, !input.canEditBooking), input.role),
      withActionability(
        {
          key: "team",
          phase: "bookable",
          done: (input.producerCount ?? 0) > 0,
          block: null,
          adminOnly: true, // always — inviting producers is inherently an admin action
          actionableByViewer: false,
        },
        input.role,
      ),
    ];
    phases.push({ key: "bookable", tasks: bookableTasks });
  }

  if (input.hireOrdersOn) {
    const paperworkTasks: GetRunningTask[] = [
      withActionability(makeHireTask("letterhead", input.hire, !input.canEditHire), input.role),
      withActionability(makeHireTask("terms", input.hire, !input.canEditHire), input.role),
      withActionability(makeHireTask("countersign", input.hire, !input.canEditHire), input.role),
    ];
    phases.push({ key: "paperwork", tasks: paperworkTasks });
  }

  const allTasks = phases.flatMap((p) => p.tasks);
  const totalCount = allTasks.length;
  const doneCount = allTasks.filter((t) => t.done).length;
  const canFirstOffer = allTasks
    .filter((t) => t.block === "offers" || t.block === "booking")
    .every((t) => t.done);
  const complete = allTasks.every((t) => t.done);

  return {
    phases,
    doneCount,
    totalCount,
    canFirstOffer,
    complete,
    bookingOn: input.bookingOn,
    hireOrdersOn: input.hireOrdersOn,
  };
}

/** Count of not-done tasks that hold up the org's first offer (the offers/booking
 *  blockers `canFirstOffer` is derived from). Shared by GetRunningHeader and the
 *  accept-invite handoff so both report the same number. */
export function firstOfferBlockingCount(model: GetRunningModel): number {
  return model.phases
    .flatMap((p) => p.tasks)
    .filter((t) => !t.done && (t.block === "offers" || t.block === "booking")).length;
}
