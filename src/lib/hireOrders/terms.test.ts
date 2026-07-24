import { describe, expect, it } from "vitest";
import {
  defaultTemplateId,
  normalizeTermsSetting,
  resolveTermsClauses,
} from "./terms";

describe("normalizeTermsSetting", () => {
  it("passes a valid new-shape value through unchanged", () => {
    const v = { templates: [{ id: "a", name: "A", clauses: [{ title: "t", body: "b" }] }], default_id: "a" };
    expect(normalizeTermsSetting(v)).toEqual(v);
  });

  it("converts the legacy lean/standard/full shape to three templates, default standard", () => {
    const legacy = { lean: [], standard: [{ title: "S", body: "sb" }], full: [] };
    expect(normalizeTermsSetting(legacy)).toEqual({
      templates: [
        { id: "lean", name: "Lean", clauses: [] },
        { id: "standard", name: "Standard", clauses: [{ title: "S", body: "sb" }] },
        { id: "full", name: "Full", clauses: [] },
      ],
      default_id: "standard",
    });
  });

  it("returns empty for missing/junk input", () => {
    expect(normalizeTermsSetting(null)).toEqual({ templates: [], default_id: null });
    expect(normalizeTermsSetting({})).toEqual({ templates: [], default_id: null });
    expect(normalizeTermsSetting({ templates: "nope" })).toEqual({ templates: [], default_id: null });
  });

  it("drops malformed templates and clauses", () => {
    const v = { templates: [{ id: "a", name: "A", clauses: [{ title: "t", body: "b" }, { title: 1 }] }, { name: "no id" }], default_id: "a" };
    expect(normalizeTermsSetting(v)).toEqual({ templates: [{ id: "a", name: "A", clauses: [{ title: "t", body: "b" }] }], default_id: "a" });
  });
});

describe("defaultTemplateId", () => {
  it("returns default_id when it points at an existing template", () => {
    expect(defaultTemplateId({ templates: [{ id: "a", name: "A", clauses: [] }], default_id: "a" })).toBe("a");
  });
  it("falls back to the first template when default_id is missing or stale", () => {
    expect(defaultTemplateId({ templates: [{ id: "a", name: "A", clauses: [] }], default_id: "gone" })).toBe("a");
    expect(defaultTemplateId({ templates: [{ id: "a", name: "A", clauses: [] }], default_id: null })).toBe("a");
  });
  it("returns null when there are no templates", () => {
    expect(defaultTemplateId({ templates: [], default_id: null })).toBeNull();
  });
});

describe("resolveTermsClauses", () => {
  const setting = {
    templates: [
      { id: "a", name: "A", clauses: [{ title: "ta", body: "ba" }] },
      { id: "b", name: "B", clauses: [{ title: "tb", body: "bb" }] },
    ],
    default_id: "b",
  };
  it("returns the referenced template's clauses", () => {
    expect(resolveTermsClauses(setting, "a")).toEqual([{ title: "ta", body: "ba" }]);
  });
  it("falls back to the default template when the id is unknown (deleted)", () => {
    expect(resolveTermsClauses(setting, "gone")).toEqual([{ title: "tb", body: "bb" }]);
  });
  it("returns [] when neither the id nor a default resolves", () => {
    expect(resolveTermsClauses({ templates: [], default_id: null }, "x")).toEqual([]);
  });
});
