import { describe, expect, it } from "vitest";
import resolveConfig from "tailwindcss/resolveConfig";
import type { Config } from "tailwindcss";
import tailwindConfig from "../tailwind.config";

/**
 * Tailwind derives utility classes from the KEYS of a theme scale, not just
 * from the scale's existence. A key that matches a name some OTHER utility
 * family already claims under the same class-name prefix emits a SECOND,
 * unrelated rule under the same class name, and whichever rule Tailwind
 * generates second wins the cascade. Silently.
 *
 * This is not hypothetical. Before this test existed, borderRadius keys `l`
 * (cards, 131 uses) and `s` (inputs, 31 uses) collided with Tailwind's own
 * `rounded-l` (round the LEFT side) and `rounded-s` (round the logical START
 * side) utilities, so every card rendered `4px 10px 10px 4px` and every input
 * rendered `4px 6px 6px 4px` for months, with no error anywhere.
 *
 * THE DISTINCTION THIS FILE ENCODES:
 *
 *  - Redefining a key that belongs to Tailwind's OWN scale for that same
 *    utility is a same-family OVERRIDE. One rule is emitted. It is SAFE and
 *    must never be flagged. `borderRadius.lg` replacing Tailwind's
 *    `rounded-lg` is deliberate here, for shadcn compatibility. So is
 *    `boxShadow.inner` or `boxShadow.none`: both are keys of Tailwind's own
 *    boxShadow scale, so redefining them replaces one value, it does not
 *    create a second rule.
 *
 *  - Using a key that a DIFFERENT utility family already claims under the
 *    same prefix is a COLLISION. Two rules, one class name. UNSAFE, flagged.
 *    `rounded-l` (borderRadius key `l` vs the side utility), `text-center`
 *    (fontSize key `center` vs the text-align utility), `shadow-primary`
 *    (boxShadow key `primary` vs the `shadow-<color>` utility from
 *    boxShadowColor), `text-card` (fontSize key `card` vs the `text-<color>`
 *    utility from textColor), `border-l` (colors key `l` vs the border side
 *    utility).
 *
 * SCALES GUARDED HERE: borderRadius, fontSize, boxShadow, colors.
 * Still unguarded, and judged low risk because their utility namespaces have
 * no static or directional siblings to collide with: fontFamily, screens,
 * keyframes, animation. Say so in docs/ui-conventions.md if that changes.
 *
 * The checks run against `resolveConfig`, the fully merged theme, so a key
 * added in replace mode (`theme.borderRadius`) is covered as well as one
 * added in extend mode (`theme.extend.borderRadius`). Merging is safe now
 * that same-family overrides are correctly exempted rather than dodged.
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
const RESERVED_TEXT_KEYS = new Set([
  "left", "center", "right", "justify",
  "start", "end",
  "wrap", "nowrap", "balance", "pretty",
  "ellipsis", "clip",
]);

/**
 * Colour names feed `bg-*`, `text-*`, `border-*`, `ring-*`, `shadow-*` and
 * more, so they inherit every one of those prefixes' static siblings. The two
 * that bite: the `border-*` side and logical suffixes, and the static
 * `text-*` utilities a colour would shadow exactly as a fontSize key does.
 */
const RESERVED_COLOR_KEYS = new Set([
  "t", "r", "b", "l", "x", "y", "s", "e",
  ...RESERVED_TEXT_KEYS,
]);

type Scale = Record<string, unknown>;

function resolvedTheme(config: Config): Record<string, Scale | undefined> {
  return resolveConfig(config).theme as unknown as Record<string, Scale | undefined>;
}

function scaleKeys(config: Config, namespace: string): string[] {
  return Object.keys(resolvedTheme(config)[namespace] ?? {});
}

/**
 * Tailwind flattens a nested colour object into dashed names, with `DEFAULT`
 * standing for the parent itself: `{ card: { DEFAULT, foreground } }` becomes
 * the colour names `card` and `card-foreground`.
 */
function flattenColorNames(value: Scale, prefix = ""): string[] {
  const names: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
    if (!name) continue;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      names.push(...flattenColorNames(child as Scale, name));
    } else {
      names.push(name);
    }
  }
  return names;
}

function colorNames(config: Config): string[] {
  return flattenColorNames(resolvedTheme(config).colors ?? {});
}

/**
 * A key like `t-lg` still emits `rounded-t-lg`, colliding with Tailwind's own
 * `rounded-t-lg` side utility, even though the whole key `t-lg` is not itself
 * in the reserved set. Split on the first dash and check the leading segment
 * too, for every namespace, not just radius.
 */
function findReservedCollisions(keys: string[], reserved: Set<string>): string[] {
  return keys.filter((key) => reserved.has(key.split("-")[0]));
}

/**
 * `boxShadow` renders as `shadow-<name>` and so does `boxShadowColor`;
 * `fontSize` renders as `text-<name>` and so does `textColor`. A key in
 * either scale whose whole name is also a resolved colour name emits two
 * rules under one class. Match the whole name, because colour names legally
 * contain dashes (`accent-500`, `card-foreground`).
 */
function findColorNameCollisions(keys: string[], colors: string[]): string[] {
  const colorSet = new Set(colors);
  return keys.filter((key) => colorSet.has(key));
}

/** Build a synthetic config so a probe never has to break the real one. */
function withTheme(overrides: NonNullable<Config["theme"]>): Config {
  const base = tailwindConfig as Config;
  return { ...base, theme: { ...base.theme, ...overrides } } as Config;
}

/** Build a synthetic config that adds keys the way the real one does. */
function withExtend(overrides: NonNullable<Config["theme"]>): Config {
  const base = tailwindConfig as Config;
  return {
    ...base,
    theme: { ...base.theme, extend: { ...base.theme?.extend, ...overrides } },
  } as Config;
}

const REAL = tailwindConfig as Config;

describe("design-system radius scale", () => {
  it("uses no key that collides with a Tailwind side or logical utility", () => {
    expect(findReservedCollisions(scaleKeys(REAL, "borderRadius"), RESERVED_RADIUS_KEYS)).toEqual([]);
  });

  it("catches a dashed key such as `t-lg` that a plain set-membership check would miss", () => {
    const probe = withExtend({ borderRadius: { "t-lg": "1px" } });
    expect(findReservedCollisions(scaleKeys(probe, "borderRadius"), RESERVED_RADIUS_KEYS)).toEqual([
      "t-lg",
    ]);
  });

  it("catches a replace-mode key, not only an extend-mode one", () => {
    // The historical bug's exact shape, written at `theme.borderRadius`
    // rather than `theme.extend.borderRadius`. Reading the raw extend object
    // would report zero collisions here; the merged theme catches it.
    const probe = withTheme({ borderRadius: { l: "1px", s: "2px" } });
    expect(findReservedCollisions(scaleKeys(probe, "borderRadius"), RESERVED_RADIUS_KEYS)).toEqual([
      "l",
      "s",
    ]);
  });

  it("exposes the full semantic scale", () => {
    const radii = scaleKeys(REAL, "borderRadius");
    for (const key of ["chip", "field", "control", "card", "icon", "pill"]) {
      expect(radii).toContain(key);
    }
  });

  it("points every semantic key at its design token", () => {
    const radii = resolvedTheme(REAL).borderRadius ?? {};
    expect(radii.chip).toBe("var(--radius-xs)");
    expect(radii.field).toBe("var(--radius-s)");
    expect(radii.control).toBe("var(--radius-m)");
    expect(radii.card).toBe("var(--radius-l)");
    expect(radii.icon).toBe("var(--radius-xxl)");
    expect(radii.pill).toBe("var(--radius-pill)");
  });

  it("has no hero step, retired on 2026-08-24 in favour of one card radius", () => {
    const radii = resolvedTheme(REAL).borderRadius ?? {};
    expect(Object.keys(radii)).not.toContain("hero");
    expect(Object.values(radii)).not.toContain("var(--radius-xl)");
  });

  it("does not flag the deliberate shadcn-compat overrides lg, md, sm", () => {
    // These replace Tailwind's own radius values under the same class name
    // (one utility family, one rule) and are intentional. Confirms the
    // reserved list itself, not just the current config, treats them as safe.
    expect(findReservedCollisions(["lg", "md", "sm"], RESERVED_RADIUS_KEYS)).toEqual([]);
    const probe = withTheme({ borderRadius: { lg: "1px", md: "2px", sm: "3px" } });
    expect(findReservedCollisions(scaleKeys(probe, "borderRadius"), RESERVED_RADIUS_KEYS)).toEqual([]);
  });
});

describe("design-system type scale", () => {
  it("uses no key that collides with a static Tailwind text utility", () => {
    expect(findReservedCollisions(scaleKeys(REAL, "fontSize"), RESERVED_TEXT_KEYS)).toEqual([]);
  });

  it("uses no key that collides with a colour name", () => {
    expect(findColorNameCollisions(scaleKeys(REAL, "fontSize"), colorNames(REAL))).toEqual([]);
  });

  it("catches a static text-utility name injected into a synthetic scale", () => {
    const probe = withExtend({ fontSize: { center: "13px" } });
    expect(findReservedCollisions(scaleKeys(probe, "fontSize"), RESERVED_TEXT_KEYS)).toEqual([
      "center",
    ]);
  });

  it("catches a fontSize key named after a colour, which `text-*` also renders", () => {
    // `card` is already a colour token here (bg-card, text-card-foreground),
    // so a fontSize key of the same name would emit both
    // `.text-card{font-size}` and `.text-card{color}`.
    const probe = withExtend({ fontSize: { card: "13px" } });
    expect(findColorNameCollisions(scaleKeys(probe, "fontSize"), colorNames(probe))).toEqual([
      "card",
    ]);
  });

  it("does not flag a same-family override of Tailwind's own type scale", () => {
    const probe = withExtend({ fontSize: { sm: "13px", lg: "17px", base: "14px" } });
    expect(findReservedCollisions(scaleKeys(probe, "fontSize"), RESERVED_TEXT_KEYS)).toEqual([]);
    expect(findColorNameCollisions(scaleKeys(probe, "fontSize"), colorNames(probe))).toEqual([]);
  });
});

describe("design-system shadow scale", () => {
  it("uses no key that collides with a colour name", () => {
    expect(findColorNameCollisions(scaleKeys(REAL, "boxShadow"), colorNames(REAL))).toEqual([]);
  });

  it("catches a boxShadow key named after a colour, which `shadow-*` also renders", () => {
    // boxShadowColor renders as `shadow-<colour>` (shadow-primary,
    // shadow-accent-500), so these are two rules under one class name.
    const probe = withExtend({ boxShadow: { primary: "0 0 0 1px red", "accent-500": "none" } });
    expect(findColorNameCollisions(scaleKeys(probe, "boxShadow"), colorNames(probe))).toEqual([
      "primary",
      "accent-500",
    ]);
  });

  it("does not flag `inner` or `none`, which are Tailwind's own boxShadow keys", () => {
    // Redefining either replaces one value in the same utility family. It is
    // a same-family override, exactly like borderRadius.lg, and safe.
    const probe = withExtend({ boxShadow: { inner: "0 0 0 1px red", none: "none" } });
    expect(findColorNameCollisions(scaleKeys(probe, "boxShadow"), colorNames(probe))).toEqual([]);
  });
});

describe("design-system colour scale", () => {
  it("uses no name that collides with a border side or static text utility", () => {
    expect(findReservedCollisions(colorNames(REAL), RESERVED_COLOR_KEYS)).toEqual([]);
  });

  it("catches a colour named after a border side utility", () => {
    const probe = withExtend({ colors: { l: "#fff", x: "#000" } });
    expect(findReservedCollisions(colorNames(probe), RESERVED_COLOR_KEYS)).toEqual(["l", "x"]);
  });

  it("catches a colour named after a static text utility", () => {
    const probe = withExtend({ colors: { center: "#fff" } });
    expect(findReservedCollisions(colorNames(probe), RESERVED_COLOR_KEYS)).toEqual(["center"]);
  });

  it("does not flag a same-family override of a Tailwind palette colour", () => {
    const probe = withExtend({ colors: { red: { 500: "#f00" }, white: "#fff" } });
    expect(findReservedCollisions(colorNames(probe), RESERVED_COLOR_KEYS)).toEqual([]);
  });
});
