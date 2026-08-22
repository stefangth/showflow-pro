# UI Standardization Wave 2.1 — Design tokens (D4 / D6 / D7 + tints) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the ADR 0012 design-system rollout by landing the four owner-approved decisions — SegmentedControl consolidation (D4), Table density + `numeric` (D6), sidebar surface rebind (D7), and three new tint tokens with a full feature-code sweep onto them.

**Architecture:** Add the tint tokens + sidebar rebind to `src/index.css` (both modes) and wire the tint colors into `tailwind.config.ts`. Enhance the existing `SegmentedControl` and `Table` primitives, migrate the ad-hoc segmented controls and table call sites, then sweep every ad-hoc `bg-muted` / foreground-alpha / accent-wash background in feature code onto the tint tokens. Finally, enforce the new convention with lint rules run at `error`, and verify visually on the local stack in both modes.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind v3, shadcn/ui, ESLint flat config (esquery `no-restricted-syntax`), Vitest.

**Spec:** `docs/ui-conventions.md` (ADR 0012). D4 = §5 SegmentedControl row; D6 = §5 Table row; tint tokens + D7 are new and are documented into `docs/ui-conventions.md` §2 as part of Task 1. Owner decisions captured in this session: D4 Option A (the primitive already IS Option A — recessed `--surface-3` track, active `bg-card shadow-elev1`); tint values hover 6% / well 8% / accent = accent-50 (light); sweep scope = **literally every match** (all 206 inventoried sites); **no changelog entry**; all in one PR.

## Global Constraints

- **No raw values in feature code.** No hex, `rgba()`, `text-[Npx]`, `rounded-[Npx]`, or bracket alpha outside `src/components/ui`. Use the fontSize scale (`text-control` etc.), the radius scale (`rounded-s|m|l|xl|xxl`), and semantic/token colors. Raw values are allowed only inside `src/components/ui/**` and the lint-exempt renderer boundaries (`src/lib/hireOrders/pdf/**`, `src/lib/emailTemplates/**`, `src/lib/avatar.ts`).
- **13 is the control size**; 14 body; 11 eyebrow. Tailwind utilities: `text-control` / `text-body` / `text-eyebrow`.
- **Tailwind opacity steps are multiples of 5 only.** A non-multiple (`/6`, `/4`) emits no class. The tint tokens are full color values (`var(--…)`), so they carry no `/opacity` — never write `bg-well-tint/50`.
- **Accent scale is immutable across modes**; only role tokens flip. `--accent-tint` is a new mode-flipping role token (accent-50 solid in light, a violet wash in dark), NOT a re-pitch of a scale stop.
- **No dashes in copy** (em/en), no exclamation marks, no emoji; German is Du-form. (No user-facing copy changes are expected in this plan.)
- **No changelog entry** for this work (owner directive). Do not touch `public/changelog.md` / `.json`.
- **CI gate is `eslint --max-warnings 0`.** New lint rules ship at `error`. The full sweep MUST be complete before the lint bans are wired on (Task 11), or the build fails.
- **Tests import the real module.** Update snapshots/assertions that break on class renames; never re-implement logic in a test.

---

## Reference A — Tint token values (final, owner-approved)

Add to `src/index.css`. Light values live on `:root` (around the existing `--surface-3` / `--accent-text` block, lines ~79-97); dark values on `.dark` (around lines ~258-262).

```css
/* :root (light) */
--hover-tint:  rgba(20, 18, 14, 0.06);   /* row / button hover wash */
--well-tint:   rgba(20, 18, 14, 0.08);   /* recessed well / inactive chip / track */
--accent-tint: #F4F1FF;                  /* = accent-50; active count chip / accent wash */

/* .dark */
--hover-tint:  rgba(245, 244, 241, 0.06);
--well-tint:   rgba(245, 244, 241, 0.08);
--accent-tint: rgba(110, 92, 246, 0.20); /* violet wash lifted for the dark ground */
```

Foreground light is `#15131C` → `rgba(20,18,14,…)`; foreground dark is `#F5F4F1` → `rgba(245,244,241,…)`. These match the current ad-hoc `bg-foreground/N` washes but are named and mode-correct.

## Reference B — Sidebar rebind (D7)

`--sidebar-background` is consumed via `hsl(var(--sidebar-background))` in `tailwind.config.ts`, so it must stay HSL channels (not a hex). Repoint it to the surface-3 value in each mode:

- `:root` line 59: `--sidebar-background: 36 27% 92%;` → `--sidebar-background: 44 20% 92%;   /* = surface-3 #EFEDE7 */`
- `.dark` line 238: `--sidebar-background: 252 11% 12%;` → `--sidebar-background: 248 10% 15%;   /* = surface-3 #24232B */`

Active-row tint (`--sidebar-accent`) and text (`--sidebar-accent-foreground`) are unchanged. Verify the rail reads right against page + content in both modes (Task 12).

## Reference C — Tailwind tint color wiring

In `tailwind.config.ts`, inside `theme.extend.colors`, alongside the existing `"accent-text": "var(--accent-text)"` entry, add:

```ts
"hover-tint":  "var(--hover-tint)",
"well-tint":   "var(--well-tint)",
"accent-tint": "var(--accent-tint)",
```

This yields `bg-hover-tint` / `hover:bg-hover-tint` / `bg-well-tint` / `bg-accent-tint`. Because the values are full colors (not HSL channels), never append a Tailwind `/opacity`.

## Reference D — Sweep mechanical mapping (exact string rules)

Apply ONLY to the enumerated sites in each sweep batch (Tasks 5–10). The lists come from the session inventory (206 sites, categories A/B/C). Preserve every other class and any variant prefix (`hover:`, `data-[state=active]:`, `[&_code]:`, etc.) that is not part of the token itself.

| From | To |
|---|---|
| `hover:bg-foreground/5` | `hover:bg-hover-tint` |
| `hover:bg-muted` | `hover:bg-hover-tint` |
| `hover:bg-muted/NN` (any NN) | `hover:bg-hover-tint` |
| `bg-foreground/5` (resting) | `bg-well-tint` |
| `bg-foreground/10` | `bg-well-tint` |
| `bg-muted` (resting; keep any non-hover variant prefix) | `bg-well-tint` |
| `bg-muted/NN` (any NN) | `bg-well-tint` |
| `bg-accent-50` (wash-intent site) | `bg-accent-tint` |
| `bg-accent-100` (wash-intent site) | `bg-accent-tint` |
| `hover:bg-accent-50` / `hover:bg-accent-100` | `hover:bg-accent-tint` |

**Never touch:**
- `bg-muted-foreground`, `text-muted-foreground`, `text-muted` — only `bg-muted` backgrounds.
- Solid accent fills `bg-accent-400/500/600/700`, the shadcn `bg-accent` / `hover:bg-accent` token, or any accent site NOT in the batch's Category-C list (those are solid fills — avatars, dots, rails — and stay).
- Anything in `src/components/ui/**` or the exempt renderer boundaries.
- `bg-primary/N`, `bg-warning/N`, `bg-success/N`, `bg-info/N`, `bg-destructive/N`, `bg-background/N`, `bg-primary-foreground/N` — out of scope, leave as-is.

After each batch, the controller confirms with grep that the batch's files contain none of the retired patterns (except intentional out-of-scope tokens above).

## Reference E — Inventory (source of the sweep site lists)

The full 206-site inventory produced this session is the authoritative list. Each sweep task below reproduces its cluster's exact file:line + class. Category A = hover (35), B = well/`bg-muted` (116), C = accent wash (55), D = bracket-alpha/non-÷5 (0 — nothing to do).

---

### Task 1: Token foundation — tint tokens, sidebar rebind, Tailwind wiring, docs

**Files:**
- Modify: `src/index.css` (`:root` ~lines 59, 79-97; `.dark` ~lines 238, 258-262)
- Modify: `tailwind.config.ts:37-112` (colors block)
- Modify: `docs/ui-conventions.md` (§2 Tokens)
- Modify: `CLAUDE.md` (Styling section)

**Interfaces:**
- Produces: CSS vars `--hover-tint` / `--well-tint` / `--accent-tint` (both modes); Tailwind utilities `bg-hover-tint` / `bg-well-tint` / `bg-accent-tint` (+ `hover:` variants); `--sidebar-background` repointed to surface-3. Every later task depends on these utilities existing.

- [ ] **Step 1: Add the three tint tokens to `:root`** using the light values in Reference A, placed next to the existing `--surface-3` / `--accent-text` block. Add the two dark values to `.dark` next to its `--surface-3` / `--accent-text` block.

- [ ] **Step 2: Rebind the sidebar** per Reference B (one line in `:root`, one in `.dark`, each with the `/* = surface-3 … */` comment).

- [ ] **Step 3: Wire the Tailwind colors** per Reference C.

- [ ] **Step 4: Document in `docs/ui-conventions.md` §2 Tokens.** After the existing radius/hairline lines add:
  > **[review]** Tint backgrounds use the token roles: `bg-hover-tint` for hover washes, `bg-well-tint` for recessed wells / inactive chips / tracks, `bg-accent-tint` for the active count chip / accent wash. Ad-hoc `bg-muted` and `bg-foreground/N` washes are retired in feature code **[ci]**. Solid accent fills stay on the accent scale (`bg-accent-500` etc.); only the low accent washes moved to `bg-accent-tint`.

- [ ] **Step 5: Update `CLAUDE.md` Styling section** — add one bullet after the accent-opacity note: tint washes use `bg-hover-tint` / `bg-well-tint` / `bg-accent-tint`; `bg-muted` and `bg-foreground/N` washes are lint-banned in feature code (Wave 2.1).

- [ ] **Step 6: Verify build wiring.** Run `npx tsc -p tsconfig.app.json --noEmit` and `npm run build`. Expected: clean. (No utility is used yet, but the config must parse.)

- [ ] **Step 7: Commit** — `feat(ui): add tint tokens and rebind sidebar to surface-3 (ADR 0012)`

---

### Task 2: SegmentedControl primitive — tinted count slot + scrollable option

The primitive already IS the approved Option A. Enhance it so it can absorb the ad-hoc consumers: (a) give the count a background tint matching the approved mockup (active `bg-accent-tint text-accent-text`, inactive `bg-well-tint text-muted-foreground`), and (b) add an optional `scrollable` prop for the mobile lens strip. Also clean the internal raw sizes onto the token scale.

**Files:**
- Modify: `src/components/ui/segmented-control.tsx`
- Test: `src/components/ui/segmented-control.test.tsx`

**Interfaces:**
- Produces: `SegmentedControlProps<T>` gains `scrollable?: boolean`. `SegmentedControlOption<T>` unchanged (`value`, `label`, `count?`). The count now renders a tinted pill. Task 3 consumes this.

- [ ] **Step 1: Write the failing test** in `segmented-control.test.tsx` — assert that when an option has a `count`, the active option's count element carries `bg-accent-tint` and an inactive option's count carries `bg-well-tint`; and that passing `scrollable` puts `overflow-x-auto` on the container.

```tsx
it("tints the count chip by active state", () => {
  render(
    <SegmentedControl
      value="a"
      onChange={() => {}}
      options={[
        { value: "a", label: "A", count: 3 },
        { value: "b", label: "B", count: 5 },
      ]}
    />,
  );
  expect(screen.getByText("3").className).toContain("bg-accent-tint");
  expect(screen.getByText("5").className).toContain("bg-well-tint");
});

it("scrolls when scrollable", () => {
  const { container } = render(
    <SegmentedControl scrollable value="a" onChange={() => {}} options={[{ value: "a", label: "A" }]} />,
  );
  expect(container.querySelector('[role="tablist"]')!.className).toContain("overflow-x-auto");
});
```

- [ ] **Step 2: Run the tests, verify they fail.** `npx vitest run src/components/ui/segmented-control.test.tsx`

- [ ] **Step 3: Implement.** Replace the primitive body with:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<SegmentedControlOption<T>>;
  className?: string;
  /** Non-wrapping, horizontally scrolling strip with snap points (mobile). */
  scrollable?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  scrollable = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        "items-center rounded-m bg-well-tint p-[2px]",
        scrollable ? "flex gap-2 overflow-x-auto snap-x" : "inline-flex gap-[2px]",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-[29px] cursor-pointer items-center gap-1.5 rounded-s px-3 text-control font-medium transition-colors",
              scrollable && "shrink-0 snap-start",
              active
                ? "bg-card text-foreground shadow-elev1"
                : "bg-transparent text-muted-foreground shadow-none",
            )}
          >
            <span>{option.label}</span>
            {option.count != null && (
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-xs px-1 font-mono text-eyebrow font-semibold tabular-nums",
                  active ? "bg-accent-tint text-accent-text" : "bg-well-tint text-muted-foreground",
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

Note: the track was `bg-[var(--surface-3)]`; `bg-well-tint` is the token role for a recessed track. This is intentional and matches the sweep. (The primitive is lint-exempt, but we still prefer the token.)

- [ ] **Step 4: Run the tests, verify they pass.** `npx vitest run src/components/ui/segmented-control.test.tsx`

- [ ] **Step 5: Commit** — `feat(ui): SegmentedControl gains tinted count and scrollable strip`

---

### Task 3: Migrate ad-hoc segmented controls onto the primitive; delete LensTabs

Consolidate the three ad-hoc segmented controls. `LensTabs` is replaced by `SegmentedControl` at its call sites and deleted; `HelpRoleTabs` and the `RunOfShowRail` volume toggle are reimplemented via `SegmentedControl`.

**Files:**
- Delete: `src/components/calendar/surface/LensTabs.tsx`, `src/components/calendar/surface/LensTabs.test.tsx`
- Modify: `src/components/calendar/surface/CalendarSurfaceHeader.tsx`, `src/components/calendar/surface/CalendarSurface.tsx` (call sites — replace `<LensTabs …>` with `<SegmentedControl …>`, mapping `lenses`→`options`, `active`→`value`, `onChange`→`onChange`, and pass `scrollable` where LensTabs was scrollable)
- Modify: `src/components/help/HelpRoleTabs.tsx` (reimplement via `SegmentedControl`)
- Modify: `src/components/demo/RunOfShowRail.tsx:251-269` (volume toggle → `SegmentedControl` with options small/full)
- Test: update/relocate any `LensTabs`-specific assertions into `CalendarSurfaceHeader.test.tsx` or `segmented-control.test.tsx`; update `HelpRoleTabs` / `RunOfShowRail` tests + any snapshots.

**Interfaces:**
- Consumes: `SegmentedControl` (Task 2). `LensTabDef` type is removed; call sites build `SegmentedControlOption[]` inline.

- [ ] **Step 1: Grep the consumers.** `rg -n "LensTabs|LensTabDef" src` and `rg -n "HelpRoleTabs" src` to confirm the exact call sites and props before editing.
- [ ] **Step 2: Replace `LensTabs` call sites** in `CalendarSurfaceHeader.tsx` and `CalendarSurface.tsx` with `SegmentedControl`, then delete `LensTabs.tsx` + its test. Map the count/label/value fields; keep `scrollable` on the mobile instance.
- [ ] **Step 3: Reimplement `HelpRoleTabs`** to render `SegmentedControl` over its role options (admin/producer/artist), preserving its external props and translations.
- [ ] **Step 4: Reimplement the `RunOfShowRail` volume toggle** (small/full) via `SegmentedControl`.
- [ ] **Step 5: Run the affected tests** — `npx vitest run src/components/calendar/surface src/components/help/HelpRoleTabs.test.tsx src/components/demo` and update assertions/snapshots for the class renames (verify diffs are class-name only). If a snapshot legitimately changed shape, `-u`.
- [ ] **Step 6: Full typecheck** — `npx tsc -p tsconfig.app.json --noEmit` (catches removed `LensTabs`/`LensTabDef` imports).
- [ ] **Step 7: Commit** — `refactor(ui): consolidate segmented controls onto SegmentedControl (D4)`

---

### Task 4: Table primitive — density + `numeric` prop (D6)

Apply the D6 spec to `Table`: 34px rows, 13px cells, eyebrow header, and a `numeric` prop on `TableHead`/`TableCell` that right-aligns and renders Geist Mono tabular.

**Files:**
- Modify: `src/components/ui/table.tsx`
- Test: `src/components/ui/table.test.tsx` (create if absent)

**Interfaces:**
- Produces: `TableHead` and `TableCell` accept `numeric?: boolean`. When true → `text-right font-mono tabular-nums`. Row height 34px, cells 13px, header is an eyebrow. Task 5 consumes `numeric`.

- [ ] **Step 1: Write the failing test** in `table.test.tsx`:

```tsx
it("right-aligns and monospaces numeric cells", () => {
  render(
    <table><tbody><tr><TableCell numeric>42</TableCell></tr></tbody></table>,
  );
  const cell = screen.getByText("42");
  expect(cell.className).toContain("text-right");
  expect(cell.className).toContain("font-mono");
  expect(cell.className).toContain("tabular-nums");
});
```

- [ ] **Step 2: Run, verify it fails.** `npx vitest run src/components/ui/table.test.tsx`

- [ ] **Step 3: Implement.** Change:
  - `TableRow`: keep `hover:bg-muted/50 data-[state=selected]:bg-muted` (primitive is lint-exempt; these are the shadcn defaults). Add `h-[34px]`.
  - `TableHead`: replace `h-12 … font-medium text-muted-foreground` with `h-[34px] px-4 text-left align-middle text-eyebrow font-semibold uppercase tracking-[1.4px] text-muted-foreground`. Add `numeric` prop → append `text-right`.
  - `TableCell`: replace `p-4` with `px-4 py-0 text-control align-middle` (34px row height drives vertical rhythm). Add `numeric` prop → append `text-right font-mono tabular-nums`.
  - `Table`: change `text-sm` → `text-control`.
  - Extend the `TableHead`/`TableCell` prop types with `numeric?: boolean` and strip it from the spread so it isn't passed to the DOM.

- [ ] **Step 4: Run, verify it passes.** `npx vitest run src/components/ui/table.test.tsx`
- [ ] **Step 5: Commit** — `feat(ui): Table density and numeric column prop (D6)`

---

### Task 5: Migrate Table consumers to `numeric` columns

Pass `numeric` on numeric columns in the 8 Table consumers and confirm the new density reads right.

**Files (all Modify):**
- `src/components/settings/skills/SkillsTab.tsx`
- `src/components/bookings/ArtistBookingsView.tsx`
- `src/components/platform/OrganizationsTab.tsx`
- `src/components/platform/UsersTab.tsx`
- `src/components/hireOrders/import/ReviewStep.tsx`
- `src/components/artists/ArtistImportDialog.tsx`
- `src/components/hireOrders/OrdersTable.tsx`
- `src/pages/SandboxViewerPage.tsx`

- [ ] **Step 1:** In each file, for every `<TableHead>`/`<TableCell>` that holds a count, amount, date-as-number, or id, add `numeric`. Remove any now-redundant local `text-right`/`font-mono`/`tabular-nums` on those cells (the prop supplies them). Leave text columns unchanged.
- [ ] **Step 2: Run the affected component tests** — `npx vitest run src/components/hireOrders src/components/platform src/components/bookings src/pages/SandboxViewerPage.test.tsx` (whichever exist); update class-rename assertions/snapshots.
- [ ] **Step 3: Typecheck** — `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 4: Commit** — `refactor(ui): adopt Table numeric columns across call sites (D6)`

---

### Task 6: Tint sweep — calendar surface cluster

Apply Reference D to every listed site. `LensTabs` is already gone (Task 3); `ScopeChips` stays.

**Files + sites (Modify):**
- `calendar/surface/ScopeChips.tsx:39` `bg-foreground/5`→`bg-well-tint`
- `calendar/surface/FillMeter.tsx:49` `bg-foreground/10`→`bg-well-tint`
- `calendar/surface/AgendaLens.tsx:196` `hover:bg-muted`→`hover:bg-hover-tint`; `:137,:151` `bg-accent-50`→`bg-accent-tint` (selected); `:207` `bg-accent-50`→`bg-accent-tint` (badge)
- `calendar/surface/MonthGrid.tsx:189` `hover:bg-muted/50`→`hover:bg-hover-tint`; `:156` `bg-muted/30`→`bg-well-tint`; `:190` `bg-muted`→`bg-well-tint`; `:191` `bg-accent-50`→`bg-accent-tint`; `:240` `bg-accent-50`→`bg-accent-tint`
- `calendar/surface/AllDatesLens.tsx:95` `hover:bg-muted/50`→`hover:bg-hover-tint`; `:67` `bg-muted`→`bg-well-tint`
- `calendar/surface/WeekLens.tsx:167` `hover:bg-muted/70`→`hover:bg-hover-tint` and `bg-muted`→`bg-well-tint` (same element); `:133,:199` `bg-accent-50`→`bg-accent-tint`
- `calendar/surface/NeedsYouLens.tsx:327` `bg-muted`→`bg-well-tint` (non-urgent) and `bg-accent-50`→`bg-accent-tint` (urgent) [conditional expression — map each branch]; `:384,:401,:472` `bg-muted`→`bg-well-tint`
- `calendar/surface/DayRail.tsx:87` `bg-muted`→`bg-well-tint`
- `calendar/surface/QueueRail.tsx:73,:131` `bg-muted`→`bg-well-tint`
- `calendar/surface/SeasonStripMobile.tsx:193,:197` `bg-muted/30`→`bg-well-tint`; `:144` `bg-accent-100`→`bg-accent-tint`
- `calendar/surface/SeasonLens.tsx:287` `bg-muted/30`→`bg-well-tint`; `:84,:108,:237` `bg-accent-50`→`bg-accent-tint`
- `calendar/surface/OffersLens.tsx:95,:177,:186` `bg-muted`→`bg-well-tint`
- `lib/calendar/tone.ts:36,:62` `bg-accent-50`→`bg-accent-tint`

- [ ] **Step 1:** Apply every mapping above. Watch the conditional expressions (NeedsYouLens:327, WeekLens:167) — convert both branches on the line, not just the string.
- [ ] **Step 2: Grep-verify** the cluster: `rg -n "bg-muted\b|bg-foreground/|bg-accent-50|bg-accent-100" src/components/calendar/surface src/lib/calendar/tone.ts` returns nothing except `bg-muted-foreground`.
- [ ] **Step 3: Run tests** `npx vitest run src/components/calendar src/lib/calendar`; update class-rename assertions/snapshots (DayRail/MonthGrid/NeedsYouLens snapshots are likely).
- [ ] **Step 4: Commit** — `style(ui): sweep calendar surface onto tint tokens`

---

### Task 7: Tint sweep — settings cluster

**Files + sites (Modify):** apply Reference D to each.
- `settings/castsCoverage/CoveragePanel.tsx:512,:522,:540,:552` `hover:bg-muted`→`hover:bg-hover-tint`
- `settings/castsCoverage/OwnershipPanel.tsx:409` `hover:bg-muted`→`hover:bg-hover-tint`; `:467` `bg-accent-50`→`bg-accent-tint`
- `settings/SystemMapCanvas.tsx:188,:204,:263` `hover:bg-muted`→`hover:bg-hover-tint`; `:266` `bg-muted`→`bg-well-tint`
- `settings/templateEditor/TemplateOutline.tsx:22` `hover:bg-muted`→`hover:bg-hover-tint` AND `bg-accent-100`→`bg-accent-tint` (active/else conditional — map both branches)
- `settings/emailTemplates/EmailPreviewPane.tsx:70` `bg-muted/30`→`bg-well-tint`
- `settings/emailTemplates/EmailTemplatesTab.tsx:152` `bg-muted`→`bg-well-tint`
- `settings/bookingFlow/FlowRail.tsx:23,:83` `bg-muted`→`bg-well-tint`
- `settings/bookingFlow/FlowTimeline.tsx:44,:153,:256,:303` `bg-muted`→`bg-well-tint` (`:44` is an inactive/active conditional — only the `bg-muted` branch)
- `settings/MarkdownDoc.tsx:15,:16,:19` `[&_code]:bg-muted`/`[&_pre]:bg-muted`/`[&_th]:bg-muted`→ `…:bg-well-tint`
- `settings/trust/VisibilityMatrix.tsx:128` `bg-muted`→`bg-well-tint`
- `settings/trust/OrgDataCard.tsx:66` `bg-muted`→`bg-well-tint`
- `settings/rolesRights/EditingPickerCard.tsx:24` `bg-accent-50`→`bg-accent-tint`; `:25` `bg-accent-100`→`bg-accent-tint`
- `settings/hireOrders/fields/TermsLibraryPicker.tsx:59` `bg-muted`→`bg-well-tint`
- `settings/hireOrders/template/TemplateDocumentPane.tsx:87` `bg-muted/30`→`bg-well-tint`
- `settings/airtable/ConsoleTabs.tsx:36` `bg-muted`→`bg-well-tint`; `:53` `bg-accent-100`→`bg-accent-tint`
- `settings/airtable/AttentionPanel.tsx:120` `bg-muted`→`bg-well-tint`; `:98` `bg-accent-50`→`bg-accent-tint` and `hover:bg-accent-100`→`hover:bg-accent-tint`
- `settings/airtable/SetupWizard.tsx:62,:124` `bg-muted`→`bg-well-tint`; `:76` `bg-accent-100`→`bg-accent-tint`
- `settings/airtable/CatalogTab.tsx:59,:156,:244,:247,:279,:286,:293` `bg-muted`→`bg-well-tint`
- `settings/airtable/ActivityTab.tsx:44` `bg-muted`→`bg-well-tint`
- `settings/airtable/ReadOnlyBanner.tsx:10` `bg-muted`→`bg-well-tint`
- `settings/airtable/AttentionPanel.tsx` (covered above)

- [ ] **Step 1:** Apply all mappings; handle the conditional lines (TemplateOutline:22, FlowTimeline:44) branch-by-branch.
- [ ] **Step 2: Grep-verify** `rg -n "bg-muted\b|bg-foreground/|bg-accent-50|bg-accent-100" src/components/settings` → only `bg-muted-foreground` remains.
- [ ] **Step 3: Run tests** `npx vitest run src/components/settings`; update assertions/snapshots.
- [ ] **Step 4: Commit** — `style(ui): sweep settings onto tint tokens`

---

### Task 8: Tint sweep — hire-orders + shows + catalog + bookings/setup cluster

**Files + sites (Modify):**
- `shows/ShowDateDetailSheet.tsx:1187` `hover:bg-muted`→`hover:bg-hover-tint`
- `shows/date/TierTimeline.tsx:257,:268` `hover:bg-muted`→`hover:bg-hover-tint`
- `shows/date/TierLadder.tsx:76` `bg-muted`→`bg-well-tint`
- `shows/date/DryRunDialog.tsx:87` `bg-muted`→`bg-well-tint`
- `shows/date/EligibilityBookList.tsx:166` `bg-muted`→`bg-well-tint`
- `shows/date/CockpitCastList.tsx:19,:86` `bg-accent-100`→`bg-accent-tint`
- `shows/ShowDateFormDialog.tsx:228` `bg-muted`→`bg-well-tint`
- `shows/hireOrders/GenerateHireOrderDialog.tsx:343` `bg-muted`→`bg-well-tint`; `:241` `bg-accent-50`→`bg-accent-tint`
- `catalog/ShowFormDialog.tsx:207` `bg-muted`→`bg-well-tint`
- `bookings/setup/FirstOfferCard.tsx:48` `bg-accent-50`→`bg-accent-tint`
- `bookings/setup/RehearsalBlock.tsx:68` `bg-accent-50`→`bg-accent-tint`
- `hireOrders/OrdersTable.tsx:129` `bg-muted/40`→`bg-well-tint`
- `hireOrders/OrderTimeline.tsx:94` `bg-muted`→`bg-well-tint`
- `hireOrders/BlockerList.tsx:160` `bg-muted`→`bg-well-tint`
- `hireOrders/HireOrderReadyBanner.tsx:38` `bg-accent-50`→`bg-accent-tint`; `:39` `bg-accent-100`→`bg-accent-tint`
- `hireOrders/edit/SetupCallout.tsx:59` `bg-accent-50`→`bg-accent-tint`
- `hireOrders/NewOrderWizard.tsx:687,:902` `bg-accent-50`→`bg-accent-tint`
- `hireOrders/import/ReviewStep.tsx:72,:76,:80` `bg-muted/50`→`bg-well-tint`
- `hireOrders/import/RangeStep.tsx:164` `bg-accent-50`→`bg-accent-tint`
- `hireOrders/import/HireOrderImportDialog.tsx:418` `hover:bg-muted/50`→`hover:bg-hover-tint`; `:512` `bg-accent-50`→`bg-accent-tint`

- [ ] **Step 1:** Apply all mappings.
- [ ] **Step 2: Grep-verify** `rg -n "bg-muted\b|bg-foreground/|bg-accent-50|bg-accent-100" src/components/shows src/components/hireOrders src/components/catalog src/components/bookings` → only `bg-muted-foreground`.
- [ ] **Step 3: Run tests** `npx vitest run src/components/shows src/components/hireOrders src/components/bookings src/components/catalog`; update assertions/snapshots.
- [ ] **Step 4: Commit** — `style(ui): sweep hire-orders and shows onto tint tokens`

---

### Task 9: Tint sweep — getRunning + today + dashboard + availability cluster

**Files + sites (Modify):**
- `getRunning/TaskPanel.tsx:192` `bg-muted`→`bg-well-tint`
- `getRunning/panels/TeamPanelBody.tsx:56` `bg-muted`→`bg-well-tint`; `:91` `bg-muted`→`bg-well-tint`; `:61` `bg-accent-100`→`bg-accent-tint`
- `getRunning/panels/DatesPanelBody.tsx:61` `bg-muted`→`bg-well-tint`
- `getRunning/panels/EligibilityPanelBody.tsx:269` `bg-accent-100`→`bg-accent-tint`
- `getRunning/panels/airtable/AirtableConnectRail.tsx:135,:232,:261` `bg-muted`→`bg-well-tint`; `:149` `bg-accent-100`→`bg-accent-tint`
- `getRunning/panels/airtable/AirtableConnectionSummary.tsx:112` `bg-muted`→`bg-well-tint` (else branch) and `bg-accent-50`→`bg-accent-tint` (emphasis branch) — conditional, map both
- `today/DoneForYouFeed.tsx:25` `bg-muted`→`bg-well-tint`; `:23` `bg-accent-100`→`bg-accent-tint`
- `today/DateRail.tsx:19` `bg-accent-50`→`bg-accent-tint`
- `today/AtRiskDateCard.tsx:95` `bg-muted`→`bg-well-tint`
- `dashboard/ArtistDashboard.tsx:220` `bg-muted`→`bg-well-tint`; `:265` `bg-accent-50`→`bg-accent-tint`
- `availability/AvailabilityFirstRun.tsx:99` `bg-muted`→`bg-well-tint`

- [ ] **Step 1:** Apply all mappings; handle AirtableConnectionSummary:112 conditional branch-by-branch.
- [ ] **Step 2: Grep-verify** `rg -n "bg-muted\b|bg-foreground/|bg-accent-50|bg-accent-100" src/components/getRunning src/components/today src/components/dashboard src/components/availability` → only `bg-muted-foreground`.
- [ ] **Step 3: Run tests** `npx vitest run src/components/getRunning src/components/today src/components/dashboard src/components/availability`; update assertions/snapshots.
- [ ] **Step 4: Commit** — `style(ui): sweep get-running and today onto tint tokens`

---

### Task 10: Tint sweep — pages + layout + platform + demo + minis + help + misc cluster

**Files + sites (Modify):**
- `pages/ArtistsPage.tsx:224` `bg-muted`→`bg-well-tint`; `:377` `bg-accent-100`→`bg-accent-tint`
- `pages/HireOrderDetailPage.tsx:278` `bg-muted`→`bg-well-tint`; `:305` `bg-accent-50`→`bg-accent-tint`
- `pages/HireOrderEditPage.tsx:726` `bg-muted`→`bg-well-tint`
- `pages/ProductionsPage.tsx:128` `bg-muted`→`bg-well-tint`; `:222` `bg-muted/30`→`bg-well-tint`
- `pages/ProfilePage.tsx:49,:285,:387` `bg-muted/40`→`bg-well-tint`
- `pages/AcceptInvitePage.tsx:538` `bg-muted/40`→`bg-well-tint`
- `pages/HelpPage.tsx:80` `bg-muted/40`→`bg-well-tint`
- `pages/NotFound.tsx:14` `bg-muted`→`bg-well-tint`
- `pages/SettingsPage.tsx:377` `hover:bg-muted/60`→`hover:bg-hover-tint` and `data-[state=active]:bg-muted`→`data-[state=active]:bg-well-tint` (same element, two tokens)
- `pages/AvailabilityPage.tsx:450` `hover:bg-muted`→`hover:bg-hover-tint`
- `layout/AppLayout.tsx:189,:349` `hover:bg-foreground/5`→`hover:bg-hover-tint`; `:288,:301,:307,:375` `hover:bg-muted`→`hover:bg-hover-tint`
- `layout/OrgSwitcher.tsx:51` `hover:bg-muted`→`hover:bg-hover-tint`
- `layout/NotificationsList.tsx:96` `hover:bg-muted`→`hover:bg-hover-tint`
- `layout/ThemeToggle.tsx:22` `bg-muted`→`bg-well-tint`
- `casts/CastDetailsSheet.tsx:505` `hover:bg-muted`→`hover:bg-hover-tint`; `:375,:556,:575,:598` `bg-muted`→`bg-well-tint`; `:337,:449,:555` `bg-accent-100`→`bg-accent-tint`; `:574` `bg-accent-50`→`bg-accent-tint`
- `casts/CastsSection.tsx:60` `hover:bg-muted`→`hover:bg-hover-tint`
- `chat/MessageBubble.tsx:23` `bg-muted`→`bg-well-tint`
- `demo/DemoBar.tsx:50` `bg-muted`→`bg-well-tint`
- `demo/RunOfShowRail.tsx:251` — handled by Task 3 (volume toggle → SegmentedControl); if any residual `bg-muted` remains after Task 3, `→bg-well-tint`
- `platform/systemHealth/EmailDeliveryPanel.tsx:15` `bg-muted/40`→`bg-well-tint`; `:40` `bg-muted`→`bg-well-tint`
- `platform/systemHealth/ScheduledJobsPanel.tsx:55` `bg-muted/40`→`bg-well-tint`
- `platform/systemHealth/DomainSummaryGrid.tsx:13` `bg-muted/40`→`bg-well-tint`; `:22` `bg-muted/20`→`bg-well-tint`
- `platform/systemHealth/EdgeFunctionsPanel.tsx:92` `bg-muted/40`→`bg-well-tint`
- `platform/systemHealth/RecentRunsList.tsx:15` `bg-muted/40`→`bg-well-tint`
- `platform/systemHealth/UptimeBar.tsx:10` `bg-muted`→`bg-well-tint`
- `minis/atoms.tsx:36,:83,:130` `bg-muted`→`bg-well-tint`; `:73` `bg-accent-100`→`bg-accent-tint`
- `minis/PageMiniCollapsed.tsx:22` `hover:bg-muted`→`hover:bg-hover-tint`; `:16` `bg-accent-100`→`bg-accent-tint`
- `minis/illustrations/ChatsMini.tsx:36,:50` `bg-muted`→`bg-well-tint`
- `minis/illustrations/HireOrdersMini.tsx:59` `bg-muted`→`bg-well-tint`
- `help/HelpFilters.tsx:48` `hover:bg-muted/50`→`hover:bg-hover-tint`; `:47` `bg-accent-100`→`bg-accent-tint`
- `help/HelpItemRow.tsx:23` `hover:bg-muted/50`→`hover:bg-hover-tint`; `:43` `bg-muted`→`bg-well-tint`; `:27` `bg-accent-100`→`bg-accent-tint`
- `artists/ArtistProfileSheet.tsx:326` `bg-accent-50`→`bg-accent-tint`; `:364` `hover:bg-accent-50`→`hover:bg-accent-tint`
- `artists/ArtistImportDialog.tsx:239` `hover:bg-muted/50`→`hover:bg-hover-tint`; `:307,:308,:309` `bg-muted/50`→`bg-well-tint`
- `artists/UnlinkedArtistCard.tsx:19` `bg-accent-100`→`bg-accent-tint`
- `auth/PasswordSetupForm.tsx:121` `bg-muted/40`→`bg-well-tint`
- `editor/ColumnLayoutEditor.tsx:150` `bg-muted`→`bg-well-tint`
- `editor/EditorSidePanel.tsx:186` `bg-muted`→`bg-well-tint`
- `lib/bookings.ts:20` `bg-muted`→`bg-well-tint`

- [ ] **Step 1:** Apply all mappings; handle SettingsPage:377 (two tokens on one element) and any conditional lines.
- [ ] **Step 2: Grep-verify** the cluster dirs: `rg -n "bg-muted\b|bg-foreground/|bg-accent-50|bg-accent-100" src/pages src/components/layout src/components/casts src/components/chat src/components/demo src/components/platform src/components/minis src/components/help src/components/artists src/components/auth src/features/editor src/lib/bookings.ts` → only `bg-muted-foreground`.
- [ ] **Step 3: Run tests** `npx vitest run src/pages src/components/layout src/components/platform src/components/minis src/components/help src/components/artists src/components/casts src/components/demo src/features/editor src/lib/bookings.test.ts`; update assertions/snapshots.
- [ ] **Step 4: Commit** — `style(ui): sweep pages, layout and remaining feature code onto tint tokens`

---

### Task 11: Enforce the convention — lint bans at `error`

With the sweep complete, ban the retired patterns in feature code so they can't return. Do NOT ban the accent scale (solid fills legitimately use `bg-accent-500` etc.).

**Files:**
- Modify: `eslint/ui-conventions.js`
- Test: rely on `npm run lint` as the gate.

- [ ] **Step 1: Add two `no-restricted-syntax` selectors** to the existing array in `eslint/ui-conventions.js`:

```js
{
  // bg-muted used as a solid wash is retired in feature code; use a tint token
  // or an explicit surface. Excludes bg-muted-foreground. / guards the "/"
  // (esquery treats a literal / as the regex terminator).
  selector: "Literal[value=/\\bbg-muted(?![-\\w])/]",
  message: 'Ad hoc bg-muted wash. Use bg-well-tint (recessed) or bg-hover-tint (hover). See docs/ui-conventions.md section 2.',
},
{
  // foreground-alpha washes are retired; use the tint tokens.
  selector: "Literal[value=/\\bbg-foreground\\u002F[0-9]/]",
  message: 'Ad hoc foreground-alpha wash. Use bg-hover-tint / bg-well-tint. See docs/ui-conventions.md section 2.',
},
```

- [ ] **Step 2: Run the full lint** — `npm run lint`. Expected: clean (the sweep removed every match). If any violation surfaces, it is a missed sweep site — fix it in its own file (do not add an `eslint-disable`; there is no legitimate remaining use in feature code). Re-run until clean.
- [ ] **Step 3: Commit** — `chore(lint): ban ad-hoc bg-muted and foreground-alpha washes (Wave 2.1)`

---

### Task 12: Full gates + visual verification (both modes)

**Files:** none (verification + any regression fixups discovered).

- [ ] **Step 1: Run every gate.**
  - `npx tsc -p tsconfig.app.json --noEmit`
  - `npx tsc -p tsconfig.tools.json --noEmit`
  - `npm run lint` (0 warnings)
  - `npx vitest run`
  - `npm run build`
  - `npm run sync:mirrors:check`
  All must pass.
- [ ] **Step 2: Boot the local stack** — `npm run local:up` then `npm run dev` (LOCAL banner). Open the in-app browser.
- [ ] **Step 3: Verify each decision in BOTH light and dark** (use `resize_window` colorScheme + the in-app theme toggle):
  - **D4:** calendar surface lens switcher (desktop + mobile scrollable), Help role tabs, RunOfShow volume toggle — active pill + count tint read correctly.
  - **D6:** a data table (Hire orders `OrdersTable`, Platform → Users) — 34px rows, eyebrow header, right-aligned mono numerics.
  - **D7:** the sidebar rail against page + content — reads as a distinct recessed surface in both modes, active row unchanged.
  - **Tints:** highest-risk `bg-muted`→`bg-well-tint` surfaces where alpha replaces a solid — chat bubbles (`MessageBubble`), markdown code blocks, status badges, calendar wells, tracks (ThemeToggle, DemoBar). Confirm none lost legibility or inverted lightness unacceptably in light mode.
- [ ] **Step 4: Fix regressions.** For any surface that reads wrong, decide per-site: adjust the token usage (e.g. a content surface that genuinely needs an opaque surface uses `bg-card`/`bg-background` rather than an alpha wash) and note the decision. Re-run gates after fixes.
- [ ] **Step 5: Capture before/after screenshots** of D4/D6/D7 and 2-3 representative tint surfaces to share with the owner.
- [ ] **Step 6: Commit** any fixups — `fix(ui): resolve tint-sweep visual regressions from local verification`

---

## Self-review notes

- **Spec coverage:** D4 (Tasks 2-3), D6 (Tasks 4-5), D7 (Task 1 + Task 12 verify), tint tokens (Task 1) + full sweep (Tasks 6-10) + enforcement (Task 11) + verification (Task 12). No changelog (honored — no task touches it).
- **Type consistency:** `SegmentedControlOption<T>`/`SegmentedControlProps<T>` names match across Tasks 2-3; `numeric` prop name matches across Tasks 4-5.
- **Sweep totals reconcile:** A(35)+B(116)+C(55)=206 across Tasks 6-10, minus the LensTabs sites absorbed by Task 3. Category D=0 (nothing to sweep).
- **Ordering:** tokens exist (Task 1) before any consumer uses them; lint bans (Task 11) come after the sweep so the build never breaks mid-flight.
