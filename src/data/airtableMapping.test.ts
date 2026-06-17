import { describe, it, expect } from "vitest";
import { buildProgramKey, buildCityKey, normalizeCityName, SHOWFLOW_FIELDS, planCityReconciliation, groupDuplicateCities } from "./airtableMapping";

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

describe("planCityReconciliation", () => {
  const existing = [
    { id: "c-berlin", name: "Berlin", airtable_city_key: null },        // seeded, unlinked
    { id: "c-hh", name: "Hamburg", airtable_city_key: "hamburg" },      // already linked
  ];
  it("links an option to an existing unlinked city by normalized name", () => {
    const plan = planCityReconciliation(["BERLIN"], existing);
    expect(plan.toLink).toEqual([{ cityId: "c-berlin", key: "berlin" }]);
    expect(plan.toCreate).toEqual([]);
  });
  it("skips options already linked by key", () => {
    const plan = planCityReconciliation(["Hamburg"], existing);
    expect(plan.toLink).toEqual([]);
    expect(plan.toCreate).toEqual([]);
  });
  it("creates genuinely-new options", () => {
    const plan = planCityReconciliation(["Köln"], existing);
    expect(plan.toLink).toEqual([]);
    expect(plan.toCreate).toEqual([{ name: "Köln", key: "köln" }]);
  });
  it("dedupes options that normalize to the same key (first wins)", () => {
    const plan = planCityReconciliation(["Berlin", "berlin"], existing);
    expect(plan.toLink).toEqual([{ cityId: "c-berlin", key: "berlin" }]);
    expect(plan.toCreate).toEqual([]);
  });
  it("ignores blank options", () => {
    const plan = planCityReconciliation(["   ", ""], existing);
    expect(plan).toEqual({ toLink: [], toCreate: [] });
  });
});

describe("groupDuplicateCities", () => {
  it("groups cities whose names normalize the same (>1 only)", () => {
    const groups = groupDuplicateCities([
      { id: "a", name: "Berlin", airtable_city_key: "berlin" },
      { id: "b", name: "berlin", airtable_city_key: null },
      { id: "c", name: "Hamburg", airtable_city_key: null },
    ]);
    expect(groups).toEqual([
      { norm: "berlin", cities: [
        { id: "a", name: "Berlin", airtable_city_key: "berlin" },
        { id: "b", name: "berlin", airtable_city_key: null },
      ] },
    ]);
  });
  it("returns [] when there are no duplicates", () => {
    expect(groupDuplicateCities([{ id: "a", name: "Berlin", airtable_city_key: null }])).toEqual([]);
  });
});
