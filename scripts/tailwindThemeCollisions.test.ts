import { describe, expect, it } from "vitest";
import tailwindConfig from "../tailwind.config";

/**
 * Custom scale keys live under `theme.extend.<namespace>`. Checking the raw
 * extend object, rather than `resolveConfig`'s fully merged theme, matters
 * for correctness: Tailwind's own defaults for `boxShadow` already include
 * `inner` and `none`, so a merged theme would always show those keys as
 * "present" regardless of anything this project defines, producing a false
 * positive. The extend object holds only what this project actually adds.
 */
function extendScale(namespace: "borderRadius" | "fontSize" | "boxShadow"): Record<string, unknown> {
  const extend = tailwindConfig.theme?.extend as Record<string, Record<string, unknown>> | undefined;
  return extend?.[namespace] ?? {};
}

/**
 * Tailwind derives utility classes from the KEYS of a custom theme scale, not
 * just from the scale's existence. A custom scale key that happens to match a
 * name Tailwind already uses in that utility's namespace can emit a SECOND,
 * unrelated rule under the same class name, and whichever rule Tailwind
 * generates second wins the cascade.
 *
 * This is not hypothetical. Before this test existed, borderRadius keys `l`
 * (cards, 131 uses) and `s` (inputs, 31 uses) collided with Tailwind's own
 * `rounded-l` (round the LEFT side) and `rounded-s` (round the logical START
 * side) utilities, so every card rendered `4px 10px 10px 4px` and every input
 * rendered `4px 6px 6px 4px` for months, with no error anywhere.
 *
 * The same trap exists for any custom scale whose key duplicates a name
 * Tailwind already uses in that utility namespace: a `fontSize` key named
 * `center` would break `text-center` identically. This file checks every
 * custom scale this project extends against a per-namespace reserved list.
 *
 * IMPORTANT: deliberately OVERRIDING a built-in key is fine and must not
 * fail here. `borderRadius` intentionally defines `lg`, `md`, `sm` for
 * shadcn compatibility: those replace Tailwind's own radius values under the
 * same class name, emitting one rule for one utility family, which is safe.
 * The bug only occurs when a key generates a DIFFERENT utility family than
 * the base `rounded-`/`text-`/`shadow-` utility, which is exactly what the
 * reserved lists below capture. `lg`/`md`/`sm` are not in the borderRadius
 * reserved list, so they are never flagged.
 *
 * Keep design-system keys as whole words that do not appear in these lists.
 * Never single letters.
 */

/** Tailwind's side, corner and logical-property radius suffixes. */
const RESERVED_RADIUS_KEYS = new Set([
  "t", "r", "b", "l",
  "tl", "tr", "br", "bl",
  "s", "e",
  "ss", "se", "es", "ee",
]);

/** The static (non-numeric) `text-*` utilities a fontSize key would shadow. */
const RESERVED_FONT_SIZE_KEYS = new Set([
  "left", "center", "right", "justify",
  "start", "end",
  "wrap", "nowrap", "balance", "pretty",
  "ellipsis", "clip",
]);

/** The static `shadow-*` utilities a boxShadow key would shadow. */
const RESERVED_BOX_SHADOW_KEYS = new Set(["inner", "none"]);

/**
 * A key like `t-lg` still emits `rounded-t-lg`, colliding with Tailwind's own
 * `rounded-t-lg` side utility, even though the whole key `t-lg` is not itself
 * in the reserved set. Split on the first dash and check the leading segment
 * too, for every namespace, not just radius.
 */
function findReservedCollisions(keys: string[], reserved: Set<string>): string[] {
  return keys.filter((key) => reserved.has(key.split("-")[0]));
}

describe("design-system radius scale", () => {
  const radii = extendScale("borderRadius");

  it("uses no key that collides with a Tailwind side or logical utility", () => {
    expect(findReservedCollisions(Object.keys(radii), RESERVED_RADIUS_KEYS)).toEqual([]);
  });

  it("catches a dashed key such as `t-lg` that a plain set-membership check would miss", () => {
    const probeRadii: Record<string, string> = { ...radii, "t-lg": "1px" };
    expect(findReservedCollisions(Object.keys(probeRadii), RESERVED_RADIUS_KEYS)).toEqual([
      "t-lg",
    ]);
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

  it("does not flag the deliberate shadcn-compat overrides lg, md, sm", () => {
    // These replace Tailwind's own radius values under the same class name
    // (one utility family, one rule) and are intentional. Confirms the
    // reserved list itself, not just the current config, treats them as safe.
    expect(RESERVED_RADIUS_KEYS.has("lg")).toBe(false);
    expect(RESERVED_RADIUS_KEYS.has("md")).toBe(false);
    expect(RESERVED_RADIUS_KEYS.has("sm")).toBe(false);
    expect(findReservedCollisions(["lg", "md", "sm"], RESERVED_RADIUS_KEYS)).toEqual([]);
  });
});

describe("design-system type scale", () => {
  const sizes = extendScale("fontSize");

  it("uses no key that collides with a static Tailwind text utility", () => {
    expect(findReservedCollisions(Object.keys(sizes), RESERVED_FONT_SIZE_KEYS)).toEqual([]);
  });

  it("catches a bad key injected into a synthetic scale", () => {
    // Injected rather than added to the real scale: this scale is safe
    // today, and the test must prove the check works, not break the config.
    const probeSizes = { ...sizes, center: "13px" };
    expect(findReservedCollisions(Object.keys(probeSizes), RESERVED_FONT_SIZE_KEYS)).toEqual([
      "center",
    ]);
  });
});

describe("design-system shadow scale", () => {
  const shadows = extendScale("boxShadow");

  it("uses no key that collides with a static Tailwind shadow utility", () => {
    expect(findReservedCollisions(Object.keys(shadows), RESERVED_BOX_SHADOW_KEYS)).toEqual([]);
  });

  it("catches a bad key injected into a synthetic scale", () => {
    const probeShadows = { ...shadows, none: "0 0 0 1px red" };
    expect(findReservedCollisions(Object.keys(probeShadows), RESERVED_BOX_SHADOW_KEYS)).toEqual([
      "none",
    ]);
  });
});
