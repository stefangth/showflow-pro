import { describe, it, expect } from "vitest";
import { mergeTermsTemplates } from "./termsImport";
import type { HireOrderTemplate, HireOrderTermsSetting } from "./terms";

const LIB: HireOrderTemplate[] = [
  { id: "platform-standard-engagement", name: "Standard engagement", clauses: [{ title: "Fee", body: "14 days." }] },
  { id: "platform-guest-per-session", name: "Guest artist, per session", clauses: [{ title: "Fee", body: "Per session." }] },
];

describe("mergeTermsTemplates", () => {
  it("imports into an empty org and adopts the first imported template as default", () => {
    const next = mergeTermsTemplates({ templates: [], default_id: null }, LIB);
    expect(next.templates.map((t) => t.id)).toEqual(["platform-standard-engagement", "platform-guest-per-session"]);
    expect(next.default_id).toBe("platform-standard-engagement");
  });

  it("appends rather than replacing the org's own templates", () => {
    const current: HireOrderTermsSetting = {
      templates: [{ id: "own", name: "House terms", clauses: [{ title: "A", body: "B" }] }],
      default_id: "own",
    };
    const next = mergeTermsTemplates(current, LIB);
    expect(next.templates.map((t) => t.id)).toEqual([
      "own",
      "platform-standard-engagement",
      "platform-guest-per-session",
    ]);
  });

  it("keeps a default that already resolves to real clauses", () => {
    const current: HireOrderTermsSetting = {
      templates: [{ id: "own", name: "House terms", clauses: [{ title: "A", body: "B" }] }],
      default_id: "own",
    };
    expect(mergeTermsTemplates(current, LIB).default_id).toBe("own");
  });

  it("adopts the imported default when the org's own default has no clauses", () => {
    const current: HireOrderTermsSetting = {
      templates: [{ id: "own", name: "Empty", clauses: [] }],
      default_id: "own",
    };
    expect(mergeTermsTemplates(current, LIB).default_id).toBe("platform-standard-engagement");
  });

  it("is a no-op on re-import of an id the org already has", () => {
    const current = mergeTermsTemplates({ templates: [], default_id: null }, LIB);
    const again = mergeTermsTemplates(current, LIB);
    expect(again.templates).toHaveLength(2);
    expect(again).toEqual(current);
  });

  it("does not overwrite an org's edits to an imported template on re-import", () => {
    const edited: HireOrderTermsSetting = {
      templates: [{ id: "platform-standard-engagement", name: "Standard engagement", clauses: [{ title: "Fee", body: "OUR WORDING" }] }],
      default_id: "platform-standard-engagement",
    };
    const next = mergeTermsTemplates(edited, LIB);
    expect(next.templates[0].clauses[0].body).toBe("OUR WORDING");
  });

  // An org with no stored row resolves HIRE_ORDER_DEFAULT_TERMS: three clause-less
  // placeholders. Persisting those would give the org three selectable terms variants
  // it never authored, each rendering a blank back page.
  it("drops a wholly clause-less current set instead of persisting it", () => {
    const fallback: HireOrderTermsSetting = {
      templates: [
        { id: "lean", name: "Lean", clauses: [] },
        { id: "standard", name: "Standard", clauses: [] },
        { id: "full", name: "Full", clauses: [] },
      ],
      default_id: "standard",
    };
    const next = mergeTermsTemplates(fallback, LIB);
    expect(next.templates.map((t) => t.id)).toEqual([
      "platform-standard-engagement",
      "platform-guest-per-session",
    ]);
    expect(next.default_id).toBe("platform-standard-engagement");
  });

  it("keeps an empty draft that sits alongside a real template", () => {
    const current: HireOrderTermsSetting = {
      templates: [
        { id: "own", name: "House terms", clauses: [{ title: "A", body: "B" }] },
        { id: "draft", name: "In progress", clauses: [] },
      ],
      default_id: "own",
    };
    const next = mergeTermsTemplates(current, LIB);
    expect(next.templates.map((t) => t.id)).toContain("draft");
  });

  // The old `added[0] ?? incoming[0]` fall-through could name a template that resolves
  // to no clauses, so the import reported success while missing_terms kept firing.
  it("never adopts a clause-less template as the new default", () => {
    const current: HireOrderTermsSetting = {
      templates: [{ id: "own", name: "Emptied", clauses: [] }],
      default_id: "own",
    };
    const incoming = [
      { id: "blank", name: "Blank", clauses: [] },
      { id: "real", name: "Real", clauses: [{ title: "Fee", body: "14 days." }] },
    ];
    expect(mergeTermsTemplates(current, incoming).default_id).toBe("real");
  });
});
