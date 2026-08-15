import { describe, it, expect } from "vitest";
import { CAPABILITY_DEFS } from "./capabilities";
import enRolesRights from "@/i18n/locales/en/settingsRolesRights.json";

// The RolesRights UI renders each capability's label/description from the
// `settingsRolesRights` catalog, falling back to the registry's English copy. The English
// catalog was generated FROM the registry, and the registry stays the single source of the
// capability set + its English wording (it is also the edge/SQL mirror source). These guards
// keep the two from drifting: an English catalog value that no longer matches the registry
// would show stale copy in the UI, and a new capability with no catalog entry would silently
// fall back (untranslated for German). The German side is covered by keyParity +
// translationCompleteness.
const enCaps = enRolesRights.capabilities as Record<string, { label: string; description: string }>;
const enGroups = enRolesRights.capabilityGroups as Record<string, string>;

describe("capability catalog parity with the registry", () => {
  it("every capability has an English catalog entry matching the registry", () => {
    for (const def of CAPABILITY_DEFS) {
      expect(enCaps[def.key], `missing capabilities.${def.key}`).toBeDefined();
      expect(enCaps[def.key].label, `label drift for ${def.key}`).toBe(def.label);
      expect(enCaps[def.key].description, `description drift for ${def.key}`).toBe(def.description);
    }
  });

  it("has no catalog entries for capabilities that no longer exist", () => {
    const keys = new Set(CAPABILITY_DEFS.map((d) => d.key));
    expect(Object.keys(enCaps).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("every distinct capability group has an English group label matching the registry", () => {
    const groups = [...new Set(CAPABILITY_DEFS.map((d) => d.group))];
    const byLabel = new Map(Object.values(enGroups).map((v) => [v, v]));
    for (const g of groups) {
      expect(byLabel.get(g), `missing capabilityGroups label for "${g}"`).toBe(g);
    }
    // No stale group labels either.
    expect(Object.values(enGroups).filter((v) => !groups.includes(v))).toEqual([]);
  });
});
