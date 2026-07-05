# System Map in Settings → Documentation — Design

**Date:** 2026-07-05
**Branch:** `claude/system-map-in-app` (off `main` @ f170322, which contains `docs/system-map.md`)
**Status:** approved (brainstorming), pending spec review

## Problem

The automation-engine map exists as `docs/system-map.md` (repo) and a one-off claude.ai artifact (ephemeral). The owner wants the interactive canvas *inside the app* at Settings → Documentation, gated to super-admins, so the oversight surface lives where they work and stays versioned with the code — not in a chat artifact that disappears.

## Decisions (locked during brainstorming)

- **Gating:** super-admin only (`isSuperAdmin`). The App Logic guide stays public.
- **Scope:** interactive canvas **and** the rendered `system-map.md` reference.
- **Port strategy:** native React component, **not** an iframe of a `public/` static file — static files are world-readable at `app.showflow.pro/…` and would defeat the gate. Native port also gets app theming and testable data.
- **Release:** no version bump / changelog now.
- **Prereqs:** PRs #149 (map) and #150 (RPC hardening) — **merged** to main before this branch was cut.

## Architecture

Four units, each with one responsibility and a well-defined interface.

### 1. `src/data/systemMap.ts` — the graph data (single in-app source)

Typed, static transcription of the artifact's graph. No React, no I/O — pure data, so it's trivially testable and the drift test can import it directly.

```ts
export type NodeKind = 'cron' | 'user' | 'fn' | 'db' | 'fx';
export type Column = 'trigger' | 'fn' | 'db' | 'fx';
export type Subsystem = 'booking' | 'email' | 'airtable' | 'platform' | 'gdpr';

export interface SystemMapNode {
  id: string;
  column: Column;
  kind: NodeKind;
  label: string;
  sub?: string;                 // one-line caption (schedule, guard, etc.)
  group?: string;               // optional sub-header within a column
  subsystems: Subsystem[];      // for filter chips; a node may span several
  detail: Record<string, string>; // ordered dossier fields for the panel
}

export interface SystemMapEdge {
  from: string;                 // node id
  to: string;                   // node id
  read?: boolean;               // true → dashed (read/propagate); default solid (write/invoke)
  label?: string;
}

export const SYSTEM_MAP_NODES: SystemMapNode[] = [ /* transcribed from the verified artifact */ ];
export const SYSTEM_MAP_EDGES: SystemMapEdge[] = [ /* … */ ];
```

Header comment ties it to the maintenance rule (see §Sync). Node set mirrors the artifact: 6 cron, 4 user-groups, 21 fn, 12 db, 9 fx; edges as in the artifact (with the §6.1 recompute-edge fix already in the source map).

### 2. `src/components/settings/SystemMapCanvas.tsx` — the interactive canvas

Consumes `systemMap.ts`; depends on nothing else. Renders four swimlane columns (Triggers / Edge functions / Database / Effects), an absolutely-positioned SVG edge overlay computed from DOM `getBoundingClientRect` after layout + on resize, subsystem filter chips, and a click-to-open detail panel (right side on desktop, below on mobile).

**Theming:** all colors are **app semantic tokens**, not the artifact's hardcoded slate palette. Kind → token mapping:
- `cron` → `--warning`
- `user` → `--info` (= primary hue)
- `fn` → `--primary`
- `db` → `--success`
- `fx` → `--destructive` (muted usage — left border + faint tint only, not alarm-red fills)

Neutrals: `--card`, `--muted`, `--border`, `--foreground`, `--muted-foreground`. This makes the canvas respond to the app's dark/light mode for free. Left-border accent + faint `color-mix`/token tint per kind; no raw hex.

**Interactions:** click a node → highlight its incident edges + neighbors, dim the rest, open the detail panel; click again or a close button → clear. Filter chips (All + 5 subsystems) hide non-matching nodes and their edges; redraw edges on filter change. Keyboard: nodes are `<button>`s (focusable, Enter/Space activate), visible focus ring, `aria-pressed` on chips. Respect `prefers-reduced-motion`.

**Overflow:** the swimlane grid has a min-width and lives in an `overflow-x:auto` container so the page body never scrolls sideways.

### 3. `src/components/settings/SystemMapReference.tsx` — the rendered map

Renders `docs/system-map.md?raw` through the existing `react-markdown` + `remark-gfm` pipeline. Mermaid fences render as plain code blocks (the app has no mermaid renderer; the canvas is the visual). To DRY with the App Logic guide, extract the large `prose` class wrapper currently inline in `DocumentationTab` into a shared:

### 4. `src/components/settings/MarkdownDoc.tsx` — shared prose wrapper

`function MarkdownDoc({ source }: { source: string })` — the `<div class="prose …">` + `<ReactMarkdown remarkPlugins={[remarkGfm]}>`. Both `DocumentationTab` (App Logic) and `SystemMapReference` use it. Pure, one job.

### 5. `DocumentationTab.tsx` — restructured (edited)

Becomes prop-driven: `function DocumentationTab({ isSuperAdmin }: { isSuperAdmin: boolean })`.
- Not super-admin → renders the App Logic guide via `MarkdownDoc` exactly as today (no visible change).
- Super-admin → wraps content in shadcn `Tabs`: `App Logic` | `System Map` | `Reference`, defaulting to `App Logic`. `System Map` → `<SystemMapCanvas />`; `Reference` → `<SystemMapReference />`.

`SettingsPage.tsx` (already calls `useAuth()`) passes `isSuperAdmin` down: `<DocumentationTab isSuperAdmin={isSuperAdmin} />`. Keeping the gate a prop (not an internal `useAuth()` call) means the component is testable by passing a boolean — no AuthContext mock, consistent with the repo's "thin wrapper, testable core" pattern.

## Data flow

`SettingsPage` (`useAuth → isSuperAdmin`) → `DocumentationTab` (prop) → conditionally `SystemMapCanvas` (reads `systemMap.ts`) / `SystemMapReference` (reads `system-map.md?raw`). No server calls, no React Query, no mutations — this is static, read-only documentation.

## Keeping in sync with the maintenance rule

The graph is a hand transcription and can drift from `docs/system-map.md`. Guards:

1. **Docs:** extend the maintenance-rule line (in `docs/system-map.md`'s header and CLAUDE.md's key-files row) to also name `src/data/systemMap.ts` — "update the map, the in-app graph data, in the same PR."
2. **Drift test** (`systemMap.test.ts`): import `../../docs/system-map.md?raw` and assert every `fn`/`cron` node's `label` string appears somewhere in the markdown. Gross drift (a renamed/removed function) then fails CI. This is a cheap containment guard, not full derivation (which would be over-engineering).

## Testing (test-first)

- **`src/data/systemMap.test.ts`**
  - every edge `from`/`to` references an existing node id;
  - counts: 21 `fn`, 6 `cron` nodes;
  - drift: each `fn`/`cron` label appears in `system-map.md?raw`.
- **`src/components/settings/SystemMapCanvas.test.tsx`** (`renderWithProviders`)
  - renders a node from each column;
  - clicking a filter chip hides a node of a non-matching subsystem;
  - clicking a node opens the detail panel showing one of its `detail` fields.
- **`src/components/settings/DocumentationTab.test.tsx`** (`renderWithProviders`)
  - `isSuperAdmin={true}` → the "System Map" tab trigger is present;
  - `isSuperAdmin={false}` → it is absent, App Logic content still renders.

(SVG geometry / `getBoundingClientRect` is jsdom-inert; tests assert DOM structure and interaction state, not pixel coordinates.)

## Out of scope (YAGNI)

Mermaid rendering; deriving the graph from the markdown AST; canvas zoom/pan/export; persisting canvas view state; any changelog/version work.

## File summary

| File | Action | Responsibility |
|---|---|---|
| `src/data/systemMap.ts` | create | typed graph data (single in-app source) |
| `src/data/systemMap.test.ts` | create | edge integrity, counts, markdown drift |
| `src/components/settings/MarkdownDoc.tsx` | create | shared prose markdown wrapper |
| `src/components/settings/SystemMapCanvas.tsx` | create | interactive canvas (tokened) |
| `src/components/settings/SystemMapCanvas.test.tsx` | create | render / filter / detail-panel |
| `src/components/settings/SystemMapReference.tsx` | create | rendered `system-map.md` |
| `src/components/settings/DocumentationTab.tsx` | edit | prop-driven; super-admin sub-tabs |
| `src/components/settings/DocumentationTab.test.tsx` | create | gating by `isSuperAdmin` prop |
| `src/pages/SettingsPage.tsx` | edit | pass `isSuperAdmin` prop |
| `docs/system-map.md` + `CLAUDE.md` | edit | maintenance rule names `systemMap.ts` |
