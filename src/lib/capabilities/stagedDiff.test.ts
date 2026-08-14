import { describe, it, expect } from "vitest";
import { changedKeys, desiredFor, diffSentence, deltaSentence } from "./stagedDiff";

const rows = [
  { key: "a", label: "Delete productions", effective: false, risk: "sensitive" as const },
  { key: "b", label: "Confirm bookings", effective: true, risk: "standard" as const },
];

describe("stagedDiff", () => {
  it("desiredFor falls back to effective when unstaged", () => {
    expect(desiredFor(rows[0], {})).toBe(false);
    expect(desiredFor(rows[0], { a: true })).toBe(true);
  });
  it("changedKeys lists only keys staged away from effective", () => {
    expect(changedKeys(rows, { a: true, b: true })).toEqual(["a"]);
    expect(changedKeys(rows, { a: false })).toEqual([]);
  });
  it("diffSentence reports the count and named rights", () => {
    expect(diffSentence(rows, {}, "Standard")).toMatch(/Matches the Standard baseline/i);
    expect(diffSentence(rows, { a: true }, "Standard")).toMatch(/1 right differs .*delete productions/i);
  });
  it("deltaSentence describes gains and losses with sensitivity", () => {
    const s = deltaSentence(rows, { a: true, b: false }, "every Production Team member");
    expect(s).toMatch(/gains: Delete productions/);
    expect(s).toMatch(/loses: Confirm bookings/);
  });
});
