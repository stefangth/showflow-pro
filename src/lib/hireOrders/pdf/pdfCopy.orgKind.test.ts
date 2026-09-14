import { describe, expect, it } from "vitest";
import { VOCABULARY } from "@/lib/orgKind";
import {
  applyTokens,
  HIRE_ORDER_COPY_DE,
  HIRE_ORDER_COPY_DEFAULTS,
  PRODUCTION_VOCAB,
  resolveHireOrderCopy,
  type CopyKey,
} from "./pdfCopy";

// The runtime data tokens the renderer fills via applyTokens (render.tsx), after the
// disambiguation rename in Task 2: {{cast}} -> {{castRef}}, {{artist}} -> {{artistName}}.
const RUNTIME_VALUES = { role: "Lead", castRef: "Berlin 1", artistName: "Ada Lovelace" };

describe("resolveHireOrderCopy org_kind vocabulary", () => {
  it("is byte-identical to the base maps for production (omitted or explicit table)", () => {
    // A plain call falls back to the production vocab, whose words equal the hardcoded
    // nouns, so every value substitutes back to the exact clean default.
    expect(resolveHireOrderCopy(undefined, "en")).toEqual(HIRE_ORDER_COPY_DEFAULTS);
    expect(resolveHireOrderCopy(undefined, "de")).toEqual(HIRE_ORDER_COPY_DE);
    expect(resolveHireOrderCopy(undefined, "en", VOCABULARY.production.en)).toEqual(
      HIRE_ORDER_COPY_DEFAULTS,
    );
    expect(resolveHireOrderCopy(undefined, "de", VOCABULARY.production.de)).toEqual(
      HIRE_ORDER_COPY_DE,
    );
  });

  it("renders the renamed runtime tokens identically for production", () => {
    // The rename changed the token NAMES; the rendered strings must be unchanged. Assert
    // the four affected keys against the value map render.tsx now supplies.
    const en = resolveHireOrderCopy(undefined, "en");
    expect(applyTokens(en.billing_role_and_cast, RUNTIME_VALUES)).toBe("Lead · billed as Berlin 1");
    expect(applyTokens(en.billing_cast_only, RUNTIME_VALUES)).toBe("Billed as Berlin 1");
    expect(applyTokens(en.party_cast_reference, RUNTIME_VALUES)).toBe("Cast reference: Berlin 1");
    expect(applyTokens(en.signature_for_artist, RUNTIME_VALUES)).toBe("The Artist · Ada Lovelace");
  });

  it("swaps domain nouns for a staffing table", () => {
    const en = resolveHireOrderCopy(undefined, "en", VOCABULARY.staffing.en);
    expect(en.party_cast_reference).toBe("Team reference: {{castRef}}");
    expect(en.party_cast_reference).not.toContain("Cast reference:");
    expect(en.party_artist_label).toBe("Engaged staff member, the Staff member");
    expect(en.signature_for_artist).toBe("The Staff member · {{artistName}}");

    const de = resolveHireOrderCopy(undefined, "de", VOCABULARY.staffing.de);
    expect(de.party_cast_reference).toBe("Team: {{castRef}}");
  });

  it("swaps the hire-order noun in the header, title and certificate lead", () => {
    // Production keeps the reconciled clean prose (byte-identical to the defaults).
    const enProd = resolveHireOrderCopy(undefined, "en");
    expect(enProd.header_eyebrow).toBe("Performance contract");
    expect(enProd.title_lead).toBe("This contract confirms the engagement of");
    const deProd = resolveHireOrderCopy(undefined, "de");
    expect(deProd.title_lead).toBe("Dieser Engagementvertrag bestätigt das Engagement von");

    // Staffing swaps the noun everywhere it is tokenized.
    const enStaff = resolveHireOrderCopy(undefined, "en", VOCABULARY.staffing.en);
    expect(enStaff.header_eyebrow).toBe("Performance work order");
    expect(enStaff.title_lead).toBe("This work order confirms the engagement of");
    expect(applyTokens(enStaff.cert_lead, { orderNo: "HO-1" })).toBe(
      "Electronic signature record for work order HO-1.",
    );
    const deStaff = resolveHireOrderCopy(undefined, "de", VOCABULARY.staffing.de);
    expect(deStaff.header_eyebrow).toBe("Arbeitsauftrag");
    expect(deStaff.title_lead).toBe("Dieser Arbeitsauftrag bestätigt das Engagement von");
  });

  it("leaves the runtime token verbatim through the vocab pass, then fills it via applyTokens", () => {
    const en = resolveHireOrderCopy(undefined, "en", VOCABULARY.staffing.en);
    // castRef is a runtime data token, not a vocab key, so the vocab pass skips it.
    expect(en.party_cast_reference).toContain("{{castRef}}");
    expect(applyTokens(en.party_cast_reference, RUNTIME_VALUES)).toBe("Team reference: Berlin 1");
  });

  it("substitutes an admin override that itself carries a vocab token", () => {
    const overrides: Partial<Record<CopyKey, string>> = {
      terms_heading: "{{Cast}} terms",
    };
    expect(resolveHireOrderCopy(overrides, "en", VOCABULARY.staffing.en).terms_heading).toBe(
      "Team terms",
    );
    // Production keeps the word.
    expect(resolveHireOrderCopy(overrides, "en").terms_heading).toBe("Cast terms");
  });
});

// PRODUCTION_VOCAB is a hand-maintained, import-free copy of VOCABULARY.production
// (the pdfCopy mirror must import nothing). Guard against silent desync from the registry.
describe("PRODUCTION_VOCAB stays in sync with the org_kind registry", () => {
  it("matches VOCABULARY.production for en and de", () => {
    expect(PRODUCTION_VOCAB.en).toEqual(VOCABULARY.production.en);
    expect(PRODUCTION_VOCAB.de).toEqual(VOCABULARY.production.de);
  });
});

// Backward-compat: a per-org override saved before the {{cast}}/{{artist}} runtime tokens
// were renamed must still resolve the real cast/artist name, not the vocabulary noun.
describe("legacy runtime tokens in stored overrides", () => {
  it("rewrites {{cast}}/{{artist}} in an override to {{castRef}}/{{artistName}} before the vocab pass", () => {
    const copy = resolveHireOrderCopy(
      { party_cast_reference: "Old ref: {{cast}}", signature_for_artist: "The Artist, {{artist}}" },
      "en",
      VOCABULARY.staffing.en,
    );
    // The runtime tokens survive the vocab pass under their new names for applyTokens.
    expect(copy.party_cast_reference).toBe("Old ref: {{castRef}}");
    expect(copy.signature_for_artist).toBe("The Artist, {{artistName}}");
    // applyTokens then fills the real values.
    expect(applyTokens(copy.party_cast_reference, { castRef: "Ensemble A", artistName: "Nora" }))
      .toBe("Old ref: Ensemble A");
    expect(applyTokens(copy.signature_for_artist, { castRef: "Ensemble A", artistName: "Nora" }))
      .toBe("The Artist, Nora");
  });
  it("still substitutes a {{Cast}} vocabulary token inside an override", () => {
    const copy = resolveHireOrderCopy({ party_cast_reference: "{{Cast}}: {{cast}}" }, "en", VOCABULARY.staffing.en);
    expect(copy.party_cast_reference).toBe("Team: {{castRef}}");
  });
});
