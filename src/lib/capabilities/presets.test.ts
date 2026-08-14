import { describe, it, expect } from "vitest";
import { presetOnKeys, matchesPreset } from "./presets";
import { CAPABILITY_DEFS } from "../capabilities";

describe("presets", () => {
  it("Standard = registry defaultEnabled set", () => {
    const on = presetOnKeys("Standard");
    for (const def of CAPABILITY_DEFS) {
      expect(on.has(def.key)).toBe(def.defaultEnabled);
    }
  });
  it("Full = every non-locked key on", () => {
    const on = presetOnKeys("Full");
    expect(on.size).toBe(CAPABILITY_DEFS.length);
  });
  it("Restricted excludes all sensitive keys", () => {
    const on = presetOnKeys("Restricted");
    const sensitiveOn = CAPABILITY_DEFS.filter(d => d.risk === "sensitive" && on.has(d.key));
    expect(sensitiveOn).toEqual([]);
  });
  it("matchesPreset is true when effective equals the preset set", () => {
    const on = presetOnKeys("Standard");
    const eff = Object.fromEntries(CAPABILITY_DEFS.map(d => [d.key, on.has(d.key)]));
    expect(matchesPreset(eff, "Standard")).toBe(true);
    expect(matchesPreset({ ...eff, producer_can_rename_org: true }, "Standard")).toBe(false);
  });
});
