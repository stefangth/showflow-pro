import { describe, expect, it } from "vitest";
import {
  familiesInUse,
  HIRE_ORDER_THEME_DEFAULTS,
  MONO_ROLE_KEYS,
  resolveHireOrderTheme,
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
