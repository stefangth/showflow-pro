import { describe, it, expect } from "vitest";
import { inTimeframe, applySort } from "./filterUtils";

const d = (s: string) => new Date(s + "T12:00:00");

describe("inTimeframe", () => {
  it("returns true when no bounds are set", () => {
    expect(inTimeframe(d("2026-04-23"), { from: null, to: null })).toBe(true);
    expect(inTimeframe(null, { from: null, to: null })).toBe(true);
  });

  it("returns false for a null date when a bound is set", () => {
    expect(inTimeframe(null, { from: d("2026-01-01"), to: null })).toBe(false);
  });

  it("excludes dates before `from`", () => {
    expect(inTimeframe(d("2025-12-31"), { from: d("2026-01-01"), to: null })).toBe(false);
    expect(inTimeframe(d("2026-01-01"), { from: d("2026-01-01"), to: null })).toBe(true);
  });

  it("includes the entire `to` day (end-of-day inclusivity)", () => {
    expect(inTimeframe(new Date("2026-06-30T23:30:00"), { from: null, to: d("2026-06-30") })).toBe(true);
    expect(inTimeframe(d("2026-07-01"), { from: null, to: d("2026-06-30") })).toBe(false);
  });
});

describe("applySort", () => {
  type Item = { name: string; date: Date | null };
  const getName = (i: Item) => i.name;
  const getDate = (i: Item) => i.date;
  const items: Item[] = [
    { name: "Charlie", date: d("2026-03-01") },
    { name: "alice", date: d("2026-01-01") },
    { name: "Bob", date: d("2026-02-01") },
  ];

  it("sorts alpha ascending case-insensitively", () => {
    expect(applySort(items, "alpha_asc", getName, getDate).map(getName)).toEqual(["alice", "Bob", "Charlie"]);
  });

  it("sorts alpha descending", () => {
    expect(applySort(items, "alpha_desc", getName, getDate).map(getName)).toEqual(["Charlie", "Bob", "alice"]);
  });

  it("sorts chrono ascending then descending", () => {
    expect(applySort(items, "chrono_asc", getName, getDate).map(getName)).toEqual(["alice", "Bob", "Charlie"]);
    expect(applySort(items, "chrono_desc", getName, getDate).map(getName)).toEqual(["Charlie", "Bob", "alice"]);
  });

  it("pushes null dates to the end in chrono_asc", () => {
    const withNull: Item[] = [{ name: "X", date: null }, { name: "Y", date: d("2026-01-01") }];
    expect(applySort(withNull, "chrono_asc", getName, getDate).map(getName)).toEqual(["Y", "X"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...items];
    applySort(items, "alpha_asc", getName, getDate);
    expect(items).toEqual(copy);
  });
});
