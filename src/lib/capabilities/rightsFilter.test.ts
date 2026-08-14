import { describe, it, expect } from "vitest";
import { matchesFilter, filterCounts } from "./rightsFilter";

const row = { key: "hard_delete_productions", label: "Delete productions", description: "Permanently delete productions.", risk: "sensitive" as const, effective: false };

describe("rightsFilter", () => {
  it("query matches label or description, case-insensitive", () => {
    expect(matchesFilter(row, { query: "delete", filter: "All", changed: false, desired: false })).toBe(true);
    expect(matchesFilter(row, { query: "airtable", filter: "All", changed: false, desired: false })).toBe(false);
  });
  it("Sensitive filter keeps only sensitive rows", () => {
    expect(matchesFilter(row, { query: "", filter: "Sensitive", changed: false, desired: false })).toBe(true);
  });
  it("Off filter keeps rows whose desired state is off", () => {
    expect(matchesFilter(row, { query: "", filter: "Off", changed: false, desired: false })).toBe(true);
    expect(matchesFilter(row, { query: "", filter: "Off", changed: false, desired: true })).toBe(false);
  });
  it("filterCounts returns correct tallies for each filter category", () => {
    const rows = [
      { key: "r1", label: "Right 1", description: "Standard", risk: "standard" as const, effective: true, changed: true, desired: true },
      { key: "r2", label: "Right 2", description: "Sensitive", risk: "sensitive" as const, effective: true, changed: false, desired: true },
      { key: "r3", label: "Right 3", description: "Sensitive", risk: "sensitive" as const, effective: false, changed: true, desired: false },
      { key: "r4", label: "Right 4", description: "Standard", risk: "standard" as const, effective: true, changed: false, desired: false },
    ];
    const counts = filterCounts(rows);
    expect(counts.All).toBe(4);
    expect(counts.Sensitive).toBe(2);
    expect(counts.Changed).toBe(2);
    expect(counts.Off).toBe(2);
  });
});
