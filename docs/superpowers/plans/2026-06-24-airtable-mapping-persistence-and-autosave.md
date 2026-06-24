# Airtable Sync — Mapping Persistence & Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved Airtable field mappings (a) persist immediately as the admin edits them, with visible save status, and (b) stay visible when leaving the Airtable Sync tab and returning.

**Architecture:** Two root-cause fixes in `src/components/settings/AirtableSyncTab.tsx`. **Part 1** replaces the ephemeral `useState` Airtable schema (`bases`/`tables`/`schemaState`) with cached React Query reads, so the schema survives the Radix tab unmount/remount and the mapping cards re-render automatically. **Part 2** decouples the four Airtable settings (`airtable_sync_enabled`, `airtable_base_id`, `airtable_table_name`, `airtable_field_map`) from the page-level draft + global Save button into a tab-owned React Query + an optimistic autosave mutation with an inline "Saving… / All changes saved" status — matching the instant-save model the rest of the tab already uses.

**Tech Stack:** React 18, TypeScript, @tanstack/react-query v5, Supabase JS, Vitest + @testing-library/react, shadcn/ui.

---

## Background — the two root causes (why this plan exists)

1. **Cards disappear on tab return (bug b).** `src/components/ui/tabs.tsx:42` renders a plain Radix `TabsContent` with **no `forceMount`**, so the Airtable tab unmounts on tab switch and remounts fresh. The schema lives in component `useState` (`AirtableSyncTab.tsx:42-45`: `schemaState`, `bases`, `tables`), populated only by a manual **Load from Airtable** click. On remount it is empty → `selectedTable = tables.find(...)` (`:52`) is `undefined` → the Field-mapping (`:425`), Custom-fields (`:484`) and Catalog-links (`:542`) cards are all gated `{selectedTable && …}` and vanish, even though the values are safely persisted.

2. **No save confirmation (bug a).** Mapping edits call `set()` (`SettingsPage.tsx:551`) into the page draft, persisted only by the **global Save button at the top of the page** (`SettingsPage.tsx:575`). But the tab's other controls (key, import, link/unlink, custom fields, merge) save instantly with their own toasts — so the user assumes mappings do too. The only "Saved" badge near the mapping area is the **API-key** badge (`AirtableSyncTab.tsx:325`), which is misleading.

**Decision (from product Q&A):** autosave the four Airtable settings on change (chosen over keeping the global Save). The Airtable tab becomes self-contained: it owns its settings via its own query key and writes them directly with `upsertOrgSetting`. The page's global Save continues to govern every other tab; the Airtable keys simply never become "dirty" in the page draft, so global Save harmlessly ignores them (verified safe: the page diffs its own cached `settings` vs `draft`, both seeded equal and never mutated for these keys after decoupling, so they are never re-upserted and the tab's DB writes are never clobbered).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/data/airtableSettings.ts` | Tab-owned read of the 4 Airtable settings (`fetchAirtableSettings`), org-row-wins-over-platform resolution in one round-trip. | Create |
| `src/data/airtableSettings.test.ts` | Unit test for `fetchAirtableSettings` against the call-recording fake. | Create |
| `src/components/settings/AirtableSyncTab.tsx` | The tab. Part 1: schema via React Query. Part 2: tab-owned settings query + autosave mutation + status indicator; drop `get`/`set` props. | Modify |
| `src/components/settings/AirtableSyncTab.test.tsx` | Rewrite schema tests for auto-load; add autosave + status tests; update `renderTab` to seed `fetchAirtableSettings`. | Modify |
| `src/pages/SettingsPage.tsx` | Render `<AirtableSyncTab orgId={orgId} />` (drop `get`/`set` for this tab only). | Modify (1 line) |
| `public/changelog.md` / `public/changelog.json` | User-facing "Fixed" entry. | Modify / regenerate |

No new dependencies.

---

## Task 1: Data module — `fetchAirtableSettings`

A single read of the four Airtable settings keys, resolving the org's own row over the platform default, mirroring the resolve logic already in `SettingsPage` (`SettingsPage.tsx:271-279`) and `resolveOrgSetting` (`src/data/settings.ts:36-51`). One round-trip rather than four `resolveOrgSetting` calls.

**Files:**
- Create: `src/data/airtableSettings.ts`
- Test: `src/data/airtableSettings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/data/airtableSettings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchAirtableSettings } from "./airtableSettings";

describe("fetchAirtableSettings", () => {
  it("returns typed defaults when no rows exist", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    const s = await fetchAirtableSettings(fake as never, "org-1");
    expect(s).toEqual({
      airtable_sync_enabled: false,
      airtable_base_id: "",
      airtable_table_name: "",
      airtable_field_map: {},
    });
  });

  it("prefers the org row over the platform default per key", async () => {
    const fake = createFakeSupabase({
      app_settings: {
        data: [
          { key: "airtable_base_id", value: "appPLATFORM", org_id: null },
          { key: "airtable_base_id", value: "appORG", org_id: "org-1" },
          { key: "airtable_table_name", value: "Events", org_id: "org-1" },
          { key: "airtable_field_map", value: { date: "Date", city: "City" }, org_id: "org-1" },
          { key: "airtable_sync_enabled", value: true, org_id: "org-1" },
        ],
        error: null,
      },
    });
    const s = await fetchAirtableSettings(fake as never, "org-1");
    expect(s.airtable_base_id).toBe("appORG");
    expect(s.airtable_table_name).toBe("Events");
    expect(s.airtable_field_map).toEqual({ date: "Date", city: "City" });
    expect(s.airtable_sync_enabled).toBe(true);
  });

  it("throws when the query errors", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "boom" } } });
    await expect(fetchAirtableSettings(fake as never, "org-1")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/airtableSettings.test.ts`
Expected: FAIL — `Cannot find module './airtableSettings'`.
(If Node is unavailable locally per the env, this step and every other `npx vitest`/`npm run lint` step is verified by pushing the branch and confirming the CI run — `.github/workflows/ci.yml` — is green. Treat CI as the test runner of record.)

- [ ] **Step 3: Write the implementation**

Create `src/data/airtableSettings.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AirtableFieldMap } from "./airtableMapping";

/** The four Airtable settings the admin edits in the Airtable Sync tab. */
export interface AirtableSettings {
  airtable_sync_enabled: boolean;
  airtable_base_id: string;
  airtable_table_name: string;
  airtable_field_map: AirtableFieldMap;
}

export const AIRTABLE_SETTING_KEYS = [
  "airtable_sync_enabled",
  "airtable_base_id",
  "airtable_table_name",
  "airtable_field_map",
] as const;

const DEFAULTS: AirtableSettings = {
  airtable_sync_enabled: false,
  airtable_base_id: "",
  airtable_table_name: "",
  airtable_field_map: {},
};

/**
 * Read the org's effective Airtable settings in one round-trip. The org's own
 * row wins over the platform default (org_id IS NULL) per key; missing keys fall
 * back to typed defaults. Mirrors the per-key resolution in SettingsPage.
 */
export async function fetchAirtableSettings(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<AirtableSettings> {
  let q = client
    .from("app_settings")
    .select("key, value, org_id")
    .in("key", AIRTABLE_SETTING_KEYS as unknown as string[]);
  q = orgId ? q.or(`org_id.eq.${orgId},org_id.is.null`) : q.is("org_id", null);
  const { data, error } = await q;
  if (error) throw error;

  const byKey = new Map<string, { value: unknown; org_id: string | null }>();
  for (const r of (data ?? []) as { key: string; value: unknown; org_id: string | null }[]) {
    const prev = byKey.get(r.key);
    if (!prev || (r.org_id !== null && prev.org_id === null)) byKey.set(r.key, { value: r.value, org_id: r.org_id });
  }

  return {
    airtable_sync_enabled: (byKey.get("airtable_sync_enabled")?.value as boolean) ?? DEFAULTS.airtable_sync_enabled,
    airtable_base_id: (byKey.get("airtable_base_id")?.value as string) ?? DEFAULTS.airtable_base_id,
    airtable_table_name: (byKey.get("airtable_table_name")?.value as string) ?? DEFAULTS.airtable_table_name,
    airtable_field_map: (byKey.get("airtable_field_map")?.value as AirtableFieldMap) ?? DEFAULTS.airtable_field_map,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/airtableSettings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/airtableSettings.ts src/data/airtableSettings.test.ts
git commit -m "add fetchAirtableSettings tab-owned settings read"
```

---

## Task 2: Part 1 — schema via React Query (fixes disappearing cards)

Replace the ephemeral schema `useState` + imperative `loadBases`/`loadTables` mutations with two cached `useQuery` reads. The QueryClient lives above the Tabs, so the schema is cached across the tab's unmount/remount and `selectedTable` re-resolves on return with zero clicks. Derive `schemaState`/`fallbackCause` from the query results so the three existing fallback behaviors (no-scope, per-base 403, network error) are preserved. **This task keeps the existing `get`/`set` draft wiring for the four settings** — Part 2 (Task 3) converts those to autosave. Shipping Task 2 alone already fixes bug (b).

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx`
- Modify: `src/components/settings/AirtableSyncTab.test.tsx`

- [ ] **Step 1: Rewrite the schema tests to expect auto-load (failing)**

In `src/components/settings/AirtableSyncTab.test.tsx`, replace the existing schema test cases (the `it(...)` blocks from "gates Load behind a saved key" through "hides field-mapping and catalog-links until a table is selected") with the versions below. Key changes: the button is renamed **Refresh from Airtable**, and schema now auto-loads on mount (no click needed). Leave the `AirtableSyncTab — last sync report` and `— duplicate cities` describe blocks unchanged.

```ts
  it("gates the schema refresh behind a saved key, with a hint", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: false, updatedAt: null });
    renderTab();
    expect(screen.getByText("Airtable Sync")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh from Airtable" })).toBeDisabled());
    expect(screen.getByText(/Save an API key first/i)).toBeInTheDocument();
    // No key → bases must never be fetched.
    expect(fetchAirtableBases).not.toHaveBeenCalled();
  });

  it("shows a saved-key status with Replace and Delete when a key exists", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: "2026-06-22T17:44:00Z" });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [] });
    renderTab();
    expect(await screen.findByText("Key saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete/ })).toBeInTheDocument();
  });

  it("auto-loads bases on mount when a key is present (no click)", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Fever Berlin" }] });
    renderTab();
    await waitFor(() => expect(fetchAirtableBases).toHaveBeenCalledWith(expect.anything(), "org-1"));
    expect(await screen.findByText("Base")).toBeInTheDocument();
  });

  it("shows the scope banner + typed fallback when the key can't read schema", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: false });
    renderTab();
    await waitFor(() => expect(screen.getByText(/schema\.bases:read/)).toBeInTheDocument());
    expect(screen.getByPlaceholderText("app1234567890")).toBeInTheDocument();
  });

  it("auto-loads tables for a base already saved in settings", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Fever Berlin" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, tables: [{ id: "tbl1", name: "Events", fields: [] }] });
    renderTab({ airtable_base_id: "appA" });
    await waitFor(() => expect(fetchAirtableTables).toHaveBeenCalledWith(expect.anything(), "org-1", "appA"));
  });

  it("drops to manual entry when a base's tables can't be read (per-base 403)", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Fever Berlin" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: false });
    renderTab({ airtable_base_id: "appA" });
    await waitFor(() => expect(screen.getByPlaceholderText("app1234567890")).toBeInTheDocument());
    expect(screen.getByText(/this specific base/i)).toBeInTheDocument();
    expect(screen.queryByText(/schema\.bases:read/)).not.toBeInTheDocument();
  });

  it("drops to manual entry when the tables fetch throws (network/edge error)", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Fever Berlin" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    renderTab({ airtable_base_id: "appA" });
    await waitFor(() => expect(screen.getByPlaceholderText("app1234567890")).toBeInTheDocument());
    expect(screen.getByText(/Couldn't reach Airtable/i)).toBeInTheDocument();
    expect(screen.queryByText(/schema\.bases:read/)).not.toBeInTheDocument();
  });

  it("hides field-mapping and catalog-links until a table is selected", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: false, updatedAt: null });
    renderTab();
    expect(screen.queryByText("Field mapping")).not.toBeInTheDocument();
    expect(screen.queryByText("Catalog links")).not.toBeInTheDocument();
  });
```

Also update the `renderTab` helper at the top of the file so seeded values feed the (still-present in Task 2) `get`/`set` draft AND the not-yet-added settings query. For Task 2, keep `renderTab` as-is (it already seeds a draft via `get`/`set`). No change needed in Task 2; `renderTab` is rewritten in Task 3.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx`
Expected: FAIL — button still named "Load from Airtable"; bases not auto-fetched on mount; "Key saved" text not present.

- [ ] **Step 3: Replace the schema state with React Query**

In `src/components/settings/AirtableSyncTab.tsx`:

**(3a)** Delete these `useState` lines (`:42-45`):

```ts
  const [schemaState, setSchemaState] = useState<"idle" | "accessible" | "fallback">("idle");
  const [fallbackCause, setFallbackCause] = useState<FallbackCause>("no-scope");
  const [bases, setBases] = useState<{ id: string; name: string }[]>([]);
  const [tables, setTables] = useState<AirtableTable[]>([]);
```

Keep `const [airtableKey, setAirtableKey] = useState("")`, `const [replacing, setReplacing] = useState(false)`, and `const [survivorByNorm, setSurvivorByNorm] = useState<Record<string, string>>({})`.

**(3b)** Delete the entire `loadTables` mutation (`:91-120`) and `loadBases` mutation (`:121-139`), and the `isSchemaPending` line (`:289`).

**(3c)** After the `keyStatusQ` / `keyPresent` block (`:55-60`), add the schema queries and derived state. (`baseId` here still reads from the draft via `get`; Task 3 will switch it to the settings query.)

```ts
  // ── Schema (bases + tables): cached React Query so it survives tab unmount/remount.
  //    Auto-loads when a key is present — no manual "Load" click needed to see mappings.
  const baseId = get("airtable_base_id", "") as string;

  const basesQ = useQuery({
    queryKey: ["airtable", "bases", orgId],
    enabled: !!orgId && keyPresent,
    queryFn: () => fetchAirtableBases(supabase, orgId!),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const basesAccessible = basesQ.data?.schemaAccessible === true;

  const tablesQ = useQuery({
    queryKey: ["airtable", "tables", orgId, baseId],
    enabled: !!orgId && keyPresent && basesAccessible && !!baseId,
    queryFn: () => fetchAirtableTables(supabase, orgId!, baseId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const bases = basesQ.data?.bases ?? [];
  const tables = tablesQ.data?.tables ?? [];

  // Derive the UI mode from the query states (was imperative setState before).
  let schemaState: "idle" | "loading" | "accessible" | "fallback" = "idle";
  let fallbackCause: FallbackCause = "no-scope";
  if (!keyPresent) {
    schemaState = "idle";
  } else if (basesQ.isError) {
    schemaState = "fallback"; fallbackCause = "error";
  } else if (basesQ.isLoading || !basesQ.data) {
    schemaState = "loading";
  } else if (!basesAccessible) {
    schemaState = "fallback"; fallbackCause = "no-scope";
  } else if (baseId && tablesQ.isError) {
    schemaState = "fallback"; fallbackCause = "error";
  } else if (baseId && tablesQ.data && !tablesQ.data.schemaAccessible) {
    schemaState = "fallback"; fallbackCause = "per-base";
  } else {
    schemaState = "accessible";
  }

  const isSchemaPending = basesQ.isFetching || tablesQ.isFetching;
  const refreshSchema = () => { void basesQ.refetch(); if (baseId) void tablesQ.refetch(); };
```

**(3d)** Update `deleteKey`'s `onSuccess` (`:82-87`) — it referenced the removed setters. Replace its body with:

```ts
    onSuccess: () => {
      setAirtableKey(""); setReplacing(false);
      qc.removeQueries({ queryKey: ["airtable", "bases", orgId] });
      qc.removeQueries({ queryKey: ["airtable", "tables", orgId] });
      qc.invalidateQueries({ queryKey: ["airtable", "key-status", orgId] });
      toast.success("Airtable API key deleted");
    },
```

`saveKey`'s `onSuccess` already invalidates `["airtable","key-status",orgId]`; flipping `keyPresent` to `true` auto-enables `basesQ`, so no change needed there.

**(3e)** Update the **Step 2 — base & table** JSX. Rename the button and point it at `refreshSchema`; add a quiet loading line. Find (`:382-384`):

```tsx
            <Button variant="outline" onClick={() => loadBases.mutate()} disabled={isSchemaPending || !orgId || !keyPresent}>
              {isSchemaPending ? "Loading…" : "Load from Airtable"}
            </Button>
```

Replace with:

```tsx
            <Button variant="outline" onClick={refreshSchema} disabled={isSchemaPending || !orgId || !keyPresent}>
              {isSchemaPending ? "Loading…" : "Refresh from Airtable"}
            </Button>
```

**(3f)** The Base `Select` `onValueChange` (`:390`) still uses `set`, but must stop calling the deleted `loadTables`/`setTables`. Replace (`:390`):

```tsx
                  <Select value={get("airtable_base_id", "")} onValueChange={(v) => { set("airtable_base_id", v); setTables([]); set("airtable_table_name", ""); loadTables.mutate({ baseId: v }); }}>
```

with:

```tsx
                  <Select value={get("airtable_base_id", "")} onValueChange={(v) => { set("airtable_base_id", v); set("airtable_table_name", ""); }}>
```

(Changing `airtable_base_id` re-keys `tablesQ`, which refetches automatically; clearing `airtable_table_name` resets the table picker.)

No other JSX changes are needed in Task 2 — `schemaState`, `fallbackCause`, `bases`, `tables`, `selectedTable` are now the derived/query values and every existing reference keeps working.

- [ ] **Step 4: Remove the now-unused `toast.info` no-scope nudge (auto-load = no per-mount toast)**

The old `loadBases` toasted on the no-scope branch because the load was user-initiated. With auto-load that would fire on every mount; the persistent fallback `Alert` (`:405-407`) is the single signal. This is already handled by deleting the `loadBases` mutation in 3b — confirm no remaining `toast.info("Airtable key can't read schema…")` reference exists:

Run: `grep -n "can't read schema" src/components/settings/AirtableSyncTab.tsx`
Expected: no matches.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx`
Expected: PASS (all schema + last-sync + duplicate-cities cases).

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx src/components/settings/AirtableSyncTab.test.tsx
git commit -m "fix(airtable): cache schema in react-query so mappings persist across tab switches"
```

---

## Task 3: Part 2 — tab-owned settings + autosave + status (fixes "did it save?")

Move the four Airtable settings off the page draft into a tab-owned `useQuery`, and persist every change immediately with an optimistic `upsertOrgSetting` mutation. Add an inline status ("Saving… / All changes saved / Couldn't save"). Drop the `get`/`set` props. Relabel the API-key badge to "Key saved" so it is not mistaken for the mapping save state.

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx`
- Modify: `src/components/settings/AirtableSyncTab.test.tsx`
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Write the failing autosave tests**

In `src/components/settings/AirtableSyncTab.test.tsx`:

**(1a)** Extend the existing mocks. Update the `@/data/settings` mock to also export `upsertOrgSetting`, and add a mock for the new module:

```ts
vi.mock("@/data/settings", () => ({
  fetchShowsForLinking: vi.fn(() => Promise.resolve([])),
  linkShowAirtableKey: vi.fn(),
  importShowsFromOptions: vi.fn(),
  upsertOrgSetting: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/data/airtableSettings", () => ({
  fetchAirtableSettings: vi.fn(() =>
    Promise.resolve({ airtable_sync_enabled: false, airtable_base_id: "", airtable_table_name: "", airtable_field_map: {} }),
  ),
  AIRTABLE_SETTING_KEYS: ["airtable_sync_enabled", "airtable_base_id", "airtable_table_name", "airtable_field_map"],
}));
```

Add to the imports block (after the existing `import { ... } from "@/data/cities";` line):

```ts
import { upsertOrgSetting } from "@/data/settings";
import { fetchAirtableSettings } from "@/data/airtableSettings";
```

**(1b)** Replace the `renderTab` helper (it no longer threads `get`/`set`; it seeds the settings query instead):

```ts
function renderTab(initial: Record<string, unknown> = {}) {
  (fetchAirtableSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
    airtable_sync_enabled: false,
    airtable_base_id: "",
    airtable_table_name: "",
    airtable_field_map: {},
    ...initial,
  });
  return renderWithProviders(<AirtableSyncTab orgId="org-1" />);
}
```

**(1c)** Add a new describe block for autosave:

```ts
describe("AirtableSyncTab — autosave", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists a field-mapping change immediately and shows saved status", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Base A" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true,
      tables: [{ id: "tbl1", name: "Events", fields: [{ id: "fld1", name: "Show Date", type: "date" }] }],
    });
    renderTab({ airtable_base_id: "appA", airtable_table_name: "Events" });

    // The Date mapping select is rendered once the table resolves.
    const dateSelect = await screen.findByRole("combobox", { name: /^Date$/i });
    fireEvent.click(dateSelect);
    fireEvent.click(await screen.findByRole("option", { name: "Show Date" }));

    await waitFor(() =>
      expect(upsertOrgSetting).toHaveBeenCalledWith(
        expect.anything(),
        "org-1",
        "airtable_field_map",
        expect.objectContaining({ date: "Show Date" }),
      ),
    );
    expect(await screen.findByText(/All changes saved/i)).toBeInTheDocument();
  });

  it("autosaves the enable toggle without a global Save click", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [] });
    renderTab();
    fireEvent.click(await screen.findByRole("switch"));
    await waitFor(() =>
      expect(upsertOrgSetting).toHaveBeenCalledWith(expect.anything(), "org-1", "airtable_sync_enabled", true),
    );
  });

  it("surfaces an error and rolls back when a save fails", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [] });
    (upsertOrgSetting as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
    renderTab();
    fireEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByText(/Couldn't save/i)).toBeInTheDocument();
  });
});
```

> Note on the combobox query: shadcn `Select` renders a `button[role="combobox"]`; its accessible name is the associated `<Label>` text via `aria-labelledby` only if wired. The mapping rows use a plain `<Label>` sibling (`AirtableSyncTab.tsx:436`). If `getByRole("combobox", { name: /Date/ })` does not resolve, fall back to selecting by trigger order: `screen.getAllByRole("combobox")[0]`. Use whichever resolves in the harness; do not add production-only `aria` markup just for the test unless it also improves accessibility (it does — see Step 4 optional aria-label).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx`
Expected: FAIL — `AirtableSyncTab` still requires `get`/`set` props; `upsertOrgSetting` never called; no "All changes saved" text.

- [ ] **Step 3: Convert the component to tab-owned settings + autosave**

In `src/components/settings/AirtableSyncTab.tsx`:

**(3a)** Update imports: add the data functions and two icons.

```ts
import { Trash2, CheckCircle2, KeyRound, Lock, Loader2, AlertCircle } from "lucide-react";
```

Add near the other `@/data` imports:

```ts
import { upsertOrgSetting } from "@/data/settings";
import { fetchAirtableSettings, type AirtableSettings } from "@/data/airtableSettings";
import type { Json } from "@/integrations/supabase/types";
```

**(3b)** Change the `Props` interface (drop `get`/`set`):

```ts
interface Props {
  orgId: string | null;
}

export function AirtableSyncTab({ orgId }: Props) {
```

**(3c)** Add the settings query + autosave mutation near the top of the component (replace the old `fieldMap`/`setField`/`selectedTable`/`baseId` derivations that used `get`). Place this right after `const qc = useQueryClient();` and the retained `useState`s:

```ts
  const SETTINGS_KEY = ["airtable", "settings", orgId] as const;
  const DEFAULTS: AirtableSettings = {
    airtable_sync_enabled: false, airtable_base_id: "", airtable_table_name: "", airtable_field_map: {},
  };
  const settingsQ = useQuery({
    queryKey: SETTINGS_KEY,
    enabled: !!orgId,
    queryFn: () => fetchAirtableSettings(supabase, orgId!),
  });
  const s = settingsQ.data ?? DEFAULTS;

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveSettings = useMutation({
    mutationFn: async (patch: Partial<AirtableSettings>) => {
      if (!orgId) throw new Error("No active organization");
      for (const [key, value] of Object.entries(patch)) {
        await upsertOrgSetting(supabase, orgId, key, value as Json);
      }
    },
    onMutate: async (patch: Partial<AirtableSettings>) => {
      setSaveState("saving");
      await qc.cancelQueries({ queryKey: SETTINGS_KEY });
      const prev = qc.getQueryData<AirtableSettings>(SETTINGS_KEY);
      qc.setQueryData<AirtableSettings>(SETTINGS_KEY, (p) => ({ ...(p ?? DEFAULTS), ...patch }));
      return { prev };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(SETTINGS_KEY, ctx.prev);
      setSaveState("error");
      toast.error("Couldn't save Airtable settings — your last change wasn't stored.");
    },
    onSuccess: () => setSaveState("saved"),
  });

  const fieldMap = s.airtable_field_map ?? {};
  const setField = (key: keyof AirtableFieldMap, value: string | null) =>
    saveSettings.mutate({ airtable_field_map: { ...fieldMap, [key]: value } });
  const baseId = s.airtable_base_id;
  const selectedTable = tables.find((t) => t.name === s.airtable_table_name);
```

> **Ordering note:** `selectedTable`/`baseId` must be defined *after* `tables` (from Task 2's `tablesQ`). Move the Task-2 schema block (basesQ/tablesQ/derived state) above this settings block, or define `s` first and reference `s.airtable_base_id` inside the schema block's `baseId`. Concretely: define `settingsQ`/`s` first, then set `const baseId = s.airtable_base_id;` once (remove the Task-2 `const baseId = get(...)` line), then the schema queries, then `selectedTable`. The final order is: keyStatus → settingsQ/`s`/autosave → `baseId` → basesQ/tablesQ/derived schemaState → `selectedTable`/`fieldMap`/`setField`.

**(3d)** Replace every remaining `get(...)`/`set(...)` call site for the four keys:

- Enable toggle (`:308`):
```tsx
            <Switch checked={!!s.airtable_sync_enabled} onCheckedChange={(v) => saveSettings.mutate({ airtable_sync_enabled: v })} />
```
- The "sync on but no key" alert condition (`:311`): replace `!!get("airtable_sync_enabled", false)` with `!!s.airtable_sync_enabled`.
- Base `Select` (accessible mode, `:390`):
```tsx
                  <Select value={s.airtable_base_id} onValueChange={(v) => saveSettings.mutate({ airtable_base_id: v, airtable_table_name: "" })}>
```
- Table `Select` (accessible mode, `:397`):
```tsx
                  <Select value={s.airtable_table_name} onValueChange={(v) => saveSettings.mutate({ airtable_table_name: v })} disabled={!tables.length}>
```
- Manual base ID `Input` (fallback mode, `:411`) — commit on blur to avoid a write per keystroke:
```tsx
                    <Input placeholder="app1234567890" defaultValue={s.airtable_base_id} key={`base-${s.airtable_base_id}`} onBlur={(e) => { if (e.target.value !== s.airtable_base_id) saveSettings.mutate({ airtable_base_id: e.target.value, airtable_table_name: "" }); }} />
```
- Manual table name `Input` (fallback mode, `:415`):
```tsx
                    <Input placeholder="Shows" defaultValue={s.airtable_table_name} key={`table-${s.airtable_table_name}`} onBlur={(e) => { if (e.target.value !== s.airtable_table_name) saveSettings.mutate({ airtable_table_name: e.target.value }); }} />
```
  (The `key` forces the uncontrolled input to re-seed its `defaultValue` when the persisted value changes, e.g. after the query resolves.)
- The field-map selects, status/cancelled/reason selects (`:437`, `:449`, `:460`, `:471`) already call `setField(...)` — no change needed, since `setField` now routes to `saveSettings`. The `fieldMap` they read is now `s.airtable_field_map`.

**(3e)** Add the autosave status indicator component near the top of the file (after the `NONE` const, before `export function AirtableSyncTab`):

```tsx
function AutosaveStatus({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  if (state === "saving")
    return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>;
  if (state === "saved")
    return <span className="flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-primary" /> All changes saved</span>;
  return <span className="flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3 w-3" /> Couldn't save</span>;
}
```

Render it in the top connection card header so it is always visible, and again on the field-mapping card. In the first `<CardHeader>` (`:295-300`), change to a flex row:

```tsx
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="font-display">Airtable Sync</CardTitle>
              <CardDescription>
                Pull show schedules from Airtable on a schedule. Follow the steps below: save your API key, load the base &amp; table, then map fields and link your catalog. Changes save automatically. Sync runs every few minutes once enabled.
              </CardDescription>
            </div>
            <AutosaveStatus state={saveState} />
          </div>
        </CardHeader>
```

In the Field-mapping `<CardHeader>` (`:427-432`), add the status next to the title:

```tsx
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="font-display">3 · Field mapping</CardTitle>
              <AutosaveStatus state={saveState} />
            </div>
            <CardDescription>
              Map each ShowFlow field to a column in <strong>{selectedTable.name}</strong>. Catalog links are keyed on the <strong>Sub-program</strong> option — map the Sub-program field to enable linking below.
            </CardDescription>
          </CardHeader>
```

**(3f)** Relabel the API-key badge (`:325`) so it does not read as the mapping save state:

```tsx
                <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Key saved</Badge>
```

**(3g)** (Optional accessibility win that also stabilizes the test) On each mapping `Select`, give the trigger an `aria-label`. For the `SHOWFLOW_FIELDS.map` trigger (`:438`):

```tsx
                  <SelectTrigger aria-label={f.label}><SelectValue placeholder="Not mapped" /></SelectTrigger>
```

- [ ] **Step 4: Update `SettingsPage` to drop `get`/`set` for this tab**

In `src/pages/SettingsPage.tsx`, change the Airtable tab render (`:900`):

```tsx
          <AirtableSyncTab orgId={orgId} />
```

Leave the page's `get`/`set`/`draft`/global-Save machinery untouched — every other tab still uses it. The four Airtable keys remain in the draft (seeded from the fetch) but are never mutated there, so they never count as dirty and global Save ignores them.

- [ ] **Step 5: Run the component tests to verify they pass**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx`
Expected: PASS (schema + autosave + last-sync + duplicate-cities).

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx src/components/settings/AirtableSyncTab.test.tsx src/pages/SettingsPage.tsx
git commit -m "feat(airtable): autosave mapping settings with inline status; decouple from page draft"
```

---

## Task 4: Full verification, changelog, and finish

**Files:**
- Modify: `public/changelog.md`
- Regenerate: `public/changelog.json`
- Possibly modify: `package.json`, `src/config/app.config.ts` (version bump — see step)

- [ ] **Step 1: Run the full unit suite + lint**

Run: `npx vitest run`
Expected: PASS (whole suite; no regressions in `SettingsPage` or elsewhere).

Run: `npm run lint`
Expected: no new errors. (Both run in CI if Node is unavailable locally — push and confirm `.github/workflows/ci.yml` is green.)

- [ ] **Step 2: Grep for orphaned references**

Run: `grep -nE "loadBases|loadTables|setSchemaState|setBases|setTables|get\\(\"airtable_|set\\(\"airtable_" src/components/settings/AirtableSyncTab.tsx`
Expected: no matches (all removed/converted).

Run: `grep -n "get={get}\|set={set}" src/pages/SettingsPage.tsx`
Expected: only `BookingEngineTab` / `filters` / `notifications` usages remain — NOT `AirtableSyncTab`.

- [ ] **Step 3: Add the user-facing changelog entry**

First confirm the current version: read `APP_META.VERSION` in `src/config/app.config.ts` and `version` in `package.json` (memory indicates the latest tag is `v1.5.1`). Use the next PATCH (expected `1.5.2`). If they already read `1.5.2+`, use the next patch up and adjust below accordingly.

Prepend a newest-first block to `public/changelog.md`:

```markdown
## 1.5.2 — Jun 24, 2026

*Airtable mapping reliability*

### Fixed
- **Airtable field mappings now save automatically** — mapping a field, picking a base or table, or toggling sync now persists instantly, with a clear "Saving… / All changes saved" indicator. No separate Save click needed.
- **Mappings no longer disappear when you switch tabs** — the Airtable Sync tab now remembers your loaded base and table, so your mappings and catalog links stay visible when you leave the tab and come back.
```

- [ ] **Step 4: Bump the version in both places (PATCH)**

Set `version` in `package.json` to `1.5.2` and `APP_META.VERSION` in `src/config/app.config.ts` to `1.5.2` (match the changelog block). Per project convention these two must match the changelog/tag.

- [ ] **Step 5: Regenerate the changelog JSON**

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
Expected: `public/changelog.json` rewritten to include the 1.5.2 block. Never hand-edit the JSON.

- [ ] **Step 6: Commit**

```bash
git add public/changelog.md public/changelog.json package.json src/config/app.config.ts
git commit -m "docs(changelog): 1.5.2 — airtable mapping autosave + persistence"
```

- [ ] **Step 7: Manual verification checklist (record results in the PR)**

In a running app as an admin with a schema-readable Airtable PAT:
1. Settings → Airtable Sync. Confirm bases auto-load (no click); pick a base + table; map a couple of fields. Confirm the inline status shows "Saving…" then "All changes saved".
2. Switch to another Settings tab (e.g. Filters), then back to Airtable Sync. **Confirm the base, table, mappings, and Catalog-links cards are still shown** (the original bug).
3. Reload the whole page. Confirm the same state is restored.
4. Toggle "Enable Airtable sync" off/on — confirm it persists across a tab switch with no global Save click.
5. (Fallback path) With a PAT lacking `schema.bases:read`, confirm the manual base/table inputs appear, persist on blur, and survive a tab switch.

---

## Self-Review

**1. Spec coverage**
- Bug (a) "I do not see if they were saved" → Task 3 autosave + `AutosaveStatus` (Saving/Saved/Couldn't save) + relabeled key badge. ✓
- Bug (b) "hidden once go into another tab and back" → Task 2 React-Query-cached schema (survives unmount/remount) + Task 3 tab-owned settings query (values survive too). ✓
- "Best-in-class fix" / autosave model (chosen) → Task 3 optimistic mutation with rollback, decoupled from the page draft. ✓

**2. Placeholder scan** — no TBD/"add error handling"/"similar to". The one judgment call (version number) has an explicit read-then-bump step with the expected value (`1.5.2`). The one test-selector fragility (combobox accessible name) is called out with a concrete fallback (`getAllByRole("combobox")[0]`) and an accessibility-improving `aria-label` in Step 3g.

**3. Type consistency**
- `AirtableSettings` shape (`airtable_sync_enabled`/`airtable_base_id`/`airtable_table_name`/`airtable_field_map`) is identical in `airtableSettings.ts`, the mutation patch type (`Partial<AirtableSettings>`), the query cache, and the tests. ✓
- `saveSettings.mutate(patch)` is the single writer; `setField` and every call site pass a `Partial<AirtableSettings>`. ✓
- `fetchAirtableSettings(client, orgId)` signature matches its mock and call site. ✓
- `schemaState` union gains `"loading"` (was `"idle" | "accessible" | "fallback"`); all JSX branches key off `=== "accessible"` / `=== "fallback"`, so `"loading"`/`"idle"` correctly render neither the dropdowns nor the fallback inputs — matching the pre-change "idle" behavior. ✓

**Cross-tab safety re-confirmed:** the tab writes the four keys straight to the DB and to its own `["airtable","settings",orgId]` cache; it never invalidates the page's `["app-settings","all",orgId]` query, so the page's draft-rebuild effect (`SettingsPage.tsx:284-290`) never fires from autosave and cannot clobber unsaved edits in other tabs. Global Save still skips the four keys (never dirty). ✓
