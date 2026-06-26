# ShowFlow Design-System Alignment — `/settings` & `/platform`

**Date:** 2026-06-26
**Status:** Approved (design)
**Source:** claude.ai/design project `7d32ea50-…` (`ShowFlow_Alignment_Visual.html`, `DESIGN_AUDIT.md`, `REFACTORING_SPECS.md`, DS `colors_and_type.css`)

## Problem

The `/settings` and `/platform` pages use shadcn/ui primitives. The repo's canonical
ShowFlow design tokens live in `src/index.css`, but two gaps cause drift:

1. **Vocabulary gap.** The canonical DS (`_ds/.../colors_and_type.css`) names tokens
   `--surface`, `--text`, `--text-muted`, `--accent-500` (as a literal color),
   `--radius-*`, `--space-*`, `--row-h`, `--veil`, `--red-100/600`, etc. The repo's
   `src/index.css` only defines a subset, and what it does define uses shadcn names
   (`--card`, `--foreground`, `--muted`) plus an `--accent-*` scale stored as **HSL
   triplets** (`249 90% 66%`) for Tailwind's `hsl(var(--…))`. Anything that references a
   canonical name the repo doesn't define renders **transparent / browser-default**.

2. **Component gap.** A few shared primitives and the two pages don't yet match the DS
   on radius / spacing / semantic-tint / elevation details.

> **Audit caveat (important):** `DESIGN_AUDIT.md` / `REFACTORING_SPECS.md` were written
> against stock shadcn defaults and **overstate** the gaps. In this repo Tailwind remaps
> `rounded-md`=8px and `rounded-lg`=10px, so buttons (8px + `accent-600/700` hover),
> badges (`rounded-[4px]` + tint tone variants), cards (`rounded-lg`=10px + border), and
> table cells (`p-4`=16px) are **already aligned**. The real remaining gaps are narrow.
> The specs also prescribe inline `style={{ '&:hover': … }}`, which is **dead code in
> React** (inline styles can't express pseudo-selectors) — we deliberately do not follow
> that literally.

## Approach: hybrid, Phase A → Phase B

One branch, reviewable as two commits. Phase A is a prerequisite for Phase B.

### Phase A — token foundation (safety net)

Make the canonical DS vocabulary fully resolvable app-wide. Purely additive **except**
the accent hex conversion. Two files.

**Decision (accent bridging):** convert the accent scale to hex and rewire Tailwind
(chosen over keeping triplets), so `var(--accent-500)` is a usable literal color
everywhere and matches the DS source of truth 1:1.

#### `src/index.css` — under both `:root` and `.dark`

1. **Convert `--accent-50…900` triplets → hex** (`--accent-500: #6E5CF6`, full 10-step
   scale from `colors_and_type.css`).
   - **The scale stays IMMUTABLE across light/dark** — identical hex in both modes. We do
     **not** adopt the DS doc's dark re-pitch of `--accent-600/700` (lifting them to
     `#A88EFF` / `#C9BCFF`). That re-pitch is the exact contrast regression from PR #139
     (white text on a lifted violet ≈ 2.4:1). Dark-mode role shifts stay in semantic
     tokens (`--sidebar-accent*`, `--primary-hover/active`), never in the scale.
2. **Add neutral aliases** that bridge to the existing shadcn neutrals (so they auto-track
   light/dark with zero duplication):
   - `--bg: hsl(var(--background))`
   - `--surface: hsl(var(--card))`
   - `--surface-2: hsl(var(--muted))`
   - `--text: hsl(var(--foreground))`
   - `--text-muted: hsl(var(--muted-foreground))`
   - `--surface-3`, `--text-faint` → literals (no shadcn equivalent): `#EFEDE7`/`#24232B`,
     `#8B8A85`/`#6F6E6A`.
3. **Add the missing primitive scales** (presently absent from the repo), taken from the
   DS source: `--radius-xs…pill`, `--space-0…10`, `--ease-out/in-out`, `--dur-fast/base/slow`,
   `--row-h`/`--btn-h`, `--shadow-0/4/inset`, `--veil`, semantic hex
   `--green/amber/red-{100,500,600}` (with `.dark` overrides on the `-100`/`-600` stops),
   and `--primary-hover`/`--primary-active` (= accent-600/700, white-text AA both modes).

#### `tailwind.config.ts`

- Rewire `colors.accent.50…900` from `hsl(var(--accent-NNN))` → `var(--accent-NNN)`.
- Add `boxShadow.elev0: var(--shadow-0)` and `boxShadow.elev4: var(--shadow-4)`.
- **Keep `--space-*`, `--ease-*`, `--dur-*`, and the `--radius-*` t-shirt scale CSS-only**
  (not Tailwind utilities) — wiring them in would shadow Tailwind's native spacing/easing
  and resize existing `rounded-xl/2xl` consumers (documented trap).

#### Lockstep fixes (accent opacity modifiers broken by the hex switch)

Tailwind v3 `/opacity` modifiers need the `hsl(var(--x) / <alpha-value>)` channel form;
plain-hex `var(--accent-500)` breaks them. Only two usages exist:

- `src/components/ui/badge.tsx` `border-accent-500/30` → `border-accent-200` (solid soft
  violet hairline).
- `src/components/layout/NotificationsList.tsx` `bg-accent-900/20` → unread wash via
  `bg-accent-50 dark:bg-accent-900` (solid stops; verify the dark tint reads as a subtle
  wash, not a heavy fill).

### Phase B — component alignment (Tailwind-first)

**Decision (migration style):** adapt the DS specs to the repo's Tailwind architecture
(chosen over literal inline-style rewrites). Keep `:hover`/`:focus`/dark-mode working
through Tailwind + existing semantic tokens; reach for raw `var(--…)` DS primitives only
where Tailwind can't express it (e.g. `--veil`, `shadow-elev4`).

**Shared `ui/` primitives (global — single source of truth):**

| File | Change |
|---|---|
| `badge.tsx` | Point tone variants (`confirmed/hold/risk`) + `destructive` at the new DS tint tokens (`--green/amber/red-100` bg + `-600` text); radius already 4px. |
| `input.tsx` | `rounded-md`(8px) → `rounded-[6px]` (`--radius-s`); border → hairline. |
| `card.tsx` | Header/content/footer padding `p-3.5`(14px) → `p-4`(16px = `--space-6`). |
| `dialog.tsx` / `alert-dialog.tsx` | Overlay `bg-black/80` → `--veil`; content `shadow-elev3` → `shadow-elev4`. |
| `alert.tsx` | `destructive` variant → DS red-tint pattern. |

`destructive` badge variant is used in only 2 places app-wide (OrganizationsTab suspended
status; one editor panel) → low realignment risk.

**Page-level (`/platform` + `/settings`):**

- `OrganizationsTab.tsx` — numeric columns (Members / Active artists / Bookings 30d) →
  `tabular-nums` right-aligned; loading `Skeleton h-12`(48px) → `h-[34px]` (`--row-h`);
  suspended badge via the tint variant.
- `OrganizationTab.tsx` / `AirtableSyncTab.tsx` — inherit the primitive changes; verify,
  no bespoke rewrites.

### Out of scope (YAGNI)

`button.tsx` (already aligned), `table.tsx` (cells already `p-4`), wholesale typography /
`.sf-*` utility classes, the `_ds/` kit files, and any non-target page.

## Components & boundaries

- **Token layer (`index.css` + `tailwind.config.ts`)** — defines the vocabulary; consumers
  read it via Tailwind utilities or `var()`. Changing a token value must not change its
  contract (name/role). The accent scale's contract: *immutable palette stops, mode-agnostic*.
- **Primitive layer (`ui/*.tsx`)** — presentational; reads tokens, exposes `variant`/`size`
  APIs. Page code stays unaware of token internals.
- **Page layer (`OrganizationsTab`, `OrganizationTab`, `AirtableSyncTab`)** — composes
  primitives; only page-specific concerns (numeric alignment, skeleton height, which badge
  variant a status maps to) live here.

## Testing & verification

**Constraint:** no local node/npm/npx (Deno-only box). `vitest` / `build` / `eslint` and
the Vite app run in **CI on the PR**, not locally. Verify locally via diff review + the DS
visual.

- **Component tests (CI, extend `button.test.tsx` pattern):** assert badge tint variants
  render the expected classes for `confirmed/hold/risk/destructive`.
- **Source-level regression guard (CI):** assert `tailwind.config.ts` contains no
  `hsl(var(--accent-` and `src/index.css` accent stops are hex — catches a half-applied
  lockstep change.
- **Local visual check:** render the project's `ShowFlow_Alignment_Visual.html` against the
  **new** tokens; eyeball color / radius / spacing / tint badges in **light and dark**
  (toggle `class="dark"`).
- **CI gate:** vitest + build + eslint green before merge.

## Risks

- **Accent hex conversion is the one non-additive change.** Mitigated: only 3 files consume
  the scale, only 2 opacity modifiers need rewriting, zero raw `hsl(var(--accent-` exist in
  app code, and the source-level guard catches regressions.
- **Primitive changes are global** — they polish the whole app, not just two pages. Accepted
  (DS alignment should be app-wide); each change is minimal and CI-gated.
- **Re-introducing the PR #139 trap** — avoided by keeping the accent scale immutable and
  putting dark role-shifts only in semantic tokens.
