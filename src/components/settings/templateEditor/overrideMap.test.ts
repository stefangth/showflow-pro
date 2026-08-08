import { describe, expect, it } from "vitest";
import {
  compactCopyMap,
  compactThemeMap,
  hasOwnKeys,
  numericInputValue,
} from "./overrideMap";

describe("template editor override maps", () => {
  it("treats null and hollow objects as unmodified", () => {
    expect(hasOwnKeys(null)).toBe(false);
    expect(hasOwnKeys({})).toBe(false);
    expect(hasOwnKeys({ size: 12 })).toBe(true);
  });

  it("returns null for a blank numeric input without conflating zero", () => {
    expect(numericInputValue("")).toBeNull();
    expect(numericInputValue("  ")).toBeNull();
    expect(numericInputValue("0")).toBe(0);
  });

  it("compacts blank and default copy values away", () => {
    expect(compactCopyMap(
      { heading: "Default heading", footer: "  ", body: "Custom body" },
      { heading: "Default heading", footer: "Default footer", body: "Default body" },
    )).toEqual({ body: "Custom body" });
  });

  it("removes hollow base and role entries while preserving populated roles", () => {
    expect(compactThemeMap({
      base: {},
      roles: { heading: {}, body: { weight: 600 } },
    })).toEqual({ roles: { body: { weight: 600 } } });
  });
});
