# Hire order PDF template editor (WYSIWYG)

Date: 2026-07-25
Branch: `claude/hire-orders-wysiwyg-editor-63326a`
Builds on: PR 196 (editable PDF copy), `docs/superpowers/plans/2026-07-24-hire-orders-editable-pdf-copy.md`

## Problem

PR 196 made every string on the hire-order PDF editable, but two gaps remain.

1. **Style is not editable at all.** Typography, colour and spacing are hardcoded in
   `render.tsx`'s `StyleSheet`. An org cannot make the document look like their brand.
2. **Editing is blind.** `PdfCopyCard` is a flat form of about 50 inputs. You cannot see
   what a field controls without saving and opening a PDF in a new tab, and copy is
   edited far away from the element it belongs to.

The renderer already names its styles semantically (`sectionHeading`, `factLabel`,
`totalValue`, `clauseBody`, `certLabel`). That structure is the missing registry.

## Goals

- Per-org control of typography, colour and spacing, bound to **semantic element roles**,
  not to coordinates.
- A single editing surface where selecting an element shows both its **text** and its
  **style**, next to a live rendering of the real document.
- Defaults render byte-identically to today. An org that changes nothing sees no change.
- No theme can produce an unreadable or structurally broken PDF.

## Non-goals

- Layout freedom. Section order, positioning and the flow layout stay fixed. This was an
  explicit scoping decision: the flow layout is what makes multi-page and aggregate
  (multi-date) orders work, and per-org layouts would be unmaintainable.
- Show/hide or reorder of document sections. Deferred, not designed here.
- Per-org font upload. Deferred; the curated library covers the need and avoids font
  validation and licensing liability.

---

## 1. Theme registry

New dual-home file, same discipline as `pdfCopy.ts` (byte-identical, mirror test, no
relative imports so the two copies can be identical):

- `src/lib/hireOrders/pdf/pdfTheme.ts`
- `supabase/functions/_shared/hire-order-pdf/pdfTheme.ts`

### Shape

```ts
export interface HireOrderThemeBase {
  fontFamily: FontFamilyKey;   // body family
  monoFamily: FontFamilyKey;   // numeric / order-number family
  scale: number;               // multiplier applied to every role size
  colors: {
    text: string; muted: string; faint: string;
    accent: string; line: string; feeCell: string; surface2: string;
  };
  page: { marginX: number; marginTop: number; marginBottom: number };
}

export interface RoleStyle {
  family?: FontFamilyKey;
  size?: number;
  weight?: 400 | 500 | 600;
  color?: ThemeColorKey;       // reference into base.colors, not a raw hex
  letterSpacing?: number;
  transform?: "none" | "uppercase";
}

export type HireOrderTheme = {
  base: HireOrderThemeBase;
  roles: Record<RoleKey, RoleStyle>;
};
```

Two levels on purpose: `base.scale` is the one knob that resizes the whole document
harmoniously, and a role override is still multiplied by it, so pinning one role does not
opt it out of global scaling. Role colours reference a base colour key rather than a raw
hex, so changing the accent recolours everything that should follow it.

### Roles

Thirty-five roles, grouped to match the existing copy sections so the outline reads the
same way in both halves of the inspector:

| Group | Roles |
|---|---|
| Letterhead | `legalName`, `letterheadLine`, `orderNumber`, `statusBadge` |
| Title | `titleLead`, `artistName`, `titleSub` |
| Parties | `partyLabel`, `partyName`, `partyLine` |
| Facts | `factLabel`, `factValue`, `factValueMono`, `factSub` |
| Sections | `sectionHeading` |
| Tables | `tableHeadCell`, `tableCellLabel`, `tableCellMono`, `notes` |
| Fees | `feeLabel`, `feeValue`, `totalLabel`, `totalValue` |
| Terms | `clauseNumber`, `clauseTitle`, `clauseBody` |
| Signatures | `signatureFor`, `signatureHint`, `signatureMarkTyped` |
| Footer | `footerText`, `watermark` |
| Certificate | `certHeading`, `certLead`, `certLabel`, `certValue` |

`HIRE_ORDER_THEME_DEFAULTS` reproduces the current `StyleSheet` values exactly. The
remaining `StyleSheet` entries (pure structure: flex direction, borders, padding, widths)
stay hardcoded and are not exposed.

### Resolution and clamping

`resolveHireOrderTheme(overrides?): HireOrderTheme` mirrors `resolveHireOrderCopy`: deep
merge over defaults, always returns a complete record, blank values fall back.

Clamps are applied during resolution, not in the UI, so a hand-edited setting cannot break
a document either: `size` to [5, 60] after scaling, `scale` to [0.75, 1.5], `letterSpacing`
to [-1, 8], `marginX` to [20, 80], `marginTop`/`marginBottom` to [20, 90]. Each hex value in
`base.colors` must match `/^#[0-9a-fA-F]{6}$/` or that key falls back to its default; a
`RoleStyle.color` that names a key not in `base.colors` falls back to the role default.

### Renderer change

`render.tsx` gains `buildStyles(theme: HireOrderTheme)` returning the `StyleSheet`, called
once per render, replacing the module-level `const s` and the `C` colour map. `RenderInput`
gains `theme?: HireOrderTheme`, defaulted to `HIRE_ORDER_THEME_DEFAULTS` for legacy callers,
exactly how `copy` was threaded in PR 196.

---

## 2. Fonts

A curated library of TTFs in a new **public** Supabase Storage bucket `hire-order-fonts`,
keyed by a registry in `pdfTheme.ts`:

```ts
export interface FontFamilyDef {
  key: FontFamilyKey;
  label: string;              // shown in the picker
  kind: "sans" | "serif" | "mono";
  files: { weight: 400 | 500 | 600; path: string }[];
}
```

The renderer registers only the families the resolved theme actually references, memoised
per isolate so a warm edge instance fetches each family once. The browser preview registers
the same public URLs.

Geist and Geist Mono stay the defaults and stay base64-embedded in `fonts.ts` for the edge,
so the default path has **no network dependency at render time** and cannot regress. Only
non-default families are fetched.

Proposed starter library, all SIL Open Font License so redistribution inside a generated
PDF is unambiguous. Implementation should not block on confirming it; the registry makes
adding or removing a family a file upload plus a registry entry, with no redeploy.

| Key | Kind | Note |
|---|---|---|
| `geist` | sans | current default |
| `inter` | sans | humanist, the safe corporate default |
| `plex-sans` | sans | more character, still neutral |
| `source-serif` | serif | contract-document feel |
| `libre-baskerville` | serif | traditional, high contrast |
| `geist-mono` | mono | current default for figures |
| `plex-mono` | mono | pairs with `plex-sans` |

Weights 400, 500 and 600 per family, matching what the renderer uses. A family that ships
fewer weights maps the missing ones to its nearest available weight at registration.

Failure handling: if a font fetch fails, the renderer falls back to the default family and
the document still renders. Issuing must never fail because of a font.

---

## 3. The editor

### Route and gating

`ROUTES.HIRE_ORDER_TEMPLATE = '/settings/hire-orders/template'`, registered in
`ROUTE_FEATURES` under `hire_orders`, wrapped in `ProtectedRoute` for admin and producer.
The `edit_hire_order_settings` capability drives read-only mode, matching `HireOrdersTab`.

`/settings/hire-orders/template` rather than `/hire-orders/template`, because the latter
would be matched by the `/hire-orders/:id` segment matcher in `requiredFeatureForPath`.

`PdfCopyCard` is removed from `HireOrdersTab` and replaced by a compact
`PdfTemplateCard` showing the current base family, scale and count of customised roles,
with a link into the editor.

### Layout

Three panes (`react-resizable-panels`, already a dependency):

- **Left, outline.** The document's semantic tree, section by section, one row per role.
  This is the selector: a PDF in an iframe has no clickable elements, so selection cannot
  come from the document itself. Rows show a modified dot when the role or any of its copy
  keys is overridden.
- **Centre, live PDF.** The real document, rendered in-browser, re-rendered on a 250ms
  debounce with the previous render kept visible until the new one resolves (no flicker,
  no empty frame).
- **Right, inspector.** For the selected role: a **Text** group listing the copy keys bound
  to that element (token hints and the existing dash rule carried over verbatim from
  `pdfCopyMeta.ts`), and a **Style** group (family, size, weight, colour, letter-spacing,
  case). Per-field, per-role and whole-document reset.

A separate **Document** entry at the top of the outline holds `base`: family, mono family,
scale, the colour palette and page margins.

### Selection highlight

`RenderInput` gains `highlightRole?: RoleKey`. When set, the renderer draws that role's text
with an accent outline. The editor passes the selected role, so clicking a row in the
outline lights the element up in the document.

This is the piece that makes the surface feel WYSIWYG rather than "a form beside a picture",
and it is only possible because we own the renderer. `highlightRole` is preview-only: it is
never set by `issue`, and a test asserts that.

### Sample document

The editor previews against the existing `sampleOrderData()` shape (which already exercises
parties, facts, a two-session running order, notes and fees), extended locally with two more
engagement dates, terms clauses and a signature block, so no role in the outline is invisible
in the preview.

An **Open exact PDF** button round-trips the unsaved draft to the server `preview` action and
opens the result in a new tab. That is the exactness check: same code path, same fonts, same
renderer as an issued document. Previewing a specific **real** order from inside the editor is
deferred; the per-order review dialog already previews real orders.

---

## 4. Sharing the renderer with the browser

The preview is the real PDF, rendered client-side by `@react-pdf/renderer` against the same
component the edge function uses.

`render.tsx` becomes byte-identical on both sides. Both runtimes already use the automatic
JSX runtime (`jsx: "react-jsx"`; Deno sets `jsxImportSource: "npm:react@18.3.1"`, Vite
resolves bare `react`), so the shared file needs no React import for JSX to work, and
`allowImportingTsExtensions` is already enabled in `tsconfig.app.json`, so `./pdfDeps.ts`
resolves on both sides.

The two runtime differences are isolated in a per-side `pdfDeps.ts`, which is the **only**
file in this set that is not mirrored:

| | edge (`supabase/functions/_shared/hire-order-pdf/`) | browser (`src/lib/hireOrders/pdf/`) |
|---|---|---|
| primitives | re-exports `npm:@react-pdf/renderer@^4` | re-exports `@react-pdf/renderer` |
| `registerFonts(theme)` | base64 data URIs from `fonts.ts`, plus Storage fetch for non-default families | Storage URLs for all families |
| React types | `npm:react@18.3.1` | `react` |

Mirrored files, each with a byte-equality test following `pdfCopyMirror.test.ts`:

| File | Status |
|---|---|
| `render.tsx` | new mirror |
| `docTypes.ts` | new mirror (`OrderData`, `OrderFieldKey`, `EngagementDate`, `RenderInput`, `formatMoney`) |
| `pdfCopy.ts` | exists, moves to `src/lib/hireOrders/pdf/` |
| `pdfTheme.ts` | new |

`fonts.ts` (about 700KB of base64) stays edge-only and never enters the frontend bundle.
The whole editor route is lazy-loaded so `@react-pdf/renderer` is not in the main chunk.

**`docTypes.ts` must not duplicate the existing type mirrors.** The domain types live today
in two places already: `src/lib/hireOrders/types.ts` and, inline, in
`supabase/functions/_shared/hireOrders.ts`. Extracting them a third time would create a
drift surface. Instead each runtime's existing home **re-exports** from its `docTypes.ts`:
`_shared/hireOrders.ts` re-exports from `./hire-order-pdf/docTypes.ts`, and
`src/lib/hireOrders/types.ts` re-exports from `./pdf/docTypes.ts`. Every current import path
keeps working, and there remains exactly one definition per runtime.

### Risk and fallback

`@react-pdf/renderer` v4 under Vite has historically needed polyfill or alias work
(`Buffer`, `process`, stream shims). **Task 1 of the implementation plan is a throwaway
spike** that renders the current document in the browser and proves it before anything else
is built.

If the spike fails, the fallback is a debounced server-rendered PDF in an iframe using the
existing `preview` action. Only the preview mechanism changes; the theme registry, the
outline, the inspector, the highlight (which is server-side either way) and the persistence
model are all unaffected. This is why the registry work does not depend on the spike.

**Spike result (2026-07-25):** react-pdf v4 renders in the browser under Vite.
Config required: none.

---

## 5. Persistence and freezing

New app-setting `hire_order_theme`, storing a **compact override map** (only values that
differ from defaults), the same shape discipline as `hire_order_copy`. Added to
`HIRE_ORDER_AUDIT_KEYS` and to `KEY_LABELS` as "PDF template".

The editor saves copy and theme as two independent settings writes, so an existing
`hire_order_copy` value keeps working untouched.

The resolved theme is frozen into `issue_snapshot` alongside the resolved copy, so
re-rendering an issued order after a theme change reproduces the original document. Per the
`d9c3d5e` precedent, font bytes are never written into the snapshot, only family keys.

The `preview` action gains `theme_override?: Partial<HireOrderTheme>`, layered over the
stored theme exactly as `copy_override` is, so the "preview a real order" path reflects
unsaved edits.

---

## 6. Folded-in fix: per-date engagement fee

### Problem

The wizard has one **Engagement fee** input whose value becomes the order's `fee`. For an
aggregate order across N dates it is stored and printed as the total for all N dates. The
intended meaning is the fee **per date**, which must be multiplied by the date count.

### Design

`hire_order_defaults` gains `default_fee_basis: "per_date" | "total"` (default `"per_date"`).

Wizard step 2 gains a basis toggle beside the fee input, with live helper text that resolves
the ambiguity on screen: `500.00 per date x 3 dates = 1,500.00`. When artists have different
date counts the helper text names the range instead of a single total.

The wizard sends the entered amount in `manual.fee` as today, plus `fee_basis` as a
**top-level field on the draft body**, not inside `manual` (the manual dict is typed
`Partial<Record<EditableOrderFieldKey, unknown>>` and the basis is not an editable order
field). `draftBatchArtist` multiplies by `dates.length` when the basis is per-date, computed
**after** the partial-success drop of already-covered dates, so a three-date request that
drops one covered date bills two dates and not three. The single-date `draft` action (used
by the auto-draft trigger) is unaffected: one date means per-date equals total.

The stored `fee` field stays the **total payable**, so `computeOrderKpis`, the readiness
check (`missing_fee`), the edit page and the PDF total are all untouched. Two new snapshot
fields carry the breakdown for display: `fee_basis` and `fee_per_date` (set only when the
basis is per-date). These are added to `OrderFieldKey`, and `EditableOrderFieldKey` widens
its exclusion to `Exclude<OrderFieldKey, "engagement_dates" | "fee_basis" | "fee_per_date">`,
since they are derived rather than hand-edited. `ORDER_FIELD_KEYS` is unchanged, so
`resolveFields` and every field-listing UI keep their current iteration.

The PDF fees section prints a breakdown line above the total when the basis is per-date,
via new copy keys `fees_per_date` (`"{{amount}} per date x {{count}} dates"`) and
`fees_per_date_single`. Being copy keys, they appear in the new editor automatically. New
keys must be added to `pdfCopyMeta.ts` or its coverage test fails, which is the intended
guard.

---

## 7. Folded-in fix: wizard date pre-selection

`toggleShowDate` adds the date to `selectedShowDateIds` but does not touch `artistDateIds`,
so the per-artist grid below starts empty and `canContinueStep1` blocks until the producer
presses "Apply selected dates to all".

Fix: selecting a date assigns it to every currently selected artist, and selecting an artist
seeds it with all currently selected dates (`toggleArtist` already seeds `current[id] ?? []`,
which becomes `[...selectedShowDateIds]`). Deselecting a date still removes it everywhere,
which is existing behaviour. Per-artist deselection in the grid is unchanged, and the
"Apply selected dates to all" button stays as a re-apply after manual edits.

---

## 8. Testing

| Layer | Coverage |
|---|---|
| Unit | `resolveHireOrderTheme` merge, blank fallback, every clamp bound, invalid colour fallback |
| Unit | Mirror byte-equality for `render.tsx`, `docTypes.ts`, `pdfCopy.ts`, `pdfTheme.ts` |
| Unit | Role registry covers every `RoleKey` exactly once (mirrors the `pdfCopyMeta` guard) |
| Unit | Copy-key to role binding covers every `CopyKey` exactly once |
| Unit | Per-date fee maths, including the dropped-covered-date case and the single-date case |
| Component | Outline selection drives the inspector; per-field, per-role and document reset; read-only mode disables every control |
| Component | Wizard: selecting a date pre-assigns it to selected artists; step 1 unblocks without pressing the apply button |
| Component | Wizard: basis toggle helper text for equal and unequal date counts |
| Edge (Deno) | Renderer output with default theme is unchanged (regression guard for the `StyleSheet` refactor) |
| Edge (Deno) | `highlightRole` is never set on the `issue` path |
| Edge (Deno) | `theme_override` layering in `preview`; theme frozen into `issue_snapshot`; font-fetch failure falls back and still renders |
| Edge (Deno) | `draftBatchArtist` per-date fee multiplication |
| E2E | Open the editor, change base scale, confirm the preview re-renders and the setting persists |

---

## 9. Sequencing

Three shippable slices. F1 and F2 are independent of the editor and can ship first while
the spike runs.

1. **Fixes** (sections 6 and 7). Small, self-contained, no dependency on anything else.
2. **Theme registry + renderer refactor** (sections 1, 2, 5). Ships behind no new UI; the
   default-output regression test is the acceptance gate.
3. **Editor** (sections 3, 4). Gated on the spike in 4.

Ships under the existing `hire_orders` entitlement, which is default-off, so all of this is
dark until an org is entitled.

## 10. Open questions

Neither blocks implementation; both have a stated default to proceed on.

- The curated font list. Section 2 proposes a concrete starter set; swapping a family later
  is data, not code.
- Whether `base.colors` should expose all seven keys or only `text`, `muted` and `accent`
  with the rest derived. Starting with all seven; can be narrowed after the first real use.
