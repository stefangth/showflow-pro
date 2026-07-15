import { describe, it, expect } from "vitest";
import { showIdentityLabel } from "./index";

describe("showIdentityLabel", () => {
  it("joins program and sub_program with a middot when both present", () => {
    expect(showIdentityLabel({ program: "TJE", sub_program: "Murder" })).toBe("TJE · Murder");
  });
  it("falls back to sub_program when program is null (synced shows)", () => {
    expect(showIdentityLabel({ program: null, sub_program: "TJE: Murder" })).toBe("TJE: Murder");
  });
  it("uses program alone when sub_program is null", () => {
    expect(showIdentityLabel({ program: "Standalone", sub_program: null })).toBe("Standalone");
  });
  it("returns 'Untitled show' when both are null", () => {
    expect(showIdentityLabel({ program: null, sub_program: null })).toBe("Untitled show");
  });
});
