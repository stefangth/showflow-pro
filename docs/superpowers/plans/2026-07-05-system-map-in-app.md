# System Map in Settings → Documentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a super-admin-only interactive automation-engine canvas + rendered `system-map.md` reference to Settings → Documentation, natively in React.

**Architecture:** Static typed graph data (`src/data/systemMap.ts`) drives a token-themed swimlane canvas (`SystemMapCanvas`); a shared `MarkdownDoc` wrapper renders both the existing App Logic guide and the new `system-map.md` reference; `DocumentationTab` becomes prop-driven and, for super-admins, exposes sub-tabs. No server calls — read-only documentation.

**Tech Stack:** React 18 + TS, Vite `?raw` imports, shadcn `Tabs`/`Card`, `react-markdown` + `remark-gfm`, Tailwind semantic tokens, Vitest + @testing-library/react + jsdom.

## Global Constraints

- Worktree: `/Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/system-map-in-app`, branch `claude/system-map-in-app` (off `main` @ f170322).
- **Semantic tokens only** — never hardcode hex/`bg-white`/`text-black`. Kind→token: `cron`→`--warning`, `user`→`--info`, `fn`→`--primary`, `db`→`--success`, `fx`→`--destructive`; neutrals `--card`/`--muted`/`--border`/`--foreground`/`--muted-foreground`. Accent numbered stops don't take opacity modifiers.
- **Accent numbered stops (`accent-50`–`900`) don't support `/alpha`** — use solid stops or `rgba()`.
- Named exports for components (except pages); `PascalCase.tsx` components, `camelCase.ts` data/utils.
- Tests co-located; use `@/test/renderWithProviders`; never `vi.mock('@/integrations/supabase/client')` for pure-render components; the drift test imports the real markdown via `?raw`.
- Test commands are CI-parity but runnable locally here: `npx vitest run <path>`.
- Graph data source of truth (transcription input): `docs/superpowers/specs/system-map-canvas-source.html` — its `N` (nodes) and `E` (edges) JS arrays. This file is a scratch reference and is **deleted in Task 6**.
- Node inventory the data + tests must preserve: **6 `cron`, 4 `user`, 21 `fn`, 12 `db`, 9 `fx`** (52 nodes).

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/data/systemMap.ts` | create | typed graph data + types (single in-app source) |
| `src/data/systemMap.test.ts` | create | edge integrity, counts, markdown-drift guard |
| `src/components/settings/MarkdownDoc.tsx` | create | shared `prose` markdown wrapper |
| `src/components/settings/SystemMapReference.tsx` | create | renders `docs/system-map.md` |
| `src/components/settings/SystemMapCanvas.tsx` | create | interactive swimlane canvas |
| `src/components/settings/SystemMapCanvas.test.tsx` | create | render / filter / detail-panel |
| `src/components/settings/DocumentationTab.tsx` | modify | prop-driven; super-admin sub-tabs |
| `src/components/settings/DocumentationTab.test.tsx` | create | gating by `isSuperAdmin` prop |
| `src/pages/SettingsPage.tsx` | modify | pass `isSuperAdmin` prop |
| `docs/system-map.md`, `CLAUDE.md` | modify | maintenance rule also names `systemMap.ts` |

---

### Task 1: Graph data + guards (`systemMap.ts`)

**Files:**
- Create: `src/data/systemMap.ts`, `src/data/systemMap.test.ts`

**Interfaces:**
- Produces: `SYSTEM_MAP_NODES: SystemMapNode[]`, `SYSTEM_MAP_EDGES: SystemMapEdge[]`, and the exported types `SystemMapNode`, `SystemMapEdge`, `NodeKind` (`'cron'|'user'|'fn'|'db'|'fx'`), `Column` (`'trigger'|'fn'|'db'|'fx'`), `Subsystem` (`'booking'|'email'|'airtable'|'platform'|'gdpr'`). Consumed by Tasks 3 (canvas) — `SystemMapNode` fields: `id, column, kind, label, sub?, group?, subsystems, detail`; `SystemMapEdge` fields: `from, to, read?, label?`.

**Transcription mapping** from `system-map-canvas-source.html` `N`/`E` arrays: node `col`→`column` (`"trig"`→`'trigger'`, else same), `t`→`kind`, `s`→`subsystems`, `g`→`group`, `d`→`detail` (keep key order), `label`/`sub` unchanged. Edge tuple `[from,to,mode?,label?]`: `mode==="dash"`→`read:true`, else omit `read`; keep `label` when present.

- [ ] **Step 1: Write the failing test** — `src/data/systemMap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SYSTEM_MAP_NODES, SYSTEM_MAP_EDGES } from "./systemMap";
import mapMd from "../../docs/system-map.md?raw";

describe("systemMap data", () => {
  const ids = new Set(SYSTEM_MAP_NODES.map((n) => n.id));

  it("has the expected node counts per kind", () => {
    const by = (k: string) => SYSTEM_MAP_NODES.filter((n) => n.kind === k).length;
    expect(by("cron")).toBe(6);
    expect(by("user")).toBe(4);
    expect(by("fn")).toBe(21);
    expect(by("db")).toBe(12);
    expect(by("fx")).toBe(9);
  });

  it("has unique node ids", () => {
    expect(ids.size).toBe(SYSTEM_MAP_NODES.length);
  });

  it("every edge references existing nodes", () => {
    for (const e of SYSTEM_MAP_EDGES) {
      expect(ids.has(e.from), `edge.from ${e.from}`).toBe(true);
      expect(ids.has(e.to), `edge.to ${e.to}`).toBe(true);
    }
  });

  it("does not drift from docs/system-map.md (every fn/cron label appears there)", () => {
    const missing = SYSTEM_MAP_NODES
      .filter((n) => n.kind === "fn" || n.kind === "cron")
      .map((n) => n.label.replace(/ (clock|actions)$/,"").trim())
      .filter((label) => !mapMd.includes(label));
    expect(missing, `labels absent from system-map.md: ${missing.join(", ")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run src/data/systemMap.test.ts`
Expected: FAIL — cannot resolve `./systemMap` (module missing).

- [ ] **Step 3: Create `src/data/systemMap.ts`** — the types header, then transcribe all 52 nodes + all edges from `system-map-canvas-source.html` per the mapping above. Header:

```ts
// Automation-engine graph powering the in-app System Map canvas
// (Settings → Documentation, super-admin only).
//
// MAINTENANCE RULE: this is a transcription of docs/system-map.md. Any PR that
// changes a cron, edge function, DB guard, email, or notification path updates
// BOTH docs/system-map.md AND this file in the same PR. The systemMap.test.ts
// drift guard fails CI if a fn/cron label here is absent from the markdown.

export type NodeKind = "cron" | "user" | "fn" | "db" | "fx";
export type Column = "trigger" | "fn" | "db" | "fx";
export type Subsystem = "booking" | "email" | "airtable" | "platform" | "gdpr";

export interface SystemMapNode {
  id: string;
  column: Column;
  kind: NodeKind;
  label: string;
  sub?: string;
  group?: string;
  subsystems: Subsystem[];
  detail: Record<string, string>;
}

export interface SystemMapEdge {
  from: string;
  to: string;
  read?: boolean;
  label?: string;
}

export const SYSTEM_MAP_NODES: SystemMapNode[] = [ /* transcribe N[] — all 52 */ ];
export const SYSTEM_MAP_EDGES: SystemMapEdge[] = [ /* transcribe E[] */ ];
```

Transcribe every entry — the count and drift tests will catch omissions.

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run src/data/systemMap.test.ts`
Expected: PASS (4 tests). If drift fails, the label in the data must be adjusted to match the map (fix the data, not the test).

- [ ] **Step 5: Commit**

```bash
git add src/data/systemMap.ts src/data/systemMap.test.ts
git commit -m "feat: add typed system-map graph data with drift guard"
```

---

### Task 2: Shared `MarkdownDoc` wrapper

**Files:**
- Create: `src/components/settings/MarkdownDoc.tsx`
- Modify: `src/components/settings/DocumentationTab.tsx` (use the wrapper — behavior-preserving)

**Interfaces:**
- Produces: `MarkdownDoc({ source }: { source: string })` — a `<div class="prose …">` rendering `source` via `ReactMarkdown` + `remarkGfm`. Consumed by Task 4 (`SystemMapReference`) and Task 5.

- [ ] **Step 1: Create `src/components/settings/MarkdownDoc.tsx`** — move the exact prose-class `<div>` + `<ReactMarkdown remarkPlugins={[remarkGfm]}>` currently inline in `DocumentationTab.tsx` (lines 17–34) into this component verbatim:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Read-only markdown rendered with the shared ShowFlow doc prose styling. */
export function MarkdownDoc({ source }: { source: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground
      [&_h1]:font-display [&_h1]:text-2xl [[&_h1]:font-bold_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3
      [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1
      [&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1
      [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-3 [&_p]:text-foreground
      [&_li]:text-sm [&_li]:leading-relaxed
      [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3
      [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3
      [&_code]:bg-muted [&_code]:text-foreground [&_code]:text-xs [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
      [&_pre]:bg-muted [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:mb-3 [&_pre]:text-xs
      [&_pre_code]:bg-transparent [&_pre_code]:p-0
      [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse [&_table]:mb-4
      [&_th]:text-left [&_th]:font-medium [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5
      [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:text-sm [&_td]:align-top
      [&_hr]:border-border [&_hr]:my-4
      [&_strong]:font-semibold [&_strong]:text-foreground
      [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 2: Refactor `DocumentationTab.tsx`** to use it — replace the inline `<div class="prose …"><ReactMarkdown …/></div>` with `<MarkdownDoc source={appLogicMd} />`, drop the now-unused `ReactMarkdown`/`remarkGfm` imports, add `import { MarkdownDoc } from "./MarkdownDoc";`. Leave the surrounding `Card`/`CardHeader` unchanged for now.

- [ ] **Step 3: Verify build + no regression**

Run: `npx vitest run src/components/settings/ && npx tsc --noEmit -p tsconfig.app.json 2>/dev/null || npx tsc --noEmit`
Expected: existing settings tests PASS, no type errors. (No behavior change — App Logic still renders identically.)

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/MarkdownDoc.tsx src/components/settings/DocumentationTab.tsx
git commit -m "refactor: extract shared MarkdownDoc wrapper"
```

---

### Task 3: `SystemMapCanvas` component

**Files:**
- Create: `src/components/settings/SystemMapCanvas.tsx`, `src/components/settings/SystemMapCanvas.test.tsx`

**Interfaces:**
- Consumes: `SYSTEM_MAP_NODES`, `SYSTEM_MAP_EDGES`, `Subsystem` from `@/data/systemMap`.
- Produces: `SystemMapCanvas()` (no props) — consumed by Task 5.

- [ ] **Step 1: Write the failing test** — `SystemMapCanvas.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SystemMapCanvas } from "./SystemMapCanvas";

describe("SystemMapCanvas", () => {
  it("renders nodes across the four columns", () => {
    renderWithProviders(<SystemMapCanvas />);
    expect(screen.getByRole("button", { name: /airtable-poll$/i })).toBeInTheDocument();
    expect(screen.getByText(/bookings/i)).toBeInTheDocument();
  });

  it("filters nodes by subsystem chip", () => {
    renderWithProviders(<SystemMapCanvas />);
    // 'Airtable sync' filter hides a GDPR-only node like fetch-remote-sheet
    fireEvent.click(screen.getByRole("button", { name: /airtable sync/i }));
    expect(screen.queryByRole("button", { name: /fetch-remote-sheet/i })).toBeNull();
    // restore
    fireEvent.click(screen.getByRole("button", { name: /^all$/i }));
    expect(screen.getByRole("button", { name: /fetch-remote-sheet/i })).toBeInTheDocument();
  });

  it("opens a detail panel when a node is clicked", () => {
    renderWithProviders(<SystemMapCanvas />);
    fireEvent.click(screen.getByRole("button", { name: /send-transactional-email/i }));
    const panel = screen.getByRole("complementary", { name: /details/i });
    expect(within(panel).getByText(/service-role only/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run src/components/settings/SystemMapCanvas.test.tsx`
Expected: FAIL — cannot resolve `./SystemMapCanvas`.

- [ ] **Step 3: Implement `SystemMapCanvas.tsx`.** Requirements the tests + spec pin:
  - Columns rendered in order Triggers/Edge functions/Database/Effects from `node.column` (`trigger|fn|db|fx`); optional `group` sub-headers within a column.
  - Each node is a `<button>` labelled by `node.label` (accessible name = label), with `node.sub` as a caption and a left-border color by `kind` using the token map (`cron`→`--warning`, `user`→`--info`, `fn`→`--primary`, `db`→`--success`, `fx`→`--destructive`). Use inline `style={{ borderLeftColor: 'hsl(var(--warning))', ... }}` keyed by kind (tokens are HSL channels) or a `kindClass` map of Tailwind classes like `border-l-warning`; do not hardcode hex.
  - Filter chips: `All` + the 5 subsystems; a `useState<Subsystem | "all">`; a node is visible when filter is `"all"` or `node.subsystems.includes(filter)`. Chips are `<button>` with `aria-pressed`.
  - Detail panel: `useState<string | null>(selectedId)`; clicking a node sets it; render an `<aside aria-label="Node details">` (role `complementary`) listing the node's `detail` entries as a `<dl>`; a close button clears it. Clicking the selected node again clears it.
  - SVG edge overlay: an absolutely-positioned `<svg>` sized to the grid; on mount + `ResizeObserver`/`window resize`, compute each visible edge's endpoints from the two nodes' `getBoundingClientRect` relative to the container and draw a cubic path; `read` edges dashed, others solid; stroke uses `currentColor`/token via `stroke: 'hsl(var(--border))'` default and the source kind's token when its node is selected. Recompute when filter or selection changes. (jsdom returns zero rects — that's fine, tests don't assert geometry.)
  - Wrap the grid in `<div className="overflow-x-auto">` with a `min-w-[…]`.
  - Keyboard: buttons are natively focusable; add `focus-visible` ring via existing utility; honor `prefers-reduced-motion` by gating any transition.
  - No Card here — the parent tab supplies chrome.

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run src/components/settings/SystemMapCanvas.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SystemMapCanvas.tsx src/components/settings/SystemMapCanvas.test.tsx
git commit -m "feat: add interactive SystemMapCanvas"
```

---

### Task 4: `SystemMapReference` component

**Files:**
- Create: `src/components/settings/SystemMapReference.tsx`

**Interfaces:**
- Consumes: `MarkdownDoc` (Task 2). Produces: `SystemMapReference()` — consumed by Task 5.

- [ ] **Step 1: Implement** `src/components/settings/SystemMapReference.tsx`:

```tsx
import mapMd from "../../../docs/system-map.md?raw";
import { MarkdownDoc } from "./MarkdownDoc";

/** The full docs/system-map.md rendered read-only. Mermaid fences show as code. */
export function SystemMapReference() {
  return <MarkdownDoc source={mapMd} />;
}
```

- [ ] **Step 2: Verify it type-checks + imports the raw file**

Run: `npx vitest run src/data/systemMap.test.ts` (already imports the same `?raw` path — proves the alias resolves) and `npx tsc --noEmit`.
Expected: PASS / no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/SystemMapReference.tsx
git commit -m "feat: add SystemMapReference markdown view"
```

---

### Task 5: Prop-driven `DocumentationTab` with super-admin sub-tabs + wiring

**Files:**
- Modify: `src/components/settings/DocumentationTab.tsx`
- Create: `src/components/settings/DocumentationTab.test.tsx`
- Modify: `src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `SystemMapCanvas` (Task 3), `SystemMapReference` (Task 4), `MarkdownDoc` (Task 2), shadcn `Tabs`.
- Produces: `DocumentationTab({ isSuperAdmin }: { isSuperAdmin: boolean })`.

- [ ] **Step 1: Write the failing test** — `DocumentationTab.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { DocumentationTab } from "./DocumentationTab";

describe("DocumentationTab", () => {
  it("shows the System Map tab for super-admins", () => {
    renderWithProviders(<DocumentationTab isSuperAdmin={true} />);
    expect(screen.getByRole("tab", { name: /system map/i })).toBeInTheDocument();
  });

  it("hides the System Map tab for non-super-admins but still shows the guide", () => {
    renderWithProviders(<DocumentationTab isSuperAdmin={false} />);
    expect(screen.queryByRole("tab", { name: /system map/i })).toBeNull();
    expect(screen.getByText(/how showflow works/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run src/components/settings/DocumentationTab.test.tsx`
Expected: FAIL — `DocumentationTab` takes no props / no tab role present.

- [ ] **Step 3: Rewrite `DocumentationTab.tsx`**:

```tsx
import appLogicMd from "../../../docs/app-logic.md?raw";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownDoc } from "./MarkdownDoc";
import { SystemMapCanvas } from "./SystemMapCanvas";
import { SystemMapReference } from "./SystemMapReference";

/** Documentation surface. App Logic is public; the System Map is super-admin only. */
export function DocumentationTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const guide = (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">App Logic Guide</CardTitle>
        <CardDescription>
          How ShowFlow works: roles, data model, eligibility, and the full availability → booking flow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MarkdownDoc source={appLogicMd} />
      </CardContent>
    </Card>
  );

  if (!isSuperAdmin) return guide;

  return (
    <Tabs defaultValue="guide" className="space-y-4">
      <TabsList>
        <TabsTrigger value="guide">App Logic</TabsTrigger>
        <TabsTrigger value="map">System Map</TabsTrigger>
        <TabsTrigger value="reference">Reference</TabsTrigger>
      </TabsList>
      <TabsContent value="guide">{guide}</TabsContent>
      <TabsContent value="map">
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Automation Engine Map</CardTitle>
            <CardDescription>
              Every trigger, edge function, database guard, and side effect — click a node for its dossier.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SystemMapCanvas />
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="reference">
        <Card>
          <CardHeader>
            <CardTitle className="font-display">System Map Reference</CardTitle>
            <CardDescription>The full written map (docs/system-map.md).</CardDescription>
          </CardHeader>
          <CardContent>
            <SystemMapReference />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 4: Wire `SettingsPage.tsx`** — add `isSuperAdmin` to the `useAuth()` destructure at line 262 (`const { hasRole, currentOrg, isSuperAdmin } = useAuth();`) and pass it at the docs tab render (line ~526): `<DocumentationTab isSuperAdmin={isSuperAdmin} />`.

- [ ] **Step 5: Run — verify it passes + no regressions**

Run: `npx vitest run src/components/settings/ && npx tsc --noEmit`
Expected: DocumentationTab tests PASS (2), all other settings tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/DocumentationTab.tsx src/components/settings/DocumentationTab.test.tsx src/pages/SettingsPage.tsx
git commit -m "feat: super-admin system map sub-tabs in Documentation"
```

---

### Task 6: Maintenance rule + cleanup + full verification

**Files:**
- Modify: `docs/system-map.md`, `CLAUDE.md`
- Delete: `docs/superpowers/specs/system-map-canvas-source.html`

- [ ] **Step 1: Extend the maintenance rule.** In `docs/system-map.md`, change the header maintenance line to end with: `…MUST update this file AND the in-app graph data \`src/data/systemMap.ts\` in the same PR.` In `CLAUDE.md`, update the `docs/system-map.md` key-files row and the `docs/` tree note to add: `— mirrored by src/data/systemMap.ts (in-app canvas), update both together`.

- [ ] **Step 2: Delete the scratch transcription source**

```bash
git rm docs/superpowers/specs/system-map-canvas-source.html
```

- [ ] **Step 3: Full suite + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS, no type errors, production build succeeds (proves the `?raw` markdown imports bundle).

- [ ] **Step 4: Preview-verify the real UI** (per the preview workflow) — start the dev server, sign in as a super-admin, open Settings → Documentation → System Map, confirm the canvas renders, a filter chip narrows nodes, and clicking a node opens the panel; screenshot for the PR. Then confirm a non-super-admin session shows no System Map tab.

- [ ] **Step 5: Commit + open PR**

```bash
git add docs/system-map.md CLAUDE.md
git commit -m "docs: system-map maintenance rule now covers in-app graph data"
git push -u origin claude/system-map-in-app
gh pr create --base main --title "feat: in-app automation system map (Settings → Documentation)" --body "…"
```

PR body: what it adds, super-admin gating, the drift-test sync guard, screenshot, and a note that the graph mirrors `docs/system-map.md`. End with the Claude Code trailer.

---

## Self-Review

- **Spec coverage:** gating (T5 + drift note), canvas native port with tokens (T3), reference render (T4), shared MarkdownDoc DRY (T2), typed data + drift guard (T1), maintenance-rule sync (T6), tests for all three behaviors (T1/T3/T5). ✔
- **Placeholders:** the two data arrays in T1 are explicit transcriptions of a named source file with counts enforced by tests — not open-ended TODOs. No other placeholders. ✔
- **Type consistency:** `SystemMapNode`/`SystemMapEdge` field names (`column`, `kind`, `subsystems`, `detail`, `read`) identical across T1 definition and T3 consumption; `DocumentationTab({ isSuperAdmin })` signature identical in T5 impl, test, and SettingsPage call. ✔
