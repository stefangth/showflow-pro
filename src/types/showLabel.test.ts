import { describe, it, expect } from "vitest";
import { showLabel } from "./index";

describe("showLabel", () => {
  it("combines program and sub_program when both present", () => {
    expect(showLabel({ program: "TJE", sub_program: "Murder" })).toBe("TJE – Murder");
  });
  it("falls back to sub_program when program is null (synced shows)", () => {
    expect(showLabel({ program: null, sub_program: "TJE: Murder" })).toBe("TJE: Murder");
  });
  it("uses program alone when sub_program is null", () => {
    expect(showLabel({ program: "Standalone", sub_program: null })).toBe("Standalone");
  });
  it("returns an em dash when both are null", () => {
    expect(showLabel({ program: null, sub_program: null })).toBe("—");
  });
});
