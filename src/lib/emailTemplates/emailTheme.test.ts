import { describe, expect, it } from "vitest";
import {
  CATEGORY_TO_FAMILY,
  EMAIL_FAMILY_ACCENTS,
  EMAIL_THEME_DEFAULTS,
  compactEmailTheme,
  resolveEmailTheme,
} from "./emailTheme";

describe("resolveEmailTheme", () => {
  it("keeps the approved jewel-tone accents available to the shell", () => {
    expect(EMAIL_FAMILY_ACCENTS.violet).toEqual({
      from: "#4738B0", to: "#1E175A", glow: "#6E5FD0",
      solid: "#322685", buttonBg: "#4738B0",
    });
    expect(EMAIL_FAMILY_ACCENTS.ember).toMatchObject({
      from: "#883A24", to: "#3A1B14", solid: "#5F2A1C",
    });
    expect(EMAIL_FAMILY_ACCENTS.cyan).toMatchObject({
      from: "#0E5B73", to: "#062A38", solid: "#0B4154",
    });
    expect(EMAIL_FAMILY_ACCENTS.pine).toMatchObject({
      from: "#1C5A44", to: "#0B2820", solid: "#133F31",
    });
    expect(EMAIL_FAMILY_ACCENTS.steel).toMatchObject({
      from: "#3B3F63", to: "#191B2E", solid: "#2A2D48",
    });
  });

  it("merges a valid role override without changing the defaults", () => {
    const resolved = resolveEmailTheme({ roles: { heading: { size: 31 } } });

    expect(resolved.roles.heading.size).toBe(31);
    expect(resolved.roles.heading.color).toBe("heroText");
    expect(EMAIL_THEME_DEFAULTS.roles.heading.size).toBe(22);
  });

  it("uses only known palette references and validated base colors", () => {
    const resolved = resolveEmailTheme({
      base: { colors: { bodyText: "#123aBc", pageBg: "not-a-color" } },
      roles: { body: { color: "bodyText" }, footer: { color: "unknown" } },
    });

    expect(resolved.base.colors.bodyText).toBe("#123aBc");
    expect(resolved.base.colors.pageBg).toBe("#F6F4EF");
    expect(resolved.roles.body.color).toBe("bodyText");
    expect(resolved.roles.footer.color).toBe("faint");
  });

  it("falls back safely for malformed JSON and unsafe style values", () => {
    const malformed = resolveEmailTheme('{"roles":');
    const invalid = resolveEmailTheme({
      base: { buttonRadius: Number.POSITIVE_INFINITY },
      roles: {
        heading: { size: 0, weight: 300, transform: "rotate" },
        body: { letterSpacing: Number.NaN },
      },
    });

    expect(malformed).toEqual(EMAIL_THEME_DEFAULTS);
    expect(invalid.base.buttonRadius).toBe(8);
    expect(invalid.roles.heading).toEqual(EMAIL_THEME_DEFAULTS.roles.heading);
    expect(invalid.roles.body.letterSpacing).toBe(EMAIL_THEME_DEFAULTS.roles.body.letterSpacing);
  });
});

describe("compactEmailTheme", () => {
  it("removes hollow nested overrides while retaining meaningful values", () => {
    expect(compactEmailTheme({ base: {}, roles: { heading: {} } })).toEqual({});
    expect(compactEmailTheme({ roles: { button: { weight: 700 } } })).toEqual({
      roles: { button: { weight: 700 } },
    });
  });
});

describe("CATEGORY_TO_FAMILY", () => {
  it("maps every active email category to a valid family", () => {
    expect(CATEGORY_TO_FAMILY).toEqual({
      booking: "violet",
      escalation: "ember",
      casts: "cyan",
      hireOrder: "pine",
      security: "steel",
      invitation: "violet",
      system: "steel",
    });
  });
});
