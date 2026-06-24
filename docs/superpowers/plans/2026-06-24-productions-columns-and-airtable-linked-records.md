# Productions configurable columns + Airtable linked-record sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six reported issues on `/productions` and Settings → Airtable Sync: configurable columns, visible program/sub-program, per-program linking, working city linking, clearer mapping headers, and resolved venue/city names (no more `["rec…"]`).

**Architecture:** Reuse the existing per-role column-template editor system for `/productions` (no permission changes). For Airtable, the `City`/`Venue` fields are `multipleRecordLinks`; the poll fetches the base schema + linked tables to resolve record IDs → names (backward-compatible passthrough for plain fields), and `airtable-schema` gains a "linked records" mode so the linking UI can enumerate a linked table's records.

**Tech Stack:** React 18 + TS, @tanstack/react-query, shadcn/ui, framer-motion (Reorder), Vitest + @testing-library/react (frontend), Deno test (edge functions), Supabase.

**Spec:** `docs/superpowers/specs/2026-06-24-productions-columns-and-airtable-linked-records-design.md`

**Environment note:** This repo's local env is Deno-only — edge-function Deno tests run locally with `deno test --allow-all --node-modules-dir=none …`; **vitest/eslint are verified in CI** (run them if a Node env is available, otherwise rely on CI). Always write the test first regardless.

---

## File map

| File | Change |
|---|---|
| `src/types/index.ts` | `showLabel` falls back to `sub_program` (#2) |
| `src/types/showLabel.test.ts` | **new** — showLabel unit tests |
| `src/features/editor/columnRegistries.ts` | add `shows` columns, `_computed.date_count`, `shows-productions` page spec (#1) |
| `src/features/editor/columnRegistries.productions.test.ts` | **new** — page-spec defaults |
| `src/pages/ProductionsPage.tsx` | column-driven rows + `ColumnLayoutEditor` (#1, #2) |
| `src/pages/ProductionsPage.test.tsx` | editor mocks + column assertions |
| `src/components/settings/AirtableSyncTab.tsx` | mapping headers (#5), program "Link to existing" (#3), city options from linked records (#4) |
| `src/components/settings/AirtableSyncTab.test.tsx` | header, program-link, city link-records tests |
| `src/data/airtableSchema.ts` | `fetchAirtableLinkedRecords` (#4) |
| `supabase/functions/airtable-schema/index.ts` | Mode C: linked-table records (#4/#6) |
| `supabase/functions/airtable-schema/index.di.test.ts` | Mode C tests |
| `supabase/functions/airtable-poll/index.ts` | linked-record resolution for venue/city (#4/#6) |
| `supabase/functions/airtable-poll/index.linked.test.ts` | **new** — resolution test |
| `public/changelog.md`, `package.json`, `src/config/app.config.ts` | changelog + version (final task) |

---

## Task 1: showLabel falls back to sub_program (#2)

**Files:**
- Create: `src/types/showLabel.test.ts`
- Modify: `src/types/index.ts:47-50`

- [ ] **Step 1: Write the failing test**

Create `src/types/showLabel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { showLabel } from "./index";

describe("showLabel", () => {
  it("combines program and sub_program when both present", () => {
    expect(showLabel({ program: "TJE", sub_program: "Murder" })).toBe("TJE – Murder");
  });
  it("falls back to sub_program when program is null (synced shows)", () => {
    expect(showLabel({ program: null, sub_program: "TJE: Murder" })).toBe("TJE: Murder");
  });
  it("uses program alone when sub_program is null", () => {
    expect(showLabel({ program: "Standalone", sub_program: null })).toBe("Standalone");
  });
  it("returns an em dash when both are null", () => {
    expect(showLabel({ program: null, sub_program: null })).toBe("—");
  });
});
```

- [ ] **Step 2: Run the test, verify the sub_program-only case fails**

Run: `npx vitest run src/types/showLabel.test.ts`
Expected: FAIL on "falls back to sub_program" (currently returns `—`).

- [ ] **Step 3: Implement the fallback**

In `src/types/index.ts`, replace the body of `showLabel` (lines 47-50):

```ts
export function showLabel(show: { program: string | null; sub_program: string | null }): string {
  if (show.program && show.sub_program) return `${show.program} – ${show.sub_program}`;
  return show.program ?? show.sub_program ?? '—';
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/types/showLabel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/types/showLabel.test.ts
git commit -m "fix(catalog): showLabel falls back to sub_program for synced shows"
```

---

## Task 2: Register the `shows-productions` column spec (#1)

**Files:**
- Modify: `src/features/editor/columnRegistries.ts`
- Create: `src/features/editor/columnRegistries.productions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/editor/columnRegistries.productions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveColumnTemplate, pageColumnDefs } from "./columnRegistries";

describe("shows-productions column spec", () => {
  it("defaults to program, sub_program, category, slots, date_count, status (in order)", () => {
    const cols = resolveColumnTemplate("shows-productions", "admin", {});
    const visible = cols.filter((c) => c.visible).map((c) => c.columnId);
    expect(visible).toEqual([
      "shows.program",
      "shows.sub_program",
      "shows.category",
      "_computed.slots",
      "_computed.date_count",
      "shows.status",
    ]);
  });

  it("exposes extra shows columns as available-but-hidden", () => {
    const ids = pageColumnDefs("shows-productions").map((d) => d.id);
    expect(ids).toContain("shows.sort_order");
    expect(ids).toContain("shows.main_cast_slots");
    expect(ids).toContain("shows.understudy_slots");
    expect(ids).toContain("shows.created_at");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/features/editor/columnRegistries.productions.test.ts`
Expected: FAIL (`shows-productions` not in `PAGE_COLUMN_SPECS`; returns empty).

- [ ] **Step 3: Extend the registry**

In `src/features/editor/columnRegistries.ts`:

(a) Replace the `shows` entry in `TABLE_COLUMNS` (line 22) — add `category`, `main_cast_slots`, `understudy_slots`, `sort_order` (all real DB columns):

```ts
  shows: ['id', 'program', 'sub_program', 'category', 'status', 'main_cast_slots', 'understudy_slots', 'sort_order', 'created_by', 'created_at', 'updated_at'],
```

(b) Replace the `_computed` entry (line 26) — add `date_count`:

```ts
  _computed: ['day', 'slots', 'date_count', 'my_status', 'blocked'],
```

(c) Add a label in `COMPUTED_LABELS` (after the `slots` line, ~line 32):

```ts
  '_computed.date_count': 'Dates',
```

(d) Add the page spec to `PAGE_COLUMN_SPECS` (after the `'availability'` entry, ~line 83):

```ts
  'shows-productions': {
    tables: ['shows', '_computed'],
    rendered: [
      'shows.program',
      'shows.sub_program',
      'shows.category',
      '_computed.slots',
      '_computed.date_count',
      'shows.status',
    ],
  },
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/features/editor/columnRegistries.productions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the broader editor test suite to confirm no regressions**

Run: `npx vitest run src/features/editor`
Expected: PASS (adding hidden columns must not change other pages' rendered defaults).

- [ ] **Step 6: Commit**

```bash
git add src/features/editor/columnRegistries.ts src/features/editor/columnRegistries.productions.test.ts
git commit -m "feat(editor): register configurable column spec for productions"
```

---

## Task 3: Make ProductionsPage column-driven (#1, #2)

**Files:**
- Modify: `src/pages/ProductionsPage.tsx`
- Modify: `src/pages/ProductionsPage.test.tsx`

- [ ] **Step 1: Add editor mocks + a column test to the existing test file**

In `src/pages/ProductionsPage.test.tsx`, add these mocks **after** the existing `vi.mock("@/hooks/useShows", …)` block (around line 20, before `import ProductionsPage`). The real `useColumnHeaders` is left unmocked — it consumes the mocked `useEditorConfig`:

```ts
vi.mock("@/features/editor/EditorContext", () => ({
  useColumnTemplate: () => ({
    orderedColumns: [
      { columnId: "shows.program", visible: true, order: 0 },
      { columnId: "shows.sub_program", visible: true, order: 1 },
      { columnId: "shows.category", visible: true, order: 2 },
      { columnId: "_computed.slots", visible: true, order: 3 },
      { columnId: "_computed.date_count", visible: true, order: 4 },
      { columnId: "shows.status", visible: true, order: 5 },
    ],
    isVisible: () => true,
    visibleCount: 6,
    activeRole: "admin",
  }),
  useEditorConfig: () => ({ isEditorMode: false, getColumnLabel: (id: string) => id }),
}));
vi.mock("@/features/editor/ColumnLayoutEditor", () => ({ ColumnLayoutEditor: () => null }));
```

Then add a new test inside the `describe("ProductionsPage", …)` block:

```ts
it("renders configured columns with headers and a date count", () => {
  renderWithProviders(<ProductionsPage />);
  // header label comes from the mocked getColumnLabel (returns the column id)
  expect(screen.getByText("shows.program")).toBeInTheDocument();
  expect(screen.getByText("_computed.date_count")).toBeInTheDocument();
  // date_count cell for the synced show (dateCount: 3)
  expect(screen.getByText(/3 dates/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/pages/ProductionsPage.test.tsx`
Expected: FAIL — the page does not yet render headers / use the column template (and may error that `ColumnLayoutEditor` import is unused until the page is refactored).

- [ ] **Step 3: Rewrite ProductionsPage to render columns from the template**

Replace the entire contents of `src/pages/ProductionsPage.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Reorder } from "framer-motion";
import { useAuth } from "@/features/auth/AuthContext";
import { useShows, useArchiveShow, useDeleteShow, useReorderShows, type ShowWithStats } from "@/hooks/useShows";
import { isSyncedShow, canHardDeleteShow } from "@/lib/catalog";
import { showSlots } from "@/lib/settings";
import { formatDateDMY } from "@/lib/dates";
import { ShowFormDialog } from "@/components/catalog/ShowFormDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { GripVertical, Pencil, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useColumnTemplate } from "@/features/editor/EditorContext";
import { useColumnHeaders } from "@/features/editor/useColumnHeaders";
import { ColumnLayoutEditor } from "@/features/editor/ColumnLayoutEditor";

type StatusFilter = "active" | "archived" | "all";

const STATUS_LABEL: Record<string, string> = { active: "Active", archived: "Archived", draft: "Draft" };

/** Tailwind width per productions column; the first visible column flexes (identity). */
function colWidth(colId: string): string {
  switch (colId) {
    case "shows.program":
    case "shows.sub_program": return "flex-1 min-w-0";
    case "shows.category": return "w-40 shrink-0";
    case "_computed.slots":
    case "shows.main_cast_slots":
    case "shows.understudy_slots": return "w-28 shrink-0";
    case "_computed.date_count": return "w-20 shrink-0";
    case "shows.status": return "w-32 shrink-0";
    default: return "w-32 shrink-0";
  }
}

export default function ProductionsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { data: shows, isLoading, isError } = useShows();
  const archive = useArchiveShow();
  const del = useDeleteShow();
  const reorder = useReorderShows();

  const { orderedColumns } = useColumnTemplate("shows-productions");
  const columnHeaders = useColumnHeaders(orderedColumns);
  const visibleColumns = useMemo(() => orderedColumns.filter((c) => c.visible), [orderedColumns]);
  const firstColId = visibleColumns[0]?.columnId;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShowWithStats | null>(null);
  const [order, setOrder] = useState<ShowWithStats[]>([]);

  const filtered = useMemo(() => {
    const list = shows ?? [];
    if (statusFilter === "all") return list;
    return list.filter((s) => s.status === statusFilter);
  }, [shows, statusFilter]);

  useEffect(() => { setOrder(filtered); }, [filtered]);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (s: ShowWithStats) => { setEditing(s); setFormOpen(true); };
  const persistOrder = () => reorder.mutate(order.map((s) => s.id));

  const onDelete = (s: ShowWithStats) =>
    del.mutate(s.id, { onSuccess: () => toast.success("Production deleted"), onError: (e) => toast.error((e as Error).message) });
  const onArchive = (s: ShowWithStats, archived: boolean) =>
    archive.mutate({ id: s.id, archived }, {
      onSuccess: () => toast.success(archived ? "Production archived" : "Production restored"),
      onError: (e) => toast.error((e as Error).message),
    });

  const reorderable = statusFilter === "active";

  if (isError) {
    return <Alert variant="destructive"><AlertDescription>Failed to load productions.</AlertDescription></Alert>;
  }

  const cellContent = (s: ShowWithStats, colId: string) => {
    const slots = showSlots(s);
    switch (colId) {
      case "shows.program": return s.program || <span className="text-muted-foreground">—</span>;
      case "shows.sub_program": return s.sub_program || <span className="text-muted-foreground">—</span>;
      case "shows.category": return s.category || <span className="text-muted-foreground">—</span>;
      case "shows.main_cast_slots": return s.main_cast_slots ?? <span className="text-muted-foreground">—</span>;
      case "shows.understudy_slots": return s.understudy_slots ?? <span className="text-muted-foreground">—</span>;
      case "shows.sort_order": return s.sort_order ?? <span className="text-muted-foreground">—</span>;
      case "shows.created_at": return s.created_at ? formatDateDMY(s.created_at) : "—";
      case "_computed.slots":
        return slots
          ? <span className="tabular-nums">{slots.main_cast} + {slots.understudies}</span>
          : <Badge variant="secondary" className="bg-destructive/10 text-destructive text-xs">Unconfigured</Badge>;
      case "_computed.date_count": return `${s.dateCount} date${s.dateCount === 1 ? "" : "s"}`;
      case "shows.status":
        return (
          <div className="flex items-center gap-1">
            {isSyncedShow(s) && <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs">Synced</Badge>}
            <Badge variant="secondary" className="text-xs">{STATUS_LABEL[s.status] ?? s.status}</Badge>
          </div>
        );
      default: return <span className="text-muted-foreground">—</span>;
    }
  };

  const renderRow = (s: ShowWithStats, draggable: boolean) => {
    const synced = isSyncedShow(s);
    const deletable = isAdmin && canHardDeleteShow({ synced, dateCount: s.dateCount });
    const label = s.program ?? s.sub_program ?? "production";
    return (
      <div className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0">
        {draggable && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />}
        {visibleColumns.map((c) => (
          <div
            key={c.columnId}
            className={`${colWidth(c.columnId)} text-sm ${c.columnId === firstColId ? "font-medium truncate" : "text-muted-foreground"}`}
          >
            {cellContent(s, c.columnId)}
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={() => openEdit(s)} aria-label={`Edit ${label}`}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => onArchive(s, s.status !== "archived")} aria-label="Toggle archive">
            {s.status === "archived" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" data-testid={`delete-${s.id}`} disabled={!deletable}
                  title={deletable ? "Delete production" : synced ? "Synced productions can't be deleted — archive instead" : "Has dates — archive instead"}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this production?</AlertDialogTitle>
                  <AlertDialogDescription>This permanently removes "{label}". This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(s)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Productions</h1>
          <p className="text-muted-foreground mt-1">Your show catalog — slots, status, and order.</p>
        </div>
        <Button onClick={openCreate}>New production</Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ColumnLayoutEditor pageKey="shows-productions" />

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (order.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No productions yet. Create your first one.</CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground">
            {reorderable && <span className="h-4 w-4 shrink-0" aria-hidden />}
            {columnHeaders.map(({ columnId, headerLabel }) => (
              <div key={columnId} className={colWidth(columnId)}>{headerLabel}</div>
            ))}
            <span className="ml-auto w-[120px] shrink-0" aria-hidden />
          </div>
          {reorderable ? (
            <Reorder.Group axis="y" values={order} onReorder={setOrder}>
              {order.map((s) => (
                <Reorder.Item key={s.id} value={s} onDragEnd={persistOrder}>
                  {renderRow(s, true)}
                </Reorder.Item>
              ))}
            </Reorder.Group>
          ) : (
            order.map((s) => <div key={s.id}>{renderRow(s, false)}</div>)
          )}
        </CardContent></Card>
      ))}

      <ShowFormDialog open={formOpen} onOpenChange={setFormOpen} show={editing} allShows={shows ?? []} />
    </div>
  );
}
```

- [ ] **Step 4: Run the ProductionsPage tests, verify all pass**

Run: `npx vitest run src/pages/ProductionsPage.test.tsx`
Expected: PASS — original three tests (program text, unconfigured badge, delete gating) plus the new column test.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProductionsPage.tsx src/pages/ProductionsPage.test.tsx
git commit -m "feat(productions): configurable columns via editor column templates"
```

---

## Task 4: Field-mapping card headers (#5)

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx` (field-mapping card, ~line 491)
- Modify: `src/components/settings/AirtableSyncTab.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/components/settings/AirtableSyncTab.test.tsx`, add a test that loads a table so the mapping card renders. Use the existing module mocks at the top of the file; set their return values inside the test:

```ts
it("field-mapping card shows Showflow-field vs Airtable-column headers", async () => {
  (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
  (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appX", name: "Base" }] });
  (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
    schemaAccessible: true,
    tables: [{ id: "tbl", name: "Events", fields: [{ id: "f1", name: "Datum", type: "date" }] }],
  });
  renderTab({ airtable_base_id: "appX", airtable_table_name: "Events" });
  expect(await screen.findByText("Showflow field")).toBeInTheDocument();
  expect(screen.getByText("Airtable column")).toBeInTheDocument();
});
```

(If `fetchAirtableBases`/`fetchAirtableTables` are not already imported in the test file's "import the mocked fns" block, add them to the existing `import { … } from "@/data/airtableSchema"` line.)

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx -t "headers"`
Expected: FAIL ("Showflow field" not found).

- [ ] **Step 3: Add the header row**

In `src/components/settings/AirtableSyncTab.tsx`, inside the field-mapping card, immediately after `<CardContent className="space-y-4">` (line 491) and before `{SHOWFLOW_FIELDS.map(...)}`:

```tsx
            <div className="hidden sm:grid grid-cols-[160px_1fr] gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Showflow field</span>
              <span>Airtable column</span>
            </div>
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx -t "headers"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx src/components/settings/AirtableSyncTab.test.tsx
git commit -m "feat(airtable): label field-mapping columns (Showflow vs Airtable)"
```

---

## Task 5: Link individual programs (#3)

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx`
- Modify: `src/components/settings/AirtableSyncTab.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/components/settings/AirtableSyncTab.test.tsx`, add a test. It needs: a key present, a base/table loaded with a `sub_program`-mapped single-select field that has a choice, and an unlinked show from `fetchShowsForLinking`:

```ts
it("offers 'Link to existing' for an unlinked program option", async () => {
  (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
  (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appX", name: "Base" }] });
  (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
    schemaAccessible: true,
    tables: [{
      id: "tbl", name: "Events",
      fields: [
        { id: "fS", name: "Sub", type: "singleSelect", options: { choices: [{ id: "c1", name: "TJE: Murder" }] } },
      ],
    }],
  });
  (fetchShowsForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "show-1", program: "Existing", sub_program: null, main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null },
  ]);
  renderTab({ airtable_base_id: "appX", airtable_table_name: "Events", airtable_field_map: { sub_program: "Sub" } });

  // The program option appears with a "Link to existing…" picker.
  expect(await screen.findByText("TJE: Murder")).toBeInTheDocument();
  expect(screen.getByLabelText("link TJE: Murder to an existing show")).toBeInTheDocument();
});
```

Add `fetchShowsForLinking` to the test's import from `@/data/settings` if not already present (the module mock already provides it).

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx -t "Link to existing"`
Expected: FAIL (no link control for programs yet).

- [ ] **Step 3: Add the `linkShow` mutation, `unlinkedShows`, and the picker**

In `src/components/settings/AirtableSyncTab.tsx`:

(a) Add the `showLabel` import near the other `@/...` imports (e.g. after line 19's `@/data/airtableMapping` import):

```ts
import { showLabel } from "@/types";
```

(b) After the `linkCity` mutation (ends ~line 268) and before `const unlinkedCities = …` (line 269), add:

```ts
  const linkShow = useMutation({
    mutationFn: ({ showId, key }: { showId: string; key: string }) => linkShowAirtableKey(supabase, showId, key),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shows"] }); toast.success("Linked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Link failed"),
  });
  const unlinkedShows = (showsQ.data ?? []).filter((sh) => !sh.airtable_program_key);
```

(c) In the Programs section, replace the unlinked branch (line 623, currently `: <Badge variant="outline">unlinked</Badge>}`) with a picker mirroring Cities:

```tsx
                        : (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">unlinked</Badge>
                            {unlinkedShows.length > 0 && key && (
                              <Select onValueChange={(showId) => linkShow.mutate({ showId, key: key! })} disabled={linkShow.isPending}>
                                <SelectTrigger className="h-8 w-[200px]" aria-label={`link ${name} to an existing show`}>
                                  <SelectValue placeholder="Link to existing…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {unlinkedShows.map((sh) => <SelectItem key={sh.id} value={sh.id}>{showLabel(sh)}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        )}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx -t "Link to existing"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx src/components/settings/AirtableSyncTab.test.tsx
git commit -m "feat(airtable): link individual program options to existing shows"
```

---

## Task 6: airtable-schema "linked records" mode (#4/#6)

**Files:**
- Modify: `supabase/functions/airtable-schema/index.ts`
- Modify: `supabase/functions/airtable-schema/index.di.test.ts`

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/airtable-schema/index.di.test.ts`, add (the file already defines `adminDeps`, `adminReq`, `airtableJson`, `ORG`):

```ts
// ─── Linked records mode (baseId + linkedTableId) ────────────────────────────────

Deno.test("airtable-schema: linked records → returns id+name from the linked table's primary field", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (url) => {
    urls.push(String(url));
    if (String(url).includes("/meta/bases/")) {
      return Promise.resolve(airtableJson({
        tables: [{ id: "tblCities", name: "Cities", primaryFieldId: "fldName", fields: [{ id: "fldName", name: "City", type: "singleLineText" }] }],
      })) as Promise<Response>;
    }
    return Promise.resolve(airtableJson({
      records: [
        { id: "recA", fields: { fldName: "Berlin" } },
        { id: "recB", fields: { fldName: "Paris" } },
      ],
    })) as Promise<Response>;
  };
  const { deps } = adminDeps({ fetchImpl });
  const res = await handle(adminReq({ org_id: ORG, baseId: "appKg8xpplxd49Bo6", linkedTableId: "tblCities" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.records, [{ id: "recA", name: "Berlin" }, { id: "recB", name: "Paris" }]);
  // schema first, then a records read scoped to the linked table
  assertEquals(urls[0], "https://api.airtable.com/v0/meta/bases/appKg8xpplxd49Bo6/tables");
  assertEquals(urls[1].includes("/v0/appKg8xpplxd49Bo6/tblCities"), true);
});

Deno.test("airtable-schema: linked records with unknown linkedTableId → 404", async () => {
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(airtableJson({ tables: [{ id: "tblOther", name: "Other", primaryFieldId: "fldX" }] })) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG, baseId: "appXXX", linkedTableId: "tblMissing" }), deps);
  assertEquals(res.status, 404);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-schema/`
Expected: FAIL (linkedTableId currently falls through to Mode B / list-bases).

- [ ] **Step 3: Implement Mode C**

In `supabase/functions/airtable-schema/index.ts`:

(a) Extend the `Body` type (line 5):

```ts
type Body = { org_id?: string; baseId?: string; linkedTableId?: string };
```

(b) Add a data-API constant + record-page cap near `AIRTABLE_META` (after line 10):

```ts
const AIRTABLE_DATA = "https://api.airtable.com/v0";
const MAX_RECORD_PAGES = 50;
```

(c) Insert Mode C **before** the `if (body?.baseId)` block (before line 60), so it takes precedence:

```ts
    // ── Mode C: list a linked table's records (id + primary-field name) ───────
    if (body?.baseId && body?.linkedTableId) {
      const schemaRes = await deps.fetch(`${AIRTABLE_META}/bases/${encodeURIComponent(body.baseId)}/tables`, { headers });
      const schemaFail = await airtableFailure(schemaRes, "Airtable schema read failed");
      if (schemaFail) return schemaFail;
      const schemaData = (await schemaRes.json()) as { tables?: Array<{ id: string; primaryFieldId?: string }> };
      const linked = (schemaData.tables ?? []).find((t) => t.id === body.linkedTableId);
      if (!linked?.primaryFieldId) return json({ error: "Linked table not found in base schema" }, 404);
      const primaryFieldId = linked.primaryFieldId;

      const records: Array<{ id: string; name: string }> = [];
      let offset: string | undefined;
      let pages = 0;
      do {
        const params = new URLSearchParams({ returnFieldsByFieldId: "true" });
        params.append("fields[]", primaryFieldId);
        if (offset) params.set("offset", offset);
        const recRes = await deps.fetch(
          `${AIRTABLE_DATA}/${encodeURIComponent(body.baseId)}/${encodeURIComponent(body.linkedTableId)}?${params.toString()}`,
          { headers },
        );
        const recFail = await airtableFailure(recRes, "Airtable records read failed");
        if (recFail) return recFail;
        const data = (await recRes.json()) as { records?: Array<{ id: string; fields?: Record<string, unknown> }>; offset?: string };
        for (const r of data.records ?? []) {
          const v = r.fields?.[primaryFieldId];
          if (v != null && String(v) !== "") records.push({ id: r.id, name: String(v) });
        }
        offset = data.offset;
        pages += 1;
      } while (offset && pages < MAX_RECORD_PAGES);

      return json({ schemaAccessible: true, records });
    }
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-schema/`
Expected: PASS (existing tests + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/airtable-schema/index.ts supabase/functions/airtable-schema/index.di.test.ts
git commit -m "feat(airtable-schema): add linked-table records mode"
```

---

## Task 7: airtable-poll resolves linked-record venue/city (#4/#6)

**Files:**
- Modify: `supabase/functions/airtable-poll/index.ts`
- Create: `supabase/functions/airtable-poll/index.linked.test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/airtable-poll/index.linked.test.ts`:

```ts
/**
 * Linked-record resolution: City/Venue mapped to Airtable multipleRecordLinks fields.
 * The poll fetches the base schema + each linked table, resolving record IDs → names.
 */
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000a1";
const BASE = "appABCDEFGHIJKLMNO";

function authReq() {
  return makeRequest({ method: "POST", headers: { "X-Cron-Secret": "secret123" } });
}

Deno.test("airtable-poll: resolves linked-record venue & city to display names", async () => {
  const insertedPayloads: Record<string, unknown>[] = [];

  const fetchImpl: typeof fetch = (url) => {
    const u = String(url);
    if (u.includes("/meta/bases/")) {
      return Promise.resolve(new Response(JSON.stringify({
        tables: [
          { id: "tblEvents", name: "Events", primaryFieldId: "fldDate", fields: [
            { id: "fldDate", name: "Datum", type: "date" },
            { id: "fldSub", name: "Sub", type: "singleSelect" },
            { id: "fldCity", name: "City", type: "multipleRecordLinks", options: { linkedTableId: "tblCities" } },
            { id: "fldVenue", name: "Venue", type: "multipleRecordLinks", options: { linkedTableId: "tblVenues" } },
          ] },
          { id: "tblCities", name: "Cities", primaryFieldId: "fldCityName", fields: [{ id: "fldCityName", name: "City", type: "singleLineText" }] },
          { id: "tblVenues", name: "Venues", primaryFieldId: "fldVenName", fields: [{ id: "fldVenName", name: "Venues", type: "singleLineText" }] },
        ],
      }), { status: 200 })) as Promise<Response>;
    }
    if (u.includes(`/v0/${BASE}/tblCities`)) {
      return Promise.resolve(new Response(JSON.stringify({ records: [{ id: "recCity1", fields: { fldCityName: "Berlin" } }] }), { status: 200 })) as Promise<Response>;
    }
    if (u.includes(`/v0/${BASE}/tblVenues`)) {
      return Promise.resolve(new Response(JSON.stringify({ records: [{ id: "recVen1", fields: { fldVenName: "Hall A" } }] }), { status: 200 })) as Promise<Response>;
    }
    // Events data page
    return Promise.resolve(new Response(JSON.stringify({ records: [
      { id: "recEvt1", fields: { Datum: "2026-07-15", Sub: "TestShow", City: ["recCity1"], Venue: ["recVen1"] } },
    ] }), { status: 200 })) as Promise<Response>;
  };

  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: BASE }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "Events" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: { date: "Datum", sub_program: "Sub", city: "City", venue: "Venue" } }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-1", airtable_program_key: "TestShow" }], error: null },
      cities: { data: [{ id: "city-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl,
  });

  const originalFrom = deps.admin.from.bind(deps.admin);
  // deno-lint-ignore no-explicit-any
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { insertedPayloads.push(p as Record<string, unknown>); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(insertedPayloads.length, 1);
  assertEquals(insertedPayloads[0].venue, "Hall A");
  assertEquals(insertedPayloads[0].city_id, "city-berlin");
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/index.linked.test.ts`
Expected: FAIL — venue is stored as the raw `["recVen1"]` array and `city_id` is null (IDs don't match `airtable_city_key`).

- [ ] **Step 3: Add the schema/linked-table helpers + resolver**

In `supabase/functions/airtable-poll/index.ts`, add after `parseTime` (after line 45):

```ts
interface MetaField { id: string; name: string; type: string; options?: { linkedTableId?: string } }
interface MetaTable { id: string; name: string; primaryFieldId?: string; fields?: MetaField[] }

/** Fetch the base's table schema (meta API). Returns null if unavailable (e.g. the PAT lacks
 *  schema scope) — callers then fall back to passthrough, preserving current behavior. */
async function fetchBaseTables(deps: Deps, baseId: string, apiKey: string): Promise<MetaTable[] | null> {
  try {
    const res = await deps.fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) { console.warn("airtable-poll: base schema unavailable", { baseId, status: res.status }); return null; }
    const data = await res.json();
    return Array.isArray(data?.tables) ? (data.tables as MetaTable[]) : null;
  } catch (e) {
    console.warn("airtable-poll: base schema fetch threw", { baseId, error: (e as Error).message });
    return null;
  }
}

/** Build a recordId → primary-field-name map for one linked table. Best-effort; partial/empty on error. */
async function fetchLinkedNameMap(deps: Deps, baseId: string, linkedTableId: string, primaryFieldId: string, apiKey: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let offset: string | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({ returnFieldsByFieldId: "true" });
    params.append("fields[]", primaryFieldId);
    if (offset) params.set("offset", offset);
    const res = await deps.fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(linkedTableId)}?${params.toString()}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) { console.warn("airtable-poll: linked table fetch failed", { linkedTableId, status: res.status }); break; }
    const data = await res.json();
    for (const r of (data.records ?? []) as Array<{ id: string; fields?: Record<string, unknown> }>) {
      const v = r.fields?.[primaryFieldId];
      if (v != null) map.set(r.id, String(v));
    }
    offset = data.offset;
    pages += 1;
  } while (offset && pages < MAX_PAGES);
  return map;
}

/** Resolve an Airtable cell to display name(s). With a linkMap (multipleRecordLinks field), record
 *  IDs → names (unknown IDs dropped). Without one (text/select), values pass through as strings. */
function resolveNames(raw: unknown, linkMap?: Map<string, string>): string[] {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const v of arr) {
    if (linkMap) {
      if (typeof v === "string" && linkMap.has(v)) out.push(linkMap.get(v)!);
    } else if (typeof v === "string" || typeof v === "number") {
      out.push(String(v));
    }
  }
  return out;
}
```

- [ ] **Step 4: Build the link maps before the record loop**

In `syncOrg`, after the `cityByKey` map is built (after line 122, before the custom-field-definitions block), add:

```ts
  // ── Resolve linked-record fields (venue/city) to display names when mapped to a
  //    multipleRecordLinks Airtable field. Best-effort: if the schema is unavailable,
  //    linkMaps stay empty and values pass through unchanged. ──
  const linkMaps: { venue?: Map<string, string>; city?: Map<string, string> } = {};
  if (fieldMap.venue || fieldMap.city) {
    const metaTables = await fetchBaseTables(deps, baseId, apiKey);
    if (metaTables) {
      const target = metaTables.find((t) => t.name === tableName);
      const fieldByName = new Map((target?.fields ?? []).map((f) => [f.name, f] as const));
      const primaryByTableId = new Map(metaTables.map((t) => [t.id, t.primaryFieldId] as const));
      for (const key of ["venue", "city"] as const) {
        const fname = fieldMap[key];
        if (!fname) continue;
        const f = fieldByName.get(fname);
        const linkedTableId = f?.type === "multipleRecordLinks" ? f.options?.linkedTableId : undefined;
        const primaryFieldId = linkedTableId ? primaryByTableId.get(linkedTableId) : undefined;
        if (linkedTableId && primaryFieldId) {
          linkMaps[key] = await fetchLinkedNameMap(deps, baseId, linkedTableId, primaryFieldId, apiKey);
        }
      }
    }
  }
```

- [ ] **Step 5: Resolve venue/city per record**

Replace the city block + venue line inside the record loop. Replace lines 196-199:

```ts
      const cityValue = fieldMap.city ? fields[fieldMap.city] ?? null : null;
      const cityKey = buildCityKey(cityValue == null ? null : String(cityValue));
      const cityId = cityKey ? cityByKey.get(cityKey) ?? null : null;
      const cityNote = cityValue && !cityId ? `city '${cityValue}' not linked` : null;
```

with:

```ts
      const cityNames = fieldMap.city ? resolveNames(fields[fieldMap.city], linkMaps.city) : [];
      const cityRawName = cityNames[0] ?? null;
      const cityKey = buildCityKey(cityRawName);
      const cityId = cityKey ? cityByKey.get(cityKey) ?? null : null;
      const cityNote = cityRawName && !cityId ? `city '${cityRawName}' not linked` : null;
```

Then replace the venue line (line 204):

```ts
      const venue = fieldMap.venue ? (fields[fieldMap.venue] ?? null) : null;
```

with:

```ts
      const venueNames = fieldMap.venue ? resolveNames(fields[fieldMap.venue], linkMaps.venue) : [];
      const venue = venueNames.length ? venueNames.join(", ") : null;
```

(`venue`, `cityId`, and `cityNote` keep the same names, so the insert/update payloads below are unchanged.)

- [ ] **Step 6: Run the new test + the full poll suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/`
Expected: PASS — the new linked-record test plus all existing tests (plain text/select City still resolves via passthrough; meta fetch returns non-schema JSON in those fixtures → `null` → passthrough).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/airtable-poll/index.ts supabase/functions/airtable-poll/index.linked.test.ts
git commit -m "feat(airtable-poll): resolve linked-record venue/city to names"
```

---

## Task 8: City options from linked records in the UI (#4)

**Files:**
- Modify: `src/data/airtableSchema.ts`
- Modify: `src/components/settings/AirtableSyncTab.tsx`
- Modify: `src/components/settings/AirtableSyncTab.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/components/settings/AirtableSyncTab.test.tsx`:

(a) Add `fetchAirtableLinkedRecords` to the `@/data/airtableSchema` mock factory at the top of the file:

```ts
vi.mock("@/data/airtableSchema", () => ({
  fetchAirtableBases: vi.fn(),
  fetchAirtableTables: vi.fn(),
  fetchAirtableLinkedRecords: vi.fn(() => Promise.resolve({ schemaAccessible: true, records: [] })),
}));
```

(b) Add `fetchAirtableLinkedRecords` to the test's `import { … } from "@/data/airtableSchema"` line, then add the test:

```ts
it("lists city options from a linked-record City field", async () => {
  (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
  (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appX", name: "Base" }] });
  (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
    schemaAccessible: true,
    tables: [{
      id: "tbl", name: "Events",
      fields: [{ id: "fCity", name: "City", type: "multipleRecordLinks", options: { linkedTableId: "tblCities" } }],
    }],
  });
  (fetchAirtableLinkedRecords as ReturnType<typeof vi.fn>).mockResolvedValue({
    schemaAccessible: true, records: [{ id: "recCity1", name: "Berlin" }],
  });
  renderTab({ airtable_base_id: "appX", airtable_table_name: "Events", airtable_field_map: { city: "City" } });

  expect(await screen.findByText("Berlin")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx -t "linked-record City"`
Expected: FAIL — `cityOptions` reads `options.choices`, which a `multipleRecordLinks` field lacks → "Berlin" never renders.

- [ ] **Step 3: Add the data function**

In `src/data/airtableSchema.ts`, append:

```ts
export interface AirtableLinkedRecord { id: string; name: string }
export interface LinkedRecordsResult { schemaAccessible: boolean; records?: AirtableLinkedRecord[] }

/** List a linked table's records (id + primary-field name) via the airtable-schema edge fn
 *  (linkedTableId mode). Used to enumerate link-field options for catalog linking. */
export async function fetchAirtableLinkedRecords(
  client: SupabaseClient<Database>,
  orgId: string,
  baseId: string,
  linkedTableId: string,
): Promise<LinkedRecordsResult> {
  const { data, error } = await client.functions.invoke("airtable-schema", { body: { org_id: orgId, baseId, linkedTableId } });
  if (error) throw error;
  const payload = data as { error?: string; schemaAccessible?: boolean; records?: AirtableLinkedRecord[] };
  if (payload?.error) throw new Error(payload.error);
  return { schemaAccessible: !!payload?.schemaAccessible, records: payload?.records };
}
```

- [ ] **Step 4: Wire the linked-records query into AirtableSyncTab**

In `src/components/settings/AirtableSyncTab.tsx`:

(a) Add `fetchAirtableLinkedRecords` to the existing import from `@/data/airtableSchema` (line 18):

```ts
import { fetchAirtableBases, fetchAirtableTables, fetchAirtableLinkedRecords } from "@/data/airtableSchema";
```

(b) After `selectedTable` is defined (line 158), add the link-field detection + query:

```ts
  // City may be a multipleRecordLinks field; if so, enumerate the linked table's records as options.
  const cityField = selectedTable?.fields.find((f) => f.name === fieldMap.city);
  const cityLinkedTableId = cityField?.type === "multipleRecordLinks"
    ? ((cityField.options as { linkedTableId?: string } | undefined)?.linkedTableId ?? null)
    : null;
  const cityLinkedRecordsQ = useQuery({
    queryKey: ["airtable", "linked-records", orgId, baseId, cityLinkedTableId],
    enabled: !!orgId && !!baseId && !!cityLinkedTableId,
    queryFn: () => fetchAirtableLinkedRecords(supabase, orgId!, baseId, cityLinkedTableId!),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
```

(c) Replace the `cityOptions` definition (line 228):

```ts
  const cityOptions = optionNames(fieldMap.city);
```

with:

```ts
  const cityOptions = cityLinkedTableId
    ? (cityLinkedRecordsQ.data?.records ?? []).map((r) => r.name)
    : optionNames(fieldMap.city);
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx -t "linked-record City"`
Expected: PASS.

- [ ] **Step 6: Run the whole AirtableSyncTab + airtableSchema suites**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx src/data/airtableSchema.test.ts`
Expected: PASS (all tests; no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/data/airtableSchema.ts src/components/settings/AirtableSyncTab.tsx src/components/settings/AirtableSyncTab.test.tsx
git commit -m "feat(airtable): enumerate city options from linked-record fields"
```

---

## Task 9: Full verification + changelog

**Files:**
- Modify: `public/changelog.md`, `package.json`, `src/config/app.config.ts`

- [ ] **Step 1: Run the edge-function Deno suite (whole folder)**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS (per the multi-file contract suites — never single-file only).

- [ ] **Step 2: Run the frontend suite + lint + build (CI if no local Node)**

Run: `npx vitest run` then `npm run lint` then `npm run build`
Expected: all green. If the local env is Deno-only, push the branch and confirm these in CI.

- [ ] **Step 3: Confirm the version number, then update changelog + version**

These are user-facing features (configurable columns, program linking) plus fixes → a MINOR bump. Read the current `version` in `package.json` and bump the minor (e.g. `1.4.0` → `1.5.0`). Set the same value in `APP_META.VERSION` in `src/config/app.config.ts`. Add a newest-first block to `public/changelog.md`:

```markdown
## 1.5.0 — Jun 24, 2026

*Productions table & Airtable sync improvements*

### New
- **Configurable Productions columns** — admins can choose which columns show on the Productions page, per role.
- **Link individual programs** — link a single Airtable program option to an existing show, like cities.

### Improved
- **Clearer field mapping** — the Airtable field-mapping card now labels the Showflow field vs. the Airtable column.

### Fixed
- **Program & sub-program now show** on the Productions page for imported shows.
- **City linking works for linked-record fields** — cities sync and link even when Airtable stores them as linked records.
- **Venue shows its name** instead of an internal Airtable record id.
```

- [ ] **Step 4: Regenerate the changelog JSON**

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
Expected: `public/changelog.json` rewritten (never hand-edit it).

- [ ] **Step 5: Commit**

```bash
git add public/changelog.md public/changelog.json package.json src/config/app.config.ts
git commit -m "chore(release): 1.5.0 — productions columns + airtable linked records"
```

(Leave git tagging / pushing / PR creation to the user unless asked — see `finishing-a-development-branch`.)

---

## Self-review notes

- **Spec coverage:** #1 → Tasks 2–3; #2 → Task 1 (+ visible via Task 3 columns); #3 → Task 5; #4 → Tasks 6 (schema mode), 7 (poll resolve), 8 (UI options); #5 → Task 4; #6 → Task 7. Testing table: all rows mapped to a task.
- **Backward compatibility:** the poll's meta fetch only runs when `venue`/`city` is mapped and degrades to passthrough when the schema isn't the expected shape — existing poll DI tests (plain-string City) stay green; fetch-count assertions are only in tests with neither field mapped.
- **Type consistency:** `fetchAirtableLinkedRecords` / `LinkedRecordsResult` (data) ↔ Mode C `{ schemaAccessible, records: [{id,name}] }` (edge) match; `resolveNames`/`fetchLinkedNameMap`/`fetchBaseTables` are poll-internal; `colWidth`/`cellContent` are page-internal; `shows-productions` page key is identical across registry, page, and ColumnLayoutEditor.
- **No new migrations:** every added registry column (`category`, `main_cast_slots`, `understudy_slots`, `sort_order`) already exists on `shows`.
```
