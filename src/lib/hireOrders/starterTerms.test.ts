import { describe, it, expect } from "vitest";
import { HIRE_ORDER_STARTER_TERMS } from "./starterTerms";

describe("HIRE_ORDER_STARTER_TERMS", () => {
  it("ships two templates with platform-prefixed ids", () => {
    expect(HIRE_ORDER_STARTER_TERMS.map((t) => t.id)).toEqual([
      "platform-standard-engagement",
      "platform-guest-per-session",
    ]);
  });

  // The bare ids "lean" / "standard" / "full" are rewritten by the legacy branch in
  // normalizeTermsSetting, so a library id must never collide with them.
  it("uses no legacy template id", () => {
    const legacy = new Set(["lean", "standard", "full"]);
    for (const t of HIRE_ORDER_STARTER_TERMS) expect(legacy.has(t.id)).toBe(false);
  });

  it("gives every template at least one clause, each with a title and a body", () => {
    for (const t of HIRE_ORDER_STARTER_TERMS) {
      expect(t.clauses.length).toBeGreaterThan(0);
      for (const c of t.clauses) {
        expect(c.title.trim()).not.toBe("");
        expect(c.body.trim()).not.toBe("");
      }
    }
  });

  it("uses no em dash or en dash anywhere (house copy rule)", () => {
    const text = HIRE_ORDER_STARTER_TERMS
      .flatMap((t) => [t.name, ...t.clauses.flatMap((c) => [c.title, c.body])])
      .join(" ");
    expect(text).not.toMatch(/[–—]/);
  });
});
