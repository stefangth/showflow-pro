import { describe, expect, it } from "vitest";
import { computeBookingSetupStatus, type BookingSetupStatusInput } from "@/lib/bookings/setupStatus";
import { computeSetupStatus, type SetupStatusInput } from "@/lib/hireOrders/setupStatus";
import { composeGetRunning, firstOfferBlockingCount, getRunningState, type GetRunningInput, type GetRunningModel, type GetRunningTask, type GetRunningTaskKey } from "./tasks";

// Real booking-status inputs, not hand-faked step shapes. "Full" = every step done;
// "empty" = a blank org (nothing configured, honest 0-of-N).
const FULL_BOOKING_INPUT: BookingSetupStatusInput = {
  flowChosen: true,
  hasAnyShows: true,
  shows: [{ main_cast_slots: 4, understudy_slots: null }],
  timingChosen: true,
  coverage: { futurePairs: [], showPriorities: [], cityPriorities: [] },
  artistCount: 3,
  artistAcceptance: true,
};

const EMPTY_BOOKING_INPUT: BookingSetupStatusInput = {
  flowChosen: false,
  hasAnyShows: false,
  shows: undefined,
  timingChosen: false,
  coverage: undefined,
  artistCount: null,
  artistAcceptance: null,
};

const FULL_HIRE_INPUT: SetupStatusInput = {
  letterhead: { legal_name: "Acme Productions" },
  terms: {
    templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fees", body: "..." }] }],
    default_id: "t1",
  },
  countersignChosen: true,
};

const EMPTY_HIRE_INPUT: SetupStatusInput = {
  letterhead: null,
  terms: null,
  countersignChosen: false,
};

function baseInput(overrides: Partial<GetRunningInput> = {}): GetRunningInput {
  return {
    role: "admin",
    bookingOn: true,
    hireOrdersOn: true,
    booking: computeBookingSetupStatus(FULL_BOOKING_INPUT),
    hire: computeSetupStatus(FULL_HIRE_INPUT),
    datesDone: true,
    producerCount: 2,
    canManageShows: true,
    canEditScheduling: true,
    canEditBooking: true,
    canEditHire: true,
    canAddArtists: true,
    canInvite: true,
    ...overrides,
  };
}

function taskByKey(tasks: GetRunningTask[], key: GetRunningTaskKey) {
  const task = tasks.find((t) => t.key === key);
  if (!task) throw new Error(`missing task ${key}`);
  return task;
}

describe("composeGetRunning", () => {
  it("(a) both modules on, fresh org, everything done → 11 tasks in 3 ordered phases", () => {
    const model = composeGetRunning(baseInput());

    expect(model.phases.map((p) => p.key)).toEqual(["get_dates", "bookable", "paperwork"]);
    const allTasks = model.phases.flatMap((p) => p.tasks);
    expect(allTasks).toHaveLength(11);
    expect(model.totalCount).toBe(11);
    expect(model.doneCount).toBe(11);
    expect(model.bookingOn).toBe(true);
    expect(model.hireOrdersOn).toBe(true);

    const getDates = model.phases[0];
    expect(getDates.tasks.map((t) => t.key)).toEqual(["dates", "slots"]);
    const bookable = model.phases[1];
    expect(bookable.tasks.map((t) => t.key)).toEqual([
      "flow",
      "people",
      "ladder",
      "eligibility",
      "timing",
      "team",
    ]);
    const paperwork = model.phases[2];
    expect(paperwork.tasks.map((t) => t.key)).toEqual(["letterhead", "terms", "countersign"]);
  });

  it("(a) doneCount reflects an incomplete fresh org honestly", () => {
    const model = composeGetRunning(
      baseInput({
        booking: computeBookingSetupStatus(EMPTY_BOOKING_INPUT),
        hire: computeSetupStatus(EMPTY_HIRE_INPUT),
        datesDone: false,
        producerCount: 0,
      }),
    );

    expect(model.totalCount).toBe(11);
    expect(model.doneCount).toBe(0);
    expect(model.complete).toBe(false);
  });

  it("(a) block/phase mapping for slots, letterhead, terms, countersign, team", () => {
    const model = composeGetRunning(
      baseInput({
        booking: computeBookingSetupStatus(EMPTY_BOOKING_INPUT),
        hire: computeSetupStatus(EMPTY_HIRE_INPUT),
        datesDone: false,
        producerCount: 0,
      }),
    );
    const allTasks = model.phases.flatMap((p) => p.tasks);

    expect(taskByKey(allTasks, "slots").block).toBe("filling");
    expect(taskByKey(allTasks, "letterhead").block).toBe("issuing");
    expect(taskByKey(allTasks, "terms").block).toBe("issuing");
    expect(taskByKey(allTasks, "countersign").block).toBe(null);
    expect(taskByKey(allTasks, "team").block).toBe(null);
    expect(taskByKey(allTasks, "team").done).toBe(false);
    expect(taskByKey(allTasks, "dates").done).toBe(false);
  });

  it("(b) producer viewer lacking capabilities → team and admin-only settings are not actionable", () => {
    const model = composeGetRunning(
      baseInput({
        role: "producer",
        canManageShows: false,
        canEditScheduling: false,
        canEditBooking: false,
        canEditHire: false,
        canAddArtists: false,
        canInvite: false,
      }),
    );
    const allTasks = model.phases.flatMap((p) => p.tasks);

    const team = taskByKey(allTasks, "team");
    expect(team.adminOnly).toBe(true);
    expect(team.actionableByViewer).toBe(false);

    const dates = taskByKey(allTasks, "dates");
    expect(dates.adminOnly).toBe(true);
    expect(dates.actionableByViewer).toBe(false);

    const letterhead = taskByKey(allTasks, "letterhead");
    expect(letterhead.adminOnly).toBe(true);
    expect(letterhead.actionableByViewer).toBe(false);

    const people = taskByKey(allTasks, "people");
    expect(people.adminOnly).toBe(true);
    expect(people.actionableByViewer).toBe(false);
  });

  it("(b) producer viewer WITH capabilities → those tasks are actionable, team never is", () => {
    const model = composeGetRunning(
      baseInput({
        role: "producer",
        canManageShows: true,
        canEditScheduling: true,
        canEditBooking: true,
        canEditHire: true,
        canAddArtists: true,
        canInvite: false,
      }),
    );
    const allTasks = model.phases.flatMap((p) => p.tasks);

    expect(taskByKey(allTasks, "dates").actionableByViewer).toBe(true);
    expect(taskByKey(allTasks, "letterhead").actionableByViewer).toBe(true);
    expect(taskByKey(allTasks, "people").actionableByViewer).toBe(true);
    // team is always adminOnly, regardless of canInvite or any other capability.
    expect(taskByKey(allTasks, "team").adminOnly).toBe(true);
    expect(taskByKey(allTasks, "team").actionableByViewer).toBe(false);
  });

  it("(b) get_dates gates by write path, not booking settings: `dates` on manage_productions, `slots` on edit_scheduling", () => {
    // A producer who can create shows (manage_productions) and edit slot counts
    // (edit_scheduling) but cannot edit booking settings can act on the whole get_dates
    // phase, while the bookable settings tasks stay admin-only.
    const model = composeGetRunning(
      baseInput({
        role: "producer",
        canManageShows: true,
        canEditScheduling: true,
        canEditBooking: false,
        canEditHire: false,
        canAddArtists: false,
        canInvite: false,
      }),
    );
    const allTasks = model.phases.flatMap((p) => p.tasks);

    expect(taskByKey(allTasks, "dates").actionableByViewer).toBe(true);
    expect(taskByKey(allTasks, "slots").actionableByViewer).toBe(true);
    expect(taskByKey(allTasks, "flow").actionableByViewer).toBe(false);
    expect(taskByKey(allTasks, "ladder").actionableByViewer).toBe(false);
    expect(taskByKey(allTasks, "timing").actionableByViewer).toBe(false);
  });

  it("(b) `slots` gates on edit_scheduling independently of manage_productions: a producer who can create shows but not edit scheduling waits on admin for slots only", () => {
    // Guards the show_slots RLS boundary: edit_scheduling is separately toggleable from
    // manage_productions, and writing show_slots requires producer_can_edit_scheduling. So a
    // producer with manage_productions but not edit_scheduling can add shows (dates
    // actionable) yet must NOT be handed an actionable slots "Resolve" that would fail on save.
    const model = composeGetRunning(
      baseInput({
        role: "producer",
        canManageShows: true,
        canEditScheduling: false,
        canEditBooking: false,
        canEditHire: false,
        canAddArtists: false,
        canInvite: false,
      }),
    );
    const allTasks = model.phases.flatMap((p) => p.tasks);

    expect(taskByKey(allTasks, "dates").adminOnly).toBe(false);
    expect(taskByKey(allTasks, "dates").actionableByViewer).toBe(true);
    expect(taskByKey(allTasks, "slots").adminOnly).toBe(true);
    expect(taskByKey(allTasks, "slots").actionableByViewer).toBe(false);
  });

  it("(b) admin viewer is always actionable, even on team", () => {
    const model = composeGetRunning(baseInput({ role: "admin" }));
    const allTasks = model.phases.flatMap((p) => p.tasks);
    for (const task of allTasks) {
      expect(task.actionableByViewer).toBe(true);
    }
  });

  it("(c) hireOrdersOn=false → no paperwork phase, totalCount drops by 3", () => {
    const model = composeGetRunning(baseInput({ hireOrdersOn: false, hire: null }));

    expect(model.phases.map((p) => p.key)).toEqual(["get_dates", "bookable"]);
    expect(model.totalCount).toBe(8);
    expect(model.hireOrdersOn).toBe(false);
  });

  it("bookingOn=false → no get_dates/bookable phases, totalCount drops to paperwork only", () => {
    const model = composeGetRunning(baseInput({ bookingOn: false, booking: null }));

    expect(model.phases.map((p) => p.key)).toEqual(["paperwork"]);
    expect(model.totalCount).toBe(3);
    expect(model.bookingOn).toBe(false);
  });

  it("both modules off → nothing-on org has totalCount 0 and is trivially complete", () => {
    const model = composeGetRunning(
      baseInput({ bookingOn: false, booking: null, hireOrdersOn: false, hire: null }),
    );

    expect(model.phases).toHaveLength(0);
    expect(model.totalCount).toBe(0);
    expect(model.doneCount).toBe(0);
    expect(model.complete).toBe(true);
  });

  it("(d) every applicable task done → complete=true", () => {
    const model = composeGetRunning(baseInput());
    expect(model.complete).toBe(true);
    expect(model.canFirstOffer).toBe(true);
  });

  it("(e) canFirstOffer is false while people is undone", () => {
    const model = composeGetRunning(
      baseInput({
        booking: computeBookingSetupStatus({ ...FULL_BOOKING_INPUT, artistCount: 0 }),
      }),
    );
    const allTasks = model.phases.flatMap((p) => p.tasks);

    expect(taskByKey(allTasks, "people").done).toBe(false);
    expect(model.canFirstOffer).toBe(false);
    expect(model.complete).toBe(false);
  });

  it("canFirstOffer ignores paperwork-blocking (issuing) gaps", () => {
    const model = composeGetRunning(
      baseInput({
        hire: computeSetupStatus(EMPTY_HIRE_INPUT),
      }),
    );
    const allTasks = model.phases.flatMap((p) => p.tasks);

    expect(taskByKey(allTasks, "letterhead").done).toBe(false);
    expect(model.canFirstOffer).toBe(true);
  });
});

describe("firstOfferBlockingCount", () => {
  it("counts only not-done offers/booking blockers", () => {
    const model = composeGetRunning(
      baseInput({
        booking: computeBookingSetupStatus(EMPTY_BOOKING_INPUT),
        hire: computeSetupStatus(EMPTY_HIRE_INPUT),
        datesDone: false,
        producerCount: 0,
      }),
    );
    // people (block "booking") and ladder (block "offers") are the first-offer blockers in
    // a blank org; slots is "filling" and letterhead/terms are "issuing" -- excluded.
    expect(firstOfferBlockingCount(model)).toBe(model.phases
      .flatMap((p) => p.tasks)
      .filter((t) => !t.done && (t.block === "offers" || t.block === "booking")).length);
    expect(firstOfferBlockingCount(model)).toBeGreaterThan(0);
  });

  it("is zero for a fully-done board", () => {
    expect(firstOfferBlockingCount(composeGetRunning(baseInput()))).toBe(0);
  });
});

describe("getRunningState", () => {
  const model = (over: Partial<GetRunningModel>): GetRunningModel => ({
    phases: [], doneCount: 0, totalCount: 1, canFirstOffer: false, complete: false,
    bookingOn: true, hireOrdersOn: false, ...over,
  });
  it("is blocking while the first offer is held up", () => {
    expect(getRunningState(model({ canFirstOffer: false, complete: false }))).toBe("blocking");
  });
  it("is ready once the first offer can go out but tasks remain", () => {
    expect(getRunningState(model({ canFirstOffer: true, complete: false }))).toBe("ready");
  });
  it("is complete once every task is done, even if canFirstOffer is also true", () => {
    expect(getRunningState(model({ canFirstOffer: true, complete: true }))).toBe("complete");
  });
});
