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
});
