import { describe, expect, it } from "vitest";
import {
  familiesInUse,
  FONT_FAMILIES,
  HIRE_ORDER_THEME_DEFAULTS,
  MONO_ROLE_KEYS,
  resolveHireOrderTheme,
  safeReactPdfFamilyName,
  selectableFontFamilies,
  THEME_ROLE_KEYS,
  themeRoleStyle,
} from "./pdfTheme";

// The six roles whose default typeface is the mono family. Spelled out here
// rather than imported as a computed value, so this test file pins the exact
// membership independently of how MONO_ROLE_KEYS is implemented.
const MONO_ROLES = [
  "orderNumber",
  "factValueMono",
  "tableCellMono",
  "feeValue",
  "totalValue",
  "clauseNumber",
] as const;

describe("resolveHireOrderTheme", () => {
  it("returns the defaults when there are no overrides", () => {
    expect(resolveHireOrderTheme()).toEqual(HIRE_ORDER_THEME_DEFAULTS);
    expect(resolveHireOrderTheme(null)).toEqual(HIRE_ORDER_THEME_DEFAULTS);
  });

  it("does not mutate the defaults", () => {
    const resolved = resolveHireOrderTheme({ base: { scale: 1.2 } });
    resolved.base.colors.text = "#000000";
    expect(HIRE_ORDER_THEME_DEFAULTS.base.colors.text).toBe("#15131C");
  });

  it("merges a single role override without dropping the others", () => {
    const resolved = resolveHireOrderTheme({ roles: { sectionHeading: { size: 20 } } });
    expect(resolved.roles.sectionHeading.size).toBe(20);
    expect(resolved.roles.artistName.size).toBe(HIRE_ORDER_THEME_DEFAULTS.roles.artistName.size);
  });

  it("clamps scale to [0.75, 1.5]", () => {
    expect(resolveHireOrderTheme({ base: { scale: 9 } }).base.scale).toBe(1.5);
    expect(resolveHireOrderTheme({ base: { scale: 0 } }).base.scale).toBe(0.75);
  });

  it("clamps a role size to [5, 60]", () => {
    expect(resolveHireOrderTheme({ roles: { notes: { size: 400 } } }).roles.notes.size).toBe(60);
    expect(resolveHireOrderTheme({ roles: { notes: { size: 1 } } }).roles.notes.size).toBe(5);
  });

  it("clamps letterSpacing and page margins", () => {
    expect(resolveHireOrderTheme({ roles: { notes: { letterSpacing: 99 } } }).roles.notes.letterSpacing).toBe(8);
    expect(resolveHireOrderTheme({ base: { page: { marginX: 300 } } }).base.page.marginX).toBe(80);
    expect(resolveHireOrderTheme({ base: { page: { marginTop: 1 } } }).base.page.marginTop).toBe(20);
  });

  it("falls back on a malformed colour but keeps the valid ones", () => {
    const resolved = resolveHireOrderTheme({
      base: { colors: { text: "not-a-colour", accent: "#FF0000" } },
    });
    expect(resolved.base.colors.text).toBe(HIRE_ORDER_THEME_DEFAULTS.base.colors.text);
    expect(resolved.base.colors.accent).toBe("#FF0000");
  });

  it("falls back on an unknown font family key", () => {
    expect(resolveHireOrderTheme({ base: { fontFamily: "comic" } }).base.fontFamily).toBe("geist");
  });

  it("falls back on an unknown role colour key", () => {
    const resolved = resolveHireOrderTheme({ roles: { notes: { color: "chartreuse" } } });
    expect(resolved.roles.notes.color).toBe(HIRE_ORDER_THEME_DEFAULTS.roles.notes.color);
  });

  it("ignores an unknown role key", () => {
    const resolved = resolveHireOrderTheme({ roles: { nonsense: { size: 12 } } });
    expect("nonsense" in resolved.roles).toBe(false);
  });
});

describe("themeRoleStyle", () => {
  it("multiplies the role size by the base scale and rounds to 2dp", () => {
    const theme = resolveHireOrderTheme({ base: { scale: 1.5 } });
    expect(themeRoleStyle(theme, "sectionHeading").fontSize).toBe(18);
  });

  it("resolves a role colour key to its hex value", () => {
    const theme = resolveHireOrderTheme({ base: { colors: { faint: "#ABCDEF" } } });
    expect(themeRoleStyle(theme, "partyLabel").color).toBe("#ABCDEF");
  });

  it("clamps the scaled size, so scale cannot bypass the size ceiling", () => {
    const theme = resolveHireOrderTheme({ base: { scale: 1.5 }, roles: { watermark: { size: 60 } } });
    expect(themeRoleStyle(theme, "watermark").fontSize).toBe(60);
  });
});

describe("role registry", () => {
  it("lists every role in the defaults exactly once", () => {
    expect([...THEME_ROLE_KEYS].sort()).toEqual(Object.keys(HIRE_ORDER_THEME_DEFAULTS.roles).sort());
    expect(new Set(THEME_ROLE_KEYS).size).toBe(THEME_ROLE_KEYS.length);
  });

  it("MONO_ROLE_KEYS names exactly the six mono-default roles", () => {
    expect([...MONO_ROLE_KEYS].sort()).toEqual([...MONO_ROLES].sort());
  });
});

describe("themeRoleStyle mono family fallback", () => {
  // Regression guard: this must already be true today (the six roles
  // currently hardcode family: "geist-mono"), and must stay true once that
  // hardcoding is replaced by a base.monoFamily fallback, because
  // base.monoFamily itself defaults to "geist-mono". A default-theme render
  // must stay byte-identical to the pre-theme output either way.
  it("resolves each mono role to GeistMono under the default theme", () => {
    const theme = resolveHireOrderTheme();
    for (const role of MONO_ROLES) {
      expect(themeRoleStyle(theme, role).fontFamily).toBe("GeistMono");
    }
  });

  it("resolves a sans role to Geist under the default theme", () => {
    const theme = resolveHireOrderTheme();
    expect(themeRoleStyle(theme, "sectionHeading").fontFamily).toBe("Geist");
  });

  it("a changed base.monoFamily changes the mono roles but leaves sans roles alone", () => {
    const theme = resolveHireOrderTheme({ base: { monoFamily: "plex-mono" } });
    for (const role of MONO_ROLES) {
      expect(themeRoleStyle(theme, role).fontFamily).toBe("PlexMono");
    }
    expect(themeRoleStyle(theme, "sectionHeading").fontFamily).toBe("Geist");
  });

  it("a changed base.fontFamily changes sans roles but leaves the mono roles alone", () => {
    const theme = resolveHireOrderTheme({ base: { fontFamily: "inter" } });
    expect(themeRoleStyle(theme, "sectionHeading").fontFamily).toBe("Inter");
    for (const role of MONO_ROLES) {
      expect(themeRoleStyle(theme, role).fontFamily).toBe("GeistMono");
    }
  });

  it("a per-role family override wins over both base families", () => {
    const theme = resolveHireOrderTheme({
      base: { fontFamily: "inter", monoFamily: "plex-mono" },
      roles: { totalValue: { family: "source-serif" } },
    });
    expect(themeRoleStyle(theme, "totalValue").fontFamily).toBe("SourceSerif");
  });
});

describe("familiesInUse", () => {
  it("the default theme uses only geist and geist-mono", () => {
    expect(familiesInUse(resolveHireOrderTheme()).map((f) => f.key).sort()).toEqual([
      "geist",
      "geist-mono",
    ]);
  });

  it("a changed base.monoFamily is included, because the mono roles now actually apply it", () => {
    const theme = resolveHireOrderTheme({ base: { monoFamily: "plex-mono" } });
    expect(familiesInUse(theme).map((f) => f.key).sort()).toEqual(["geist", "plex-mono"]);
  });

  it("a per-role family override is included", () => {
    const theme = resolveHireOrderTheme({ roles: { totalValue: { family: "source-serif" } } });
    expect(familiesInUse(theme).map((f) => f.key)).toContain("source-serif");
  });
});

// safeReactPdfFamilyName's degradation logic is exercised end-to-end (through
// a real registerFonts failure) by supabase/functions/_shared/hire-order-pdf/
// pdfDeps.test.ts on the edge runtime; these are the pure-function unit cases
// for the same code (pdfTheme.ts is dual-homed and byte-identical there).
describe("safeReactPdfFamilyName", () => {
  it("resolves a family that IS available to its real react-pdf family name", () => {
    expect(safeReactPdfFamilyName("inter", new Set(["inter"]))).toBe("Inter");
  });

  it("falls back to Helvetica for an unavailable sans family", () => {
    expect(safeReactPdfFamilyName("plex-sans", new Set())).toBe("Helvetica");
  });

  it("falls back to Courier for an unavailable mono family", () => {
    expect(safeReactPdfFamilyName("plex-mono", new Set())).toBe("Courier");
  });

  it("falls back to Times-Roman, not Helvetica, for an unavailable serif family", () => {
    expect(safeReactPdfFamilyName("source-serif", new Set())).toBe("Times-Roman");
    expect(safeReactPdfFamilyName("libre-baskerville", new Set())).toBe("Times-Roman");
  });

  it("defaults `available` to every registered key, so an omitted argument resolves normally", () => {
    expect(safeReactPdfFamilyName("plex-mono")).toBe("PlexMono");
  });
});

describe("FONT_FAMILIES registry", () => {
  it("every family declares at least one weight file and a unique react-pdf family name", () => {
    const names = FONT_FAMILIES.map((f) => f.family);
    expect(new Set(names).size).toBe(names.length);
    for (const def of FONT_FAMILIES) {
      expect(def.files.length).toBeGreaterThan(0);
    }
  });

  it("libre-baskerville has three distinct weight files (not a duplicated Bold standing in for 500/600)", () => {
    const def = FONT_FAMILIES.find((f) => f.key === "libre-baskerville")!;
    const paths = def.files.map((f) => f.path);
    expect(new Set(paths).size).toBe(3);
  });

  it("source-serif's weight 500 reuses the Regular file, because Adobe's static release has no discrete Medium cut", () => {
    const def = FONT_FAMILIES.find((f) => f.key === "source-serif")!;
    const byWeight = Object.fromEntries(def.files.map((f) => [f.weight, f.path]));
    expect(byWeight[500]).toBe(byWeight[400]);
    expect(byWeight[600]).not.toBe(byWeight[400]);
  });
});

describe("selectableFontFamilies", () => {
  it("returns exactly the two embedded design-system families today", () => {
    expect(selectableFontFamilies().map((f) => f.key).sort()).toEqual([
      "geist",
      "geist-mono",
    ]);
  });

  it("every selectable family is embedded, so a picker choice can never fail to load", () => {
    for (const def of selectableFontFamilies()) {
      expect(def.embedded).toBe(true);
    }
  });

  it("excludes every family still awaiting a font upload", () => {
    for (const def of selectableFontFamilies()) {
      expect(def.pendingUpload).toBeFalsy();
    }
  });

  it("FONT_FAMILIES itself is untouched: all seven entries remain, five pending", () => {
    expect(FONT_FAMILIES).toHaveLength(7);
    expect(FONT_FAMILIES.filter((f) => f.pendingUpload)).toHaveLength(5);
  });
});

describe("resolveHireOrderTheme accepts a pending family", () => {
  it("a stored base.fontFamily pointing at a pendingUpload family still resolves to it, not the default", () => {
    const pending = FONT_FAMILIES.find((f) => f.pendingUpload);
    expect(pending).toBeDefined();
    const theme = resolveHireOrderTheme({ base: { fontFamily: pending!.key } });
    expect(theme.base.fontFamily).toBe(pending!.key);
    expect(theme.base.fontFamily).not.toBe(HIRE_ORDER_THEME_DEFAULTS.base.fontFamily);
  });

  it("a stored per-role family override pointing at a pendingUpload family still resolves and is included by familiesInUse", () => {
    const pending = FONT_FAMILIES.find((f) => f.pendingUpload)!;
    const theme = resolveHireOrderTheme({ roles: { totalValue: { family: pending.key } } });
    expect(theme.roles.totalValue.family).toBe(pending.key);
    expect(familiesInUse(theme).map((f) => f.key)).toContain(pending.key);
  });
});
