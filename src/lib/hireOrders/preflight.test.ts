import { describe, it, expect } from "vitest";
import { computeBlockers, BLOCKER_COPY } from "./preflight";
import type { OrderData } from "./types";
import type { HireOrderTermsSetting } from "./terms";

const READY: OrderData = {
  fee: { value: "1200.00", source: "manual" },
  recipient_email: { value: "mara@example.de", source: "showflow" },
  date: { value: "2026-04-12", source: "showflow" },
};
const LETTERHEAD = { legal_name: "Aurora Productions GmbH" };
const TERMS: HireOrderTermsSetting = {
  templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }],
  default_id: "t1",
};

describe("computeBlockers", () => {
  it("returns nothing when the order and the org are both ready", () => {
    expect(
      computeBlockers({ data: READY, letterhead: LETTERHEAD, terms: TERMS, termsVariant: "t1", canEditSettings: true }),
    ).toEqual([]);
  });

  it("reports order-scoped gaps as fixable regardless of capability", () => {
    const blockers = computeBlockers({
      data: { ...READY, fee: undefined },
      letterhead: LETTERHEAD,
      terms: TERMS,
      termsVariant: "t1",
      canEditSettings: false,
    });
    expect(blockers).toEqual([{ key: "missing_fee", scope: "order", fixable: true }]);
  });

  it("reports org-scoped gaps as fixable only with the settings capability", () => {
    const args = { data: READY, letterhead: null, terms: TERMS, termsVariant: "t1" };
    expect(computeBlockers({ ...args, canEditSettings: true })).toEqual([
      { key: "missing_letterhead", scope: "org", fixable: true },
    ]);
    expect(computeBlockers({ ...args, canEditSettings: false })).toEqual([
      { key: "missing_letterhead", scope: "org", fixable: false },
    ]);
  });

  // Mirrors issueOne: resolveTermsClauses(setting, order.terms_variant) must be non-empty.
  it("reports missing_terms when the order's variant resolves to no clauses", () => {
    const empty: HireOrderTermsSetting = { templates: [{ id: "t1", name: "Standard", clauses: [] }], default_id: "t1" };
    const blockers = computeBlockers({
      data: READY, letterhead: LETTERHEAD, terms: empty, termsVariant: "t1", canEditSettings: true,
    });
    expect(blockers.map((b) => b.key)).toEqual(["missing_terms"]);
  });

  it("orders blockers order-scope first, so the fixable ones read first", () => {
    const blockers = computeBlockers({
      data: {}, letterhead: null, terms: { templates: [], default_id: null }, termsVariant: null, canEditSettings: true,
    });
    expect(blockers.map((b) => b.key)).toEqual([
      "missing_fee",
      "missing_recipient_email",
      "missing_date",
      "missing_letterhead",
      "missing_terms",
    ]);
  });

  it("has copy for every key it can emit", () => {
    const blockers = computeBlockers({
      data: {}, letterhead: null, terms: { templates: [], default_id: null }, termsVariant: null, canEditSettings: true,
    });
    for (const b of blockers) {
      expect(BLOCKER_COPY[b.key].label.trim()).not.toBe("");
      expect(BLOCKER_COPY[b.key].detail.trim()).not.toBe("");
    }
  });
});
