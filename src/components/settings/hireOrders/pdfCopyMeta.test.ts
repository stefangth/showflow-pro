import { describe, expect, it } from "vitest";
import { HIRE_ORDER_COPY_DEFAULTS, type CopyKey } from "@/lib/hireOrders/pdf/pdfCopy";
import { COPY_SECTIONS, hasBadDash } from "./pdfCopyMeta";

describe("COPY_SECTIONS", () => {
  it("covers every CopyKey exactly once", () => {
    const keys = COPY_SECTIONS.flatMap((s) => s.fields.map((f) => f.key)).sort();
    const all = (Object.keys(HIRE_ORDER_COPY_DEFAULTS) as CopyKey[]).sort();
    expect(keys).toEqual(all);
    expect(new Set(keys).size).toBe(keys.length); // no dupes
  });

  it("declares only tokens that actually appear in the default template", () => {
    for (const s of COPY_SECTIONS) {
      for (const f of s.fields) {
        for (const t of f.tokens) {
          expect(HIRE_ORDER_COPY_DEFAULTS[f.key]).toContain(`{{${t}}}`);
        }
      }
    }
  });

  it("gives every field a non-empty label", () => {
    for (const s of COPY_SECTIONS) {
      expect(s.title.length).toBeGreaterThan(0);
      for (const f of s.fields) expect(f.label.length).toBeGreaterThan(0);
    }
  });
});

describe("hasBadDash", () => {
  it("flags em and en dashes", () => {
    expect(hasBadDash("a — b")).toBe(true);
    expect(hasBadDash("a – b")).toBe(true);
  });
  it("passes middot / hyphen / plain copy", () => {
    expect(hasBadDash("a · b")).toBe(false);
    expect(hasBadDash("a - b")).toBe(false);
    expect(hasBadDash("Terms & conditions")).toBe(false);
  });
});
