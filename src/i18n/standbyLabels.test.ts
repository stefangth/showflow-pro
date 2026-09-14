import { describe, it, expect, afterAll } from "vitest";
import i18n from "@/i18n";
import { applyVocabulary } from "@/features/i18n/vocabulary";
import type { OrgKind } from "@/lib/orgKind";
import type { Lang } from "@/i18n/config";

/**
 * The standby (understudy) short labels are kind-varying in BOTH languages, unlike the
 * usual pattern where English uses a vocabulary token. Production keeps its abbreviation;
 * staffing spells the standby word out (owner decision, 2026-09-14). These pin the exact
 * shipped wording so an edit to the siblings is a deliberate, visible change.
 *   - calendar "Needs you" understudy pill: bookings:calendar.needsYou.understudyAbbrev
 *   - booking setup-rail slot label:         bookingCopy:slotsStep.usLabel
 */
const CASES: Array<{ kind: OrgKind; lang: Lang; pill: string; slot: string }> = [
  { kind: "production", lang: "en", pill: "US", slot: "u/s" },
  { kind: "staffing", lang: "en", pill: "Standby", slot: "standby" },
  { kind: "production", lang: "de", pill: "ZB", slot: "ZB" },
  { kind: "staffing", lang: "de", pill: "Ersatz", slot: "Ersatz" },
];

describe("standby short labels resolve per workspace kind", () => {
  afterAll(async () => {
    applyVocabulary(i18n, "production", "en");
    await i18n.changeLanguage("en");
  });

  for (const { kind, lang, pill, slot } of CASES) {
    it(`${kind}/${lang}: pill "${pill}", slot label "${slot}"`, async () => {
      await i18n.changeLanguage(lang);
      applyVocabulary(i18n, kind, lang);
      expect(i18n.t("calendar.needsYou.understudyAbbrev", { ns: "bookings" })).toBe(pill);
      expect(i18n.t("slotsStep.usLabel", { ns: "bookingCopy" })).toBe(slot);
    });
  }
});
