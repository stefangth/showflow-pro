import { describe, it, expect, beforeEach } from "vitest";
import i18n from "@/i18n";
import { applyVocabulary } from "./vocabulary";
import { VOCABULARY } from "@/lib/orgKind";

describe("applyVocabulary", () => {
  beforeEach(() => {
    i18n.addResourceBundle("en", "vocabTest", { line: "Add your first {{show}} for {{Artists}}" }, true, true);
    i18n.addResourceBundle("de", "vocabTest", { line: "Lege dein erstes {{show}} für {{Artists}} an" }, true, true);
    applyVocabulary(i18n, "production", "en");
  });

  it("resolves variables from the production table by default", () => {
    expect(i18n.t("vocabTest:line")).toBe("Add your first show for Artists");
  });

  it("swaps to the staffing table", () => {
    expect(applyVocabulary(i18n, "staffing", "en")).toBe(true);
    expect(i18n.t("vocabTest:line")).toBe("Add your first project for People");
  });

  it("reports no change when the same table is applied twice", () => {
    applyVocabulary(i18n, "staffing", "en");
    expect(applyVocabulary(i18n, "staffing", "en")).toBe(false);
  });

  it("explicit t() variables win over the defaults", () => {
    applyVocabulary(i18n, "staffing", "en");
    expect(i18n.t("vocabTest:line", { show: "gig" })).toBe("Add your first gig for People");
  });

  it("installs the table for the given language", () => {
    applyVocabulary(i18n, "staffing", "de");
    expect(i18n.options.interpolation?.defaultVariables).toEqual(VOCABULARY.staffing.de);
  });
});
