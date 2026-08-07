// GENERATED FILE. Do not edit.
// Source: src/lib/emailTemplates/emailTheme.ts
// Regenerate: npm run sync:mirrors
// Editable transactional-email theme. This file stays free of React Email
// imports so the browser editor and Deno edge runtime can share one validated
// settings contract.
//
// DUAL-HOME PAIR: src/lib/emailTemplates/emailTheme.ts generates
// supabase/functions/_shared/transactional-email-templates/_shell/emailTheme.ts.
// Edit this source, then run `npm run sync:mirrors`; never edit the target.

export type EmailFamily = "violet" | "ember" | "cyan" | "pine" | "steel";

export type EmailRoleKey =
  | "header"
  | "heading"
  | "subheading"
  | "body"
  | "dataLabel"
  | "dataValue"
  | "button"
  | "footer";

export type EmailThemeColorKey =
  | "heroText"
  | "heroSub"
  | "bodyText"
  | "muted"
  | "faint"
  | "accent"
  | "line"
  | "tileBg"
  | "buttonBg"
  | "buttonText"
  | "cardBg"
  | "pageBg";

export type EmailFontKind = "body" | "heading";
export type EmailTextTransform = "none" | "uppercase";
export type EmailFontWeight = 400 | 500 | 600 | 700;

export interface EmailRoleStyle {
  family?: EmailFontKind;
  size?: number;
  weight?: EmailFontWeight;
  color?: EmailThemeColorKey;
  letterSpacing?: number;
  transform?: EmailTextTransform;
}

export interface EmailThemeBase {
  colors: Record<EmailThemeColorKey, string>;
  bodyFamily: string;
  headingFamily: string;
  buttonRadius: number;
  footerText: string;
}

export interface EmailTheme {
  base: EmailThemeBase;
  roles: Record<EmailRoleKey, EmailRoleStyle>;
}

/** The untrusted JSON shape stored in app_settings. */
export interface EmailThemeOverride {
  base?: {
    colors?: Partial<Record<string, unknown>>;
    bodyFamily?: unknown;
    headingFamily?: unknown;
    buttonRadius?: unknown;
    footerText?: unknown;
  };
  roles?: Record<string, {
    family?: unknown;
    size?: unknown;
    weight?: unknown;
    color?: unknown;
    letterSpacing?: unknown;
    transform?: unknown;
  }>;
}

export interface EmailFamilyAccent {
  from: string;
  to: string;
  glow: string;
  solid: string;
  buttonBg: string;
}

export const EMAIL_FAMILY_ACCENTS: Record<EmailFamily, EmailFamilyAccent> = {
  violet: { from: "#4738B0", to: "#1E175A", glow: "#6E5FD0", solid: "#322685", buttonBg: "#4738B0" },
  ember: { from: "#883A24", to: "#3A1B14", glow: "#C8633A", solid: "#5F2A1C", buttonBg: "#883A24" },
  cyan: { from: "#0E5B73", to: "#062A38", glow: "#0891B2", solid: "#0B4154", buttonBg: "#0E5B73" },
  pine: { from: "#1C5A44", to: "#0B2820", glow: "#3D9E73", solid: "#133F31", buttonBg: "#1C5A44" },
  steel: { from: "#3B3F63", to: "#191B2E", glow: "#747CB6", solid: "#2A2D48", buttonBg: "#3B3F63" },
};

/** Families are assigned by the live template inventory's domain category. */
export const CATEGORY_TO_FAMILY = {
  booking: "violet",
  escalation: "ember",
  casts: "cyan",
  hireOrder: "pine",
  security: "steel",
  invitation: "violet",
  system: "steel",
} as const satisfies Record<string, EmailFamily>;

const SYSTEM_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const EMAIL_THEME_DEFAULTS: EmailTheme = {
  base: {
    colors: {
      heroText: "#FFFFFF",
      heroSub: "#CDC3FF",
      bodyText: "#4B4952",
      muted: "#5B5A57",
      faint: "#9A98A3",
      accent: "#4738B0",
      line: "#ECECF0",
      tileBg: "#FAF8F4",
      buttonBg: "#4738B0",
      buttonText: "#FFFFFF",
      cardBg: "#FFFFFF",
      pageBg: "#F6F4EF",
    },
    bodyFamily: `"Geist", ${SYSTEM_STACK}`,
    headingFamily: `"Geist", ${SYSTEM_STACK}`,
    buttonRadius: 8,
    footerText: "The ShowFlow team",
  },
  roles: {
    header: { family: "heading", size: 13, weight: 600, color: "heroText" },
    heading: { family: "heading", size: 22, weight: 600, color: "heroText", letterSpacing: -0.4 },
    subheading: { family: "body", size: 12.5, weight: 400, color: "heroSub" },
    body: { family: "body", size: 14, weight: 400, color: "bodyText" },
    dataLabel: { family: "body", size: 9, weight: 700, color: "faint", letterSpacing: 0.6, transform: "uppercase" },
    dataValue: { family: "body", size: 12.5, weight: 500, color: "bodyText" },
    button: { family: "body", size: 14, weight: 600, color: "buttonText" },
    footer: { family: "body", size: 11.5, weight: 400, color: "faint" },
  },
};

export const EMAIL_ROLE_KEYS = Object.keys(EMAIL_THEME_DEFAULTS.roles) as EmailRoleKey[];
export const EMAIL_THEME_COLOR_KEYS = Object.keys(EMAIL_THEME_DEFAULTS.base.colors) as EmailThemeColorKey[];

const HEX = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOverride(value: unknown): EmailThemeOverride {
  if (typeof value === "string") {
    try {
      return parseOverride(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value as EmailThemeOverride : {};
}

function positiveFinite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function finite(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isColorKey(value: unknown): value is EmailThemeColorKey {
  return typeof value === "string" && EMAIL_THEME_COLOR_KEYS.includes(value as EmailThemeColorKey);
}

function isFontKind(value: unknown): value is EmailFontKind {
  return value === "body" || value === "heading";
}

function isWeight(value: unknown): value is EmailFontWeight {
  return value === 400 || value === 500 || value === 600 || value === 700;
}

function isTransform(value: unknown): value is EmailTextTransform {
  return value === "none" || value === "uppercase";
}

function nonBlankString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

/**
 * Resolves potentially hand-edited app-setting JSON into a complete safe theme.
 * It always creates fresh nested values, so callers cannot mutate the defaults.
 */
export function resolveEmailTheme(override?: EmailThemeOverride | string | null): EmailTheme {
  const input = parseOverride(override);
  const baseOverride = isRecord(input.base) ? input.base : {};
  const inputColors = isRecord(baseOverride.colors) ? baseOverride.colors : {};
  const colors = {} as Record<EmailThemeColorKey, string>;

  for (const key of EMAIL_THEME_COLOR_KEYS) {
    const candidate = inputColors[key];
    colors[key] = typeof candidate === "string" && HEX.test(candidate)
      ? candidate
      : EMAIL_THEME_DEFAULTS.base.colors[key];
  }

  const inputRoles = isRecord(input.roles) ? input.roles : {};
  const roles = {} as Record<EmailRoleKey, EmailRoleStyle>;
  for (const key of EMAIL_ROLE_KEYS) {
    const defaults = EMAIL_THEME_DEFAULTS.roles[key];
    const candidate = isRecord(inputRoles[key]) ? inputRoles[key] : {};
    roles[key] = {
      family: isFontKind(candidate.family) ? candidate.family : defaults.family,
      size: positiveFinite(candidate.size, defaults.size ?? 14),
      weight: isWeight(candidate.weight) ? candidate.weight : defaults.weight,
      color: isColorKey(candidate.color) ? candidate.color : defaults.color,
      letterSpacing: finite(candidate.letterSpacing, defaults.letterSpacing),
      transform: isTransform(candidate.transform) ? candidate.transform : defaults.transform,
    };
  }

  return {
    base: {
      colors,
      bodyFamily: nonBlankString(baseOverride.bodyFamily, EMAIL_THEME_DEFAULTS.base.bodyFamily),
      headingFamily: nonBlankString(baseOverride.headingFamily, EMAIL_THEME_DEFAULTS.base.headingFamily),
      buttonRadius: positiveFinite(baseOverride.buttonRadius, EMAIL_THEME_DEFAULTS.base.buttonRadius),
      footerText: nonBlankString(baseOverride.footerText, EMAIL_THEME_DEFAULTS.base.footerText),
    },
    roles,
  };
}

/** Remove empty nested maps before persisting an editor draft. */
export function compactEmailTheme(draft?: EmailThemeOverride | null): EmailThemeOverride {
  if (!draft || !isRecord(draft)) return {};
  const out: EmailThemeOverride = {};
  if (isRecord(draft.base) && Object.keys(draft.base).length > 0) {
    const base = { ...draft.base };
    if (isRecord(base.colors) && Object.keys(base.colors).length === 0) delete base.colors;
    if (Object.keys(base).length > 0) out.base = base;
  }
  if (isRecord(draft.roles)) {
    const roles: Record<string, EmailThemeOverride["roles"] extends Record<string, infer T> ? T : never> = {};
    for (const [key, value] of Object.entries(draft.roles)) {
      if (isRecord(value) && Object.keys(value).length > 0) roles[key] = { ...value };
    }
    if (Object.keys(roles).length > 0) out.roles = roles;
  }
  return out;
}
