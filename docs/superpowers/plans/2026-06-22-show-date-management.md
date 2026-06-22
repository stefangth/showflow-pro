# In-app Show & Show-Date Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins/producers create, edit, archive/cancel, reorder, and safely delete **productions** (`shows`) and **show-dates** entirely in-app, with Airtable-synced rows protected from accidental divergence.

**Architecture:** Frontend + a thin tested data-access layer + one small migration. The backend is already complete (RLS lets admins/producers write both tables; status is DB-computed; triggers handle edit-notifications and cancel-cascade; `org_id` auto-derives on insert). New `src/data/shows.ts` + `src/data/showDates.ts` (client passed in), pure helpers in `src/lib/catalog.ts`, thin hooks, two form dialogs, a `Productions` page, and edits to the existing bookings page + detail sheet. Implements [the design](../specs/2026-06-22-show-date-management-design.md).

**Tech Stack:** React 18 + TS, `@tanstack/react-query` v5, `react-hook-form` + `zod`, shadcn/ui, `framer-motion@12` (drag-reorder — already a dep), `sonner`, vitest + jsdom + @testing-library. **Frontend tests are CI-only here (no local Node/npm)** — write tests test-first, but they RUN in CI (`npm run test` = `vitest run`). Verify each task by pushing + reading CI or by review; do not expect a local `vitest` run. The migration applies via the **Supabase MCP** (`apply_migration` + `generate_typescript_types`).

---

## ⚠️ Conventions to follow (verified in the codebase)

- **Data-access:** every function takes `client: SupabaseClient<Database>` first; **never import the `supabase` singleton inside `src/data/`**. Hooks/components pass `supabase`. Pattern: [src/data/cities.ts](../../../src/data/cities.ts), [src/data/settings.ts](../../../src/data/settings.ts). Always `if (error) throw error;`.
- **Data tests:** `createFakeSupabase(seed)` from [src/test/supabaseFake.ts](../../../src/test/supabaseFake.ts); assert on `fake.calls` (`{ table, method, args }`). Seed `.single()`/`.maybeSingle()` reads with `{ table: { data, error } }`; seed RPCs under `"rpc:name"`, edge fns under `"fn:name"`. **Never `vi.mock` the supabase client.** Pattern: [src/data/cities.test.ts](../../../src/data/cities.test.ts).
- **Hooks:** thin wrappers passing `supabase` + `useAuth().currentOrg`. `useQuery` for reads, `useMutation` for writes. Pattern: [src/hooks/useSkills.ts](../../../src/hooks/useSkills.ts).
- **Query keys & invalidation (CLAUDE.md rule):** bust whole domain prefixes, never sub-keys. Show writes invalidate **`['shows']`** AND **`['show-dates']`** (date rows join show fields). Date cancel/delete also invalidate **`['bookings']`**. The bookings page already reads `['show-dates','list']`.
- **Forms:** `useForm` + `zodResolver`; shadcn `Dialog`/`Input`/`Label`/`Select`/`Textarea`; errors as `<p className="text-xs text-destructive">`. Pattern: [src/components/platform/NewOrgDialog.tsx](../../../src/components/platform/NewOrgDialog.tsx).
- **Component tests:** pure components take props ([LinkedAccountPanel.test.tsx](../../../src/components/artists/LinkedAccountPanel.test.tsx)); data-fetching components `vi.mock("@/data/<module>")` + `renderWithProviders` ([AirtableSyncTab.test.tsx](../../../src/components/settings/AirtableSyncTab.test.tsx)). Mock `@/data/*` and `@/features/auth/AuthContext`, never the client.
- **Dates:** `toDateKey(date) → 'yyyy-MM-dd'`, `parseDateOnly`, `formatDateDMY` from [src/lib/dates.ts](../../../src/lib/dates.ts) (timezone-safe). Calendars are **Monday-first** (`weekStartsOn={1}`).
- **Styling:** semantic tokens only (`text-destructive`, `bg-muted`, …); `Skeleton` for loading, `Alert variant="destructive"` for errors; `toast` from `sonner` on mutation success/error.
- **Roles:** `useAuth().hasRole('admin'|'producer'|'artist')` (UX only; RLS enforces). `canManage = hasRole('admin') || hasRole('producer')`; `isAdmin = hasRole('admin')`. `useAuth()` also exposes `user` and `currentOrg`.
- **Never** hand-edit `supabase/migrations/` or `src/integrations/supabase/types.ts` — use the migration tool + type generation.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_shows_sort_order.sql` | create (via tool) | `shows.sort_order smallint` + backfill |
| `src/lib/catalog.ts` / `.test.ts` | create | Pure guards/helpers: synced detection, delete-gating, dup-find, sort-order |
| `src/data/shows.ts` / `.test.ts` | create | Show CRUD + reorder (client-param) |
| `src/data/showDates.ts` / `.test.ts` | create | Date CRUD + cancel + per-show dup fetch |
| `src/hooks/useShows.ts` | create | Show query + mutations |
| `src/hooks/useShowDates.ts` | create | Date mutations |
| `src/hooks/useCities.ts` | create | City list (reuses `fetchCitiesForLinking`) |
| `src/components/catalog/ShowFormDialog.tsx` / `.test.tsx` | create | Create/edit a production |
| `src/pages/ProductionsPage.tsx` / `.test.tsx` | create | Catalog surface: list, CRUD, reorder |
| `src/components/shows/ShowDateFormDialog.tsx` / `.test.tsx` | create | Create/edit a date |
| `src/pages/ShowsBookingsPage.tsx` | modify | "New date" button |
| `src/components/shows/ShowDateDetailSheet.tsx` | modify | Edit / Cancel / Delete date |
| `src/config/app.config.ts`, `src/App.tsx`, `src/components/layout/navItems.ts` | modify | Route + nav |
| `src/pages/SettingsPage.tsx`, `src/data/settings.ts`, `src/data/settings.test.ts` | modify | Consolidate slots into Productions |
| `CLAUDE.md` | modify | Supersede "no create-show-date UI"; document Productions + synced-lock |

---

### Task 1: DB migration — `shows.sort_order`

**Files:** `supabase/migrations/<ts>_shows_sort_order.sql` (via Supabase MCP `apply_migration`, name `shows_sort_order`), then regenerate `src/integrations/supabase/types.ts`.

- [ ] **Step 1: Apply the migration** via the Supabase MCP `apply_migration` tool (name: `shows_sort_order`):

```sql
alter table public.shows add column sort_order smallint;

with ranked as (
  select id, row_number() over (partition by org_id order by program, sub_program) as rn
  from public.shows
)
update public.shows s set sort_order = ranked.rn
from ranked where ranked.id = s.id;
```

- [ ] **Step 2: Regenerate types** via the Supabase MCP `generate_typescript_types` tool; write the result to `src/integrations/supabase/types.ts` (do not hand-edit).
- [ ] **Step 3: Verify** `sort_order: number | null` now appears under `shows: { Row/Insert/Update }` in `types.ts`.
- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ src/integrations/supabase/types.ts
git commit -m "feat(db): add shows.sort_order for production reordering"
```

---

### Task 2: Pure helpers — `src/lib/catalog.ts`

**Files:** Create `src/lib/catalog.ts`, `src/lib/catalog.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/lib/catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isSyncedShow, isSyncedDate, canHardDeleteDate, canHardDeleteShow,
  findDuplicateDate, nextSortOrder,
} from "./catalog";

describe("catalog helpers", () => {
  it("isSyncedShow / isSyncedDate reflect the link key", () => {
    expect(isSyncedShow({ airtable_program_key: "K" })).toBe(true);
    expect(isSyncedShow({ airtable_program_key: null })).toBe(false);
    expect(isSyncedDate({ airtable_record_id: "rec1" })).toBe(true);
    expect(isSyncedDate({ airtable_record_id: null })).toBe(false);
  });

  it("canHardDeleteDate: only manual rows with zero bookings", () => {
    expect(canHardDeleteDate({ synced: false, bookingCount: 0 })).toBe(true);
    expect(canHardDeleteDate({ synced: false, bookingCount: 2 })).toBe(false);
    expect(canHardDeleteDate({ synced: true, bookingCount: 0 })).toBe(false);
  });

  it("canHardDeleteShow: only manual shows with zero dates", () => {
    expect(canHardDeleteShow({ synced: false, dateCount: 0 })).toBe(true);
    expect(canHardDeleteShow({ synced: false, dateCount: 1 })).toBe(false);
    expect(canHardDeleteShow({ synced: true, dateCount: 0 })).toBe(false);
  });

  it("findDuplicateDate matches same show+date, ignores cancelled, else null", () => {
    const rows = [
      { id: "d1", show_id: "s1", date: "2026-07-01", status: "open" },
      { id: "d2", show_id: "s1", date: "2026-07-02", status: "cancelled" },
    ];
    expect(findDuplicateDate(rows, { showId: "s1", date: "2026-07-01" })?.id).toBe("d1");
    expect(findDuplicateDate(rows, { showId: "s1", date: "2026-07-02" })).toBeNull(); // cancelled ignored
    expect(findDuplicateDate(rows, { showId: "s1", date: "2026-09-09" })).toBeNull();
  });

  it("nextSortOrder = max(sort_order) + 1, treating null as 0", () => {
    expect(nextSortOrder([])).toBe(1);
    expect(nextSortOrder([{ sort_order: 3 }, { sort_order: null }, { sort_order: 7 }])).toBe(8);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run (CI): `npm run test -- src/lib/catalog.test.ts` → FAIL ("Cannot find module './catalog'").
- [ ] **Step 3: Implement** — `src/lib/catalog.ts`:

```ts
/** A row is "synced" (Airtable-owned) when its link key is set. */
export const isSyncedShow = (s: { airtable_program_key: string | null }): boolean => !!s.airtable_program_key;
export const isSyncedDate = (d: { airtable_record_id: string | null }): boolean => !!d.airtable_record_id;

/** Hard-delete is allowed only for a manual (non-synced) date with no bookings. Else: Cancel. */
export const canHardDeleteDate = (a: { synced: boolean; bookingCount: number }): boolean =>
  !a.synced && a.bookingCount === 0;

/** Hard-delete is allowed only for a manual (non-synced) show with no dates. Else: Archive. */
export const canHardDeleteShow = (a: { synced: boolean; dateCount: number }): boolean =>
  !a.synced && a.dateCount === 0;

/** First non-cancelled date with the same show_id + date (soft create warning), else null. */
export function findDuplicateDate<T extends { show_id: string; date: string; status: string }>(
  existing: T[],
  q: { showId: string; date: string },
): T | null {
  return existing.find((r) => r.show_id === q.showId && r.date === q.date && r.status !== "cancelled") ?? null;
}

/** Next display order = max(sort_order ?? 0) + 1. */
export function nextSortOrder(shows: { sort_order: number | null }[]): number {
  return shows.reduce((max, s) => Math.max(max, s.sort_order ?? 0), 0) + 1;
}
```

- [ ] **Step 4: Run to verify it passes** — Run (CI): `npm run test -- src/lib/catalog.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog.ts src/lib/catalog.test.ts
git commit -m "feat(catalog): pure helpers for synced-lock, delete-gating, dup-find"
```

---

### Task 3: Data-access — `src/data/shows.ts`

**Files:** Create `src/data/shows.ts`, `src/data/shows.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/data/shows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchShowsWithStats, createShow, updateShow, archiveShow, deleteShow, reorderShows } from "./shows";

describe("shows data-access", () => {
  it("fetchShowsWithStats scopes to org and attaches non-cancelled date counts", async () => {
    const fake = createFakeSupabase({
      shows: { data: [{ id: "s1", program: "A", sub_program: null, category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 1 }], error: null },
      show_dates: { data: [{ show_id: "s1" }, { show_id: "s1" }], error: null },
    });
    const res = await fetchShowsWithStats(fake as never, "org-1");
    expect(res[0]).toMatchObject({ id: "s1", dateCount: 2 });
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "neq", args: ["status", "cancelled"] });
  });

  it("fetchShowsWithStats returns [] for null org", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchShowsWithStats(fake as never, null)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("createShow inserts mapped fields (status active) and returns id", async () => {
    const fake = createFakeSupabase({ shows: { data: { id: "s9" }, error: null } });
    const res = await createShow(fake as never, {
      orgId: "org-1", createdBy: "u1", program: "Hamlet", subProgram: "Mat", category: "Drama",
      description: "d", mainCastSlots: 3, understudySlots: 1, sortOrder: 5,
    });
    expect(res).toEqual({ id: "s9" });
    expect(fake.calls).toContainEqual({ table: "shows", method: "insert", args: [{
      org_id: "org-1", created_by: "u1", program: "Hamlet", sub_program: "Mat", category: "Drama",
      description: "d", main_cast_slots: 3, understudy_slots: 1, status: "active", sort_order: 5,
    }] });
  });

  it("updateShow patches by id", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await updateShow(fake as never, "s1", { main_cast_slots: 4, description: "x" });
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ main_cast_slots: 4, description: "x" }] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["id", "s1"] });
  });

  it("archiveShow toggles status", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await archiveShow(fake as never, "s1", true);
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ status: "archived" }] });
    await archiveShow(fake as never, "s1", false);
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ status: "active" }] });
  });

  it("deleteShow deletes by id", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await deleteShow(fake as never, "s1");
    expect(fake.calls).toContainEqual({ table: "shows", method: "delete", args: [] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["id", "s1"] });
  });

  it("reorderShows writes sort_order = index per id", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await reorderShows(fake as never, ["a", "b", "c"]);
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ sort_order: 0 }] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["id", "b"] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ sort_order: 2 }] });
  });

  it("createShow throws on error", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: { message: "denied" } } });
    await expect(createShow(fake as never, {
      orgId: "o", createdBy: null, program: "P", subProgram: null, category: null,
      description: null, mainCastSlots: null, understudySlots: null, sortOrder: null,
    })).rejects.toMatchObject({ message: "denied" });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run (CI): `npm run test -- src/data/shows.test.ts` → FAIL.
- [ ] **Step 3: Implement** — `src/data/shows.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type ShowStatus = Database["public"]["Enums"]["show_status"]; // 'active' | 'archived' | 'draft'

export interface ShowRow {
  id: string;
  program: string | null;
  sub_program: string | null;
  category: string | null;
  description: string | null;
  status: ShowStatus;
  main_cast_slots: number | null;
  understudy_slots: number | null;
  airtable_program_key: string | null;
  sort_order: number | null;
}
export interface ShowWithStats extends ShowRow { dateCount: number }

export interface CreateShowArgs {
  orgId: string;
  createdBy: string | null;
  program: string | null;
  subProgram: string | null;
  category: string | null;
  description: string | null;
  mainCastSlots: number | null;
  understudySlots: number | null;
  sortOrder: number | null;
}
export interface UpdateShowPatch {
  program?: string | null;
  sub_program?: string | null;
  category?: string | null;
  description?: string | null;
  main_cast_slots?: number | null;
  understudy_slots?: number | null;
}

const SHOW_COLS =
  "id, program, sub_program, category, description, status, main_cast_slots, understudy_slots, airtable_program_key, sort_order";

/** Org's shows ordered for display, each with its non-cancelled date count. */
export async function fetchShowsWithStats(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<ShowWithStats[]> {
  if (!orgId) return [];
  const { data: shows, error } = await client
    .from("shows").select(SHOW_COLS).eq("org_id", orgId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("program", { ascending: true })
    .order("sub_program", { ascending: true });
  if (error) throw error;
  const { data: dates, error: dErr } = await client
    .from("show_dates").select("show_id").eq("org_id", orgId).neq("status", "cancelled");
  if (dErr) throw dErr;
  const counts = new Map<string, number>();
  for (const d of (dates ?? []) as { show_id: string }[]) counts.set(d.show_id, (counts.get(d.show_id) ?? 0) + 1);
  return (shows ?? []).map((s) => ({ ...(s as ShowRow), dateCount: counts.get((s as ShowRow).id) ?? 0 }));
}

export async function createShow(client: SupabaseClient<Database>, a: CreateShowArgs): Promise<{ id: string }> {
  const { data, error } = await client.from("shows").insert({
    org_id: a.orgId, created_by: a.createdBy, program: a.program, sub_program: a.subProgram,
    category: a.category, description: a.description, main_cast_slots: a.mainCastSlots,
    understudy_slots: a.understudySlots, status: "active", sort_order: a.sortOrder,
  }).select("id").single();
  if (error) throw error;
  return data as { id: string };
}

export async function updateShow(client: SupabaseClient<Database>, id: string, patch: UpdateShowPatch): Promise<void> {
  const { error } = await client.from("shows").update(patch).eq("id", id);
  if (error) throw error;
}

export async function archiveShow(client: SupabaseClient<Database>, id: string, archived: boolean): Promise<void> {
  const { error } = await client.from("shows").update({ status: archived ? "archived" : "active" }).eq("id", id);
  if (error) throw error;
}

export async function deleteShow(client: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await client.from("shows").delete().eq("id", id);
  if (error) throw error;
}

/** Persist a new display order: sort_order = array index, per id. */
export async function reorderShows(client: SupabaseClient<Database>, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await client.from("shows").update({ sort_order: i }).eq("id", orderedIds[i]);
    if (error) throw error;
  }
}
```

- [ ] **Step 4: Run to verify it passes** — Run (CI): `npm run test -- src/data/shows.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/data/shows.ts src/data/shows.test.ts
git commit -m "feat(data): show CRUD + reorder data-access"
```

---

### Task 4: Data-access — `src/data/showDates.ts`

**Files:** Create `src/data/showDates.ts`, `src/data/showDates.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/data/showDates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { createShowDate, updateShowDate, cancelShowDate, deleteShowDate, fetchShowDatesForShow } from "./showDates";

describe("showDates data-access", () => {
  it("createShowDate inserts mapped fields (no status set) and returns id", async () => {
    const fake = createFakeSupabase({ show_dates: { data: { id: "d1" }, error: null } });
    const res = await createShowDate(fake as never, {
      orgId: "org-1", showId: "s1", date: "2026-07-01",
      session1: "19:30", session2: null, session3: null, venue: "Hall", cityId: "c1", notes: "n",
    });
    expect(res).toEqual({ id: "d1" });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "insert", args: [{
      org_id: "org-1", show_id: "s1", date: "2026-07-01",
      session_1: "19:30", session_2: null, session_3: null, venue: "Hall", city_id: "c1", notes: "n",
    }] });
  });

  it("updateShowDate patches by id", async () => {
    const fake = createFakeSupabase({ show_dates: { data: null, error: null } });
    await updateShowDate(fake as never, "d1", { venue: "New", session_1: "20:00" });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "update", args: [{ venue: "New", session_1: "20:00" }] });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "eq", args: ["id", "d1"] });
  });

  it("cancelShowDate sets status cancelled + reason", async () => {
    const fake = createFakeSupabase({ show_dates: { data: null, error: null } });
    await cancelShowDate(fake as never, "d1", "venue lost");
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "update", args: [{ status: "cancelled", cancellation_reason: "venue lost" }] });
  });

  it("deleteShowDate deletes by id", async () => {
    const fake = createFakeSupabase({ show_dates: { data: null, error: null } });
    await deleteShowDate(fake as never, "d1");
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "delete", args: [] });
  });

  it("fetchShowDatesForShow scopes by show_id, returns dup-check rows", async () => {
    const rows = [{ id: "d1", show_id: "s1", date: "2026-07-01", status: "open" }];
    const fake = createFakeSupabase({ show_dates: { data: rows, error: null } });
    const res = await fetchShowDatesForShow(fake as never, "s1");
    expect(res).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "eq", args: ["show_id", "s1"] });
  });

  it("fetchShowDatesForShow returns [] for null show", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchShowDatesForShow(fake as never, null)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run (CI): `npm run test -- src/data/showDates.test.ts` → FAIL.
- [ ] **Step 3: Implement** — `src/data/showDates.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface CreateShowDateArgs {
  orgId: string;
  showId: string;
  date: string; // 'yyyy-MM-dd'
  session1: string | null;
  session2: string | null;
  session3: string | null;
  venue: string | null;
  cityId: string | null;
  notes: string | null;
}
export interface UpdateShowDatePatch {
  date?: string;
  session_1?: string | null;
  session_2?: string | null;
  session_3?: string | null;
  venue?: string | null;
  city_id?: string | null;
  notes?: string | null;
}
export interface DupCheckDate { id: string; show_id: string; date: string; status: string }

/** Insert a manual show_date. org_id is also re-derived by trg_derive_org_id from show_id. */
export async function createShowDate(client: SupabaseClient<Database>, a: CreateShowDateArgs): Promise<{ id: string }> {
  const { data, error } = await client.from("show_dates").insert({
    org_id: a.orgId, show_id: a.showId, date: a.date,
    session_1: a.session1, session_2: a.session2, session_3: a.session3,
    venue: a.venue, city_id: a.cityId, notes: a.notes,
  }).select("id").single();
  if (error) throw error;
  return data as { id: string };
}

export async function updateShowDate(client: SupabaseClient<Database>, id: string, patch: UpdateShowDatePatch): Promise<void> {
  const { error } = await client.from("show_dates").update(patch).eq("id", id);
  if (error) throw error;
}

/** Cancel (status→cancelled fires cascade_cancel_bookings_on_date_cancel; releases bookings, audited). */
export async function cancelShowDate(client: SupabaseClient<Database>, id: string, reason: string): Promise<void> {
  const { error } = await client.from("show_dates").update({ status: "cancelled", cancellation_reason: reason }).eq("id", id);
  if (error) throw error;
}

export async function deleteShowDate(client: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await client.from("show_dates").delete().eq("id", id);
  if (error) throw error;
}

/** Minimal rows for the create-dialog duplicate check (same show). */
export async function fetchShowDatesForShow(client: SupabaseClient<Database>, showId: string | null): Promise<DupCheckDate[]> {
  if (!showId) return [];
  const { data, error } = await client.from("show_dates").select("id, show_id, date, status").eq("show_id", showId);
  if (error) throw error;
  return (data ?? []) as DupCheckDate[];
}
```

- [ ] **Step 4: Run to verify it passes** — Run (CI): `npm run test -- src/data/showDates.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/data/showDates.ts src/data/showDates.test.ts
git commit -m "feat(data): show-date CRUD, cancel, and dup-check data-access"
```

---

### Task 5: Hooks — `useShows`, `useShowDates`, `useCities`

**Files:** Create `src/hooks/useShows.ts`, `src/hooks/useShowDates.ts`, `src/hooks/useCities.ts`. (Thin wrappers — verified by typecheck + downstream component tests; no dedicated hook tests, matching `useSkills.ts`.)

- [ ] **Step 1: Implement `src/hooks/useShows.ts`:**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  fetchShowsWithStats, createShow, updateShow, archiveShow, deleteShow, reorderShows,
  type CreateShowArgs, type UpdateShowPatch, type ShowWithStats,
} from "@/data/shows";

export type { ShowWithStats };

export function useShows() {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ["shows", "list", currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchShowsWithStats(supabase, currentOrg?.id ?? null),
  });
}

/** Invalidate both domains: show fields are joined into the bookings/date list. */
function useShowInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["shows"] });
    qc.invalidateQueries({ queryKey: ["show-dates"] });
  };
}

export function useCreateShow() {
  const invalidate = useShowInvalidation();
  return useMutation({
    mutationFn: (a: CreateShowArgs) => createShow(supabase, a),
    onSuccess: invalidate,
  });
}

export function useUpdateShow() {
  const invalidate = useShowInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; patch: UpdateShowPatch }) => updateShow(supabase, v.id, v.patch),
    onSuccess: invalidate,
  });
}

export function useArchiveShow() {
  const invalidate = useShowInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; archived: boolean }) => archiveShow(supabase, v.id, v.archived),
    onSuccess: invalidate,
  });
}

export function useDeleteShow() {
  const invalidate = useShowInvalidation();
  return useMutation({
    mutationFn: (id: string) => deleteShow(supabase, id),
    onSuccess: invalidate,
  });
}

export function useReorderShows() {
  const invalidate = useShowInvalidation();
  return useMutation({
    mutationFn: (orderedIds: string[]) => reorderShows(supabase, orderedIds),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 2: Implement `src/hooks/useShowDates.ts`:**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  createShowDate, updateShowDate, cancelShowDate, deleteShowDate,
  type CreateShowDateArgs, type UpdateShowDatePatch,
} from "@/data/showDates";

function useDateInvalidation(alsoBookings: boolean) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["show-dates"] });
    if (alsoBookings) qc.invalidateQueries({ queryKey: ["bookings"] });
  };
}

export function useCreateShowDate() {
  const invalidate = useDateInvalidation(true);
  return useMutation({ mutationFn: (a: CreateShowDateArgs) => createShowDate(supabase, a), onSuccess: invalidate });
}
export function useUpdateShowDate() {
  const invalidate = useDateInvalidation(false);
  return useMutation({
    mutationFn: (v: { id: string; patch: UpdateShowDatePatch }) => updateShowDate(supabase, v.id, v.patch),
    onSuccess: invalidate,
  });
}
export function useCancelShowDate() {
  const invalidate = useDateInvalidation(true);
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => cancelShowDate(supabase, v.id, v.reason),
    onSuccess: invalidate,
  });
}
export function useDeleteShowDate() {
  const invalidate = useDateInvalidation(true);
  return useMutation({ mutationFn: (id: string) => deleteShowDate(supabase, id), onSuccess: invalidate });
}
```

- [ ] **Step 3: Implement `src/hooks/useCities.ts`** (reuses the existing `fetchCitiesForLinking`):

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchCitiesForLinking, type CityLink } from "@/data/cities";

export type { CityLink };

export function useCities() {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ["cities", currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchCitiesForLinking(supabase, currentOrg?.id ?? null),
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useShows.ts src/hooks/useShowDates.ts src/hooks/useCities.ts
git commit -m "feat(hooks): show/date/city query + mutation hooks"
```

---

### Task 6: `ShowFormDialog` — create/edit a production

**Files:** Create `src/components/catalog/ShowFormDialog.tsx`, `src/components/catalog/ShowFormDialog.test.tsx`.

**Contract:** `ShowFormDialog({ open, onOpenChange, show, allShows, onSaved })` where
`show?: ShowWithStats | null` (null/undefined → create), `allShows: ShowWithStats[]` (for `nextSortOrder`),
`onSaved?: (id: string) => void`. Uses `useCreateShow()` / `useUpdateShow()`. Synced show (`isSyncedShow(show)`):
`program`/`sub_program` inputs `disabled` + a "Synced from Airtable" `Badge`; slots/description/category stay editable.

- [ ] **Step 1: Write the failing test** — `src/components/catalog/ShowFormDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const createShow = vi.fn(() => Promise.resolve({ id: "s-new" }));
const updateShow = vi.fn(() => Promise.resolve());
vi.mock("@/data/shows", async (orig) => ({ ...(await orig<typeof import("@/data/shows")>()), createShow: (...a: unknown[]) => createShow(...a), updateShow: (...a: unknown[]) => updateShow(...a) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: () => true }) }));

import { ShowFormDialog } from "./ShowFormDialog";

describe("ShowFormDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create: requires a program/sub-program label", async () => {
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/program or sub-program required/i)).toBeInTheDocument();
    expect(createShow).not.toHaveBeenCalled();
  });

  it("create: submits mapped values with computed sortOrder", async () => {
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[{ sort_order: 4 } as never]} />);
    fireEvent.change(screen.getByLabelText(/^program/i), { target: { value: "Hamlet" } });
    fireEvent.change(screen.getByLabelText(/main cast/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(createShow).toHaveBeenCalled());
    const arg = createShow.mock.calls[0][1] as Record<string, unknown>;
    expect(arg).toMatchObject({ program: "Hamlet", mainCastSlots: 3, sortOrder: 5, orgId: "org-1", createdBy: "u1" });
  });

  it("synced show: program is read-only, slots editable", () => {
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={{ id: "s1", program: "P", sub_program: null, category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: "K", sort_order: 1, dateCount: 0 }} />);
    expect(screen.getByText(/synced from airtable/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^program/i)).toBeDisabled();
    expect(screen.getByLabelText(/main cast/i)).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run (CI): `npm run test -- src/components/catalog/ShowFormDialog.test.tsx` → FAIL.
- [ ] **Step 3: Implement** — `src/components/catalog/ShowFormDialog.tsx`. Model the form shell on `NewOrgDialog.tsx`. Full code:

```tsx
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { useCreateShow, useUpdateShow, type ShowWithStats } from "@/hooks/useShows";
import { isSyncedShow, nextSortOrder } from "@/lib/catalog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const slot = z.string().regex(/^\d*$/, "Whole number ≥ 0").optional().or(z.literal(""));
const schema = z.object({
  program: z.string().trim().optional().or(z.literal("")),
  subProgram: z.string().trim().optional().or(z.literal("")),
  category: z.string().trim().optional().or(z.literal("")),
  description: z.string().trim().optional().or(z.literal("")),
  mainCastSlots: slot,
  understudySlots: slot,
}).refine((v) => !!(v.program || v.subProgram), { message: "Program or sub-program required", path: ["program"] });
type FormValues = z.infer<typeof schema>;

const toSlot = (s: string | undefined): number | null => (s && s.trim() !== "" ? parseInt(s, 10) : null);

export function ShowFormDialog({
  open, onOpenChange, show, allShows, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  show?: ShowWithStats | null;
  allShows: ShowWithStats[];
  onSaved?: (id: string) => void;
}) {
  const { user, currentOrg } = useAuth();
  const isEdit = !!show;
  const synced = !!show && isSyncedShow(show);
  const createShow = useCreateShow();
  const updateShow = useUpdateShow();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      program: show?.program ?? "", subProgram: show?.sub_program ?? "", category: show?.category ?? "",
      description: show?.description ?? "",
      mainCastSlots: show?.main_cast_slots != null ? String(show.main_cast_slots) : "",
      understudySlots: show?.understudy_slots != null ? String(show.understudy_slots) : "",
    },
  });
  useEffect(() => {
    if (open) form.reset({
      program: show?.program ?? "", subProgram: show?.sub_program ?? "", category: show?.category ?? "",
      description: show?.description ?? "",
      mainCastSlots: show?.main_cast_slots != null ? String(show.main_cast_slots) : "",
      understudySlots: show?.understudy_slots != null ? String(show.understudy_slots) : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, show]);

  const onSubmit = async (v: FormValues) => {
    try {
      if (isEdit && show) {
        await updateShow.mutateAsync({
          id: show.id,
          patch: synced
            ? { category: v.category || null, description: v.description || null, main_cast_slots: toSlot(v.mainCastSlots), understudy_slots: toSlot(v.understudySlots) }
            : { program: v.program || null, sub_program: v.subProgram || null, category: v.category || null, description: v.description || null, main_cast_slots: toSlot(v.mainCastSlots), understudy_slots: toSlot(v.understudySlots) },
        });
        toast.success("Production updated");
        onSaved?.(show.id);
      } else {
        if (!currentOrg) { toast.error("No active organization"); return; }
        const { id } = await createShow.mutateAsync({
          orgId: currentOrg.id, createdBy: user?.id ?? null,
          program: v.program || null, subProgram: v.subProgram || null,
          category: v.category || null, description: v.description || null,
          mainCastSlots: toSlot(v.mainCastSlots), understudySlots: toSlot(v.understudySlots),
          sortOrder: nextSortOrder(allShows),
        });
        toast.success("Production created");
        onSaved?.(id);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const pending = createShow.isPending || updateShow.isPending;
  const err = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? "Edit production" : "New production"}
            {synced && <Badge variant="secondary" className="bg-muted text-muted-foreground">Synced from Airtable</Badge>}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="program">Program</Label>
            <Input id="program" disabled={synced} {...form.register("program")} />
            {err.program && <p className="text-xs text-destructive">{err.program.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subProgram">Sub-program</Label>
            <Input id="subProgram" disabled={synced} {...form.register("subProgram")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Input id="category" {...form.register("category")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" {...form.register("description")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mainCastSlots">Main cast slots</Label>
              <Input id="mainCastSlots" inputMode="numeric" {...form.register("mainCastSlots")} />
              {err.mainCastSlots && <p className="text-xs text-destructive">{err.mainCastSlots.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="understudySlots">Understudy slots</Label>
              <Input id="understudySlots" inputMode="numeric" {...form.register("understudySlots")} />
              {err.understudySlots && <p className="text-xs text-destructive">{err.understudySlots.message}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : isEdit ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

> The create branch guards on `currentOrg` and passes `orgId: currentOrg.id` (the hooks are org-agnostic). The test mocks `currentOrg.id = "org-1"` and asserts it on the `createShow` call.

- [ ] **Step 4: Run to verify it passes** — Run (CI): `npm run test -- src/components/catalog/ShowFormDialog.test.tsx` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/catalog/ShowFormDialog.tsx src/components/catalog/ShowFormDialog.test.tsx
git commit -m "feat(catalog): production create/edit dialog with synced-lock"
```

---

### Task 7: `ProductionsPage` + route + nav

**Files:** Create `src/pages/ProductionsPage.tsx`, `src/pages/ProductionsPage.test.tsx`; modify `src/config/app.config.ts`, `src/App.tsx`, `src/components/layout/navItems.ts`.

- [ ] **Step 1: Add the route constant** — `src/config/app.config.ts`, inside `ROUTES`, after `BOOKINGS`:

```ts
  PRODUCTIONS: '/productions',
```

- [ ] **Step 2: Add the nav item** — `src/components/layout/navItems.ts`: import `Theater` from `lucide-react`, and add after the `BOOKINGS` entry:

```ts
  { to: ROUTES.PRODUCTIONS, icon: Theater, label: 'Productions', roles: ['admin', 'producer'] },
```

- [ ] **Step 3: Write the failing test** — `src/pages/ProductionsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const reorderShows = vi.fn(() => Promise.resolve());
const archiveShow = vi.fn(() => Promise.resolve());
const deleteShow = vi.fn(() => Promise.resolve());
let role = "admin";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: (r: string) => r === role || r === "producer" }) }));
vi.mock("@/data/shows", async (orig) => ({ ...(await orig<typeof import("@/data/shows")>()), reorderShows: (...a: unknown[]) => reorderShows(...a), archiveShow: (...a: unknown[]) => archiveShow(...a), deleteShow: (...a: unknown[]) => deleteShow(...a) }));

const SHOWS = [
  { id: "s1", program: "Manual", sub_program: null, category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 1, dateCount: 0 },
  { id: "s2", program: "Synced", sub_program: null, category: null, description: null, status: "active", main_cast_slots: null, understudy_slots: null, airtable_program_key: "K", sort_order: 2, dateCount: 3 },
];
vi.mock("@/hooks/useShows", async (orig) => {
  const real = await orig<typeof import("@/hooks/useShows")>();
  return { ...real, useShows: () => ({ data: SHOWS, isLoading: false, isError: false }) };
});

import ProductionsPage from "./ProductionsPage";

describe("ProductionsPage", () => {
  beforeEach(() => { vi.clearAllMocks(); role = "admin"; });

  it("renders rows and an unconfigured badge for null slots", () => {
    renderWithProviders(<ProductionsPage />);
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Synced")).toBeInTheDocument();
    expect(screen.getAllByText(/unconfigured/i).length).toBeGreaterThanOrEqual(1);
  });

  it("delete is enabled only for a manual, zero-date show", () => {
    renderWithProviders(<ProductionsPage />);
    expect(screen.getByTestId("delete-s1")).not.toBeDisabled(); // manual, 0 dates
    expect(screen.getByTestId("delete-s2")).toBeDisabled();     // synced + has dates
  });

  it("producers see no delete control", () => {
    role = "producer-only"; // hasRole('admin') === false
    renderWithProviders(<ProductionsPage />);
    expect(screen.queryByTestId("delete-s1")).not.toBeInTheDocument();
  });
});
```

> The `hasRole` mock returns true for `'producer'` always and for `'admin'` only when `role==='admin'`; setting `role='producer-only'` makes `hasRole('admin')` false so the admin-only delete control is not rendered.

- [ ] **Step 4: Run to verify it fails** — Run (CI): `npm run test -- src/pages/ProductionsPage.test.tsx` → FAIL.
- [ ] **Step 5: Implement** — `src/pages/ProductionsPage.tsx` (default export). Use framer-motion `Reorder` for the active list; model table styling on `ShowsBookingsPage`. Full code:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Reorder } from "framer-motion";
import { useAuth } from "@/features/auth/AuthContext";
import { useShows, useArchiveShow, useDeleteShow, useReorderShows, type ShowWithStats } from "@/hooks/useShows";
import { isSyncedShow, canHardDeleteShow } from "@/lib/catalog";
import { showSlots } from "@/lib/settings";
import { showLabel } from "@/types";
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

type StatusFilter = "active" | "archived" | "all";

export default function ProductionsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { data: shows, isLoading, isError } = useShows();
  const archive = useArchiveShow();
  const del = useDeleteShow();
  const reorder = useReorderShows();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShowWithStats | null>(null);
  const [order, setOrder] = useState<ShowWithStats[]>([]);

  const filtered = useMemo(() => {
    const list = shows ?? [];
    if (statusFilter === "all") return list;
    return list.filter((s) => s.status === statusFilter);
  }, [shows, statusFilter]);

  // Local drag order mirrors the filtered list; reorder only enabled for the 'active' view.
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

  const renderRow = (s: ShowWithStats, draggable: boolean) => {
    const slots = showSlots(s);
    const synced = isSyncedShow(s);
    const deletable = isAdmin && canHardDeleteShow({ synced, dateCount: s.dateCount });
    return (
      <div className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0">
        {draggable && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{showLabel(s)}</p>
          <p className="text-xs text-muted-foreground truncate">{s.category || "—"}</p>
        </div>
        <div className="w-28 text-sm tabular-nums text-muted-foreground">
          {slots ? `${slots.main_cast} + ${slots.understudies}` : <Badge variant="secondary" className="bg-destructive/10 text-destructive text-xs">Unconfigured</Badge>}
        </div>
        <div className="w-20 text-sm text-muted-foreground">{s.dateCount} date{s.dateCount === 1 ? "" : "s"}</div>
        <div className="w-24">
          {synced && <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs">Synced</Badge>}
          {s.status === "archived" && <Badge variant="secondary" className="text-xs">Archived</Badge>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={() => openEdit(s)} aria-label={`Edit ${showLabel(s)}`}><Pencil className="h-4 w-4" /></Button>
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
                  <AlertDialogDescription>This permanently removes “{showLabel(s)}”. This cannot be undone.</AlertDialogDescription>
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

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (order.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No productions yet. Create your first one.</CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
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

- [ ] **Step 6: Register the route** — `src/App.tsx`: import `ProductionsPage` and add (next to the `BOOKINGS` route):

```tsx
<Route path={ROUTES.PRODUCTIONS} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><ProductionsPage /></AppLayout></ProtectedRoute>} />
```

- [ ] **Step 7: Run to verify it passes** — Run (CI): `npm run test -- src/pages/ProductionsPage.test.tsx` → PASS.
- [ ] **Step 8: Commit**

```bash
git add src/pages/ProductionsPage.tsx src/pages/ProductionsPage.test.tsx src/config/app.config.ts src/App.tsx src/components/layout/navItems.ts
git commit -m "feat(productions): catalog page with CRUD, archive, and drag-reorder"
```

---

### Task 8: `ShowDateFormDialog` — create/edit a date

**Files:** Create `src/components/shows/ShowDateFormDialog.tsx`, `src/components/shows/ShowDateFormDialog.test.tsx`.

**Contract:** `ShowDateFormDialog({ open, onOpenChange, mode, showDate, defaultShowId })`.
`mode: 'create' | 'edit'`; `showDate?` carries the row in edit mode (incl. `airtable_record_id`).
Reads productions via `useShows()` (non-archived only) and cities via `useCities()`. On **create**, an
`□ Open tier-1 offers now` checkbox (disabled when the chosen show has no slots) calls
`openOfferTier(supabase, { showDateId, tier: 1 })` after a successful insert. Synced date
(`isSyncedDate(showDate)`): date/sessions/venue/city are read-only + badge; `notes` editable. Soft dup
warning via `findDuplicateDate` over `fetchShowDatesForShow`.

- [ ] **Step 1: Write the failing test** — `src/components/shows/ShowDateFormDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const createShowDate = vi.fn(() => Promise.resolve({ id: "d-new" }));
const openOfferTier = vi.fn(() => Promise.resolve({ offersCreated: 1 }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: () => true }) }));
vi.mock("@/data/showDates", async (orig) => ({ ...(await orig<typeof import("@/data/showDates")>()), createShowDate: (...a: unknown[]) => createShowDate(...a), fetchShowDatesForShow: () => Promise.resolve([]) }));
vi.mock("@/data/bookings", async (orig) => ({ ...(await orig<typeof import("@/data/bookings")>()), openOfferTier: (...a: unknown[]) => openOfferTier(...a) }));
vi.mock("@/hooks/useShows", async (orig) => ({ ...(await orig<typeof import("@/hooks/useShows")>()), useShows: () => ({ data: [
  { id: "s1", program: "Configured", sub_program: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 1, category: null, description: null, dateCount: 0 },
  { id: "s2", program: "NoSlots", sub_program: null, status: "active", main_cast_slots: null, understudy_slots: null, airtable_program_key: null, sort_order: 2, category: null, description: null, dateCount: 0 },
], isLoading: false }) }));
vi.mock("@/hooks/useCities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCities")>()), useCities: () => ({ data: [{ id: "c1", name: "Berlin", airtable_city_key: null }] }) }));

import { ShowDateFormDialog } from "./ShowDateFormDialog";

describe("ShowDateFormDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create requires a production and a date", async () => {
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="create" />);
    fireEvent.click(screen.getByRole("button", { name: /create date/i }));
    expect(await screen.findByText(/production is required/i)).toBeInTheDocument();
    expect(createShowDate).not.toHaveBeenCalled();
  });

  it("synced date locks the date field, keeps notes editable", () => {
    renderWithProviders(<ShowDateFormDialog open onOpenChange={() => {}} mode="edit" showDate={{ id: "d1", show_id: "s1", date: "2026-07-01", session_1: null, session_2: null, session_3: null, venue: null, city_id: null, notes: "n", airtable_record_id: "rec1", status: "open" }} />);
    expect(screen.getByText(/synced from airtable/i)).toBeInTheDocument();
    expect(screen.getByTestId("date-trigger")).toBeDisabled();
    expect(screen.getByLabelText(/notes/i)).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run (CI): `npm run test -- src/components/shows/ShowDateFormDialog.test.tsx` → FAIL.
- [ ] **Step 3: Implement** — `src/components/shows/ShowDateFormDialog.tsx`. Full code (date picker = shadcn `Calendar` Monday-first in a `Popover`; reuse `toDateKey`/`parseDateOnly`/`formatDateDMY`):

```tsx
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useShows } from "@/hooks/useShows";
import { useCities } from "@/hooks/useCities";
import { useCreateShowDate, useUpdateShowDate } from "@/hooks/useShowDates";
import { openOfferTier } from "@/data/bookings";
import { fetchShowDatesForShow } from "@/data/showDates";
import { isSyncedDate, findDuplicateDate } from "@/lib/catalog";
import { showSlots } from "@/lib/settings";
import { showLabel } from "@/types";
import { toDateKey, parseDateOnly, formatDateDMY } from "@/lib/dates";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").optional().or(z.literal(""));
const schema = z.object({
  showId: z.string().min(1, "Production is required"),
  date: z.string().min(1, "Date is required"),
  session1: time, session2: time, session3: time,
  venue: z.string().optional().or(z.literal("")),
  cityId: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;
const orNull = (s: string | undefined) => (s && s.trim() !== "" ? s : null);

interface EditDate {
  id: string; show_id: string; date: string;
  session_1: string | null; session_2: string | null; session_3: string | null;
  venue: string | null; city_id: string | null; notes: string | null;
  airtable_record_id: string | null; status: string;
}

export function ShowDateFormDialog({
  open, onOpenChange, mode, showDate, defaultShowId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "create" | "edit";
  showDate?: EditDate | null;
  defaultShowId?: string | null;
}) {
  const { currentOrg } = useAuth();
  const { data: shows } = useShows();
  const { data: cities } = useCities();
  const create = useCreateShowDate();
  const update = useUpdateShowDate();
  const synced = mode === "edit" && !!showDate && isSyncedDate(showDate);
  const [openOffers, setOpenOffers] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      showId: showDate?.show_id ?? defaultShowId ?? "",
      date: showDate?.date ?? "",
      session1: showDate?.session_1?.slice(0, 5) ?? "", session2: showDate?.session_2?.slice(0, 5) ?? "", session3: showDate?.session_3?.slice(0, 5) ?? "",
      venue: showDate?.venue ?? "", cityId: showDate?.city_id ?? "", notes: showDate?.notes ?? "",
    },
  });
  useEffect(() => {
    if (open) {
      form.reset({
        showId: showDate?.show_id ?? defaultShowId ?? "", date: showDate?.date ?? "",
        session1: showDate?.session_1?.slice(0, 5) ?? "", session2: showDate?.session_2?.slice(0, 5) ?? "", session3: showDate?.session_3?.slice(0, 5) ?? "",
        venue: showDate?.venue ?? "", cityId: showDate?.city_id ?? "", notes: showDate?.notes ?? "",
      });
      setOpenOffers(false); setDupWarning(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showDate, defaultShowId]);

  const activeShows = useMemo(() => (shows ?? []).filter((s) => s.status !== "archived"), [shows]);
  const showId = form.watch("showId");
  const dateStr = form.watch("date");
  const chosenShow = activeShows.find((s) => s.id === showId);
  const slotsConfigured = !!(chosenShow && showSlots(chosenShow));

  // Soft duplicate check (create only).
  useEffect(() => {
    if (mode !== "create" || !showId || !dateStr) { setDupWarning(null); return; }
    let cancelled = false;
    fetchShowDatesForShow(supabase, showId).then((rows) => {
      if (cancelled) return;
      const dup = findDuplicateDate(rows, { showId, date: dateStr });
      setDupWarning(dup ? "A non-cancelled date already exists for this production on that day." : null);
    });
    return () => { cancelled = true; };
  }, [mode, showId, dateStr]);

  const onSubmit = async (v: FormValues) => {
    try {
      if (mode === "edit" && showDate) {
        await update.mutateAsync({
          id: showDate.id,
          patch: synced
            ? { notes: orNull(v.notes) }
            : {
                date: v.date, session_1: orNull(v.session1), session_2: orNull(v.session2), session_3: orNull(v.session3),
                venue: orNull(v.venue), city_id: orNull(v.cityId), notes: orNull(v.notes),
              },
        });
        toast.success("Date updated");
      } else {
        if (!currentOrg) { toast.error("No active organization"); return; }
        const { id } = await create.mutateAsync({
          orgId: currentOrg.id, showId: v.showId, date: v.date,
          session1: orNull(v.session1), session2: orNull(v.session2), session3: orNull(v.session3),
          venue: orNull(v.venue), cityId: orNull(v.cityId), notes: orNull(v.notes),
        });
        if (openOffers && slotsConfigured) {
          try {
            const res = await openOfferTier(supabase, { showDateId: id, tier: 1 });
            toast.success(res.offersCreated > 0 ? `Date created — ${res.offersCreated} offer(s) opened` : "Date created");
          } catch { toast.success("Date created (offers could not be opened)"); }
        } else {
          toast.success("Date created");
        }
      }
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const pending = create.isPending || update.isPending;
  const err = form.formState.errors;
  const selectedDate = dateStr ? parseDateOnly(dateStr) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "edit" ? "Edit date" : "New date"}
            {synced && <Badge variant="secondary" className="bg-muted text-muted-foreground">Synced from Airtable</Badge>}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Production</Label>
            <Select value={showId} onValueChange={(v) => form.setValue("showId", v, { shouldValidate: true })} disabled={mode === "edit"}>
              <SelectTrigger><SelectValue placeholder="Choose a production" /></SelectTrigger>
              <SelectContent>
                {activeShows.map((s) => <SelectItem key={s.id} value={s.id}>{showLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            {err.showId && <p className="text-xs text-destructive">{err.showId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" data-testid="date-trigger" disabled={synced} className="w-full justify-start font-normal">
                  {selectedDate ? formatDateDMY(selectedDate) : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" weekStartsOn={1} selected={selectedDate}
                  onSelect={(d) => d && form.setValue("date", toDateKey(d), { shouldValidate: true })} />
              </PopoverContent>
            </Popover>
            {err.date && <p className="text-xs text-destructive">{err.date.message}</p>}
            {dupWarning && <p className="text-xs text-warning">{dupWarning}</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {(["session1", "session2", "session3"] as const).map((name, i) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={name}>Session {i + 1}</Label>
                <Input id={name} placeholder="HH:MM" disabled={synced} {...form.register(name)} />
                {err[name] && <p className="text-xs text-destructive">{err[name]?.message}</p>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="venue">Venue</Label>
              <Input id="venue" disabled={synced} {...form.register("venue")} />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Select value={form.watch("cityId")} onValueChange={(v) => form.setValue("cityId", v)} disabled={synced}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(cities ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" {...form.register("notes")} />
          </div>

          {mode === "create" && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={openOffers} disabled={!slotsConfigured} onCheckedChange={(c) => setOpenOffers(!!c)} />
              <span className={slotsConfigured ? "" : "text-muted-foreground"}>
                Open tier-1 offers now{!slotsConfigured && " (configure slots first)"}
              </span>
            </label>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : mode === "edit" ? "Save date" : "Create date"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — Run (CI): `npm run test -- src/components/shows/ShowDateFormDialog.test.tsx` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/shows/ShowDateFormDialog.tsx src/components/shows/ShowDateFormDialog.test.tsx
git commit -m "feat(shows): show-date create/edit dialog with synced-lock + open-offers"
```

---

### Task 9: "New date" button on `ShowsBookingsPage`

**Files:** Modify `src/pages/ShowsBookingsPage.tsx`.

- [ ] **Step 1: Add imports** near the top of `ShowsBookingsPage.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { ShowDateFormDialog } from '@/components/shows/ShowDateFormDialog';
```

- [ ] **Step 2: Add state** inside `ProducerShowsBookings`, next to the other `useState` hooks:

```tsx
const [newDateOpen, setNewDateOpen] = useState(false);
const { hasRole } = useAuth();
const canManage = hasRole('admin') || hasRole('producer');
```

> `useAuth` is already imported at the top of the file. If `hasRole`/`canManage` is already destructured elsewhere in this component, reuse it instead of redeclaring.

- [ ] **Step 3: Add the button + dialog** — change the page header block to include a New date button, and render the dialog before the closing `</div>`:

```tsx
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Shows &amp; Bookings</h1>
          <p className="text-muted-foreground mt-1">All scheduled dates and cast status in one place.</p>
        </div>
        {canManage && <Button onClick={() => setNewDateOpen(true)}>New date</Button>}
      </div>
```

```tsx
      <ShowDateFormDialog open={newDateOpen} onOpenChange={setNewDateOpen} mode="create" />
```

- [ ] **Step 4: Verify (CI)** — Run: `npm run test` (no regressions) + `npm run lint`. Manually verify the button opens the dialog and a created date appears (realtime/invalidation already wired for `['show-dates']`).
- [ ] **Step 5: Commit**

```bash
git add src/pages/ShowsBookingsPage.tsx
git commit -m "feat(bookings): add 'New date' entry point"
```

---

### Task 10: Edit / Cancel / Delete on `ShowDateDetailSheet`

**Files:** Modify `src/components/shows/ShowDateDetailSheet.tsx`.

**Goal:** add (a) an **Edit schedule** button opening `ShowDateFormDialog` in edit mode; (b) a **Cancel
date** action (`canManage`, status≠cancelled) using `useCancelShowDate`; (c) a **Delete date** action
(admin only, enabled iff `canHardDeleteDate`). Route the existing inline `city_id` update through
`updateShowDate` for consistency (optional but preferred). The sheet already imports `AlertDialog*` and
has a `bookingsForDate` query for the booking count and a `canManage` flag.

- [ ] **Step 1: Add imports:**

```tsx
import { ShowDateFormDialog } from '@/components/shows/ShowDateFormDialog';
import { useCancelShowDate, useDeleteShowDate } from '@/hooks/useShowDates';
import { isSyncedDate, canHardDeleteDate } from '@/lib/catalog';
```

- [ ] **Step 2: Add state + derived flags** inside the component (after `showDate` is loaded; `useAuth().hasRole` is already available via `canManage`):

```tsx
const [editOpen, setEditOpen] = useState(false);
const [cancelReason, setCancelReason] = useState('');
const cancelDate = useCancelShowDate();
const deleteDate = useDeleteShowDate();
const isAdmin = hasRole('admin');
const bookingCount = (bookingsForDate ?? []).filter((b: { status: string }) => b.status !== 'cancelled').length;
const synced = showDate ? isSyncedDate(showDate) : false;
const deletable = isAdmin && showDate ? canHardDeleteDate({ synced, bookingCount }) : false;
```

> Verified in the file: `const { data: bookingsForDate } = useQuery(...)` (line ~78), `const { hasRole, user, roles, currentOrg } = useAuth()` (line ~50), and `const canManage = hasRole('admin') || hasRole('producer')` (line ~54) already exist. Reuse them — do not redeclare.

- [ ] **Step 3: Add the action row** in the management area (where `canManage && showDate.status !== 'cancelled'` already gates content). For a synced date, show only Edit (notes) + a "Synced — edit schedule in Airtable" hint; never a Delete:

```tsx
{canManage && showDate.status !== 'cancelled' && (
  <div className="flex flex-wrap items-center gap-2">
    <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
      {synced ? 'Edit notes' : 'Edit schedule'}
    </Button>

    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">Cancel date</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this date?</AlertDialogTitle>
          <AlertDialogDescription>
            This releases all bookings for this date and notifies booked artists. Add a reason:
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason (e.g. venue lost)" />
        <AlertDialogFooter>
          <AlertDialogCancel>Keep date</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => cancelDate.mutate({ id: showDate.id, reason: cancelReason },
              { onSuccess: () => { toast.success('Date cancelled'); onOpenChange(false); },
                onError: (e) => toast.error((e as Error).message) })}>
            Cancel date
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {isAdmin && (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-destructive" disabled={!deletable}
            title={deletable ? 'Delete date' : synced ? "Synced dates can't be deleted — cancel instead" : 'Has bookings — cancel instead'}>
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this date?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the date. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteDate.mutate(showDate.id,
              { onSuccess: () => { toast.success('Date deleted'); onOpenChange(false); },
                onError: (e) => toast.error((e as Error).message) })}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )}
  </div>
)}
```

- [ ] **Step 4: Render the edit dialog** near the end of the sheet's JSX:

```tsx
{showDate && (
  <ShowDateFormDialog
    open={editOpen}
    onOpenChange={setEditOpen}
    mode="edit"
    showDate={{
      id: showDate.id, show_id: showDate.show_id, date: showDate.date,
      session_1: showDate.session_1, session_2: showDate.session_2, session_3: showDate.session_3,
      venue: showDate.venue, city_id: showDate.city_id, notes: showDate.notes,
      airtable_record_id: showDate.airtable_record_id, status: showDate.status,
    }}
  />
)}
```

> **Add `airtable_record_id`** to the sheet's `show_date` `.select(...)` (line ~63) — the others (`date, session_1..3, venue, status, notes, city_id, show_id, cancellation_reason`) are already selected. Ensure `toast` (sonner) and `Input` are imported (add if missing).

- [ ] **Step 5: Verify (CI)** — Run: `npm run test` + `npm run lint`. Manually: edit a manual date's schedule (artists notified), cancel a date (bookings released), confirm Delete is disabled for a date with bookings and for synced dates.
- [ ] **Step 6: Commit**

```bash
git add src/components/shows/ShowDateDetailSheet.tsx
git commit -m "feat(shows): edit/cancel/delete a date from the detail sheet"
```

---

### Task 11: Consolidate slot editing into Productions

**Files:** Modify `src/pages/SettingsPage.tsx`, `src/data/settings.ts`, `src/data/settings.test.ts`.

- [ ] **Step 1: Replace the `ShowSlotsEditor` body** in `SettingsPage.tsx` with a pointer (keep the "N unconfigured" warning, which uses `useSettingsWarnings`/`fetchShowsWithSlots`). The Scheduling tab content becomes:

```tsx
import { Link } from 'react-router-dom';
import { ROUTES } from '@/config/app.config';
import { useSettingsWarnings } from '@/hooks/useSettingsWarnings';
// ...
function ShowSlotsEditor() {
  const warn = useSettingsWarnings(); // returns { schedulingWarnings, hasAnyWarning } directly
  return (
    <div className="space-y-3">
      {warn.schedulingWarnings > 0 ? (
        <Alert>
          <AlertDescription>
            {warn.schedulingWarnings} production(s) have no slot configuration. Bookings for these can’t reach
            <em> fully filled</em> until slots are set.
          </AlertDescription>
        </Alert>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Slot configuration has moved to the <Link to={ROUTES.PRODUCTIONS} className="text-primary underline">Productions</Link> page.
      </p>
    </div>
  );
}
```

> `useSettingsWarnings()` takes no args and returns `{ schedulingWarnings, hasAnyWarning }` **directly** (verified in [src/hooks/useSettingsWarnings.ts](../../../src/hooks/useSettingsWarnings.ts)) — not a `{ data }` query result. Update the call site to `<ShowSlotsEditor />` (drop the `orgId` prop). Remove the now-unused local edit state and the `updateShowSlots` / `fetchShowsWithSlots` / `ShowWithSlots` imports from `SettingsPage.tsx`.

- [ ] **Step 2: Remove `updateShowSlots`** from `src/data/settings.ts` (superseded by `updateShow`). Remove its `describe("updateShowSlots", …)` block from `src/data/settings.test.ts`. Keep `fetchShowsWithSlots` (used by `useSettingsWarnings`).
- [ ] **Step 3: Verify (CI)** — Run: `npm run test` (settings tests still green) + `npm run lint` + typecheck. No references to `updateShowSlots` remain (`grep -rn updateShowSlots src/` → only none).
- [ ] **Step 4: Commit**

```bash
git add src/pages/SettingsPage.tsx src/data/settings.ts src/data/settings.test.ts
git commit -m "refactor(settings): move slot editing to Productions page"
```

---

### Task 12: Update `CLAUDE.md`

**Files:** Modify `CLAUDE.md`.

- [ ] **Step 1:** Replace the "No UI for creating show dates" decision bullet with the new reality and add a Productions/synced-lock note. Suggested text:

```md
- **In-app catalog & date management.** Admins/producers create/edit/archive/reorder **productions**
  (`shows`) on the **Productions** page (`ROUTES.PRODUCTIONS`) and create/edit/cancel/delete **dates**
  via `ShowDateFormDialog` + `ShowDateDetailSheet`. Airtable-synced rows are **locked** (read-only for
  poll-managed fields; manual rows fully editable). Deleting is gated: dates → hard-delete only when
  zero bookings (else Cancel); shows → hard-delete only when zero dates (else Archive). Data-access:
  `src/data/shows.ts`, `src/data/showDates.ts`; guards: `src/lib/catalog.ts`. Slot config lives on the
  Productions page (no longer in Settings → Scheduling).
```

Also add `src/components/catalog/` and `src/pages/ProductionsPage.tsx` to the architecture map, and `PRODUCTIONS` to the routes list.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document in-app show/date management + synced-lock"
```

---

### Task 13: Final verification

- [ ] **Step 1: Full test suite (CI)** — Run: `npm run test` → all green (new: `catalog`, `shows`, `showDates`, `ShowFormDialog`, `ProductionsPage`, `ShowDateFormDialog`; existing unaffected).
- [ ] **Step 2: Typecheck + lint (CI)** — Run: `npm run lint` and the typecheck job → clean.
- [ ] **Step 3: Manual smoke (running app)** — as admin: create a production (appears, unconfigured badge), set slots, reorder by drag (persists on reload), create a date for it (optionally open offers), edit its schedule, cancel it (bookings released), delete an empty manual date; confirm a synced production/date shows the "Synced" badge and locked fields; confirm a producer sees no Delete and an artist sees no Productions nav.
- [ ] **Step 4: Open PR** (per repo workflow) once CI is green.

---

## Self-review notes

- **Spec coverage:** scope (catalog+dates CRUD) → Tasks 6–10; synced-lock matrix → `catalog.ts` (T2) + dialogs (T6, T8) + sheet (T10); cancel-first/delete-gating → `catalog.ts` (T2) + sheet (T10) + page (T7); reorder + migration → T1, T3, T7; consolidation → T11; permissions → UX gates in T7/T10 (RLS pre-exists); open-offers-on-create → T8; nav/route → T7; docs → T12.
- **No placeholders:** every code step shows full code; the two prose "substitute the real variable name" notes (sheet's bookings variable; `useSettingsWarnings` signature) are unavoidable couplings to existing code, flagged explicitly with the file to check.
- **Type consistency:** `ShowWithStats`/`ShowRow` (T3) reused by hooks (T5), dialog (T6), page (T7); `CreateShowArgs`/`UpdateShowPatch` (T3) match hook mutation inputs (T5); `EditDate` shape (T8) matches the object the sheet passes (T10); `openOfferTier` result `.offersCreated` matches `src/data/bookings.ts`.
