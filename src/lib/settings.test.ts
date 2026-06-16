import { describe, it, expect } from "vitest";
import { showSlots, computeSchedulingWarnings } from "./settings";

describe("showSlots", () => {
  it("returns null when show is null", () => {
    expect(showSlots(null)).toBeNull();
  });

  it("returns null when show is undefined", () => {
    expect(showSlots(undefined)).toBeNull();
  });

  it("returns null when main_cast_slots is null", () => {
    expect(showSlots({ main_cast_slots: null, understudy_slots: 1 })).toBeNull();
  });

  it("returns null when understudy_slots is null", () => {
    expect(showSlots({ main_cast_slots: 2, understudy_slots: null })).toBeNull();
  });

  it("returns null when both columns are null", () => {
    expect(showSlots({ main_cast_slots: null, understudy_slots: null })).toBeNull();
  });

  it("returns SlotCounts when both columns are set", () => {
    expect(showSlots({ main_cast_slots: 2, understudy_slots: 1 })).toEqual({
      main_cast: 2,
      understudies: 1,
    });
  });

  it("treats explicit 0/0 as configured (not null)", () => {
    expect(showSlots({ main_cast_slots: 0, understudy_slots: 0 })).toEqual({
      main_cast: 0,
      understudies: 0,
    });
  });
});

describe("computeSchedulingWarnings", () => {
  it("returns zero for empty array", () => {
    const w = computeSchedulingWarnings([]);
    expect(w.schedulingWarnings).toBe(0);
    expect(w.hasAnyWarning).toBe(false);
  });

  it("returns zero for null input", () => {
    const w = computeSchedulingWarnings(null);
    expect(w.schedulingWarnings).toBe(0);
    expect(w.hasAnyWarning).toBe(false);
  });

  it("counts shows where main_cast_slots is null", () => {
    const w = computeSchedulingWarnings([
      { main_cast_slots: null, understudy_slots: 1 },
      { main_cast_slots: 2, understudy_slots: 1 },
    ]);
    expect(w.schedulingWarnings).toBe(1);
    expect(w.hasAnyWarning).toBe(true);
  });

  it("counts shows where understudy_slots is null", () => {
    const w = computeSchedulingWarnings([
      { main_cast_slots: 2, understudy_slots: null },
      { main_cast_slots: 2, understudy_slots: 1 },
    ]);
    expect(w.schedulingWarnings).toBe(1);
    expect(w.hasAnyWarning).toBe(true);
  });

  it("counts each show with any null column once", () => {
    const w = computeSchedulingWarnings([
      { main_cast_slots: null, understudy_slots: null },
      { main_cast_slots: null, understudy_slots: 1 },
      { main_cast_slots: 2, understudy_slots: 1 },
    ]);
    expect(w.schedulingWarnings).toBe(2);
    expect(w.hasAnyWarning).toBe(true);
  });

  it("reports zero when all shows are configured", () => {
    const w = computeSchedulingWarnings([
      { main_cast_slots: 2, understudy_slots: 1 },
      { main_cast_slots: 0, understudy_slots: 0 },
    ]);
    expect(w.schedulingWarnings).toBe(0);
    expect(w.hasAnyWarning).toBe(false);
  });
});
