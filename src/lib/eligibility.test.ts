import { describe, it, expect } from "vitest";
import { unionSkillIds, artistHasAllSkills } from "./eligibility";

describe("unionSkillIds", () => {
  it("dedups and sorts for stable query keys", () => {
    expect(unionSkillIds(["b", "a"], ["a", "c"])).toEqual(["a", "b", "c"]);
  });
  it("handles empty inputs", () => {
    expect(unionSkillIds([], [])).toEqual([]);
  });
});

describe("artistHasAllSkills", () => {
  it("requires every required skill", () => {
    expect(artistHasAllSkills(new Set(["s1", "s2"]), ["s1"])).toBe(true);
    expect(artistHasAllSkills(new Set(["s1"]), ["s1", "s2"])).toBe(false);
  });
  it("passes everyone when nothing is required", () => {
    expect(artistHasAllSkills(new Set(), [])).toBe(true);
  });
});
