import { describe, it, expect } from "vitest";
import {
  airtableTypeToCustomType, slugifyKey, formatCustomValue,
  compareCustomValues, customFilterMatches,
} from "./customFields";

describe("airtableTypeToCustomType", () => {
  it("maps known Airtable types", () => {
    expect(airtableTypeToCustomType("number")).toBe("number");
    expect(airtableTypeToCustomType("currency")).toBe("number");
    expect(airtableTypeToCustomType("date")).toBe("date");
    expect(airtableTypeToCustomType("dateTime")).toBe("date");
    expect(airtableTypeToCustomType("checkbox")).toBe("boolean");
    expect(airtableTypeToCustomType("singleSelect")).toBe("select");
    expect(airtableTypeToCustomType("multilineText")).toBe("text");
    expect(airtableTypeToCustomType("anythingElse")).toBe("text");
  });
});

describe("slugifyKey", () => {
  it("lowercases and replaces non-alphanumerics with single underscores", () => {
    expect(slugifyKey("1. Show")).toBe("1_show");
    expect(slugifyKey("Max Capacity!!")).toBe("max_capacity");
    expect(slugifyKey("  Trimmed  ")).toBe("trimmed");
  });
});

describe("formatCustomValue", () => {
  it("renders by type, with — for empty", () => {
    expect(formatCustomValue(null, "text")).toBe("—");
    expect(formatCustomValue("", "text")).toBe("—");
    expect(formatCustomValue("Houdini", "text")).toBe("Houdini");
    expect(formatCustomValue(250, "number")).toBe("250");
    expect(formatCustomValue("2026-06-18", "date")).toBe("18.06.2026");
    expect(formatCustomValue(true, "boolean")).toBe("Yes");
    expect(formatCustomValue(false, "boolean")).toBe("No");
  });
});

describe("compareCustomValues", () => {
  it("compares numbers numerically and nulls last", () => {
    expect(compareCustomValues(2, 10, "number")).toBeLessThan(0);
    expect(compareCustomValues(null, 1, "number")).toBeGreaterThan(0);
  });
  it("compares dates lexicographically (ISO) and text via locale", () => {
    expect(compareCustomValues("2026-01-01", "2026-02-01", "date")).toBeLessThan(0);
    expect(compareCustomValues("apple", "banana", "text")).toBeLessThan(0);
  });
});

describe("customFilterMatches", () => {
  it("text contains (case-insensitive), empty matches all", () => {
    expect(customFilterMatches("Houdini", "text", { kind: "text", q: "" })).toBe(true);
    expect(customFilterMatches("Houdini", "text", { kind: "text", q: "houd" })).toBe(true);
    expect(customFilterMatches("Houdini", "text", { kind: "text", q: "xyz" })).toBe(false);
  });
  it("select equality", () => {
    expect(customFilterMatches("Booked", "select", { kind: "select", value: null })).toBe(true);
    expect(customFilterMatches("Booked", "select", { kind: "select", value: "Booked" })).toBe(true);
    expect(customFilterMatches("Live", "select", { kind: "select", value: "Booked" })).toBe(false);
  });
  it("number range inclusive", () => {
    expect(customFilterMatches(250, "number", { kind: "number", min: 100, max: 300 })).toBe(true);
    expect(customFilterMatches(50, "number", { kind: "number", min: 100, max: null })).toBe(false);
  });
  it("date range inclusive on ISO strings", () => {
    expect(customFilterMatches("2026-06-15", "date", { kind: "date", from: "2026-06-01", to: "2026-06-30" })).toBe(true);
    expect(customFilterMatches("2026-07-15", "date", { kind: "date", from: null, to: "2026-06-30" })).toBe(false);
  });
  it("boolean tri-state", () => {
    expect(customFilterMatches(true, "boolean", { kind: "boolean", value: null })).toBe(true);
    expect(customFilterMatches(true, "boolean", { kind: "boolean", value: true })).toBe(true);
    expect(customFilterMatches(false, "boolean", { kind: "boolean", value: true })).toBe(false);
  });
});
