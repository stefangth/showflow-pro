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
  /** True while this family's TTFs have not yet been uploaded to the
   *  `hire-order-fonts` Storage bucket (see docs/runbooks/hire-order-fonts.md).
   *  `selectableFontFamilies()` uses this to keep an unusable family out of
   *  the editor's font picker; it deliberately does NOT gate anything else
   *  here — see resolveHireOrderTheme's `isFamilyKey` for why a pending
   *  family must still be an ACCEPTED stored value. Flip to omitted (or
   *  `false`) in the same commit that uploads the files, then run
   *  `npm run sync:mirrors` — an upload with no flag flip leaves the family
   *  invisible in the picker forever. */
  pendingUpload?: true;
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
    pendingUpload: true,
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
    pendingUpload: true,
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
    pendingUpload: true,
    // Adobe's static release (github.com/adobe-fonts/source-serif) ships
    // ExtraLight/Light/Regular/Semibold/Bold/Black -- no discrete 500 cut.
    // Weight 500 reuses the Regular file rather than pointing at a
    // Medium.ttf that does not exist in the release (see docs/runbooks/
    // hire-order-fonts.md), the same "duplicate the nearest available
    // file" convention Libre Baskerville uses below.
    files: [
      { weight: 400, path: "source-serif/SourceSerif4-Regular.ttf" },
      { weight: 500, path: "source-serif/SourceSerif4-Regular.ttf" },
      { weight: 600, path: "source-serif/SourceSerif4-SemiBold.ttf" },
    ],
  },
  {
    key: "libre-baskerville",
    label: "Libre Baskerville",
    kind: "serif",
    family: "LibreBaskerville",
    pendingUpload: true,
    files: [
      { weight: 400, path: "libre-baskerville/LibreBaskerville-Regular.ttf" },
      { weight: 500, path: "libre-baskerville/LibreBaskerville-Medium.ttf" },
      { weight: 600, path: "libre-baskerville/LibreBaskerville-SemiBold.ttf" },
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
    pendingUpload: true,
    files: [
      { weight: 400, path: "plex-mono/IBMPlexMono-Regular.ttf" },
      { weight: 500, path: "plex-mono/IBMPlexMono-Medium.ttf" },
      { weight: 600, path: "plex-mono/IBMPlexMono-SemiBold.ttf" },
    ],
  },
];

/**
 * Families a user may actually pick today — the design-system fonts
 * (`embedded: true`), which are base64-embedded on the edge and therefore
 * resolve with zero network I/O and can never fail. The other five entries
 * stay in `FONT_FAMILIES` (never delete them: the registry doubles as the
 * catalog `docs/runbooks/hire-order-fonts.md` documents and the source
 * `scripts/upload-hire-order-fonts.ts` derives its required-path list from)
 * but are excluded here until an operator uploads their TTFs to the
 * `hire-order-fonts` bucket AND flips `pendingUpload` off in this file (see
 * that field's doc comment above). The editor's font pickers (a later task)
 * must call this instead of reading `FONT_FAMILIES` directly, so a family
 * never becomes choosable before its files exist.
 *
 * This governs the picker only — `resolveHireOrderTheme` still accepts (and
 * `familiesInUse`/`registerFonts` still attempt) any key in the full
 * registry regardless of `pendingUpload`; see `isFamilyKey`'s doc comment.
 */
export function selectableFontFamilies(): FontFamilyDef[] {
  return FONT_FAMILIES.filter((f) => !f.pendingUpload);
}

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
  /** Omitted means "inherit the theme's base family for this role's kind":
   *  base.monoFamily for the roles in MONO_ROLE_KEYS, base.fontFamily for
   *  every other role. themeRoleStyle applies this fallback. */
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
    orderNumber: { size: 15, weight: 600, color: "text" },
    statusBadge: { size: 9, weight: 500, color: "muted" },

    titleLead: { size: 11, weight: 400, color: "muted" },
    artistName: { size: 30, weight: 600, color: "text", letterSpacing: -0.5 },
    titleSub: { size: 12, weight: 400, color: "muted" },

    partyLabel: { size: 9, weight: 400, color: "faint" },
    partyName: { size: 13.5, weight: 600, color: "text" },
    partyLine: { size: 11, weight: 400, color: "muted" },

    factLabel: { size: 8, weight: 400, color: "faint" },
    factValue: { size: 12, weight: 500, color: "text" },
    factValueMono: { size: 12, weight: 400, color: "text" },
    factSub: { size: 9, weight: 400, color: "muted" },

    sectionHeading: { size: 12, weight: 600, color: "text" },

    tableHeadCell: { size: 8, weight: 400, color: "faint" },
    tableCellLabel: { size: 12, weight: 600, color: "text" },
    tableCellMono: { size: 12, weight: 400, color: "text" },
    notes: { size: 11, weight: 400, color: "muted" },

    feeLabel: { size: 12, weight: 400, color: "text" },
    feeValue: { size: 12, weight: 400, color: "text" },
    totalLabel: { size: 12, weight: 600, color: "text", letterSpacing: 0.4, transform: "uppercase" },
    totalValue: { size: 17, weight: 600, color: "text" },

    clauseNumber: { size: 11, weight: 600, color: "accent" },
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

/** Roles whose default typeface is the mono family rather than the base sans
 *  family. themeRoleStyle consults this to pick which base family a role
 *  with no explicit `family` override falls back to. Listed explicitly
 *  (not derived from the defaults) because removing a role's default
 *  `family` no longer signals "this role is mono" once overrides can also
 *  omit `family` on a sans role. */
export const MONO_ROLE_KEYS: ReadonlySet<RoleKey> = new Set<RoleKey>([
  "orderNumber",
  "factValueMono",
  "tableCellMono",
  "feeValue",
  "totalValue",
  "clauseNumber",
]);

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

/** Deliberately checks membership in the FULL registry, not
 *  `selectableFontFamilies()` — `pendingUpload` gates what the editor's
 *  picker OFFERS, never what a stored theme is ALLOWED to reference. An org
 *  that already has a `pendingUpload` family saved (or one whose files land
 *  after this ships) must keep resolving to that family, not silently fall
 *  back to the default the moment `resolveHireOrderTheme` sees it — that
 *  would be a worse regression than the picker briefly offering a family
 *  before its files exist. See the `pendingUpload` field's doc comment on
 *  `FontFamilyDef` for the picker-side half of this split. */
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

/** Map a font-family key to its registered react-pdf family name. Exported so
 *  a caller can resolve `theme.base.fontFamily` (the document's inherited
 *  default) directly, without going through any particular role — a role's
 *  resolved family is that role's own override-or-fallback, and must not be
 *  read back out as "the" document default (see the renderer's `bodyFamily`,
 *  which uses this rather than themeRoleStyle(theme, someRole).fontFamily). */
export function reactPdfFamilyName(key: FontFamilyKey): string {
  const def = FONT_FAMILIES.find((f) => f.key === key) ?? FONT_FAMILIES[0];
  return def.family;
}

/** Every key in the registry — the default `available` set, meaning "resolve
 *  normally" (no fetch has failed). registerFonts passes the REAL available
 *  set it produced; every existing caller that omits the argument keeps
 *  resolving exactly as before. */
const ALL_FAMILY_KEYS: ReadonlySet<FontFamilyKey> = new Set(FONT_FAMILIES.map((f) => f.key));

/**
 * Like `reactPdfFamilyName`, but falls back to a react-pdf STANDARD font when
 * `key` is not in `available` — used when `registerFonts` could not load the
 * intended family for this particular render (see pdfDeps.ts). "Helvetica",
 * "Courier" and "Times-Roman" are all pre-registered by react-pdf's own
 * FontStore constructor (confirmed in @react-pdf/font's FontStore
 * constructor, which registers all three alongside their bold/oblique/italic
 * variants), so this never touches `Font.register` and can never collide
 * with (or be shadowed by) a real family that loads successfully on a later
 * render: the real family name is registered once, only on a genuine full
 * success, and never with fallback data — see pdfDeps.ts's registerFonts doc
 * comment for why re-registering the same name with different data is
 * unsafe.
 */
export function safeReactPdfFamilyName(
  key: FontFamilyKey,
  available: ReadonlySet<FontFamilyKey> = ALL_FAMILY_KEYS,
): string {
  if (available.has(key)) return reactPdfFamilyName(key);
  const def = FONT_FAMILIES.find((f) => f.key === key);
  if (def?.kind === "mono") return "Courier";
  if (def?.kind === "serif") return "Times-Roman";
  return "Helvetica";
}

/** react-pdf text style for one role: base scale applied, colour key resolved,
 *  family key resolved to its react-pdf family name (or a standard-font
 *  fallback — see `safeReactPdfFamilyName` — for a family `available`
 *  excludes; omitting `available` resolves every key normally). */
export function themeRoleStyle(
  theme: HireOrderTheme,
  role: RoleKey,
  available: ReadonlySet<FontFamilyKey> = ALL_FAMILY_KEYS,
): RoleTextStyle {
  const style = theme.roles[role];
  const familyKey = style.family ??
    (MONO_ROLE_KEYS.has(role) ? theme.base.monoFamily : theme.base.fontFamily);
  const out: RoleTextStyle = { fontFamily: safeReactPdfFamilyName(familyKey, available) };
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
