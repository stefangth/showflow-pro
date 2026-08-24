import { it, expect } from "vitest";
import { HELP_ITEMS } from "@/lib/help/items";
import { STEP_FEATURE } from "./stepFeature";
import { STEP_HELP, stepHelpLink } from "./stepHelp";
import type { GetRunningStepKey } from "./steps";

const KEYS = Object.keys(STEP_FEATURE) as GetRunningStepKey[];

it("covers every step", () => {
  for (const key of KEYS) expect(STEP_HELP[key], `no help target for ${key}`).toBeDefined();
});

it("never links at a help item that does not exist", () => {
  // A typo here would send "Read more" to a page that silently shows nothing expanded.
  for (const key of KEYS) {
    const entry = STEP_HELP[key];
    if ("item" in entry) {
      expect(HELP_ITEMS.some((i) => i.id === entry.item), `${key} -> unknown item ${entry.item}`).toBe(true);
    }
  }
});

it("always resolves inside the help center, never at a settings page", () => {
  // The bug this replaces: every one of these resolved through stepFeatureLink, so
  // "Read more about the Airtable connection" opened /dates.
  for (const key of KEYS) expect(stepHelpLink(key)).toMatch(/^\/help\?/);
});
