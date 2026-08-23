import { describe, it, expect } from "vitest";
import { composeGetRunningV3, type GetRunningInputV3 } from "./steps";
import type { BookingSetupStatus } from "@/lib/bookings/setupStatus";
import type { HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

// Minimal booking status builder: every step done unless overridden.
function booking(overrides: Partial<Record<string, boolean>> = {}): BookingSetupStatus {
  const keys = ["shows", "slots", "flow", "people", "ladder", "eligibility", "timing"];
  return {
    // Match the real BookingSetupStatus shape; steps carry key/done/block.
    steps: keys.map((key) => ({ key, done: overrides[key] ?? true, block: null })),
    // Fields consumed by the coverage merge + advisory:
    datesWithoutCity: 0,
  } as unknown as BookingSetupStatus;
}
function hire(overrides: Partial<Record<string, boolean>> = {}): HireOrderSetupStatus {
  const keys = ["letterhead", "terms", "countersign"];
  return {
    steps: keys.map((key) => ({ key, done: overrides[key] ?? true, blocksIssue: false })),
  } as unknown as HireOrderSetupStatus;
}
const base: GetRunningInputV3 = {
  role: "admin",
  bookingOn: true,
  hireOrdersOn: true,
  booking: booking(),
  hire: hire(),
  datesSource: "airtable",
  datesConnectDone: true,
  datesMapDone: true,
  datesCitiesDone: true,
  producerCount: 1,
  skillsDone: true,
  feeDone: false,
  documentDone: false,
  canManageShows: true,
  canEditScheduling: true,
  canEditBooking: true,
  canManageSkills: true,
  canEditHire: true,
  canAddArtists: true,
  canInvite: true,
};
function baseInput(overrides: Partial<GetRunningInputV3> = {}): GetRunningInputV3 {
  return { ...base, ...overrides };
}

describe("composeGetRunningV3", () => {
  it("produces 16 steps across 3 phases when both modules are on", () => {
    const m = composeGetRunningV3(base);
    expect(m.phases.map((p) => p.key)).toEqual(["get_dates", "bookable", "paperwork"]);
    expect(m.totalCount).toBe(16);
    expect(m.phases.flatMap((p) => p.steps)).toHaveLength(16);
  });

  it("drops the paperwork phase and shrinks the denominator when hire_orders is off", () => {
    const m = composeGetRunningV3({ ...base, hireOrdersOn: false, hire: null });
    expect(m.phases.map((p) => p.key)).toEqual(["get_dates", "bookable"]);
    expect(m.totalCount).toBe(11);
  });

  it("shows only the paperwork phase when booking_flow is off", () => {
    const m = composeGetRunningV3({ ...base, bookingOn: false, booking: null });
    expect(m.phases.map((p) => p.key)).toEqual(["paperwork"]);
  });

  it("maps the four dates-in steps to their per-step signals and productions to the slots step", () => {
    const m = composeGetRunningV3({
      ...base,
      datesSource: null,
      datesConnectDone: false,
      datesMapDone: false,
      datesCitiesDone: false,
      booking: booking({ slots: false }),
    });
    const getDates = m.phases.find((p) => p.key === "get_dates")!;
    const doneByKey = Object.fromEntries(getDates.steps.map((s) => [s.key, s.done]));
    expect(doneByKey).toMatchObject({ source: false, connect: false, map: false, cities: false, productions: false });
  });

  it("bookable waits on get_dates until productions (slots) is done", () => {
    const m = composeGetRunningV3({ ...base, booking: booking({ slots: false }) });
    expect(m.phases.find((p) => p.key === "bookable")!.waitsOn).toBe("get_dates");
  });

  it("merges ladder+eligibility into one coverage step", () => {
    const m = composeGetRunningV3({ ...base, booking: booking({ eligibility: false }) });
    const coverage = m.phases.find((p) => p.key === "bookable")!.steps.find((s) => s.key === "coverage")!;
    expect(coverage.done).toBe(false);
    expect(m.phases.flatMap((p) => p.steps).some((s) => (s.key as string) === "eligibility")).toBe(false);
  });

  it("all steps are now real, no placeholders", () => {
    const m = composeGetRunningV3(base);
    const byKey = Object.fromEntries(m.phases.flatMap((p) => p.steps).map((s) => [s.key, s.placeholder]));
    expect(byKey).toMatchObject({ source: false, skills: false, fee: false, document: false, artists: false, flow: false, coverage: false });
  });

  it("a producer cannot act on team (adminOnly)", () => {
    const m = composeGetRunningV3({ ...base, role: "producer" });
    const team = m.phases.find((p) => p.key === "bookable")!.steps.find((s) => s.key === "team")!;
    expect(team.adminOnly).toBe(true);
    expect(team.actionableByViewer).toBe(false);
  });

  it("is complete only when every included non-placeholder-blocking step is done", () => {
    // With placeholders (source/skills/fee/document) not done, board is not complete.
    expect(composeGetRunningV3(base).complete).toBe(false);
    // All real+placeholder signals satisfied → complete.
    const all = composeGetRunningV3({ ...base, skillsDone: true, feeDone: true, documentDone: true });
    expect(all.complete).toBe(true);
  });
});

describe("composeGetRunningV3 Phase 3 (skills/fee/document are real steps)", () => {
  it("marks skills, fee, and document as non-placeholder", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, hireOrdersOn: true }));
    const all = m.phases.flatMap((p) => p.steps);
    for (const key of ["skills", "fee", "document"] as const) {
      expect(all.find((s) => s.key === key)!.placeholder).toBe(false);
    }
  });

  it("no step in the whole model is a placeholder anymore", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, hireOrdersOn: true }));
    expect(m.phases.flatMap((p) => p.steps).some((s) => s.placeholder)).toBe(false);
  });

  it("fee and document done still track their input signals", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, hireOrdersOn: true, feeDone: true, documentDone: false }));
    const paper = m.phases.find((p) => p.key === "paperwork")!;
    expect(paper.steps.find((s) => s.key === "fee")!.done).toBe(true);
    expect(paper.steps.find((s) => s.key === "document")!.done).toBe(false);
  });

  it("skills done tracks its input signal", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, skillsDone: true }));
    const bookable = m.phases.find((p) => p.key === "bookable")!;
    expect(bookable.steps.find((s) => s.key === "skills")!.done).toBe(true);
  });

  it("skills actionability follows manage_skills, not edit_booking_settings", () => {
    const skillsStep = (input: Partial<GetRunningInputV3>) =>
      composeGetRunningV3(baseInput({ role: "producer", bookingOn: true, ...input }))
        .phases.find((p) => p.key === "bookable")!
        .steps.find((s) => s.key === "skills")!;
    // A producer with manage_skills (its default) but NOT edit_booking_settings CAN act on
    // skills — the reused SkillsTab renders editable for them, so the step must too.
    expect(skillsStep({ canManageSkills: true, canEditBooking: false }).actionableByViewer).toBe(true);
    // Without manage_skills they cannot, even if they can edit booking settings.
    expect(skillsStep({ canManageSkills: false, canEditBooking: true }).actionableByViewer).toBe(false);
  });
});

describe("composeGetRunningV3 get_dates phase (Phase 2)", () => {
  it("source is done once a source is chosen", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, datesSource: "airtable" }));
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    expect(dates.steps.find((s) => s.key === "source")!.done).toBe(true);
  });

  it("none of the five get_dates steps are placeholders anymore", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true }));
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    for (const key of ["source", "connect", "map", "cities", "productions"] as const) {
      expect(dates.steps.find((s) => s.key === key)!.placeholder).toBe(false);
    }
  });

  it("hides connect and map when the source is by-hand, and excludes them from counts", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, datesSource: "manual" }));
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    const connect = dates.steps.find((s) => s.key === "connect")!;
    const map = dates.steps.find((s) => s.key === "map")!;
    expect(connect.hidden).toBe(true);
    expect(map.hidden).toBe(true);
    // 3 visible get_dates steps (source, cities, productions), not 5
    expect(dates.steps.filter((s) => !s.hidden).length).toBe(3);
  });

  it("shows connect and map when the source is airtable", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, datesSource: "airtable" }));
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    expect(dates.steps.find((s) => s.key === "connect")!.hidden).toBeFalsy();
    expect(dates.steps.find((s) => s.key === "map")!.hidden).toBeFalsy();
  });

  it("maps per-step done signals (connect/map/cities) independently", () => {
    const m = composeGetRunningV3(
      baseInput({ bookingOn: true, datesSource: "airtable", datesConnectDone: true, datesMapDone: false, datesCitiesDone: true }),
    );
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    expect(dates.steps.find((s) => s.key === "connect")!.done).toBe(true);
    expect(dates.steps.find((s) => s.key === "map")!.done).toBe(false);
    expect(dates.steps.find((s) => s.key === "cities")!.done).toBe(true);
  });

  it("nextStep and doneCount ignore hidden steps", () => {
    // manual source, source+cities done, productions not: nextStep is productions, not the hidden connect
    const m = composeGetRunningV3(
      baseInput({
        bookingOn: true,
        datesSource: "manual",
        datesCitiesDone: true,
        booking: booking({ slots: false }),
      }),
    );
    expect(m.nextStep?.key).toBe("productions");
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    expect(dates.totalCount).toBe(3); // hidden connect/map excluded
  });
});
