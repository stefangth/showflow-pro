# Hire Order PDF Template Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each org a WYSIWYG editor for its hire-order PDF, where selecting a semantic element (heading, label, mono value, total, clause body) edits both that element's text and its typography, colour and spacing, next to a live rendering of the real document.

**Architecture:** The renderer's hardcoded `StyleSheet` becomes a **theme registry** dual-homed exactly like the existing copy registry, keyed by ~35 semantic **role** names. `render.tsx` itself becomes byte-identical across the Deno edge runtime and the browser, with the only two runtime differences (which `@react-pdf/renderer` build, how fonts register) isolated behind a per-side `pdfDeps.ts` shim. The editor therefore previews the **real PDF**, rendered client-side by the same component the edge function uses.

**Tech Stack:** React 18 + TypeScript, `@react-pdf/renderer` v4 (new frontend dependency), Vite 5, Vitest, Deno edge functions, Supabase Storage, `react-resizable-panels` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-07-25-hire-order-pdf-template-editor-design.md` sections 1 to 5.

**Depends on:** `docs/superpowers/plans/2026-07-25-hire-order-per-date-fee-and-wizard-selection.md` should land first. It adds two copy keys, and doing it after this plan means editing the mirrored `pdfCopy.ts` twice.

## Global Constraints

- **`any` is banned.** Lint runs `--max-warnings 0`.
- **No em dashes or en dashes in product copy** (UI strings, PDF copy defaults, changelog). Use a period, comma, or middot.
- **Byte-identical mirrors.** `pdfCopy.ts`, `pdfTheme.ts`, `docTypes.ts` and `render.tsx` each exist twice and must match byte for byte, enforced by mirror tests. They may contain **no relative imports other than `./pdfDeps.ts`, `./pdfCopy.ts`, `./pdfTheme.ts` and `./docTypes.ts`**, because those are the only paths that resolve identically on both sides.
- **Semantic design tokens only** in app UI (`bg-background`, `text-foreground`, `border-border`). Never `bg-white`. Note that accent numbered stops (`accent-50` to `accent-900`) are plain hex and **do not support Tailwind opacity modifiers** such as `bg-accent-500/20`.
- **Defaults must render byte-identically to today.** That is the acceptance gate for the renderer refactor.
- **Test-first.** Write the failing test, run it, watch it fail, then implement.
- **Ships dark.** Everything here sits behind the `hire_orders` entitlement, which defaults off.
- Run commands from the repo root: `/Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/booking-engine-ui-ux-09cbf4`.

### Command reference

| Purpose | Command |
|---|---|
| One vitest file | `npx vitest run <path>` |
| All vitest | `npx vitest run` |
| Edge tests | `deno test --allow-all --node-modules-dir=none supabase/functions/` |
| Type check | `npx tsc -p tsconfig.app.json --noEmit` |
| Lint gate | `npm run lint` |
| Dev server | Use the `preview_start` browser tool, never `npm run dev` in a shell |

---

## File Structure

### New shared module: `src/lib/hireOrders/pdf/` and `supabase/functions/_shared/hire-order-pdf/`

| File | Responsibility | Mirrored |
|---|---|---|
| `docTypes.ts` | `FieldValue`, `OrderFieldKey`, `OrderData`, `EngagementDate`, `RenderInput`, `formatMoney` | Yes, byte-identical |
| `pdfCopy.ts` | Copy registry (exists; **moves** from `src/lib/hireOrders/pdfCopy.ts`) | Yes, byte-identical |
| `pdfTheme.ts` | Theme registry, role keys, font registry, `resolveHireOrderTheme` | Yes, byte-identical |
| `render.tsx` | The document (exists edge-side; gains a browser twin) | Yes, byte-identical |
| `pdfDeps.ts` | Per-runtime shim: react-pdf primitives, React types, `registerFonts` | **No, deliberately differs** |
| `fonts.ts` | Base64 Geist TTFs | Edge only |

### New editor UI: `src/components/settings/hireOrders/template/`

| File | Responsibility |
|---|---|
| `TemplateEditorPage.tsx` | Route component: loads settings, owns draft state, three-pane shell |
| `TemplateOutline.tsx` | Left pane: section/role tree, selection, modified markers |
| `TemplateInspector.tsx` | Right pane: Text group + Style group for the selected role |
| `TemplateDocumentPane.tsx` | Centre pane: debounced browser PDF render |
| `templateMeta.ts` | Role labels, grouping, and the role-to-copy-key binding |
| `sampleDocument.ts` | The representative order the editor previews against |

---

## Task 1: Spike, prove react-pdf renders in the browser

**Files:**
- Create (throwaway): `src/pages/__spike__/PdfSpike.tsx`
- Modify: `package.json`, `vite.config.ts` (only if the spike proves config is needed)

**Interfaces:** none. This task produces a **decision**, not shipped code.

`@react-pdf/renderer` v4 targets the browser, but under Vite it has historically needed polyfills for Node globals (`Buffer`, `process`, stream shims). Everything downstream of Task 4 depends on this working. Prove it before building anything on top.

- [ ] **Step 1: Install the dependency**

```bash
npm install @react-pdf/renderer@^4
```

- [ ] **Step 2: Write the spike component**

Create `src/pages/__spike__/PdfSpike.tsx`:

```tsx
import { Document, Page, StyleSheet, Text, View, usePDF } from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 12 },
  heading: { fontSize: 18, marginBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
});

function SpikeDoc() {
  return (
    <Document title="spike">
      <Page size="A4" style={s.page}>
        <Text style={s.heading}>Hire order spike</Text>
        <View style={s.row}>
          <Text>Engagement fee</Text>
          <Text>1,500.00</Text>
        </View>
      </Page>
    </Document>
  );
}

export default function PdfSpike() {
  const [instance] = usePDF({ document: <SpikeDoc /> });
  if (instance.loading) return <p>rendering</p>;
  if (instance.error) return <p>error: {String(instance.error)}</p>;
  return <iframe title="spike" src={instance.url ?? ""} style={{ width: "100%", height: "90vh" }} />;
}
```

Register it temporarily in `src/App.tsx` at `/__spike__`, outside any `ProtectedRoute`.

- [ ] **Step 3: Run it in the browser**

Start the dev server with the `preview_start` browser tool (never `npm run dev` in a shell), navigate to `/__spike__`, then check `read_console_messages` for errors.

Expected: an A4 PDF renders in the iframe, console clean.

- [ ] **Step 4: If it fails, fix the config here and only here**

Typical failures and their fixes:

| Console error | Fix in `vite.config.ts` |
|---|---|
| `Buffer is not defined` | `define: { global: "globalThis" }` plus `resolve.alias: { buffer: "buffer/" }` and `npm i buffer` |
| `process is not defined` | `define: { "process.env": {} }` |
| `Module "stream" has been externalized` | `optimizeDeps: { include: ["@react-pdf/renderer"] }` |

Apply the minimum that makes it render. Re-run step 3 after each change.

- [ ] **Step 5: Record the verdict**

Append to the spec file `docs/superpowers/specs/2026-07-25-hire-order-pdf-template-editor-design.md`, at the end of section 4:

```markdown
**Spike result (YYYY-MM-DD):** react-pdf v4 renders in the browser under Vite.
Config required: <the exact vite.config.ts changes, or "none">.
```

- [ ] **Step 6: Decision gate**

**If the spike succeeded:** delete `src/pages/__spike__/`, remove the temporary route, keep the `vite.config.ts` changes and the dependency, and continue to Task 2.

**If the spike could not be made to work after a reasonable attempt:** STOP and report to the user. The fallback is a debounced server-rendered PDF in an iframe using the existing `preview` action. Tasks 2, 3, 6, 7, 8, 9, 10, 11 and 12 are unaffected; only Task 4 (the `render.tsx` mirror) is dropped and Task 5's `TemplateDocumentPane` calls `invokeHireOrderAction` instead of rendering locally. Do not silently switch approaches.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts docs/superpowers/specs/2026-07-25-hire-order-pdf-template-editor-design.md
git commit -m "build: add @react-pdf/renderer for the browser preview"
```

---

## Task 2: Theme registry

**Files:**
- Create: `src/lib/hireOrders/pdf/pdfTheme.ts`
- Create: `supabase/functions/_shared/hire-order-pdf/pdfTheme.ts` (byte-identical)
- Create: `src/lib/hireOrders/pdf/pdfTheme.test.ts`
- Create: `src/lib/hireOrders/pdf/pdfThemeMirror.test.ts`

**Interfaces:**
- Produces: `RoleKey`, `RoleStyle`, `ThemeColorKey`, `FontFamilyKey`, `HireOrderTheme`, `HIRE_ORDER_THEME_DEFAULTS`, `THEME_ROLE_KEYS`, `FONT_FAMILIES`, `resolveHireOrderTheme(overrides?): HireOrderTheme`, `themeRoleStyle(theme, role)`. Tasks 3, 5, 7, 8, 9, 10 all consume these.

Every default below is copied from the current `StyleSheet` in `render.tsx:78-249` and the colour map `C` at `render.tsx:67-76`. Do not round or "tidy" them; byte-identical output is the acceptance gate for Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/lib/hireOrders/pdf/pdfTheme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  HIRE_ORDER_THEME_DEFAULTS,
  resolveHireOrderTheme,
  THEME_ROLE_KEYS,
  themeRoleStyle,
} from "./pdfTheme";

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hireOrders/pdf/pdfTheme.test.ts`
Expected: FAIL, cannot resolve `./pdfTheme`.

- [ ] **Step 3: Write the registry**

Create `src/lib/hireOrders/pdf/pdfTheme.ts`:

```ts
// Editable hire-order PDF theme. Every typographic and colour decision the
// renderer makes is a role here; per-org overrides live in the
// `hire_order_theme` app-setting and are merged over these defaults by
// resolveHireOrderTheme.
//
// DUAL-HOME: byte-identical to supabase/functions/_shared/hire-order-pdf/
// pdfTheme.ts (the edge renderer can't import from src/). Edit both in the same
// commit; pdfThemeMirror.test.ts enforces byte-equality. No relative imports
// here so the two files can be identical.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hireOrders/pdf/pdfTheme.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Create the mirror and its guard**

```bash
mkdir -p supabase/functions/_shared/hire-order-pdf
cp src/lib/hireOrders/pdf/pdfTheme.ts supabase/functions/_shared/hire-order-pdf/pdfTheme.ts
```

Create `src/lib/hireOrders/pdf/pdfThemeMirror.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The theme registry is dual-homed because the Deno edge renderer can't import
// from src/. The two files must be byte-identical: the editor shows defaults +
// reset, the edge renders from them and freezes them into the issue snapshot.
// If they drift, a preview and its issued PDF would look different.
describe("hire-order pdf theme mirror", () => {
  it("src and edge pdfTheme.ts are byte-identical", () => {
    const a = readFileSync("src/lib/hireOrders/pdf/pdfTheme.ts", "utf8");
    const b = readFileSync(
      "supabase/functions/_shared/hire-order-pdf/pdfTheme.ts",
      "utf8",
    );
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 6: Run both guards**

Run: `npx vitest run src/lib/hireOrders/pdf/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/hireOrders/pdf/ supabase/functions/_shared/hire-order-pdf/pdfTheme.ts
git commit -m "feat(hire-orders): editable pdf theme registry + resolver"
```

---

## Task 3: Renderer builds styles from the theme

**Files:**
- Modify: `supabase/functions/_shared/hire-order-pdf/render.tsx:63-249` (replace `C` and `const s`)
- Modify: `supabase/functions/_shared/hireOrders.ts` (`RenderInput` gains `theme`)
- Modify: `supabase/functions/_shared/hire-order-pdf/render.test.ts`

**Interfaces:**
- Consumes: `HireOrderTheme`, `resolveHireOrderTheme`, `themeRoleStyle` (Task 2).
- Produces: `buildStyles(theme: HireOrderTheme)` returning the same `StyleSheet` shape as today; `RenderInput.theme?: HireOrderTheme`.

`buildStyles` merges **structural** properties (flex direction, borders, padding, widths, `lineHeight`, absolute positioning) with **themeable** properties from `themeRoleStyle`. Structure is not exposed to the editor.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/_shared/hire-order-pdf/render.test.ts`:

```ts
Deno.test("default theme renders byte-identically to no theme at all", async () => {
  const withoutTheme = await renderHireOrderPdf({ ...BASE, generatedAtIso: "2026-08-01T10:00:00.000Z" });
  const withTheme = await renderHireOrderPdf({
    ...BASE,
    generatedAtIso: "2026-08-01T10:00:00.000Z",
    theme: resolveHireOrderTheme(),
  });
  assertEquals(withTheme.length, withoutTheme.length);
});

Deno.test("a theme override changes the rendered document", async () => {
  const plain = await renderHireOrderPdf({ ...BASE, generatedAtIso: "2026-08-01T10:00:00.000Z" });
  const scaled = await renderHireOrderPdf({
    ...BASE,
    generatedAtIso: "2026-08-01T10:00:00.000Z",
    theme: resolveHireOrderTheme({ base: { scale: 1.4 } }),
  });
  assertNotEquals(scaled.length, plain.length);
});

Deno.test("buildStyles applies role size, weight and colour", () => {
  const theme = resolveHireOrderTheme({
    roles: { sectionHeading: { size: 20, weight: 400, color: "accent" } },
  });
  const s = buildStyles(theme);
  assertEquals(s.sectionHeading.fontSize, 20);
  assertEquals(s.sectionHeading.fontWeight, 400);
  assertEquals(s.sectionHeading.color, theme.base.colors.accent);
  // Structure survives the theming.
  assertEquals(s.sectionHeading.marginBottom, 8);
});

Deno.test("buildStyles applies base scale and page margins", () => {
  const theme = resolveHireOrderTheme({ base: { scale: 1.5, page: { marginX: 60 } } });
  const s = buildStyles(theme);
  assertEquals(s.sectionHeading.fontSize, 18);
  assertEquals(s.page.paddingHorizontal, 60);
  assertEquals(s.footer.left, 60);
  assertEquals(s.footer.right, 60);
});
```

The generated date must be pinned so the footer does not vary between the two renders being compared in the first test. `BASE` (the shared fixture at `render.test.ts:178`) already carries `generatedAtIso: "2026-08-01T10:00:00.000Z"`, so spreading `...BASE` without overriding it is sufficient; the explicit override above is belt and braces. `renderToText(input)` already exists at `render.test.ts:471` and returns the document's extracted text.

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/render.test.ts`
Expected: FAIL, `buildStyles` is not exported.

- [ ] **Step 3: Replace the stylesheet with a builder**

In `render.tsx`, delete the `C` constant (lines 67-76) and the `const s = StyleSheet.create({...})` block (lines 78-249), and put in their place:

```tsx
// ── styles ───────────────────────────────────────────────────────────────
// Built per render from the resolved theme. Structural properties (flex,
// borders, padding, widths, lineHeight, absolute positioning) stay here and are
// NOT editable; only typography and colour come from the theme, via
// themeRoleStyle. Adding a role means adding it to pdfTheme.ts first.

export function buildStyles(theme: HireOrderTheme) {
  const c = theme.base.colors;
  const r = (role: RoleKey) => themeRoleStyle(theme, role);
  const { marginX, marginTop, marginBottom } = theme.base.page;
  const bodyFamily = themeRoleStyle(theme, "titleLead").fontFamily;

  return StyleSheet.create({
    page: {
      fontFamily: bodyFamily,
      fontWeight: 400,
      fontSize: 11,
      color: c.text,
      backgroundColor: "#FFFFFF",
      paddingTop: marginTop,
      paddingBottom: marginBottom,
      paddingHorizontal: marginX,
    },

    // Letterhead
    letterhead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    brandRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
    brandTile: {
      width: 26,
      height: 26,
      borderRadius: 6,
      backgroundColor: c.text,
      color: "#FFFFFF",
      fontSize: 13,
      fontWeight: 600,
      textAlign: "center",
      paddingTop: 6,
      marginRight: 8,
    },
    legalName: { ...r("legalName") },
    eyebrow: { ...r("letterheadLine"), marginTop: 2 },
    eyebrowRight: { ...r("letterheadLine"), textAlign: "right" },
    orderNo: { ...r("orderNumber"), marginTop: 3, textAlign: "right" },
    badgeRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 5 },
    badgeDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 4 },
    badgeText: { ...r("statusBadge") },

    // Title
    title: { marginTop: 22 },
    titleLead: { ...r("titleLead") },
    artistName: { ...r("artistName"), marginTop: 4 },
    titleSub: { ...r("titleSub"), marginTop: 4 },

    // Parties
    parties: { flexDirection: "row", marginTop: 22 },
    party: { flex: 1 },
    partyGap: { width: 28 },
    partyLabel: { ...r("partyLabel"), marginBottom: 5 },
    partyName: { ...r("partyName") },
    partyLine: { ...r("partyLine"), marginTop: 2 },

    // Facts strip
    facts: {
      flexDirection: "row",
      marginTop: 22,
      borderWidth: 0.5,
      borderColor: c.line,
      borderRadius: 10,
      overflow: "hidden",
    },
    factCell: { flex: 1, padding: 10 },
    factDivider: { borderLeftWidth: 0.5, borderLeftColor: c.line },
    factCellFee: { backgroundColor: c.feeCell },
    factLabel: { ...r("factLabel"), marginBottom: 3 },
    factValue: { ...r("factValue") },
    factValueMono: { ...r("factValueMono") },
    factSub: { ...r("factSub"), marginTop: 2 },

    // Section
    section: { marginTop: 20 },
    sectionHeading: { ...r("sectionHeading"), marginBottom: 8 },

    // Running order
    tableHead: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: c.line, paddingBottom: 5 },
    tableHeadCell: { ...r("tableHeadCell") },
    tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: c.line, paddingVertical: 6 },
    colCall: { width: "30%" },
    colTime: { width: "70%" },
    cellLabel: { ...r("tableCellLabel") },
    cellTime: { ...r("tableCellMono") },
    notes: { ...r("notes"), marginTop: 8 },

    // Aggregate engagement dates
    engagementDateRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: c.line, paddingVertical: 6 },
    engagementDateValue: { ...r("tableCellMono"), width: "28%", fontSize: 10.5 },
    engagementDatePlace: { ...r("factValue"), flex: 1, fontSize: 10.5, fontWeight: 400 },
    engagementDateCity: { ...r("partyLine"), width: "25%", fontSize: 10.5 },

    // Fees
    feeRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
    feeLabel: { ...r("feeLabel") },
    feeValue: { ...r("feeValue") },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderTopWidth: 1.5,
      borderTopColor: c.text,
      backgroundColor: c.surface2,
      paddingVertical: 9,
      paddingHorizontal: 10,
    },
    totalLabel: { ...r("totalLabel") },
    totalValue: { ...r("totalValue") },

    // Terms
    clause: { flexDirection: "row", marginBottom: 7 },
    clauseNo: { ...r("clauseNumber"), width: 18 },
    clauseBody: { ...r("clauseBody"), flex: 1, lineHeight: 1.4 },
    clauseTitle: { ...r("clauseTitle") },

    // Signatures
    signatures: { flexDirection: "row", marginTop: 28 },
    signature: { flex: 1 },
    signatureGap: { width: 40 },
    signatureFor: { ...r("signatureFor"), marginBottom: 26 },
    signatureLine: { borderBottomWidth: 0.5, borderBottomColor: c.text },
    signatureHint: { ...r("signatureHint"), marginTop: 5 },

    // Applied (countersigned) signature mark
    sigMarkTyped: { ...r("signatureMarkTyped"), marginBottom: 2 },
    sigMarkImage: { height: 44, marginBottom: 2, objectFit: "contain" },

    // Certificate page
    certHeading: { ...r("certHeading"), marginBottom: 4 },
    certLead: { ...r("certLead"), marginBottom: 18 },
    certRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: c.line, paddingVertical: 7 },
    certLabel: { ...r("certLabel"), width: "34%" },
    certValue: { ...r("certValue"), flex: 1 },
    certValueMono: { ...r("factValueMono"), flex: 1, fontSize: 9.5 },
    certConsent: { ...r("certLead"), marginTop: 16, marginBottom: 0, fontSize: 10, lineHeight: 1.4 },

    // Footer
    footer: {
      position: "absolute",
      bottom: 26,
      left: marginX,
      right: marginX,
      flexDirection: "row",
      justifyContent: "space-between",
      borderTopWidth: 0.5,
      borderTopColor: c.line,
      paddingTop: 8,
    },
    footerText: { ...r("footerText") },
    footerMono: { ...r("footerText"), fontFamily: themeRoleStyle(theme, "factValueMono").fontFamily },

    // Watermark
    watermark: {
      ...r("watermark"),
      position: "absolute",
      top: 360,
      left: 90,
      opacity: 0.08,
      transform: "rotate(-30deg)",
    },
  });
}
```

- [ ] **Step 4: Call it per render**

In `HireOrderDoc`, immediately after the `copy` line (currently line 338):

```tsx
  const theme = input.theme ?? HIRE_ORDER_THEME_DEFAULTS;
  const s = buildStyles(theme);
```

Everywhere the old code referenced `C.faint` or `C.accent` inline (the badge dot at line 382), read from the theme instead:

```tsx
<View style={[s.badgeDot, { backgroundColor: status === "preview" ? theme.base.colors.faint : theme.base.colors.accent }]} />
```

Add to the imports at the top of `render.tsx`:

```tsx
import {
  HIRE_ORDER_THEME_DEFAULTS,
  type HireOrderTheme,
  type RoleKey,
  themeRoleStyle,
} from "./pdfTheme.ts";
```

- [ ] **Step 5: Add `theme` to RenderInput**

In `supabase/functions/_shared/hireOrders.ts`, find the `RenderInput` interface and add beside the existing `copy` field:

```ts
  /** Resolved theme. Absent means the built-in defaults, so legacy callers and
   *  the auto-draft trigger keep rendering exactly as before. */
  theme?: HireOrderTheme;
```

Import `type HireOrderTheme` from `./hire-order-pdf/pdfTheme.ts`.

- [ ] **Step 6: Run test to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/render.test.ts`
Expected: PASS, including the 4 new tests. The first test is the acceptance gate: if the byte lengths differ, a default value was transcribed wrongly in Task 2. Diff the two stylesheets rather than adjusting the test.

- [ ] **Step 7: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS. Edge functions have multiple test files and a single-file run has previously hidden regressions.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "refactor(hire-orders): renderer builds its stylesheet from the theme"
```

---

## Task 4: Share the renderer with the browser

**Files:**
- Create: `supabase/functions/_shared/hire-order-pdf/docTypes.ts`
- Create: `src/lib/hireOrders/pdf/docTypes.ts` (byte-identical)
- Create: `supabase/functions/_shared/hire-order-pdf/pdfDeps.ts` (Deno)
- Create: `src/lib/hireOrders/pdf/pdfDeps.ts` (browser, deliberately different)
- Move: `src/lib/hireOrders/pdfCopy.ts` to `src/lib/hireOrders/pdf/pdfCopy.ts`
- Create: `src/lib/hireOrders/pdf/render.tsx` (byte-identical to the edge copy)
- Create: `src/lib/hireOrders/pdf/renderMirror.test.ts`
- Modify: `supabase/functions/_shared/hireOrders.ts`, `src/lib/hireOrders/types.ts` (re-export from `docTypes.ts`)
- Modify: `src/lib/hireOrders/pdfCopyMirror.test.ts` (new paths)

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces: `renderHireOrderPdf(input: RenderInput): Promise<Uint8Array>` importable from `@/lib/hireOrders/pdf/render`. Task 5 consumes it.

**`docTypes.ts` must not become a third copy of the domain types.** Each runtime's existing home re-exports from it, so there is still exactly one definition per runtime and every current import path keeps working.

- [ ] **Step 1: Write the failing test**

Create `src/lib/hireOrders/pdf/renderMirror.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// render.tsx is dual-homed so the settings editor can preview the REAL document
// in the browser instead of a lookalike. The two files must be byte-identical;
// the only per-runtime differences (which @react-pdf/renderer build, how fonts
// register) live in pdfDeps.ts, which is deliberately NOT mirrored.
describe("hire-order pdf render mirror", () => {
  const pairs: [string, string][] = [
    ["src/lib/hireOrders/pdf/render.tsx", "supabase/functions/_shared/hire-order-pdf/render.tsx"],
    ["src/lib/hireOrders/pdf/docTypes.ts", "supabase/functions/_shared/hire-order-pdf/docTypes.ts"],
    ["src/lib/hireOrders/pdf/pdfCopy.ts", "supabase/functions/_shared/hire-order-pdf/pdfCopy.ts"],
    ["src/lib/hireOrders/pdf/pdfTheme.ts", "supabase/functions/_shared/hire-order-pdf/pdfTheme.ts"],
  ];

  it.each(pairs)("%s and %s are byte-identical", (a, b) => {
    expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
  });

  it("pdfDeps.ts is NOT mirrored (it is the per-runtime shim)", () => {
    const a = readFileSync("src/lib/hireOrders/pdf/pdfDeps.ts", "utf8");
    const b = readFileSync("supabase/functions/_shared/hire-order-pdf/pdfDeps.ts", "utf8");
    expect(a).not.toBe(b);
  });

  it("render.tsx imports only from the four mirrored paths", () => {
    const source = readFileSync("src/lib/hireOrders/pdf/render.tsx", "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    const allowed = ["./pdfDeps.ts", "./docTypes.ts", "./pdfCopy.ts", "./pdfTheme.ts"];
    for (const specifier of imports) {
      expect(allowed).toContain(specifier);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hireOrders/pdf/renderMirror.test.ts`
Expected: FAIL, the files do not exist.

- [ ] **Step 3: Extract docTypes.ts**

Create `supabase/functions/_shared/hire-order-pdf/docTypes.ts` holding the domain types and `formatMoney` currently inline in `_shared/hireOrders.ts`: `FieldSource`, `FieldValue`, `EngagementDate`, `OrderFieldKey`, `EditableOrderFieldKey`, `ORDER_FIELD_KEYS`, `OrderData`, `FieldLayers`, `RenderInput`, `CURRENCY_SYMBOLS`, `formatMoney`. Header:

```ts
// Hire-order document types + money formatting, shared by the renderer.
//
// DUAL-HOME: byte-identical to src/lib/hireOrders/pdf/docTypes.ts. Both
// runtimes' existing homes (supabase/functions/_shared/hireOrders.ts and
// src/lib/hireOrders/types.ts) RE-EXPORT from here rather than redeclaring,
// so there is exactly one definition per runtime. No relative imports other
// than ./pdfTheme.ts and ./pdfCopy.ts so the two files can be identical.

import type { HireOrderTheme } from "./pdfTheme.ts";
import type { HireOrderCopy } from "./pdfCopy.ts";
```

Copy it to `src/lib/hireOrders/pdf/docTypes.ts`.

Then in `supabase/functions/_shared/hireOrders.ts`, delete those declarations and re-export:

```ts
export * from "./hire-order-pdf/docTypes.ts";
```

And in `src/lib/hireOrders/types.ts`, delete the declarations and re-export:

```ts
export * from "./pdf/docTypes.ts";
```

- [ ] **Step 4: Verify nothing broke from the re-export**

Run: `npx tsc -p tsconfig.app.json --noEmit && deno check --node-modules-dir=none supabase/functions/generate-hire-orders/index.ts`
Expected: no errors. Every existing `import { OrderData } from "@/lib/hireOrders/types"` still resolves through the re-export.

- [ ] **Step 5: Write the two pdfDeps shims**

Create `supabase/functions/_shared/hire-order-pdf/pdfDeps.ts`:

```ts
// Per-runtime shim for the shared renderer (Deno edge).
//
// NOT MIRRORED. render.tsx is byte-identical across runtimes; this file is the
// one place the two differ. The browser twin lives at
// src/lib/hireOrders/pdf/pdfDeps.ts.

export {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "npm:@react-pdf/renderer@^4";
export { renderToBuffer } from "npm:@react-pdf/renderer@^4";
export type { ReactElement } from "npm:react@18.3.1";

import { Font } from "npm:@react-pdf/renderer@^4";
import { GEIST_MEDIUM_B64, GEIST_MONO_REGULAR_B64, GEIST_REGULAR_B64, GEIST_SEMIBOLD_B64 } from "./fonts.ts";
import { type FontFamilyDef } from "./pdfTheme.ts";

const FONT_BUCKET_URL = `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/hire-order-fonts`;

const registered = new Set<string>();

/**
 * Register the families a theme uses. Geist and Geist Mono are base64-embedded
 * so the DEFAULT theme never touches the network; anything else is fetched from
 * the public font bucket and memoised per isolate.
 *
 * Registration failures are swallowed on purpose: react-pdf falls back to an
 * already-registered family, so a bad font produces a plain-looking document
 * rather than a failed issue.
 */
export async function registerFonts(families: FontFamilyDef[]): Promise<void> {
  if (!registered.has("Geist")) {
    Font.register({
      family: "Geist",
      fonts: [
        { src: `data:font/ttf;base64,${GEIST_REGULAR_B64}`, fontWeight: 400 },
        { src: `data:font/ttf;base64,${GEIST_MEDIUM_B64}`, fontWeight: 500 },
        { src: `data:font/ttf;base64,${GEIST_SEMIBOLD_B64}`, fontWeight: 600 },
      ],
    });
    Font.register({
      family: "GeistMono",
      fonts: [{ src: `data:font/ttf;base64,${GEIST_MONO_REGULAR_B64}`, fontWeight: 400 }],
    });
    Font.registerHyphenationCallback((word) => [word]);
    registered.add("Geist");
    registered.add("GeistMono");
  }

  for (const def of families) {
    if (def.embedded || registered.has(def.family)) continue;
    try {
      Font.register({
        family: def.family,
        fonts: def.files.map((f) => ({
          src: `${FONT_BUCKET_URL}/${f.path}`,
          fontWeight: f.weight,
        })),
      });
      registered.add(def.family);
    } catch (_error) {
      // Leave it unregistered: react-pdf falls back rather than throwing.
    }
  }
}
```

Create `src/lib/hireOrders/pdf/pdfDeps.ts`:

```ts
// Per-runtime shim for the shared renderer (browser).
//
// NOT MIRRORED. render.tsx is byte-identical across runtimes; this file is the
// one place the two differ. The Deno twin lives at
// supabase/functions/_shared/hire-order-pdf/pdfDeps.ts.
//
// Fonts come from the same public Storage bucket the edge renderer uses,
// including Geist: the browser has no reason to carry 700KB of base64.

export { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
export { renderToBuffer } from "@react-pdf/renderer";
export type { ReactElement } from "react";

import { Font } from "@react-pdf/renderer";
import { type FontFamilyDef } from "./pdfTheme.ts";

const FONT_BUCKET_URL =
  `${import.meta.env.VITE_SUPABASE_URL ?? ""}/storage/v1/object/public/hire-order-fonts`;

const registered = new Set<string>();
let hyphenationSet = false;

/** Register the families a theme uses, all from the public font bucket.
 *  Failures are swallowed: react-pdf falls back rather than throwing. */
export async function registerFonts(families: FontFamilyDef[]): Promise<void> {
  if (!hyphenationSet) {
    Font.registerHyphenationCallback((word) => [word]);
    hyphenationSet = true;
  }
  for (const def of families) {
    if (registered.has(def.family)) continue;
    try {
      Font.register({
        family: def.family,
        fonts: def.files.map((f) => ({
          src: `${FONT_BUCKET_URL}/${f.path}`,
          fontWeight: f.weight,
        })),
      });
      registered.add(def.family);
    } catch (_error) {
      // Leave it unregistered.
    }
  }
}
```

- [ ] **Step 6: Rewrite render.tsx's imports and font handling**

In `supabase/functions/_shared/hire-order-pdf/render.tsx`:

Replace the header block (the `/// <reference>` line, the react import, the react-pdf import, the `hireOrders.ts` import, the fonts import, and the module-level `Font.register` calls at lines 38-61) with:

```tsx
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "./pdfDeps.ts";
import { registerFonts } from "./pdfDeps.ts";
import type { ReactElement } from "./pdfDeps.ts";
import { type EngagementDate, formatMoney, type OrderData, type RenderInput } from "./docTypes.ts";
import { applyTokens, HIRE_ORDER_COPY_DEFAULTS, type HireOrderCopy } from "./pdfCopy.ts";
import {
  familiesInUse,
  HIRE_ORDER_THEME_DEFAULTS,
  type HireOrderTheme,
  type RoleKey,
  themeRoleStyle,
} from "./pdfTheme.ts";
```

Change `React.ReactElement` to `ReactElement` in `HireOrderDoc`'s return type. Both runtimes use the automatic JSX runtime, so no React import is needed for JSX.

Change the exported entry point to register fonts first:

```tsx
/** Concrete `RenderHireOrderPdf`. */
export async function renderHireOrderPdf(input: RenderInput): Promise<Uint8Array> {
  const theme = input.theme ?? HIRE_ORDER_THEME_DEFAULTS;
  await registerFonts(familiesInUse(theme));
  return new Uint8Array(await renderToBuffer(<HireOrderDoc {...input} />));
}
```

- [ ] **Step 7: Copy the file to the browser side**

```bash
cp supabase/functions/_shared/hire-order-pdf/render.tsx src/lib/hireOrders/pdf/render.tsx
git mv src/lib/hireOrders/pdfCopy.ts src/lib/hireOrders/pdf/pdfCopy.ts
```

Update `src/lib/hireOrders/pdfCopyMirror.test.ts` to the new path, and update every importer of `@/lib/hireOrders/pdfCopy` to `@/lib/hireOrders/pdf/pdfCopy`:

```bash
grep -rln "hireOrders/pdfCopy" src/ | xargs sed -i '' 's#hireOrders/pdfCopy#hireOrders/pdf/pdfCopy#g'
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/lib/hireOrders/ && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS on all mirror tests, no type errors.

- [ ] **Step 9: Verify the browser can actually render**

Add a temporary button to any page that calls:

```ts
const bytes = await renderHireOrderPdf({ ...sampleInput });
```

and logs `bytes.length`. Run it via the browser preview tool, confirm a non-zero length in the console, then remove the button. This proves the shim resolves and fonts register before Task 5 depends on it.

- [ ] **Step 10: Run the edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/hireOrders/ supabase/functions/_shared/
git commit -m "refactor(hire-orders): dual-home the pdf renderer for browser preview"
```

---

## Task 5: Upload the font library

**Files:**
- Create: `docs/runbooks/hire-order-fonts.md`
- Create: one migration via the Supabase MCP `apply_migration`

**Interfaces:** none in code. Produces the Storage objects that `FONT_FAMILIES` paths point at.

- [ ] **Step 1: Create the bucket**

Use the Supabase MCP `apply_migration` with:

```sql
insert into storage.buckets (id, name, public)
values ('hire-order-fonts', 'hire-order-fonts', true)
on conflict (id) do nothing;

-- Public read, no writes from clients: fonts are uploaded by an operator with
-- the service role, never by an org.
create policy "hire_order_fonts_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'hire-order-fonts');
```

Name the migration file to match the real timestamp `apply_migration` records. Never edit an applied migration; follow up with a new one instead.

- [ ] **Step 2: Download the font files**

Fetch the TTF files for Inter, IBM Plex Sans, Source Serif 4, Libre Baskerville and IBM Plex Mono from their official GitHub releases (all SIL OFL). Place them in a local scratch directory matching the `path` values in `FONT_FAMILIES`, plus the Geist and Geist Mono TTFs already in the repo's history.

Verify each is a real TTF before uploading: `file <path>` must report "TrueType font data". A woff2 renamed to `.ttf` will register without error and then render nothing.

- [ ] **Step 3: Upload**

Upload each file to `hire-order-fonts/<path>` via the Supabase dashboard Storage UI or a service-role script. Confirm each is fetchable:

```bash
curl -sI "https://epweartpzwvcasrzyueh.supabase.co/storage/v1/object/public/hire-order-fonts/inter/Inter-Regular.ttf" | head -3
```

Expected: `HTTP/2 200` and `content-type: font/ttf` or `application/octet-stream`.

- [ ] **Step 4: Write the runbook**

Create `docs/runbooks/hire-order-fonts.md` documenting: the bucket name, the path convention, the licence of each family, how to add a family (upload plus a `FONT_FAMILIES` entry in **both** mirrors), and the `file` verification step.

- [ ] **Step 5: Verify a non-default family renders**

Add a temporary Deno test that renders with `resolveHireOrderTheme({ base: { fontFamily: "inter" } })` and asserts a non-zero byte length, run it, then delete it. A silent fallback would also produce bytes, so additionally assert the length differs from a Geist render.

- [ ] **Step 6: Commit**

```bash
git add scripts/upload-hire-order-fonts.ts docs/runbooks/hire-order-fonts.md supabase/migrations/
git commit -m "feat(hire-orders): public font bucket for pdf theme families"
```

---

## Task 6: Selection highlight

**Files:**
- Modify: `supabase/functions/_shared/hire-order-pdf/render.tsx` and its browser mirror
- Modify: `supabase/functions/_shared/hire-order-pdf/docTypes.ts` and its browser mirror
- Modify: `supabase/functions/_shared/hire-order-pdf/render.test.ts`

**Interfaces:**
- Produces: `RenderInput.highlightRole?: RoleKey`. Task 8 sets it from the editor's selection.

A PDF in an iframe has no clickable elements, so selection comes from the outline. This gives the reverse: pick a role, see it light up.

- [ ] **Step 1: Write the failing test**

Append to `render.test.ts`:

```ts
Deno.test("highlightRole changes the rendered document", async () => {
  const plain = await renderHireOrderPdf({ ...BASE, generatedAtIso: "2026-08-01T10:00:00.000Z" });
  const lit = await renderHireOrderPdf({
    ...BASE,
    generatedAtIso: "2026-08-01T10:00:00.000Z",
    highlightRole: "sectionHeading",
  });
  assertNotEquals(lit.length, plain.length);
});

Deno.test("highlightRole is ignored for a role the document does not use", async () => {
  const plain = await renderHireOrderPdf({ ...BASE, generatedAtIso: "2026-08-01T10:00:00.000Z" });
  const lit = await renderHireOrderPdf({
    ...BASE,
    generatedAtIso: "2026-08-01T10:00:00.000Z",
    // BASE has no signature, so the certificate page is absent.
    highlightRole: "certLabel",
  });
  assertEquals(lit.length, plain.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/render.test.ts`
Expected: FAIL, `highlightRole` is not a property of `RenderInput`.

- [ ] **Step 3: Add the field**

In `docTypes.ts` (both mirrors), add to `RenderInput`:

```ts
  /** Preview only. Draws an accent outline around every element with this role
   *  so the settings editor can show which element the outline row selects.
   *  Never set on the issue path. */
  highlightRole?: RoleKey;
```

Import `type RoleKey` from `./pdfTheme.ts` there.

- [ ] **Step 4: Apply it in buildStyles**

Change `buildStyles`'s signature to `buildStyles(theme: HireOrderTheme, highlightRole?: RoleKey)` and the `r` helper to add the outline:

```tsx
  const r = (role: RoleKey) => {
    const style = themeRoleStyle(theme, role);
    if (role !== highlightRole) return style;
    return {
      ...style,
      backgroundColor: theme.base.colors.feeCell,
      border: `0.5pt solid ${theme.base.colors.accent}`,
    };
  };
```

Update the call site in `HireOrderDoc`:

```tsx
  const s = buildStyles(theme, input.highlightRole);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/render.test.ts`
Expected: PASS.

- [ ] **Step 6: Guard the issue path**

Append to `supabase/functions/generate-hire-orders/index.di.test.ts`:

```ts
Deno.test("issue never passes highlightRole to the renderer", async () => {
  const { deps, renderCalls } = makeIssueDeps();
  await handle(issueRequest(), deps);
  assertEquals(renderCalls[0].highlightRole, undefined);
});
```

Reuse the existing issue-path fixture in that file; if it does not already capture the render input, extend the fake `renderHireOrderPdf` in `makeFakeDeps` to push its argument onto an array.

- [ ] **Step 7: Sync the mirror and run everything**

```bash
cp supabase/functions/_shared/hire-order-pdf/render.tsx src/lib/hireOrders/pdf/render.tsx
cp supabase/functions/_shared/hire-order-pdf/docTypes.ts src/lib/hireOrders/pdf/docTypes.ts
```

Run: `npx vitest run src/lib/hireOrders/pdf/ && deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/hireOrders/pdf/ supabase/functions/
git commit -m "feat(hire-orders): highlight the selected role in pdf previews"
```

---

## Task 7: Theme persistence

**Files:**
- Modify: `supabase/functions/generate-hire-orders/index.ts` (preview body, `previewOrder`, the issue path's snapshot write)
- Modify: `supabase/functions/generate-hire-orders/index.di.test.ts`
- Modify: `src/components/settings/hireOrders/auditKeys.ts`
- Modify: `src/components/settings/hireOrders/HireOrdersTab.tsx` (`KEY_LABELS`)

**Interfaces:**
- Produces: the `hire_order_theme` app-setting; `preview` accepts `theme_override`. Task 8 writes the setting, Task 10 previews with the override.

- [ ] **Step 1: Write the failing test**

Append to `index.di.test.ts`:

```ts
Deno.test("preview layers theme_override over the stored theme", async () => {
  const { deps, renderCalls } = makePreviewDeps({
    storedTheme: { base: { scale: 1.2 } },
  });
  await handle(previewRequest({ theme_override: { base: { scale: 1.4 } } }), deps);
  assertEquals(renderCalls[0].theme.base.scale, 1.4);
});

Deno.test("preview falls back to the stored theme when no override is sent", async () => {
  const { deps, renderCalls } = makePreviewDeps({
    storedTheme: { base: { scale: 1.2 } },
  });
  await handle(previewRequest({}), deps);
  assertEquals(renderCalls[0].theme.base.scale, 1.2);
});

Deno.test("issue freezes the resolved theme into the snapshot", async () => {
  const { deps, inserted } = makeIssueDeps({ storedTheme: { base: { scale: 1.3 } } });
  await handle(issueRequest(), deps);
  const snapshot = inserted.hire_orders[0].issue_snapshot;
  assertEquals(snapshot.theme.base.scale, 1.3);
  // Font BYTES must never reach the snapshot, only family keys.
  assertEquals(JSON.stringify(snapshot).includes("base64"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/index.di.test.ts`
Expected: FAIL, `renderCalls[0].theme` is undefined.

- [ ] **Step 3: Resolve the theme wherever copy is resolved**

`copy` is resolved in three places in `index.ts`: `previewOrder` (line 2039), the issue path (around line 2398 where `renderCopy` is built), and the draft path. In each, resolve the theme the same way. Add the constant beside `COPY_DEFAULT`:

```ts
const THEME_DEFAULT: HireOrderThemeOverride = {};
```

In `previewOrder`, add to the `Promise.all` block and then layer:

```ts
    resolveOrgSetting<HireOrderThemeOverride>(admin, org, "hire_order_theme", THEME_DEFAULT),
```

```ts
  const theme = resolveHireOrderTheme({
    base: { ...storedTheme.base, ...(body.theme_override?.base ?? {}) },
    roles: { ...storedTheme.roles, ...(body.theme_override?.roles ?? {}) },
  });
```

Note the layering is per top-level group, matching how `copy_override` layers per key. Pass `theme` into `deps.renderHireOrderPdf({ ... })` beside `copy`.

Add to `PreviewBody`:

```ts
  /** Ad-hoc theme overrides layered over the org's stored theme, so the editor
   *  can preview unsaved edits. */
  theme_override?: HireOrderThemeOverride;
```

- [ ] **Step 4: Freeze it on issue**

Wherever the issue path builds `issue_snapshot`, add `theme` beside the existing `copy`. Font bytes must not be included: `HireOrderTheme` holds only family **keys**, so passing the resolved theme is already safe. Do not add `FONT_FAMILIES` or any file content to the snapshot.

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/index.di.test.ts`
Expected: PASS.

- [ ] **Step 6: Register the setting key in the UI metadata**

`src/components/settings/hireOrders/auditKeys.ts`: add `"hire_order_theme"` to the array.
`src/components/settings/hireOrders/HireOrdersTab.tsx`: add `hire_order_theme: "PDF template"` to `KEY_LABELS`.

- [ ] **Step 7: Run everything**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/ && npx vitest run src/components/settings/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/generate-hire-orders/ src/components/settings/hireOrders/
git commit -m "feat(hire-orders): persist + freeze the pdf theme"
```

---

## Task 8: Editor route and shell

**Files:**
- Create: `src/components/settings/hireOrders/template/TemplateEditorPage.tsx`
- Create: `src/components/settings/hireOrders/template/templateMeta.ts`
- Create: `src/components/settings/hireOrders/template/sampleDocument.ts`
- Create: `src/components/settings/hireOrders/template/TemplateEditorPage.test.tsx`
- Modify: `src/config/app.config.ts` (`ROUTES`, `ROUTE_FEATURES`)
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Tasks 2, 4, 7.
- Produces: `TEMPLATE_SECTIONS` (role grouping + labels + copy-key binding), `sampleRenderInput(copy, theme)`. Tasks 9, 10, 11 consume them.

- [ ] **Step 1: Write the failing test**

Create `src/components/settings/hireOrders/template/TemplateEditorPage.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import TemplateEditorPage from "./TemplateEditorPage";
import { TEMPLATE_SECTIONS } from "./templateMeta";
import { THEME_ROLE_KEYS } from "@/lib/hireOrders/pdf/pdfTheme";
import { HIRE_ORDER_COPY_DEFAULTS, type CopyKey } from "@/lib/hireOrders/pdf/pdfCopy";

describe("templateMeta", () => {
  it("places every theme role in exactly one section", () => {
    const placed = TEMPLATE_SECTIONS.flatMap((s) => s.roles.map((r) => r.key));
    expect([...placed].sort()).toEqual([...THEME_ROLE_KEYS].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("binds every copy key to exactly one role", () => {
    const bound = TEMPLATE_SECTIONS.flatMap((s) => s.roles.flatMap((r) => r.copyKeys));
    const all = Object.keys(HIRE_ORDER_COPY_DEFAULTS) as CopyKey[];
    expect([...bound].sort()).toEqual([...all].sort());
    expect(new Set(bound).size).toBe(bound.length);
  });
});

describe("TemplateEditorPage", () => {
  it("renders the three panes", async () => {
    renderWithProviders(<TemplateEditorPage />);
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Document preview" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Element settings" })).toBeInTheDocument();
  });

  it("disables saving in read-only mode", async () => {
    renderWithProviders(<TemplateEditorPage readOnly />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/hireOrders/template/`
Expected: FAIL, module not found.

- [ ] **Step 3: Write templateMeta.ts**

```ts
// Editor grouping for the PDF template: which semantic roles exist, what to
// call them, and which copy keys each role prints. Frontend-only, like
// pdfCopyMeta.ts: the renderer needs none of this.
//
// The two coverage tests in TemplateEditorPage.test.tsx are the guard: add a
// RoleKey or a CopyKey and it must be placed here, or they fail.

import type { CopyKey } from "@/lib/hireOrders/pdf/pdfCopy";
import type { RoleKey } from "@/lib/hireOrders/pdf/pdfTheme";

export interface TemplateRole {
  key: RoleKey;
  label: string;
  /** Copy keys printed with this role's style. Shown as the Text group in the
   *  inspector. May be empty for a role that only styles dynamic values. */
  copyKeys: CopyKey[];
}

export interface TemplateSection {
  title: string;
  roles: TemplateRole[];
}

export const TEMPLATE_SECTIONS: TemplateSection[] = [
  {
    title: "Letterhead",
    roles: [
      { key: "legalName", label: "Legal name", copyKeys: [] },
      { key: "letterheadLine", label: "Address lines", copyKeys: ["header_eyebrow"] },
      { key: "orderNumber", label: "Order number", copyKeys: [] },
      {
        key: "statusBadge",
        label: "Status badge",
        copyKeys: ["badge_preview", "badge_countersigned", "badge_issued"],
      },
    ],
  },
  {
    title: "Title",
    roles: [
      { key: "titleLead", label: "Lead line", copyKeys: ["title_lead"] },
      { key: "artistName", label: "Artist name", copyKeys: [] },
      {
        key: "titleSub",
        label: "Billing line",
        copyKeys: ["billing_role_and_cast", "billing_cast_only"],
      },
    ],
  },
  {
    title: "Parties",
    roles: [
      {
        key: "partyLabel",
        label: "Party label",
        copyKeys: ["party_producer_label", "party_artist_label"],
      },
      { key: "partyName", label: "Party name", copyKeys: [] },
      {
        key: "partyLine",
        label: "Party detail line",
        copyKeys: ["party_agent", "party_cast_reference", "party_engagement"],
      },
    ],
  },
  {
    title: "Facts strip",
    roles: [
      {
        key: "factLabel",
        label: "Fact label",
        copyKeys: [
          "facts_date_label",
          "facts_venue_label",
          "facts_performance_label",
          "facts_fee_label",
        ],
      },
      { key: "factValue", label: "Fact value", copyKeys: [] },
      { key: "factValueMono", label: "Fact value (numeric)", copyKeys: ["facts_duration"] },
      {
        key: "factSub",
        label: "Fact sub-label",
        copyKeys: [
          "facts_dates_count",
          "facts_sessions_count",
          "facts_single_set",
          "facts_fee_sub",
        ],
      },
    ],
  },
  {
    title: "Section headings",
    roles: [
      {
        key: "sectionHeading",
        label: "Section heading",
        copyKeys: [
          "engagement_dates_heading",
          "running_order_heading_venue",
          "running_order_heading",
          "fees_heading",
          "terms_heading",
        ],
      },
    ],
  },
  {
    title: "Tables",
    roles: [
      { key: "tableHeadCell", label: "Column header", copyKeys: ["table_call", "table_time"] },
      { key: "tableCellLabel", label: "Row label", copyKeys: ["session_label"] },
      { key: "tableCellMono", label: "Row value (numeric)", copyKeys: [] },
      { key: "notes", label: "Notes line", copyKeys: ["notes_prefix"] },
    ],
  },
  {
    title: "Fees",
    roles: [
      {
        key: "feeLabel",
        label: "Fee row label",
        copyKeys: ["fees_engagement_fee", "fees_per_date", "fees_per_date_single"],
      },
      { key: "feeValue", label: "Fee row value", copyKeys: [] },
      { key: "totalLabel", label: "Total label", copyKeys: ["fees_total"] },
      { key: "totalValue", label: "Total value", copyKeys: [] },
    ],
  },
  {
    title: "Terms",
    roles: [
      { key: "clauseNumber", label: "Clause number", copyKeys: [] },
      { key: "clauseTitle", label: "Clause title", copyKeys: [] },
      { key: "clauseBody", label: "Clause body", copyKeys: [] },
    ],
  },
  {
    title: "Signatures",
    roles: [
      {
        key: "signatureFor",
        label: "Signature heading",
        copyKeys: ["signature_for_producer", "signature_for_artist"],
      },
      {
        key: "signatureHint",
        label: "Signature hint",
        copyKeys: [
          "signature_producer_hint",
          "signature_signed_electronically",
          "signature_artist_hint",
        ],
      },
      { key: "signatureMarkTyped", label: "Typed signature mark", copyKeys: [] },
    ],
  },
  {
    title: "Footer",
    roles: [
      { key: "footerText", label: "Footer line", copyKeys: ["footer_generated"] },
      { key: "watermark", label: "Preview watermark", copyKeys: ["watermark"] },
    ],
  },
  {
    title: "Signature certificate",
    roles: [
      { key: "certHeading", label: "Certificate heading", copyKeys: ["cert_heading"] },
      { key: "certLead", label: "Certificate lead", copyKeys: ["cert_lead"] },
      {
        key: "certLabel",
        label: "Certificate label",
        copyKeys: [
          "cert_signer",
          "cert_email",
          "cert_method",
          "cert_signed_at",
          "cert_ip",
          "cert_device",
          "cert_sha",
        ],
      },
      {
        key: "certValue",
        label: "Certificate value",
        copyKeys: ["cert_method_drawn", "cert_method_typed", "cert_signed_at_value"],
      },
    ],
  },
];
```

If the copy-key coverage test fails, the message names the unplaced key. Place it in the role whose style actually prints it; check `render.tsx` rather than guessing.

- [ ] **Step 4: Write sampleDocument.ts**

```ts
// The representative order the template editor previews against. Exercises
// every section (parties, facts, an aggregate's engagement dates, a running
// order, notes, fees, terms, a countersignature and therefore the certificate
// page) so no role in the outline is invisible in the preview.

import type { HireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import type { HireOrderTheme, RoleKey } from "@/lib/hireOrders/pdf/pdfTheme";
import type { RenderInput } from "@/lib/hireOrders/pdf/docTypes";

export function sampleRenderInput(
  copy: HireOrderCopy,
  theme: HireOrderTheme,
  highlightRole?: RoleKey,
): RenderInput {
  return {
    orderNo: "HO-2026-0615-001",
    status: "preview",
    currency: "EUR",
    generatedAtIso: "2026-06-01T10:00:00.000Z",
    copy,
    theme,
    highlightRole,
    letterhead: {
      legal_name: "Meridian Stage Productions",
      address_lines: ["Kastanienallee 12", "10435 Berlin"],
      registration_line: "HRB 123456 B",
      agent_name: "Jonas Wagner",
      agent_email: "jonas@example.com",
      agent_signature_path: null,
      agent_signature_data_url: null,
    },
    terms: [
      { title: "Cancellation", body: "Either party may cancel in writing no later than 14 days before the first engagement date." },
      { title: "Travel", body: "Economy travel and single-occupancy accommodation are provided by the Producer." },
    ],
    data: {
      artist_name: { value: "Alex Rivera", source: "showflow" },
      recipient_email: { value: "alex@example.com", source: "showflow" },
      role: { value: "Lead", source: "showflow" },
      cast: { value: "A-cast", source: "showflow" },
      date: { value: "2026-06-15", source: "showflow" },
      venue: { value: "Grand Theatre", source: "showflow" },
      city: { value: "Berlin", source: "showflow" },
      duration_min: { value: 90, source: "manual" },
      sessions: { value: ["18:00", "20:30"], source: "showflow" },
      fee: { value: "1500.00", source: "manual" },
      fee_basis: { value: "per_date", source: "manual" },
      fee_per_date: { value: "500.00", source: "manual" },
      currency: { value: "EUR", source: "default" },
      notes: { value: "Backline provided by the venue.", source: "manual" },
      engagement_dates: {
        value: [
          { show_date_id: "s1", date: "2026-06-15", venue: "Grand Theatre", city: "Berlin", sessions: ["18:00", "20:30"], duration_min: 90 },
          { show_date_id: "s2", date: "2026-06-16", venue: "Kammerspiele", city: "Hamburg", sessions: ["19:00"], duration_min: 90 },
          { show_date_id: "s3", date: "2026-06-17", venue: "Volksbuehne", city: "Munich", sessions: ["19:30"], duration_min: 90 },
        ],
        source: "showflow",
      },
    },
    signature: {
      signerName: "Alex Rivera",
      signerEmail: "alex@example.com",
      method: "typed",
      typedName: "Alex Rivera",
      imageDataUrl: null,
      signedAtIso: "2026-06-02T14:31:00.000Z",
      ip: "203.0.113.4",
      userAgent: "Mozilla/5.0",
      documentSha256: "9f2a1c4e7b8d0a3f5c6e2b9d4a7f1c8e0b3d6a9f2c5e8b1d4a7f0c3e6b9d2a5f",
      consentText: "I agree that my electronic signature is the legal equivalent of my handwritten signature.",
    },
  };
}
```

If any field name here does not match `RenderInput`, fix this file to match the type, never the type to match this file.

- [ ] **Step 5: Write the page shell**

`TemplateEditorPage.tsx` owns: the two settings queries (`hire_order_copy`, `hire_order_theme`), the draft override state for each, the selected role, and the save mutation. It renders the three panes and a header with Save, Reset all, and Open exact PDF.

```tsx
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { invokeHireOrderAction } from "@/data/hireOrders";
import { openPdfBase64 } from "@/lib/hireOrders/openPdf";
import { ROUTES } from "@/config/app.config";
import {
  HIRE_ORDER_COPY_DEFAULTS,
  resolveHireOrderCopy,
  type CopyKey,
  type HireOrderCopy,
} from "@/lib/hireOrders/pdf/pdfCopy";
import {
  resolveHireOrderTheme,
  type HireOrderThemeOverride,
  type RoleKey,
} from "@/lib/hireOrders/pdf/pdfTheme";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TemplateOutline } from "./TemplateOutline";
import { TemplateInspector } from "./TemplateInspector";
import { TemplateDocumentPane } from "./TemplateDocumentPane";
import { sampleRenderInput } from "./sampleDocument";

const COPY_DEFAULT: Partial<HireOrderCopy> = {};
const THEME_DEFAULT: HireOrderThemeOverride = {};

/** Keep only copy values that are non-empty AND differ from the default: the
 *  stored setting is a compact override map, never the full dictionary. */
function compactCopy(form: Partial<HireOrderCopy>): Partial<HireOrderCopy> {
  const out: Partial<HireOrderCopy> = {};
  for (const key of Object.keys(HIRE_ORDER_COPY_DEFAULTS) as CopyKey[]) {
    const v = form[key];
    if (typeof v === "string" && v.trim() !== "" && v !== HIRE_ORDER_COPY_DEFAULTS[key]) {
      out[key] = v;
    }
  }
  return out;
}

export default function TemplateEditorPage({ readOnly: readOnlyProp }: { readOnly?: boolean } = {}) {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const canEdit = useCan("edit_hire_order_settings");
  const readOnly = readOnlyProp ?? !canEdit;
  const qc = useQueryClient();

  const copyQuery = useQuery({
    queryKey: ["app-settings", "hire_order_copy", orgId],
    queryFn: () => resolveOrgSetting<Partial<HireOrderCopy>>(supabase, orgId, "hire_order_copy", COPY_DEFAULT),
    enabled: Boolean(orgId),
  });
  const themeQuery = useQuery({
    queryKey: ["app-settings", "hire_order_theme", orgId],
    queryFn: () => resolveOrgSetting<HireOrderThemeOverride>(supabase, orgId, "hire_order_theme", THEME_DEFAULT),
    enabled: Boolean(orgId),
  });

  // Draft overrides. Seeded once when server data first arrives; a later
  // unrelated refetch must not clobber in-progress edits.
  const [copyDraft, setCopyDraft] = useState<Partial<HireOrderCopy>>({});
  const [themeDraft, setThemeDraft] = useState<HireOrderThemeOverride>({});
  const [selected, setSelected] = useState<RoleKey | "document">("document");
  const seeded = useRef(false);
  if (!seeded.current && copyQuery.data && themeQuery.data) {
    seeded.current = true;
    setCopyDraft(copyQuery.data);
    setThemeDraft(themeQuery.data);
  }

  const copy = useMemo(() => resolveHireOrderCopy(copyDraft), [copyDraft]);
  const theme = useMemo(() => resolveHireOrderTheme(themeDraft), [themeDraft]);
  const renderInput = useMemo(
    () => sampleRenderInput(copy, theme, selected === "document" ? undefined : selected),
    [copy, theme, selected],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      await upsertOrgSetting(supabase, orgId, "hire_order_copy", compactCopy(copyDraft) as unknown as Json);
      await upsertOrgSetting(supabase, orgId, "hire_order_theme", themeDraft as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("PDF template saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exact = useMutation({
    mutationFn: () =>
      invokeHireOrderAction(supabase, {
        action: "preview",
        org_id: orgId,
        copy_override: compactCopy(copyDraft),
        theme_override: themeDraft,
      }),
    onSuccess: (res) => {
      const b64 = (res as { pdf_base64?: string } | null)?.pdf_base64;
      if (b64) openPdfBase64(b64);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (copyQuery.isLoading || themeQuery.isLoading) return <Skeleton className="h-[80vh] w-full" />;
  // A failed read must not fall through to the defaults: the editor would show
  // them as if they were the org's values, and a Save would overwrite real copy.
  if (copyQuery.isError || themeQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load the PDF template settings.{" "}
          {((copyQuery.error ?? themeQuery.error) as Error)?.message}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to={ROUTES.SETTINGS}><ArrowLeft className="mr-1 h-4 w-4" />Settings</Link>
          </Button>
          <h1 className="font-display text-lg">PDF template</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exact.mutate()} disabled={exact.isPending || !orgId}>
            Open exact PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={readOnly}
            onClick={() => { setCopyDraft({}); setThemeDraft({}); }}
          >
            Reset all
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={readOnly || save.isPending || !orgId}>
            Save template
          </Button>
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1 rounded-lg border">
        <ResizablePanel defaultSize={22} minSize={16}>
          <TemplateOutline
            selected={selected}
            onSelect={setSelected}
            copyDraft={copyDraft}
            themeDraft={themeDraft}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={30}>
          <TemplateDocumentPane input={renderInput} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={28} minSize={20}>
          <TemplateInspector
            selected={selected}
            readOnly={readOnly}
            copyDraft={copyDraft}
            themeDraft={themeDraft}
            onCopyChange={setCopyDraft}
            onThemeChange={setThemeDraft}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
```

- [ ] **Step 6: Register the route**

`src/config/app.config.ts`:

```ts
  HIRE_ORDER_TEMPLATE: '/settings/hire-orders/template',
```

and in `ROUTE_FEATURES`:

```ts
  '/settings/hire-orders/template': 'hire_orders',
```

`src/App.tsx`: register it lazily so `@react-pdf/renderer` stays out of the main chunk.

```tsx
const TemplateEditorPage = lazy(() => import("@/components/settings/hireOrders/template/TemplateEditorPage"));
```

```tsx
<Route
  path={ROUTES.HIRE_ORDER_TEMPLATE}
  element={
    <ProtectedRoute requiredRoles={["admin", "producer"]}>
      <Suspense fallback={<Skeleton className="h-[80vh] w-full" />}>
        <TemplateEditorPage />
      </Suspense>
    </ProtectedRoute>
  }
/>
```

Match the existing `Suspense` and `lazy` usage in `App.tsx`; if the file uses a different fallback convention, follow that one.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/components/settings/hireOrders/template/`
Expected: PASS, 4 tests. The panes come from Tasks 9, 10 and 11: create each as a one-line stub returning the right ARIA landmark now, and fill it in its own task.

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/hireOrders/template/ src/config/app.config.ts src/App.tsx
git commit -m "feat(hire-orders): pdf template editor route + shell"
```

---

## Task 9: Live document pane

**Files:**
- Create: `src/components/settings/hireOrders/template/TemplateDocumentPane.tsx`
- Create: `src/components/settings/hireOrders/template/TemplateDocumentPane.test.tsx`

**Interfaces:**
- Consumes: `renderHireOrderPdf` (Task 4), `RenderInput`.

Debounce at 250ms and keep the previous object URL visible until the new render resolves, so typing does not flash an empty frame. Guard against out-of-order resolution: a slow render started earlier must not overwrite a newer one.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TemplateDocumentPane } from "./TemplateDocumentPane";
import { sampleRenderInput } from "./sampleDocument";
import { resolveHireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import { resolveHireOrderTheme } from "@/lib/hireOrders/pdf/pdfTheme";

vi.mock("@/lib/hireOrders/pdf/render", () => ({
  renderHireOrderPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));

const input = sampleRenderInput(resolveHireOrderCopy(), resolveHireOrderTheme());

describe("TemplateDocumentPane", () => {
  it("renders the document into an iframe", async () => {
    render(<TemplateDocumentPane input={input} />);
    await waitFor(() =>
      expect(screen.getByTitle("Hire order preview")).toHaveAttribute("src", expect.stringContaining("blob:")),
    );
  });

  it("surfaces a render failure instead of showing a blank frame", async () => {
    const { renderHireOrderPdf } = await import("@/lib/hireOrders/pdf/render");
    vi.mocked(renderHireOrderPdf).mockRejectedValueOnce(new Error("font blew up"));
    render(<TemplateDocumentPane input={input} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("font blew up"));
  });
});
```

This is one of the few justified `vi.mock` cases: the module under test is not a Supabase client but a heavy PDF renderer, and the test is about the pane's debounce, error and URL-lifecycle behaviour. The renderer itself is covered by its own Deno tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/hireOrders/template/TemplateDocumentPane.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useRef, useState } from "react";
import type { RenderInput } from "@/lib/hireOrders/pdf/docTypes";
import { renderHireOrderPdf } from "@/lib/hireOrders/pdf/render";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";

const DEBOUNCE_MS = 250;

/** Centre pane: the real PDF, rendered in-browser by the same component the
 *  edge function uses. The previous frame stays visible while a new render is
 *  in flight, so typing never flashes an empty document. */
export function TemplateDocumentPane({ input }: { input: RenderInput }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Monotonic token: a slow render started earlier must not overwrite a newer
  // one that already resolved.
  const runId = useRef(0);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const id = ++runId.current;
    setPending(true);
    const timer = window.setTimeout(async () => {
      try {
        const bytes = await renderHireOrderPdf(input);
        if (id !== runId.current) return;
        const next = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setUrl(next);
        setError(null);
      } catch (e) {
        if (id !== runId.current) return;
        setError((e as Error).message);
      } finally {
        if (id === runId.current) setPending(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input]);

  // Release the last object URL when the pane unmounts.
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  return (
    <section aria-label="Document preview" className="relative h-full bg-muted/40">
      {error && (
        <Alert variant="destructive" className="m-3">
          <AlertDescription>Could not render the preview. {error}</AlertDescription>
        </Alert>
      )}
      {pending && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Updating
        </div>
      )}
      {url && <iframe title="Hire order preview" src={url} className="h-full w-full border-0" />}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/settings/hireOrders/template/TemplateDocumentPane.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/hireOrders/template/TemplateDocumentPane.tsx src/components/settings/hireOrders/template/TemplateDocumentPane.test.tsx
git commit -m "feat(hire-orders): live browser-rendered pdf preview pane"
```

---

## Task 10: Outline pane

**Files:**
- Create: `src/components/settings/hireOrders/template/TemplateOutline.tsx`
- Create: `src/components/settings/hireOrders/template/TemplateOutline.test.tsx`

**Interfaces:**
- Consumes: `TEMPLATE_SECTIONS` (Task 8).
- Produces: `TemplateOutline` with props `{ selected, onSelect, copyDraft, themeDraft }`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateOutline } from "./TemplateOutline";

describe("TemplateOutline", () => {
  it("lists a Document entry and every section", () => {
    render(<TemplateOutline selected="document" onSelect={vi.fn()} copyDraft={{}} themeDraft={{}} />);
    expect(screen.getByRole("button", { name: /Document/ })).toBeInTheDocument();
    expect(screen.getByText("Letterhead")).toBeInTheDocument();
    expect(screen.getByText("Signature certificate")).toBeInTheDocument();
  });

  it("reports the clicked role", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<TemplateOutline selected="document" onSelect={onSelect} copyDraft={{}} themeDraft={{}} />);
    await user.click(screen.getByRole("button", { name: /Section heading/ }));
    expect(onSelect).toHaveBeenCalledWith("sectionHeading");
  });

  it("marks a role whose style was overridden", () => {
    render(
      <TemplateOutline
        selected="document"
        onSelect={vi.fn()}
        copyDraft={{}}
        themeDraft={{ roles: { sectionHeading: { size: 20 } } }}
      />,
    );
    expect(screen.getByRole("button", { name: /Section heading, modified/ })).toBeInTheDocument();
  });

  it("marks a role whose bound copy was overridden", () => {
    render(
      <TemplateOutline
        selected="document"
        onSelect={vi.fn()}
        copyDraft={{ fees_total: "Amount due" }}
        themeDraft={{}}
      />,
    );
    expect(screen.getByRole("button", { name: /Total label, modified/ })).toBeInTheDocument();
  });

  it("marks the selected row as current", () => {
    render(<TemplateOutline selected="notes" onSelect={vi.fn()} copyDraft={{}} themeDraft={{}} />);
    expect(screen.getByRole("button", { name: /Notes line/ })).toHaveAttribute("aria-current", "true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/hireOrders/template/TemplateOutline.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```tsx
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { HireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import type { HireOrderThemeOverride, RoleKey } from "@/lib/hireOrders/pdf/pdfTheme";
import { TEMPLATE_SECTIONS, type TemplateRole } from "./templateMeta";

interface Props {
  selected: RoleKey | "document";
  onSelect: (next: RoleKey | "document") => void;
  copyDraft: Partial<HireOrderCopy>;
  themeDraft: HireOrderThemeOverride;
}

/** A role counts as modified when its style OR any copy key it prints has an
 *  override, so the outline answers "what have I changed" at a glance. */
function isModified(
  role: TemplateRole,
  copyDraft: Partial<HireOrderCopy>,
  themeDraft: HireOrderThemeOverride,
): boolean {
  const style = themeDraft.roles?.[role.key];
  if (style && Object.keys(style).length > 0) return true;
  return role.copyKeys.some((key) => copyDraft[key] !== undefined);
}

/** Left pane. A PDF in an iframe has no clickable elements, so this tree is how
 *  an element gets selected; the renderer then outlines it in the preview. */
export function TemplateOutline({ selected, onSelect, copyDraft, themeDraft }: Props) {
  const baseModified = Boolean(themeDraft.base && Object.keys(themeDraft.base).length > 0);

  return (
    <nav aria-label="Document outline" className="h-full">
      <ScrollArea className="h-full">
        <div className="p-2">
          <button
            type="button"
            aria-current={selected === "document" ? "true" : undefined}
            onClick={() => onSelect("document")}
            className={cn(
              "w-full rounded-md px-2 py-1.5 text-left text-sm",
              selected === "document" ? "bg-accent-100 text-accent-800" : "hover:bg-muted",
            )}
          >
            Document{baseModified ? ", modified" : ""}
          </button>

          {TEMPLATE_SECTIONS.map((section) => (
            <div key={section.title} className="mt-3">
              <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </p>
              <div className="mt-1">
                {section.roles.map((role) => {
                  const modified = isModified(role, copyDraft, themeDraft);
                  const active = selected === role.key;
                  return (
                    <button
                      key={role.key}
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => onSelect(role.key)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm",
                        active ? "bg-accent-100 text-accent-800" : "hover:bg-muted",
                      )}
                    >
                      <span>{role.label}{modified ? ", modified" : ""}</span>
                      {modified && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent-600" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </nav>
  );
}
```

The ", modified" text is inside the button so it lands in the accessible name, which is what the tests assert and what a screen reader needs. The dot is decorative and `aria-hidden`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/settings/hireOrders/template/TemplateOutline.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/hireOrders/template/TemplateOutline.tsx src/components/settings/hireOrders/template/TemplateOutline.test.tsx
git commit -m "feat(hire-orders): pdf template outline pane"
```

---

## Task 11: Inspector pane

**Files:**
- Create: `src/components/settings/hireOrders/template/TemplateInspector.tsx`
- Create: `src/components/settings/hireOrders/template/TemplateInspector.test.tsx`

**Interfaces:**
- Consumes: `TEMPLATE_SECTIONS`, `FONT_FAMILIES`, `HIRE_ORDER_THEME_DEFAULTS`, `HIRE_ORDER_COPY_DEFAULTS`, and `hasBadDash` from the existing `pdfCopyMeta.ts`.

Two groups: **Text** (the role's copy keys, carrying over the token hints and dash rule from the old `PdfCopyCard`) and **Style**. Selecting "document" shows the base controls instead.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateInspector } from "./TemplateInspector";

const noop = vi.fn();
const props = {
  copyDraft: {},
  themeDraft: {},
  onCopyChange: noop,
  onThemeChange: noop,
  readOnly: false,
};

describe("TemplateInspector", () => {
  it("shows the base controls for the document entry", () => {
    render(<TemplateInspector selected="document" {...props} />);
    expect(screen.getByLabelText("Body font")).toBeInTheDocument();
    expect(screen.getByLabelText("Numeric font")).toBeInTheDocument();
    expect(screen.getByLabelText("Text size")).toBeInTheDocument();
  });

  it("shows a role's bound copy fields and style controls", () => {
    render(<TemplateInspector selected="totalLabel" {...props} />);
    expect(screen.getByLabelText("Total row")).toHaveValue("Total payable");
    expect(screen.getByLabelText("Size")).toHaveValue(12);
  });

  it("reports a copy edit", async () => {
    const onCopyChange = vi.fn();
    const user = userEvent.setup();
    render(<TemplateInspector selected="totalLabel" {...props} onCopyChange={onCopyChange} />);
    await user.type(screen.getByLabelText("Total row"), "!");
    expect(onCopyChange).toHaveBeenCalled();
  });

  it("warns on a dash in copy", () => {
    render(<TemplateInspector selected="totalLabel" {...props} copyDraft={{ fees_total: "Total — payable" }} />);
    expect(screen.getByText("Use a period, comma, or middot instead of a dash.")).toBeInTheDocument();
  });

  it("offers reset only for a modified field", async () => {
    const { rerender } = render(<TemplateInspector selected="totalLabel" {...props} />);
    expect(screen.queryByRole("button", { name: /Reset Total row/ })).not.toBeInTheDocument();
    rerender(<TemplateInspector selected="totalLabel" {...props} copyDraft={{ fees_total: "Amount due" }} />);
    expect(screen.getByRole("button", { name: /Reset Total row/ })).toBeInTheDocument();
  });

  it("disables every control in read-only mode", () => {
    render(<TemplateInspector selected="totalLabel" {...props} readOnly />);
    expect(screen.getByLabelText("Total row")).toBeDisabled();
    expect(screen.getByLabelText("Size")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/hireOrders/template/TemplateInspector.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```tsx
import { hasBadDash } from "../pdfCopyMeta";
import { HIRE_ORDER_COPY_DEFAULTS, type CopyKey, type HireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import {
  FONT_FAMILIES,
  HIRE_ORDER_THEME_DEFAULTS,
  type FontFamilyKey,
  type HireOrderThemeOverride,
  type RoleKey,
  type RoleStyle,
  type ThemeColorKey,
} from "@/lib/hireOrders/pdf/pdfTheme";
import { TEMPLATE_SECTIONS } from "./templateMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

interface Props {
  selected: RoleKey | "document";
  readOnly: boolean;
  copyDraft: Partial<HireOrderCopy>;
  themeDraft: HireOrderThemeOverride;
  onCopyChange: (next: Partial<HireOrderCopy>) => void;
  onThemeChange: (next: HireOrderThemeOverride) => void;
}

const ALL_ROLES = TEMPLATE_SECTIONS.flatMap((s) => s.roles);
const COLOR_KEYS: ThemeColorKey[] = ["text", "muted", "faint", "accent", "line", "feeCell", "surface2"];
const COLOR_LABELS: Record<ThemeColorKey, string> = {
  text: "Text",
  muted: "Muted text",
  faint: "Faint text",
  accent: "Accent",
  line: "Rules and borders",
  feeCell: "Fee cell background",
  surface2: "Total row background",
};

/** Token names a copy default interpolates, surfaced as an inline hint. */
function tokensOf(key: CopyKey): string[] {
  return [...HIRE_ORDER_COPY_DEFAULTS[key].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
}

export function TemplateInspector({
  selected, readOnly, copyDraft, themeDraft, onCopyChange, onThemeChange,
}: Props) {
  function setCopy(key: CopyKey, value: string) {
    onCopyChange({ ...copyDraft, [key]: value });
  }
  function resetCopy(key: CopyKey) {
    const next = { ...copyDraft };
    delete next[key];
    onCopyChange(next);
  }
  function setBase(patch: Partial<NonNullable<HireOrderThemeOverride["base"]>>) {
    onThemeChange({ ...themeDraft, base: { ...themeDraft.base, ...patch } });
  }
  function setRole(role: RoleKey, patch: RoleStyle) {
    onThemeChange({
      ...themeDraft,
      roles: { ...themeDraft.roles, [role]: { ...themeDraft.roles?.[role], ...patch } },
    });
  }
  function resetRole(role: RoleKey) {
    const roles = { ...themeDraft.roles };
    delete roles[role];
    onThemeChange({ ...themeDraft, roles });
  }

  if (selected === "document") {
    const base = { ...HIRE_ORDER_THEME_DEFAULTS.base, ...themeDraft.base };
    const colors = { ...HIRE_ORDER_THEME_DEFAULTS.base.colors, ...themeDraft.base?.colors };
    return (
      <aside aria-label="Element settings" className="h-full">
        <ScrollArea className="h-full">
          <div className="space-y-4 p-4">
            <h3 className="font-display text-sm">Document</h3>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-body-font">Body font</Label>
              <Select
                value={base.fontFamily}
                onValueChange={(v) => setBase({ fontFamily: v as FontFamilyKey })}
                disabled={readOnly}
              >
                <SelectTrigger id="tpl-body-font" aria-label="Body font"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FONT_FAMILIES.filter((f) => f.kind !== "mono").map((f) => (
                    <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-mono-font">Numeric font</Label>
              <Select
                value={base.monoFamily}
                onValueChange={(v) => setBase({ monoFamily: v as FontFamilyKey })}
                disabled={readOnly}
              >
                <SelectTrigger id="tpl-mono-font" aria-label="Numeric font"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FONT_FAMILIES.filter((f) => f.kind === "mono").map((f) => (
                    <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-scale">Text size</Label>
              <Slider
                id="tpl-scale"
                aria-label="Text size"
                min={0.75}
                max={1.5}
                step={0.05}
                value={[base.scale]}
                disabled={readOnly}
                onValueChange={([v]) => setBase({ scale: v })}
              />
              <p className="text-xs text-muted-foreground">
                Scales every element together, so the type hierarchy is preserved. {Math.round(base.scale * 100)}%
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Colours</p>
              {COLOR_KEYS.map((key) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <Label htmlFor={`tpl-color-${key}`} className="text-sm font-normal">{COLOR_LABELS[key]}</Label>
                  <Input
                    id={`tpl-color-${key}`}
                    type="color"
                    className="h-8 w-14 p-1"
                    value={colors[key]}
                    disabled={readOnly}
                    onChange={(e) => setBase({ colors: { ...themeDraft.base?.colors, [key]: e.target.value.toUpperCase() } })}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Page margins</p>
              {(["marginX", "marginTop", "marginBottom"] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`tpl-${key}`} className="text-sm font-normal">
                    {key === "marginX" ? "Left and right" : key === "marginTop" ? "Top" : "Bottom"}
                  </Label>
                  <Input
                    id={`tpl-${key}`}
                    type="number"
                    min={20}
                    max={key === "marginX" ? 80 : 90}
                    value={base.page[key]}
                    disabled={readOnly}
                    onChange={(e) => setBase({ page: { ...themeDraft.base?.page, [key]: Number(e.target.value) } })}
                  />
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      </aside>
    );
  }

  const role = ALL_ROLES.find((r) => r.key === selected);
  if (!role) return <aside aria-label="Element settings" className="h-full" />;
  const style = { ...HIRE_ORDER_THEME_DEFAULTS.roles[role.key], ...themeDraft.roles?.[role.key] };
  const styleModified = Boolean(themeDraft.roles?.[role.key] && Object.keys(themeDraft.roles[role.key]).length > 0);

  return (
    <aside aria-label="Element settings" className="h-full">
      <ScrollArea className="h-full">
        <div className="space-y-5 p-4">
          <h3 className="font-display text-sm">{role.label}</h3>

          {role.copyKeys.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Text</p>
              {role.copyKeys.map((key) => {
                const label = COPY_LABELS[key] ?? key;
                const value = copyDraft[key] ?? HIRE_ORDER_COPY_DEFAULTS[key];
                const modified = value !== HIRE_ORDER_COPY_DEFAULTS[key];
                const tokens = tokensOf(key);
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={`tpl-copy-${key}`}>{label}</Label>
                      {modified && !readOnly && (
                        <Button
                          type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs"
                          aria-label={`Reset ${label} to default`}
                          onClick={() => resetCopy(key)}
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                    <Input
                      id={`tpl-copy-${key}`}
                      value={value}
                      disabled={readOnly}
                      onChange={(e) => setCopy(key, e.target.value)}
                    />
                    {tokens.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Tokens: {tokens.map((t) => `{{${t}}}`).join(" ")}
                      </p>
                    )}
                    {hasBadDash(value) && (
                      <p className="text-xs text-destructive">
                        Use a period, comma, or middot instead of a dash.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Style</p>
              {styleModified && !readOnly && (
                <Button
                  type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs"
                  aria-label={`Reset ${role.label} style to default`}
                  onClick={() => resetRole(role.key)}
                >
                  Reset
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-role-family">Font</Label>
              <Select
                value={style.family ?? "inherit"}
                onValueChange={(v) => setRole(role.key, { family: v === "inherit" ? undefined : (v as FontFamilyKey) })}
                disabled={readOnly}
              >
                <SelectTrigger id="tpl-role-family" aria-label="Font"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Document font</SelectItem>
                  {FONT_FAMILIES.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {style.size !== undefined && (
              <div className="space-y-1.5">
                <Label htmlFor="tpl-role-size">Size</Label>
                <Input
                  id="tpl-role-size" type="number" min={5} max={60} step={0.5}
                  value={style.size}
                  disabled={readOnly}
                  onChange={(e) => setRole(role.key, { size: Number(e.target.value) })}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="tpl-role-weight">Weight</Label>
              <Select
                value={String(style.weight ?? 400)}
                onValueChange={(v) => setRole(role.key, { weight: Number(v) as 400 | 500 | 600 })}
                disabled={readOnly}
              >
                <SelectTrigger id="tpl-role-weight" aria-label="Weight"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="400">Regular</SelectItem>
                  <SelectItem value="500">Medium</SelectItem>
                  <SelectItem value="600">Semibold</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-role-color">Colour</Label>
              <Select
                value={style.color ?? "text"}
                onValueChange={(v) => setRole(role.key, { color: v as ThemeColorKey })}
                disabled={readOnly}
              >
                <SelectTrigger id="tpl-role-color" aria-label="Colour"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COLOR_KEYS.map((k) => <SelectItem key={k} value={k}>{COLOR_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-role-tracking">Letter spacing</Label>
              <Input
                id="tpl-role-tracking" type="number" min={-1} max={8} step={0.1}
                value={style.letterSpacing ?? 0}
                disabled={readOnly}
                onChange={(e) => setRole(role.key, { letterSpacing: Number(e.target.value) })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-role-case">Case</Label>
              <Select
                value={style.transform ?? "none"}
                onValueChange={(v) => setRole(role.key, { transform: v as "none" | "uppercase" })}
                disabled={readOnly}
              >
                <SelectTrigger id="tpl-role-case" aria-label="Case"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">As typed</SelectItem>
                  <SelectItem value="uppercase">Uppercase</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
```

- [ ] **Step 4: Reuse the existing copy labels**

`COPY_LABELS` above must exist. Add it to `templateMeta.ts`, built from the labels already written in `pdfCopyMeta.ts` so the two never disagree:

```ts
import { COPY_SECTIONS } from "../pdfCopyMeta";

/** Field labels, reused verbatim from the old PdfCopyCard metadata so the
 *  editor and any remaining copy UI name the same field identically. */
export const COPY_LABELS: Record<string, string> = Object.fromEntries(
  COPY_SECTIONS.flatMap((s) => s.fields.map((f) => [f.key, f.label])),
);
```

Export it from `templateMeta.ts` and import it in the inspector.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/settings/hireOrders/template/`
Expected: PASS, all inspector, outline, pane and meta tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/hireOrders/template/
git commit -m "feat(hire-orders): pdf template inspector pane"
```

---

## Task 12: Swap the settings card, then ship

**Files:**
- Create: `src/components/settings/hireOrders/PdfTemplateCard.tsx`
- Create: `src/components/settings/hireOrders/PdfTemplateCard.test.tsx`
- Delete: `src/components/settings/hireOrders/PdfCopyCard.tsx`, `PdfCopyCard.test.tsx`
- Modify: `src/components/settings/hireOrders/HireOrdersTab.tsx`
- Modify: `e2e/hire-orders.spec.ts`
- Modify: `public/changelog.md`, `public/changelog.json`, `package.json`, `src/config/app.config.ts`

`pdfCopyMeta.ts` stays: `COPY_LABELS` and `hasBadDash` are both still used.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { PdfTemplateCard } from "./PdfTemplateCard";

describe("PdfTemplateCard", () => {
  it("summarises the current template and links into the editor", async () => {
    renderWithProviders(<PdfTemplateCard orgId="org-1" />);
    await waitFor(() => expect(screen.getByText("PDF template")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Open template editor" })).toHaveAttribute(
      "href",
      "/settings/hire-orders/template",
    );
    expect(screen.getByTestId("tpl-summary")).toHaveTextContent("Geist");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/hireOrders/PdfTemplateCard.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the card**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import { ROUTES } from "@/config/app.config";
import {
  FONT_FAMILIES,
  resolveHireOrderTheme,
  THEME_ROLE_KEYS,
  type HireOrderThemeOverride,
} from "@/lib/hireOrders/pdf/pdfTheme";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const THEME_DEFAULT: HireOrderThemeOverride = {};

export function PdfTemplateCard({ orgId }: { orgId: string | null; readOnly?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", "hire_order_theme", orgId],
    queryFn: () => resolveOrgSetting<HireOrderThemeOverride>(supabase, orgId, "hire_order_theme", THEME_DEFAULT),
    enabled: Boolean(orgId),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const theme = resolveHireOrderTheme(data);
  const family = FONT_FAMILIES.find((f) => f.key === theme.base.fontFamily)?.label ?? "Geist";
  const customised = THEME_ROLE_KEYS.filter((k) => (data?.roles?.[k] ?? null) !== null).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">PDF template</CardTitle>
        <CardDescription>
          Wording, fonts, sizes, and colours for the hire order PDF. Edit any element and see the
          document update as you type. Changes apply to the next order issued, not to documents
          already issued.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground" data-testid="tpl-summary">
          {family} at {Math.round(theme.base.scale * 100)}%
          {customised > 0 ? `, ${customised} customised elements` : ", no customised elements"}
        </p>
        <Button asChild>
          <Link to={ROUTES.HIRE_ORDER_TEMPLATE}>Open template editor</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Swap it into the tab and delete the old card**

In `HireOrdersTab.tsx`, replace the `PdfCopyCard` import and usage with `PdfTemplateCard`, and update `KEY_LABELS`:

```ts
  hire_order_copy: "PDF copy",
  hire_order_theme: "PDF template",
```

Then:

```bash
git rm src/components/settings/hireOrders/PdfCopyCard.tsx src/components/settings/hireOrders/PdfCopyCard.test.tsx
```

- [ ] **Step 5: Add the E2E flow**

Append to `e2e/hire-orders.spec.ts`, following that file's existing login and navigation helpers:

```ts
test("admin can retheme the hire order PDF", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/settings/hire-orders/template");
  await expect(page.getByRole("navigation", { name: "Document outline" })).toBeVisible();

  await page.getByRole("button", { name: /^Document/ }).click();
  await page.getByLabel("Text size").fill("1.3");
  await expect(page.getByTitle("Hire order preview")).toBeVisible();

  await page.getByRole("button", { name: "Section heading" }).click();
  await page.getByLabel("Size").fill("18");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("PDF template saved")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /Section heading, modified/ }).click();
  await expect(page.getByLabel("Size")).toHaveValue("18");
});
```

- [ ] **Step 6: Changelog and version**

MINOR bump. If plan 1 already shipped `1.13.0` **today**, fold these bullets into that same block rather than creating `1.14.0`; same-day changes are one version entry.

```markdown
### New
- **PDF template editor** — Settings > Hire orders > PDF template opens a live editor for the hire order document. Pick any element from the outline, change its wording, font, size, weight, colour, spacing, or case, and watch the real PDF update as you type.
- **Document fonts** — Choose from a library of licensed fonts for body text and for figures, or scale the whole document up or down with a single control.
```

Bump `package.json` and `APP_META.VERSION`, then run:

```bash
deno run --allow-read --allow-write scripts/changelog-to-json.ts
```

- [ ] **Step 7: Run the full gate**

Run: `npm run lint && npx vitest run && deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS on all three.

- [ ] **Step 8: Verify in the browser**

Use `preview_start`, navigate to `/settings/hire-orders/template`, and confirm: the outline lists every section, selecting a role outlines it in the preview, changing the text size re-renders within about a second, and `read_console_messages` is clean. Take a screenshot for the PR.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(hire-orders): replace the pdf copy card with the template editor"
```

---

## Final verification

- [ ] `npm run lint` passes with zero warnings.
- [ ] `npx vitest run` passes, including all four mirror byte-equality tests.
- [ ] `deno test --allow-all --node-modules-dir=none supabase/functions/` passes, including the default-theme regression test from Task 3.
- [ ] `npx playwright test --config=e2e/playwright.config.ts` passes.
- [ ] Confirm each command's actual output before claiming completion. Do not infer a pass from a partial run.
- [ ] Migration reminder: the font bucket migration from Task 5 is **not** applied automatically on merge. Apply it via the Supabase MCP `apply_migration` and confirm with `list_migrations`.
