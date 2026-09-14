import { describe, it, expect } from "vitest";
import { CAPABILITY_DEFS } from "./capabilities";
import { GROUP_LABEL_SLUG } from "@/components/settings/rolesRights/capabilityGroups";
import enRolesRights from "@/i18n/locales/en/settingsRolesRights.json";
import { interpolateVocabulary, VOCABULARY } from "@/lib/orgKind";

// The RolesRights UI renders each capability's label/description from the
// `settingsRolesRights` catalog, falling back to the registry's English copy. The English
// catalog is the vocabulary-variable form of that copy ({{artists}}, {{roleProducer}}, ...);
// rendered under the production vocabulary it must equal the registry's English, which stays
// the single source of the capability set + its wording (it is also the edge/SQL mirror
// source). These guards keep the two from drifting: a catalog value that no longer renders to
// the registry copy would show stale wording in the UI, and a new capability with no catalog
// entry would silently fall back (untranslated for German). The German side is covered by
// keyParity + translationCompleteness.
const PRODUCTION_EN = VOCABULARY.production.en;
const render = (text: string) => interpolateVocabulary(text, PRODUCTION_EN);
const enCaps = enRolesRights.capabilities as Record<string, { label: string; description: string }>;
const enGroups = enRolesRights.capabilityGroups as Record<string, string>;

describe("capability catalog parity with the registry", () => {
  it("every capability has an English catalog entry matching the registry", () => {
    for (const def of CAPABILITY_DEFS) {
      expect(enCaps[def.key], `missing capabilities.${def.key}`).toBeDefined();
      expect(render(enCaps[def.key].label), `label drift for ${def.key}`).toBe(def.label);
      expect(render(enCaps[def.key].description), `description drift for ${def.key}`).toBe(def.description);
    }
  });

  it("has no catalog entries for capabilities that no longer exist", () => {
    const keys = new Set(CAPABILITY_DEFS.map((d) => d.key));
    expect(Object.keys(enCaps).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("every distinct capability group has an English group label matching the registry", () => {
    const groups = [...new Set(CAPABILITY_DEFS.map((d) => d.group))];
    const byLabel = new Map(Object.values(enGroups).map((v) => [render(v), render(v)]));
    for (const g of groups) {
      expect(byLabel.get(g), `missing capabilityGroups label for "${g}"`).toBe(g);
    }
    // No stale group labels either.
    expect(Object.values(enGroups).map(render).filter((v) => !groups.includes(v))).toEqual([]);
  });

  it("GROUP_LABEL_SLUG maps every registry group to a real catalog slug", () => {
    // The RolesRights UI resolves group headers via GROUP_LABEL_SLUG[group] -> the
    // capabilityGroups.<slug> catalog key. This is the third artifact that must agree with the
    // registry and the catalog; pin it so a new/renamed group cannot silently fall back to the
    // raw English header for German viewers.
    const groups = [...new Set(CAPABILITY_DEFS.map((d) => d.group))];
    const slugKeys = new Set(Object.keys(enGroups));
    for (const g of groups) {
      const slug = GROUP_LABEL_SLUG[g];
      expect(slug, `GROUP_LABEL_SLUG missing "${g}"`).toBeDefined();
      expect(slugKeys.has(slug), `capabilityGroups.${slug} missing for "${g}"`).toBe(true);
    }
    // No stale slug map entries pointing at groups the registry no longer has.
    expect(Object.keys(GROUP_LABEL_SLUG).filter((g) => !groups.includes(g))).toEqual([]);
  });
});
