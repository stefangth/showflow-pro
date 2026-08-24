import { describe, expect, it } from "vitest";
import resolveConfig from "tailwindcss/resolveConfig";
import tailwindConfig from "../tailwind.config";

/**
 * Tailwind generates side, corner and logical-property radius utilities from
 * these suffixes: rounded-t, rounded-bl, rounded-s and so on. A custom
 * borderRadius key that reuses one of them emits a SECOND rule with the same
 * class name, and Tailwind's rule wins the cascade on the corners it sets.
 *
 * This is not hypothetical. Before this test existed, `l` (cards, 131 uses) and
 * `s` (inputs, 31 uses) both collided, so every card rendered
 * `4px 10px 10px 4px` and every input rendered `4px 6px 6px 4px`.
 *
 * Keep design-system keys as whole words. Never single letters.
 */
const RESERVED_RADIUS_SUFFIXES = new Set([
  "t", "r", "b", "l",
  "tl", "tr", "br", "bl",
  "s", "e",
  "ss", "se", "es", "ee",
]);

describe("design-system radius scale", () => {
  const radii = resolveConfig(tailwindConfig).theme?.borderRadius ?? {};

  it("uses no key that collides with a Tailwind side or logical utility", () => {
    const collisions = Object.keys(radii).filter((key) =>
      RESERVED_RADIUS_SUFFIXES.has(key),
    );
    expect(collisions).toEqual([]);
  });

  it("exposes the full semantic scale", () => {
    for (const key of ["chip", "field", "control", "card", "icon", "pill"]) {
      expect(Object.keys(radii)).toContain(key);
    }
  });

  it("points every semantic key at its design token", () => {
    expect(radii.chip).toBe("var(--radius-xs)");
    expect(radii.field).toBe("var(--radius-s)");
    expect(radii.control).toBe("var(--radius-m)");
    expect(radii.card).toBe("var(--radius-l)");
    expect(radii.icon).toBe("var(--radius-xxl)");
    expect(radii.pill).toBe("var(--radius-pill)");
  });

  it("has no hero step, retired on 2026-08-24 in favour of one card radius", () => {
    expect(Object.keys(radii)).not.toContain("hero");
    expect(Object.values(radii)).not.toContain("var(--radius-xl)");
  });
});
