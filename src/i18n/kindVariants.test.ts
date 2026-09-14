import { describe, it, expect, beforeAll, afterAll } from "vitest";
import i18n from "@/i18n";
import { applyVocabulary } from "@/features/i18n/vocabulary";

/**
 * German sentences that cannot take a bare noun variable (article, adjective ending,
 * pronoun) use per-kind sibling keys selected by i18next nesting on the `kind`
 * vocabulary variable: "$t(ns:path.key_{{kind}})". This pins the behaviour the copy
 * audit relies on so an i18next upgrade cannot silently break it.
 */
const NS = "kindVariantsTest";
const de = {
  page: {
    add: "$t(kindVariantsTest:page.add_{{kind}})",
    add_production: "Neue Produktion",
    add_staffing: "Neuer Kunde",
    count_one: "$t(kindVariantsTest:page.count_{{kind}}_one)",
    count_other: "$t(kindVariantsTest:page.count_{{kind}}_other)",
    count_production_one: "{{count}} Termin",
    count_production_other: "{{count}} Termine",
    count_staffing_one: "{{count}} Schicht",
    count_staffing_other: "{{count}} Schichten",
    plain: "Deine {{Productions}}",
  },
};

describe("per-kind German siblings via nesting", () => {
  beforeAll(async () => {
    i18n.addResourceBundle("de", NS, de, true, true);
    i18n.addResourceBundle("en", NS, { page: { add: "New {{production}}", count_one: "{{count}} {{showDate}}", count_other: "{{count}} {{showDates}}", plain: "Your {{productions}}" } }, true, true);
    await i18n.changeLanguage("de");
  });
  afterAll(async () => {
    applyVocabulary(i18n, "production", "en");
    await i18n.changeLanguage("en");
  });

  it("selects the production sibling under the production vocabulary", () => {
    applyVocabulary(i18n, "production", "de");
    expect(i18n.t("page.add", { ns: NS })).toBe("Neue Produktion");
    expect(i18n.t("page.plain", { ns: NS })).toBe("Deine Produktionen");
  });

  it("selects the staffing sibling after the table swaps", () => {
    applyVocabulary(i18n, "staffing", "de");
    expect(i18n.t("page.add", { ns: NS })).toBe("Neuer Kunde");
    expect(i18n.t("page.plain", { ns: NS })).toBe("Deine Kunden");
  });

  it("resolves when t is bound to a different namespace", () => {
    applyVocabulary(i18n, "staffing", "de");
    const t = i18n.getFixedT("de", "common");
    expect(t(`${NS}:page.add`)).toBe("Neuer Kunde");
  });

  it("carries the plural suffix and the count through the sibling", () => {
    applyVocabulary(i18n, "staffing", "de");
    expect(i18n.t("page.count", { ns: NS, count: 1 })).toBe("1 Schicht");
    expect(i18n.t("page.count", { ns: NS, count: 3 })).toBe("3 Schichten");
    applyVocabulary(i18n, "production", "de");
    expect(i18n.t("page.count", { ns: NS, count: 3 })).toBe("3 Termine");
  });
});
