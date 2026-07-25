// Editable hire-order PDF theme. Every typographic and colour decision the
// renderer makes is a role here; per-org overrides live in the
// `hire_order_theme` app-setting and are merged over these defaults by
// resolveHireOrderTheme.
//
// DUAL-HOME PAIR: src/lib/hireOrders/pdf/pdfTheme.ts generates
// supabase/functions/_shared/hire-order-pdf/pdfTheme.ts (the edge renderer can't
// import from src/). Edit src/lib/hireOrders/pdf/pdfTheme.ts, then run
// `npm run sync:mirrors`; never hand-edit the generated target. CI's
// sync:mirrors:check fails if the two drift. No relative imports here so the
// two files can be identical.
//
// Defaults are transcribed from the pre-theme StyleSheet. Do not "tidy" them:
// a default-theme render must be byte-identical to the pre-theme output.

export type ThemeColorKey =
  | "text"
  | "muted"
  | "faint"
  | "accent"
  | "line"
  | "feeCell"
  | "surface2";

export type FontFamilyKey =
  | "geist"
  | "inter"
  | "plex-sans"
  | "source-serif"
  | "libre-baskerville"
  | "geist-mono"
  | "plex-mono";

export interface FontFamilyDef {
  key: FontFamilyKey;
  /** Shown in the editor's family picker. */
  label: string;
  kind: "sans" | "serif" | "mono";
  /** react-pdf family name. Must be unique across the registry. */
  family: string;
  /** Storage object names inside the `hire-order-fonts` bucket, per weight.
   *  `null` path means the weight is served by the nearest available file. */
  files: { weight: 400 | 500 | 600; path: string }[];
  /** Geist ships base64-embedded in the edge function, so it never needs a
   *  fetch. Everything else is fetched on demand. */
  embedded?: true;
}

export const FONT_FAMILIES: FontFamilyDef[] = [
  {
    key: "geist",
    label: "Geist",
    kind: "sans",
    family: "Geist",
    embedded: true,
    files: [
      { weight: 400, path: "geist/Geist-Regular.ttf" },
      { weight: 500, path: "geist/Geist-Medium.ttf" },
      { weight: 600, path: "geist/Geist-SemiBold.ttf" },
    ],
  },
  {
    key: "inter",
    label: "Inter",
    kind: "sans",
    family: "Inter",
    files: [
      { weight: 400, path: "inter/Inter-Regular.ttf" },
      { weight: 500, path: "inter/Inter-Medium.ttf" },
      { weight: 600, path: "inter/Inter-SemiBold.ttf" },
    ],
  },
  {
    key: "plex-sans",
    label: "IBM Plex Sans",
    kind: "sans",
    family: "PlexSans",
    files: [
      { weight: 400, path: "plex-sans/IBMPlexSans-Regular.ttf" },
      { weight: 500, path: "plex-sans/IBMPlexSans-Medium.ttf" },
      { weight: 600, path: "plex-sans/IBMPlexSans-SemiBold.ttf" },
    ],
  },
  {
    key: "source-serif",
    label: "Source Serif",
    kind: "serif",
    family: "SourceSerif",
    files: [
      { weight: 400, path: "source-serif/SourceSerif4-Regular.ttf" },
      { weight: 500, path: "source-serif/SourceSerif4-Medium.ttf" },
      { weight: 600, path: "source-serif/SourceSerif4-SemiBold.ttf" },
    ],
  },
  {
    key: "libre-baskerville",
    label: "Libre Baskerville",
    kind: "serif",
    family: "LibreBaskerville",
    files: [
      { weight: 400, path: "libre-baskerville/LibreBaskerville-Regular.ttf" },
      { weight: 500, path: "libre-baskerville/LibreBaskerville-Bold.ttf" },
      { weight: 600, path: "libre-baskerville/LibreBaskerville-Bold.ttf" },
    ],
  },
  {
    key: "geist-mono",
    label: "Geist Mono",
    kind: "mono",
    family: "GeistMono",
    embedded: true,
    files: [
      { weight: 400, path: "geist-mono/GeistMono-Regular.ttf" },
      { weight: 500, path: "geist-mono/GeistMono-Regular.ttf" },
      { weight: 600, path: "geist-mono/GeistMono-Regular.ttf" },
    ],
  },
  {
    key: "plex-mono",
    label: "IBM Plex Mono",
    kind: "mono",
    family: "PlexMono",
    files: [
      { weight: 400, path: "plex-mono/IBMPlexMono-Regular.ttf" },
      { weight: 500, path: "plex-mono/IBMPlexMono-Medium.ttf" },
      { weight: 600, path: "plex-mono/IBMPlexMono-SemiBold.ttf" },
    ],
  },
];

export type RoleKey =
  // Letterhead
  | "legalName"
  | "letterheadLine"
  | "orderNumber"
  | "statusBadge"
  // Title
  | "titleLead"
  | "artistName"
  | "titleSub"
  // Parties
  | "partyLabel"
  | "partyName"
  | "partyLine"
  // Facts strip
  | "factLabel"
  | "factValue"
  | "factValueMono"
  | "factSub"
  // Sections
  | "sectionHeading"
  // Tables
  | "tableHeadCell"
  | "tableCellLabel"
  | "tableCellMono"
  | "notes"
  // Fees
  | "feeLabel"
  | "feeValue"
  | "totalLabel"
  | "totalValue"
  // Terms
  | "clauseNumber"
  | "clauseTitle"
  | "clauseBody"
  // Signatures
  | "signatureFor"
  | "signatureHint"
  | "signatureMarkTyped"
  // Footer
  | "footerText"
  | "watermark"
  // Certificate
  | "certHeading"
  | "certLead"
  | "certLabel"
  | "certValue";

export interface RoleStyle {
  /** Omitted means "inherit base.fontFamily" (or base.monoFamily for the
   *  roles whose default is mono). */
  family?: FontFamilyKey;
  size?: number;
  weight?: 400 | 500 | 600;
  color?: ThemeColorKey;
  letterSpacing?: number;
  transform?: "none" | "uppercase";
}

export interface HireOrderThemeBase {
  fontFamily: FontFamilyKey;
  monoFamily: FontFamilyKey;
  /** Multiplier applied to every role size, so one control rescales the
   *  document without flattening the type hierarchy. */
  scale: number;
  colors: Record<ThemeColorKey, string>;
  page: { marginX: number; marginTop: number; marginBottom: number };
}

export interface HireOrderTheme {
  base: HireOrderThemeBase;
  roles: Record<RoleKey, RoleStyle>;
}

/**
 * A stored override: any subset, at any depth. Deliberately LOOSER than
 * HireOrderTheme, because this models untrusted JSON out of app_settings that
 * a human may have hand-edited. Every field is widened to the type the JSON
 * could actually hold, and resolveHireOrderTheme is what narrows it. Typing
 * this strictly would be a lie that pushes the validation into the callers.
 */
export interface LooseRoleStyle {
  family?: string;
  size?: number;
  weight?: number;
  color?: string;
  letterSpacing?: number;
  transform?: string;
}

export interface HireOrderThemeOverride {
  base?: {
    fontFamily?: string;
    monoFamily?: string;
    scale?: number;
    colors?: Partial<Record<string, string>>;
    page?: Partial<HireOrderThemeBase["page"]>;
  };
  roles?: Record<string, LooseRoleStyle>;
}

export const HIRE_ORDER_THEME_DEFAULTS: HireOrderTheme = {
  base: {
    fontFamily: "geist",
    monoFamily: "geist-mono",
    scale: 1,
    colors: {
      text: "#15131C",
      muted: "#5B5A57",
      faint: "#8B8A85",
      accent: "#4738B0",
      line: "#E5E2DA",
      feeCell: "#F4F1FF",
      surface2: "#FAF8F4",
    },
    page: { marginX: 44, marginTop: 40, marginBottom: 60 },
  },
  roles: {
    legalName: { size: 16, weight: 600, color: "text" },
    letterheadLine: { size: 9, weight: 400, color: "faint" },
    orderNumber: { family: "geist-mono", size: 15, weight: 600, color: "text" },
    statusBadge: { size: 9, weight: 500, color: "muted" },

    titleLead: { size: 11, weight: 400, color: "muted" },
    artistName: { size: 30, weight: 600, color: "text", letterSpacing: -0.5 },
    titleSub: { size: 12, weight: 400, color: "muted" },

    partyLabel: { size: 9, weight: 400, color: "faint" },
    partyName: { size: 13.5, weight: 600, color: "text" },
    partyLine: { size: 11, weight: 400, color: "muted" },

    factLabel: { size: 8, weight: 400, color: "faint" },
    factValue: { size: 12, weight: 500, color: "text" },
    factValueMono: { family: "geist-mono", size: 12, weight: 400, color: "text" },
    factSub: { size: 9, weight: 400, color: "muted" },

    sectionHeading: { size: 12, weight: 600, color: "text" },

    tableHeadCell: { size: 8, weight: 400, color: "faint" },
    tableCellLabel: { size: 12, weight: 600, color: "text" },
    tableCellMono: { family: "geist-mono", size: 12, weight: 400, color: "text" },
    notes: { size: 11, weight: 400, color: "muted" },

    feeLabel: { size: 12, weight: 400, color: "text" },
    feeValue: { family: "geist-mono", size: 12, weight: 400, color: "text" },
    totalLabel: { size: 12, weight: 600, color: "text", letterSpacing: 0.4, transform: "uppercase" },
    totalValue: { family: "geist-mono", size: 17, weight: 600, color: "text" },

    clauseNumber: { family: "geist-mono", size: 11, weight: 600, color: "accent" },
    clauseTitle: { weight: 600, color: "text" },
    clauseBody: { size: 10.5, weight: 400, color: "muted" },

    signatureFor: { size: 11, weight: 500, color: "text" },
    signatureHint: { size: 9, weight: 400, color: "faint" },
    signatureMarkTyped: { size: 22, weight: 600, color: "text" },

    footerText: { size: 8.5, weight: 400, color: "faint" },
    watermark: { size: 48, weight: 600, color: "text", letterSpacing: 6 },

    certHeading: { size: 16, weight: 600, color: "text" },
    certLead: { size: 11, weight: 400, color: "muted" },
    certLabel: { size: 10, weight: 400, color: "faint" },
    certValue: { size: 10.5, weight: 400, color: "text" },
  },
};

export const THEME_ROLE_KEYS = Object.keys(
  HIRE_ORDER_THEME_DEFAULTS.roles,
) as RoleKey[];

const HEX = /^#[0-9a-fA-F]{6}$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Finite numbers only; anything else falls back to the default. */
function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

function isFamilyKey(value: unknown): value is FontFamilyKey {
  return typeof value === "string" &&
    FONT_FAMILIES.some((f) => f.key === value);
}

/**
 * Merge per-org overrides over the defaults and clamp everything into a range
 * that still produces a readable, non-overflowing document. Clamping lives here
 * rather than in the editor so a hand-edited app-setting is equally safe. The
 * result is always a complete theme.
 */
export function resolveHireOrderTheme(
  overrides?: HireOrderThemeOverride | null,
): HireOrderTheme {
  const d = HIRE_ORDER_THEME_DEFAULTS;
  const o = overrides ?? {};
  const ob = o.base ?? {};

  const colors = {} as Record<ThemeColorKey, string>;
  for (const key of Object.keys(d.base.colors) as ThemeColorKey[]) {
    const candidate = ob.colors?.[key];
    colors[key] = typeof candidate === "string" && HEX.test(candidate)
      ? candidate
      : d.base.colors[key];
  }

  const roles = {} as Record<RoleKey, RoleStyle>;
  for (const key of THEME_ROLE_KEYS) {
    const base = d.roles[key];
    const over = o.roles?.[key] ?? {};
    const style: RoleStyle = { ...base };
    if (isFamilyKey(over.family)) style.family = over.family;
    if (over.size !== undefined) style.size = num(over.size, base.size ?? 11, 5, 60);
    if (over.weight === 400 || over.weight === 500 || over.weight === 600) {
      style.weight = over.weight;
    }
    if (typeof over.color === "string" && over.color in colors) {
      style.color = over.color as ThemeColorKey;
    }
    if (over.letterSpacing !== undefined) {
      style.letterSpacing = num(over.letterSpacing, base.letterSpacing ?? 0, -1, 8);
    }
    if (over.transform === "none" || over.transform === "uppercase") {
      style.transform = over.transform;
    }
    roles[key] = style;
  }

  return {
    base: {
      fontFamily: isFamilyKey(ob.fontFamily) ? ob.fontFamily : d.base.fontFamily,
      monoFamily: isFamilyKey(ob.monoFamily) ? ob.monoFamily : d.base.monoFamily,
      scale: num(ob.scale, d.base.scale, 0.75, 1.5),
      colors,
      page: {
        marginX: num(ob.page?.marginX, d.base.page.marginX, 20, 80),
        marginTop: num(ob.page?.marginTop, d.base.page.marginTop, 20, 90),
        marginBottom: num(ob.page?.marginBottom, d.base.page.marginBottom, 20, 90),
      },
    },
    roles,
  };
}

/** The react-pdf text properties a role contributes. Named rather than inlined
 *  because the function body references it, and a `ReturnType<typeof ...>` of
 *  the function that declares it would be circular. */
export interface RoleTextStyle {
  fontFamily: string;
  fontSize?: number;
  fontWeight?: 400 | 500 | 600;
  color?: string;
  letterSpacing?: number;
  textTransform?: "none" | "uppercase";
}

/** react-pdf text style for one role: base scale applied, colour key resolved,
 *  family key resolved to its react-pdf family name. */
export function themeRoleStyle(theme: HireOrderTheme, role: RoleKey): RoleTextStyle {
  const style = theme.roles[role];
  const familyKey = style.family ?? theme.base.fontFamily;
  const def = FONT_FAMILIES.find((f) => f.key === familyKey) ?? FONT_FAMILIES[0];
  const out: RoleTextStyle = { fontFamily: def.family };
  if (style.size !== undefined) {
    // Round to 2dp: react-pdf accepts fractional sizes, but unrounded float
    // products would make snapshot comparisons noisy.
    out.fontSize = clamp(
      Math.round(style.size * theme.base.scale * 100) / 100,
      5,
      60,
    );
  }
  if (style.weight !== undefined) out.fontWeight = style.weight;
  if (style.color !== undefined) out.color = theme.base.colors[style.color];
  if (style.letterSpacing !== undefined) out.letterSpacing = style.letterSpacing;
  if (style.transform !== undefined) out.textTransform = style.transform;
  return out;
}

/** Every family the theme actually references, so a renderer registers only
 *  what it needs rather than the whole library. */
export function familiesInUse(theme: HireOrderTheme): FontFamilyDef[] {
  const keys = new Set<FontFamilyKey>([theme.base.fontFamily, theme.base.monoFamily]);
  for (const role of THEME_ROLE_KEYS) {
    const family = theme.roles[role].family;
    if (family) keys.add(family);
  }
  return FONT_FAMILIES.filter((f) => keys.has(f.key));
}
