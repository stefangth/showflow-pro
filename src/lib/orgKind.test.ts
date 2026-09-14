import { describe, it, expect } from "vitest";
import {
  ORG_KINDS,
  DEFAULT_ORG_KIND,
  isOrgKind,
  coerceOrgKind,
  ORG_KIND_LABELS,
  VOCABULARY,
  interpolateVocabulary,
} from "./orgKind";

const DASH = /[–—]/;

describe("orgKind registry", () => {
  it("lists production first and defaults to it", () => {
    expect(ORG_KINDS[0]).toBe("production");
    expect(DEFAULT_ORG_KIND).toBe("production");
    expect(ORG_KINDS).toEqual(["production", "staffing"]);
  });

  it("isOrgKind / coerceOrgKind narrow safely", () => {
    expect(isOrgKind("staffing")).toBe(true);
    expect(isOrgKind("Staffing")).toBe(false);
    expect(isOrgKind(null)).toBe(false);
    expect(coerceOrgKind("staffing")).toBe("staffing");
    expect(coerceOrgKind("circus")).toBe("production");
    expect(coerceOrgKind(undefined)).toBe("production");
  });

  it("every (kind, lang) vocabulary has the identical key set", () => {
    const ref = Object.keys(VOCABULARY.production.en).sort();
    expect(ref.length).toBeGreaterThan(0);
    for (const kind of ORG_KINDS) {
      for (const lang of ["en", "de"] as const) {
        expect(Object.keys(VOCABULARY[kind][lang]).sort()).toEqual(ref);
      }
    }
  });

  it("vocabulary and labels are copy-clean and non-empty", () => {
    for (const kind of ORG_KINDS) {
      for (const lang of ["en", "de"] as const) {
        for (const v of Object.values(VOCABULARY[kind][lang])) {
          expect(v.trim().length).toBeGreaterThan(0);
          expect(v).not.toMatch(DASH);
          expect(v).not.toContain("!");
        }
        expect(ORG_KIND_LABELS[kind][lang].title).not.toMatch(DASH);
        expect(ORG_KIND_LABELS[kind][lang].desc).not.toMatch(DASH);
      }
    }
  });

  it("capitalised forms are the capitalised singular/plural", () => {
    for (const kind of ORG_KINDS) {
      const v = VOCABULARY[kind].en;
      expect(v.Show.charAt(0)).toBe(v.Show.charAt(0).toUpperCase());
      expect(v.Shows.charAt(0)).toBe(v.Shows.charAt(0).toUpperCase());
      expect(v.show.charAt(0)).toBe(v.show.charAt(0).toLowerCase());
    }
  });
});

describe("vocabulary extensions", () => {
  it("carries the role label and the kind id", () => {
    expect(VOCABULARY.production.en.roleProducer).toBe("Production Team");
    expect(VOCABULARY.staffing.en.roleProducer).toBe("Booking team");
    expect(VOCABULARY.staffing.de.roleProducer).toBe("Buchungsteam");
    for (const kind of ORG_KINDS) for (const lang of ["en", "de"] as const) expect(VOCABULARY[kind][lang].kind).toBe(kind);
  });
});

describe("interpolateVocabulary", () => {
  const vocab = VOCABULARY.staffing.en;
  it("replaces known vocabulary variables, every occurrence", () => {
    expect(interpolateVocabulary("Add a {{artist}} to the {{cast}}. {{Artists}} first.", vocab))
      .toBe("Add a staff member to the team. People first.");
  });
  it("leaves runtime variables and unknown tokens alone", () => {
    expect(interpolateVocabulary("{{count}} {{shows}} for {{showTitle}}", vocab)).toBe("{{count}} projects for {{showTitle}}");
  });
  it("is the identity on text without variables", () => {
    expect(interpolateVocabulary("plain", vocab)).toBe("plain");
  });
});
