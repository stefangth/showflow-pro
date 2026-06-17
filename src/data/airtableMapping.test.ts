import { describe, it, expect } from "vitest";
import { buildProgramKey, buildCityKey, normalizeCityName, SHOWFLOW_FIELDS } from "./airtableMapping";

describe("airtableMapping key helpers", () => {
  it("buildProgramKey uses sub_program alone when program value is absent", () => {
    expect(buildProgramKey(null, "TJE: Murder")).toBe("TJE: Murder");
  });
  it("buildProgramKey composes program|sub_program when both present", () => {
    expect(buildProgramKey("TJE", "TJE: Murder")).toBe("TJE|TJE: Murder");
  });
  it("buildProgramKey trims and returns null when nothing usable", () => {
    expect(buildProgramKey(null, "  ")).toBeNull();
    expect(buildProgramKey("  ", null)).toBeNull();
  });
  it("buildCityKey lowercases + trims; null/blank → null", () => {
    expect(buildCityKey(" Berlin ")).toBe("berlin");
    expect(buildCityKey("BERLIN")).toBe("berlin");
    expect(buildCityKey("")).toBeNull();
  });
  it("normalizeCityName trims + lowercases, never null", () => {
    expect(normalizeCityName(" Hamburg ")).toBe("hamburg");
    expect(normalizeCityName(null)).toBe("");
    expect(normalizeCityName(undefined)).toBe("");
  });
  it("SHOWFLOW_FIELDS lists the mappable core fields incl. optional session_3", () => {
    expect(SHOWFLOW_FIELDS.map((f) => f.key)).toEqual(
      ["date", "program", "sub_program", "city", "venue", "session_1", "session_2", "session_3"]);
    expect(SHOWFLOW_FIELDS.find((f) => f.key === "session_3")?.optional).toBe(true);
  });
});
