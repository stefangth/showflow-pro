import { describe, expect, it } from "vitest";
import {
  SAMPLE_LETTERHEAD,
  SAMPLE_TERMS,
  sampleLetterhead,
  sampleRenderInput,
  sampleTerms,
} from "./sampleDocument";
import { THEME_ROLE_KEYS } from "./pdfTheme";

describe("sampleLetterhead", () => {
  it("uses the org's own letterhead when it has one", () => {
    // The editor styles `legalName` and `partyLine`. Showing an invented
    // company there means the org is styling text it will never see.
    const stored = {
      legal_name: "Nord Productions GmbH",
      address_lines: ["Chausseestrasse 12", "10115 Berlin"],
      registration_line: "HRB 123456 B",
    };

    expect(sampleLetterhead(stored)).toEqual(stored);
  });

  it("falls back to the fixture when the org has authored none", () => {
    const unconfigured = { legal_name: "", address_lines: [], registration_line: "" };

    // A blank letterhead block would leave `legalName` and `partyLine`
    // invisible in the preview, so there has to be SOMETHING there.
    expect(sampleLetterhead(unconfigured).legal_name).toBe(SAMPLE_LETTERHEAD.legal_name);
    expect(sampleLetterhead(null).legal_name).toBe(SAMPLE_LETTERHEAD.legal_name);
    expect(sampleLetterhead(undefined).legal_name).toBe(SAMPLE_LETTERHEAD.legal_name);
  });

  it("treats a whitespace-only legal name as unconfigured", () => {
    expect(sampleLetterhead({ legal_name: "   ", address_lines: [] }).legal_name)
      .toBe(SAMPLE_LETTERHEAD.legal_name);
  });

  it("keeps a resolved agent signature image across the fallback", () => {
    // The server resolves this from the org's stored path. Dropping it would
    // blank the producer signature line for an org that has one but no
    // letterhead text yet.
    const resolved = sampleLetterhead({
      legal_name: "",
      address_lines: [],
      agent_signature_data_url: "data:image/png;base64,AAA",
    });

    expect(resolved.agent_signature_data_url).toBe("data:image/png;base64,AAA");
    expect(resolved.legal_name).toBe(SAMPLE_LETTERHEAD.legal_name);
  });
});

describe("sampleTerms", () => {
  it("uses the org's own clauses when it has any", () => {
    const clauses = [{ title: "Cancellation", body: "Fourteen days notice." }];

    expect(sampleTerms(clauses)).toEqual(clauses);
  });

  it("falls back to the fixture when the org has authored none", () => {
    // `clauseTitle` and `clauseBody` are editable roles: with no clauses at
    // all the terms section is omitted entirely and both become unstylable.
    expect(sampleTerms([])).toEqual(SAMPLE_TERMS);
    expect(sampleTerms(null)).toEqual(SAMPLE_TERMS);
    expect(sampleTerms(undefined)).toEqual(SAMPLE_TERMS);
  });
});

describe("sampleRenderInput", () => {
  it("threads the org's letterhead and terms through", () => {
    const letterhead = { legal_name: "Nord Productions GmbH", address_lines: ["Berlin"] };
    const terms = [{ title: "Travel", body: "Economy travel is provided." }];

    const input = sampleRenderInput({ letterhead, terms });

    expect(input.letterhead).toEqual(letterhead);
    expect(input.terms).toEqual(terms);
  });

  it("carries every section the outline can select", () => {
    const input = sampleRenderInput();

    // The sample is the only document the editor ever shows. A section
    // missing here is a role the user can select and then see nothing change.
    expect(input.status).toBe("preview"); // watermark role
    expect(input.signature).toBeDefined(); // signature mark + certificate page roles
    expect(input.data.engagement_dates?.value).toHaveLength(3); // engagement-date roles
    expect(input.data.fee_basis?.value).toBe("per_date"); // fee-breakdown role
    expect(input.data.sessions?.value).toBeDefined(); // running-order roles
    expect(input.data.notes?.value).toBeTruthy(); // notes roles
    expect(input.terms.length).toBeGreaterThan(0); // clause roles
  });

  it("keeps a per-date fee breakdown that reconciles against the total", () => {
    // The renderer refuses to print a breakdown that does not multiply up to
    // the stored total, so a sloppy fixture would silently hide the
    // fee-breakdown role rather than fail loudly.
    const { data } = sampleRenderInput();
    const dates = (data.engagement_dates?.value as unknown[]).length;
    const perDate = Number(data.fee_per_date?.value);
    const total = Number(data.fee?.value);

    expect(Math.round(perDate * dates * 100)).toBe(Math.round(total * 100));
  });

  it("passes the highlighted role straight through", () => {
    const role = THEME_ROLE_KEYS[0];

    expect(sampleRenderInput({ highlightRole: role }).highlightRole).toBe(role);
  });
});
