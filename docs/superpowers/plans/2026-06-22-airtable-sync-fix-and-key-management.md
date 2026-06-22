# Airtable Sync Fix + Key Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Airtable sync work again (deploy the missing functions), let admins see/replace/delete the stored API key, and polish the connection panel.

**Architecture:** Deploy the already-written `airtable-schema` + `airtable-poll` edge functions to the live project (the cron + Vault key already exist). Add two Vault RPCs (`get_org_airtable_key_status`, `delete_org_airtable_key`) that expose presence/timestamp but never the secret. Add a `src/data/airtableKey.ts` data layer (extracting the existing inline save), and redesign the connection panel in `AirtableSyncTab.tsx`.

**Tech Stack:** Supabase (Postgres + Vault + Edge Functions/Deno), React 18 + React Query + shadcn/ui, Vitest + supabaseFake, pgTAP.

**Project ID:** `epweartpzwvcasrzyueh`

---

## File structure

- Create: `supabase/migrations/<version>_org_airtable_key_status.sql` — the two new RPCs (version assigned by `apply_migration`).
- Modify: `src/integrations/supabase/types.ts` — regenerated (never hand-edited).
- Create: `src/data/airtableKey.ts` — `saveAirtableKey`, `fetchAirtableKeyStatus`, `deleteAirtableKey`.
- Create: `src/data/airtableKey.test.ts` — unit tests (supabaseFake).
- Modify: `supabase/tests/rpc/org_airtable_key.sql` — add status/delete pgTAP cases.
- Modify: `src/components/settings/AirtableSyncTab.tsx` — connection-panel redesign + key status/delete.
- Deploy (no repo change): `airtable-schema`, `airtable-poll` via the Supabase integration.
- Modify: `package.json`, `src/config/app.config.ts`, `public/changelog.md`, `public/changelog.json` — version 1.4.1.

---

## Task 1: Migration — two Vault RPCs + regenerate types

**Files:**
- Create: `supabase/migrations/<version>_org_airtable_key_status.sql`
- Modify: `src/integrations/supabase/types.ts` (regenerated)

- [ ] **Step 1: Apply the migration to the live DB**

Use the Supabase MCP `apply_migration` with `project_id: "epweartpzwvcasrzyueh"`, `name: "org_airtable_key_status"`, and this exact SQL (mirrors the guard/grant pattern in `20260604131000_org_airtable_vault.sql`):

```sql
-- Presence + last-updated ONLY. Never returns the decrypted secret.
create or replace function public.get_org_airtable_key_status(_org uuid)
returns table(present boolean, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_name text := 'airtable_api_key:' || _org::text;
begin
  if not public.has_org_role(auth.uid(), _org, 'admin') then
    raise exception 'forbidden';
  end if;
  return query
    select exists(select 1 from vault.secrets where name = v_name),
           (select s.updated_at from vault.secrets s where s.name = v_name limit 1);
end; $$;

create or replace function public.delete_org_airtable_key(_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), _org, 'admin') then
    raise exception 'forbidden';
  end if;
  delete from vault.secrets where name = 'airtable_api_key:' || _org::text;
end; $$;

revoke all on function public.get_org_airtable_key_status(uuid) from public;
grant execute on function public.get_org_airtable_key_status(uuid) to authenticated;
revoke all on function public.delete_org_airtable_key(uuid) from public;
grant execute on function public.delete_org_airtable_key(uuid) to authenticated;
```

- [ ] **Step 2: Capture the recorded version and write the local migration file**

Run MCP `list_migrations` (`project_id: "epweartpzwvcasrzyueh"`), find the newest version (the `org_airtable_key_status` row). Write the same SQL above into `supabase/migrations/<that-version>_org_airtable_key_status.sql` so the local file matches the recorded version (per the apply_migration real-timestamp rule).

- [ ] **Step 3: Verify the functions exist**

Run MCP `execute_sql` (`project_id: "epweartpzwvcasrzyueh"`):

```sql
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in ('get_org_airtable_key_status','delete_org_airtable_key')
order by proname;
```

Expected: two rows.

- [ ] **Step 4: Regenerate TypeScript types**

Run MCP `generate_typescript_types` (`project_id: "epweartpzwvcasrzyueh"`) and overwrite `src/integrations/supabase/types.ts` with the returned content. Confirm the `Functions` block now contains `get_org_airtable_key_status` and `delete_org_airtable_key`, and that the diff is otherwise limited to expected schema (no unrelated destructive changes).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ src/integrations/supabase/types.ts
git commit -m "feat(db): add get_org_airtable_key_status + delete_org_airtable_key vault rpcs"
```

---

## Task 2: Data layer — `src/data/airtableKey.ts` (TDD)

**Files:**
- Create: `src/data/airtableKey.test.ts`
- Create: `src/data/airtableKey.ts`

- [ ] **Step 1: Write the failing test**

Create `src/data/airtableKey.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { saveAirtableKey, fetchAirtableKeyStatus, deleteAirtableKey } from "./airtableKey";

describe("saveAirtableKey", () => {
  it("calls set_org_airtable_key with org + key", async () => {
    const fake = createFakeSupabase({ "rpc:set_org_airtable_key": { data: null, error: null } });
    await saveAirtableKey(fake as never, "org-1", "key_abc");
    expect(fake.calls).toContainEqual({ table: "rpc:set_org_airtable_key", method: "rpc", args: [{ _org: "org-1", _key: "key_abc" }] });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:set_org_airtable_key": { data: null, error: { message: "forbidden" } } });
    await expect(saveAirtableKey(fake as never, "org-1", "k")).rejects.toBeTruthy();
  });
});

describe("fetchAirtableKeyStatus", () => {
  it("returns present + updatedAt from the table row", async () => {
    const fake = createFakeSupabase({ "rpc:get_org_airtable_key_status": { data: [{ present: true, updated_at: "2026-06-22T17:44:00Z" }], error: null } });
    const res = await fetchAirtableKeyStatus(fake as never, "org-1");
    expect(res).toEqual({ present: true, updatedAt: "2026-06-22T17:44:00Z" });
    expect(fake.calls).toContainEqual({ table: "rpc:get_org_airtable_key_status", method: "rpc", args: [{ _org: "org-1" }] });
  });
  it("treats an absent key (or empty result) as not present", async () => {
    const fake = createFakeSupabase({ "rpc:get_org_airtable_key_status": { data: [], error: null } });
    const res = await fetchAirtableKeyStatus(fake as never, "org-1");
    expect(res).toEqual({ present: false, updatedAt: null });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:get_org_airtable_key_status": { data: null, error: { message: "forbidden" } } });
    await expect(fetchAirtableKeyStatus(fake as never, "org-1")).rejects.toBeTruthy();
  });
});

describe("deleteAirtableKey", () => {
  it("calls delete_org_airtable_key with org", async () => {
    const fake = createFakeSupabase({ "rpc:delete_org_airtable_key": { data: null, error: null } });
    await deleteAirtableKey(fake as never, "org-1");
    expect(fake.calls).toContainEqual({ table: "rpc:delete_org_airtable_key", method: "rpc", args: [{ _org: "org-1" }] });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:delete_org_airtable_key": { data: null, error: { message: "forbidden" } } });
    await expect(deleteAirtableKey(fake as never, "org-1")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/airtableKey.test.ts`
Expected: FAIL — cannot resolve `./airtableKey`.

- [ ] **Step 3: Implement the data layer**

Create `src/data/airtableKey.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface AirtableKeyStatus {
  present: boolean;
  updatedAt: string | null;
}

/** Store the org's Airtable PAT in the Vault (write-only; never read back to the client). */
export async function saveAirtableKey(
  client: SupabaseClient<Database>,
  orgId: string,
  key: string,
): Promise<void> {
  const { error } = await client.rpc("set_org_airtable_key", { _org: orgId, _key: key });
  if (error) throw error;
}

/** Whether a key is stored + when it was last updated. Never returns the key value. */
export async function fetchAirtableKeyStatus(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<AirtableKeyStatus> {
  const { data, error } = await client.rpc("get_org_airtable_key_status", { _org: orgId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { present: !!row?.present, updatedAt: row?.updated_at ?? null };
}

/** Remove the org's stored Airtable PAT from the Vault. */
export async function deleteAirtableKey(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<void> {
  const { error } = await client.rpc("delete_org_airtable_key", { _org: orgId });
  if (error) throw error;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/airtableKey.test.ts`
Expected: PASS (8 assertions across 7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/airtableKey.ts src/data/airtableKey.test.ts
git commit -m "feat(data): airtable key save/status/delete data layer"
```

---

## Task 3: pgTAP — RPC guard + presence tests

**Files:**
- Modify: `supabase/tests/rpc/org_airtable_key.sql`

> pgTAP runs in CI only (no local Supabase). Write it; CI executes it.

- [ ] **Step 1: Bump the plan count**

In `supabase/tests/rpc/org_airtable_key.sql`, change `SELECT plan(3);` to `SELECT plan(8);`.

- [ ] **Step 2: Append the new cases before `SELECT * FROM finish();`**

The existing tests leave org `…a17a` with key `key_abc` set. Insert these five assertions immediately before the `SELECT * FROM finish();` line:

```sql
-- status as the org admin: key is present (set by the earlier setter test)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000ad317","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT present FROM public.get_org_airtable_key_status('00000000-0000-0000-0000-00000000a17a')),
  true,
  'org admin sees the key as present');
RESET ROLE;

-- status as a non-member is rejected
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000beef","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.get_org_airtable_key_status('00000000-0000-0000-0000-00000000a17a') $$,
  'forbidden',
  'non-admin cannot read key status');
RESET ROLE;

-- delete as a non-member is rejected
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000beef","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.delete_org_airtable_key('00000000-0000-0000-0000-00000000a17a') $$,
  'forbidden',
  'non-admin cannot delete the key');
RESET ROLE;

-- delete as the org admin succeeds, then the key reads as absent
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000ad317","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.delete_org_airtable_key('00000000-0000-0000-0000-00000000a17a') $$,
  'org admin can delete the key');
SELECT is(
  (SELECT present FROM public.get_org_airtable_key_status('00000000-0000-0000-0000-00000000a17a')),
  false,
  'key reads as absent after delete');
RESET ROLE;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/rpc/org_airtable_key.sql
git commit -m "test(db): cover airtable key status + delete rpcs"
```

---

## Task 4: UI — connection-panel redesign in `AirtableSyncTab.tsx`

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx`

- [ ] **Step 1: Extend imports**

At the top of the file:
- Change `import { Trash2 } from "lucide-react";` to:
  `import { Trash2, CheckCircle2, KeyRound, Lock } from "lucide-react";`
- Add after the existing `@/data/...` imports:
  ```ts
  import { saveAirtableKey, fetchAirtableKeyStatus, deleteAirtableKey } from "@/data/airtableKey";
  import { formatDateDMY } from "@/lib/dates";
  ```

- [ ] **Step 2: Add the `replacing` state**

Immediately after `const [airtableKey, setAirtableKey] = useState("");` add:

```ts
const [replacing, setReplacing] = useState(false);
```

- [ ] **Step 3: Add the key-status query**

After the `selectedTable` line (`const selectedTable = tables.find(...)`), add:

```ts
const keyStatusQ = useQuery({
  queryKey: ["airtable", "key-status", orgId],
  enabled: !!orgId,
  queryFn: () => fetchAirtableKeyStatus(supabase, orgId!),
});
const keyPresent = !!keyStatusQ.data?.present;
```

- [ ] **Step 4: Replace the `saveKey` mutation and add `deleteKey`**

Replace the existing `saveKey` mutation block with:

```ts
const saveKey = useMutation({
  mutationFn: async () => {
    if (!orgId) throw new Error("No active organization");
    if (!airtableKey.trim()) throw new Error("Enter an API key");
    await saveAirtableKey(supabase, orgId, airtableKey.trim());
  },
  onSuccess: () => {
    setAirtableKey(""); setReplacing(false);
    qc.invalidateQueries({ queryKey: ["airtable", "key-status", orgId] });
    toast.success("Airtable API key saved");
  },
  onError: (e: unknown) => toast.error((e as Error).message ?? "Failed to save Airtable key"),
});

const deleteKey = useMutation({
  mutationFn: async () => {
    if (!orgId) throw new Error("No active organization");
    await deleteAirtableKey(supabase, orgId);
  },
  onSuccess: () => {
    setAirtableKey(""); setReplacing(false);
    setSchemaState("idle"); setBases([]); setTables([]);
    qc.invalidateQueries({ queryKey: ["airtable", "key-status", orgId] });
    toast.success("Airtable API key deleted");
  },
  onError: (e: unknown) => toast.error((e as Error).message ?? "Failed to delete Airtable key"),
});
```

- [ ] **Step 5: Replace the Connection `CardContent`**

Replace the entire `<CardContent className="space-y-6">…</CardContent>` of the first (Connection) card — i.e. the block currently holding the enable toggle, the API-key input, and the "Load from Airtable" button + base/table selects — with:

```tsx
<CardContent className="space-y-6">
  {/* Enable toggle */}
  <div className="flex items-center justify-between">
    <div>
      <Label className="font-medium">Enable Airtable sync</Label>
      <p className="text-xs text-muted-foreground mt-0.5">Turn polling on or off globally.</p>
    </div>
    <Switch checked={!!get("airtable_sync_enabled", false)} onCheckedChange={(v) => set("airtable_sync_enabled", v)} />
  </div>

  {!!get("airtable_sync_enabled", false) && !keyStatusQ.isLoading && !keyPresent && (
    <Alert variant="destructive">
      <AlertDescription>Sync is on but no API key is saved — the poll can't run until you add a key below.</AlertDescription>
    </Alert>
  )}

  <Separator />

  {/* Step 1 — API key */}
  <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">1</span>
      <Label className="font-medium">API key</Label>
      {keyStatusQ.isLoading ? null : keyPresent ? (
        <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Saved</Badge>
      ) : (
        <Badge variant="outline" className="gap-1 text-muted-foreground"><KeyRound className="h-3 w-3" /> Not set</Badge>
      )}
      {keyPresent && keyStatusQ.data?.updatedAt && (
        <span className="text-xs text-muted-foreground">updated {formatDateDMY(new Date(keyStatusQ.data.updatedAt))}</span>
      )}
    </div>

    {keyPresent && !replacing ? (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
        <span className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="h-4 w-4" /> ••••••••••</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>Replace</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={deleteKey.isPending}>
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete the Airtable API key?</AlertDialogTitle>
                <AlertDialogDescription>Sync stops working until a new key is saved. The key is removed from the encrypted vault. This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteKey.mutate()}>Delete key</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    ) : (
      <>
        <div className="flex gap-2">
          <Input id="airtable-key" type="password" autoComplete="off" placeholder={keyPresent ? "Enter a new key…" : "key… (write-only)"} value={airtableKey} onChange={(e) => setAirtableKey(e.target.value)} />
          <Button onClick={() => saveKey.mutate()} disabled={saveKey.isPending}>{keyPresent ? "Update" : "Save key"}</Button>
          {keyPresent && replacing && (
            <Button variant="ghost" onClick={() => { setReplacing(false); setAirtableKey(""); }}>Cancel</Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Stored encrypted in Vault; never displayed. Required for Airtable sync.</p>
      </>
    )}
  </div>

  <Separator />

  {/* Step 2 — base & table */}
  <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">2</span>
      <Label className="font-medium">Base &amp; table</Label>
      {schemaState === "accessible" && <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Schema connected</Badge>}
      {schemaState === "fallback" && <Badge variant="outline">Manual mode</Badge>}
    </div>
    <Button variant="outline" onClick={() => loadBases.mutate()} disabled={loadBases.isPending || !orgId || !keyPresent}>
      {loadBases.isPending ? "Loading…" : "Load from Airtable"}
    </Button>
    {!keyPresent && <p className="text-xs text-muted-foreground">Save an API key first to load bases &amp; tables.</p>}
    {schemaState === "accessible" ? (
      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <Label>Base</Label>
          <Select value={get("airtable_base_id", "")} onValueChange={(v) => { set("airtable_base_id", v); setTables([]); set("airtable_table_name", ""); loadTables.mutate(v); }}>
            <SelectTrigger><SelectValue placeholder="Select a base" /></SelectTrigger>
            <SelectContent>{bases.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Table</Label>
          <Select value={get("airtable_table_name", "")} onValueChange={(v) => set("airtable_table_name", v)} disabled={!tables.length}>
            <SelectTrigger><SelectValue placeholder="Select a table" /></SelectTrigger>
            <SelectContent>{tables.map((t) => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
    ) : schemaState === "fallback" ? (
      <>
        <Alert>
          <AlertDescription>
            Your Airtable key lacks the <code>schema.bases:read</code> scope. Grant it to pick base/table/fields from dropdowns; until then, type the names below.
          </AlertDescription>
        </Alert>
        <div className="grid grid-cols-1 gap-4">
          <div className="space-y-2">
            <Label>Airtable base ID</Label>
            <Input placeholder="app1234567890" value={get("airtable_base_id", "")} onChange={(e) => set("airtable_base_id", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Airtable table name</Label>
            <Input placeholder="Shows" value={get("airtable_table_name", "")} onChange={(e) => set("airtable_table_name", e.target.value)} />
          </div>
        </div>
      </>
    ) : null}
  </div>
</CardContent>
```

- [ ] **Step 6: Update the Connection card description**

Replace the Connection `CardDescription` text with:

```tsx
<CardDescription>
  Pull show schedules from Airtable on a schedule. Follow the steps below: save your API key, load the base &amp; table, then map fields and link your catalog. Sync runs every few minutes once enabled.
</CardDescription>
```

- [ ] **Step 7: Number the downstream section titles**

For continuity with the steps, prefix the two downstream card titles:
- Field mapping `CardTitle` → `<CardTitle className="font-display">3 · Field mapping</CardTitle>`
- Catalog links `CardTitle` → `<CardTitle className="font-display">4 · Catalog links</CardTitle>`

- [ ] **Step 8: Lint + type-check the file**

Run: `npm run lint`
Expected: PASS (no new errors in `AirtableSyncTab.tsx`). If the build type-checks separately, run `npx tsc --noEmit` and expect no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx
git commit -m "feat(settings): airtable key status/replace/delete + connection panel polish"
```

---

## Task 5: Deploy `airtable-schema` + `airtable-poll` (fixes the live error)

> Deploy via the Supabase MCP `deploy_edge_function` (`project_id: "epweartpzwvcasrzyueh"`). For each `files` entry, read the CURRENT repo contents of the named file and pass `{ name, content }`. File names are relative to `supabase/functions/` so the `../_shared/…` imports resolve.

- [ ] **Step 1: Deploy `airtable-schema`**

`deploy_edge_function` with:
- `name`: `airtable-schema`
- `entrypoint_path`: `airtable-schema/index.ts`
- `verify_jwt`: `true` (user-invoked from the browser; also self-checks via `requireOrgRole`)
- `files` (name → repo path):
  - `airtable-schema/index.ts` → `supabase/functions/airtable-schema/index.ts`
  - `_shared/http.ts` → `supabase/functions/_shared/http.ts`
  - `_shared/auth.ts` → `supabase/functions/_shared/auth.ts`
  - `_shared/deps.ts` → `supabase/functions/_shared/deps.ts`

- [ ] **Step 2: Deploy `airtable-poll`**

`deploy_edge_function` with:
- `name`: `airtable-poll`
- `entrypoint_path`: `airtable-poll/index.ts`
- `verify_jwt`: `false` (cron-invoked with `X-Cron-Secret`; no user JWT — the handler returns 401 unless the secret matches)
- `files` (name → repo path):
  - `airtable-poll/index.ts` → `supabase/functions/airtable-poll/index.ts`
  - `_shared/http.ts` → `supabase/functions/_shared/http.ts`
  - `_shared/deps.ts` → `supabase/functions/_shared/deps.ts`
  - `_shared/settings.ts` → `supabase/functions/_shared/settings.ts`
  - `_shared/airtableKey.ts` → `supabase/functions/_shared/airtableKey.ts`
  - `_shared/customFields.ts` → `supabase/functions/_shared/customFields.ts`
  - `_shared/airtableStatus.ts` → `supabase/functions/_shared/airtableStatus.ts`

If the bundler errors on relative resolution, re-check that every `../_shared/*.ts` the entrypoint imports is present in `files` with the `_shared/<name>.ts` path.

- [ ] **Step 3: Verify both are deployed**

Run MCP `list_edge_functions` (`project_id: "epweartpzwvcasrzyueh"`). Expected: `airtable-schema` and `airtable-poll` now appear with `status: ACTIVE`.

- [ ] **Step 4: Verify the schema function from the app**

In the running app (Settings → Airtable Sync, as an org admin with the saved key), click "Load from Airtable". Expected: bases load (schema accessible) OR the "Manual mode" fallback appears — NOT "Failed to send a request to the Edge Function".

- [ ] **Step 5: Verify the poll ran**

Within ~5 minutes (next cron tick), run MCP `get_logs` (`project_id: "epweartpzwvcasrzyueh"`, `service: "edge-function"`) and/or `execute_sql`:

```sql
select id, status, imported_count, new_count, updated_count, held_count, created_at
from public.airtable_sync_log order by created_at desc limit 3;
```

Expected: a recent row (status `success` or a held/errored breakdown — anything other than the function 404'ing).

---

## Task 6: Version bump + changelog → 1.4.1

**Files:**
- Modify: `package.json`, `src/config/app.config.ts`, `public/changelog.md`, `public/changelog.json`

- [ ] **Step 1: Bump the version in both places**

- `package.json`: `"version": "1.4.0"` → `"version": "1.4.1"`.
- `src/config/app.config.ts` (line ~77): `VERSION: '1.4.0',` → `VERSION: '1.4.1',`.

- [ ] **Step 2: Add the changelog block**

In `public/changelog.md`, insert this block immediately above `## 1.4.0 — June 21, 2026`:

```markdown
## 1.4.1 — June 22, 2026

*Airtable sync fixes*

### Fixed
- **Airtable connection** — loading bases and tables from Airtable works again, and the automatic show-date sync is running.

### Improved
- **API key management** — the Airtable settings now show whether a key is saved and when it was last updated, and let you replace or delete it.

```

- [ ] **Step 3: Regenerate the changelog JSON**

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
Expected: `public/changelog.json` updated with the 1.4.1 block (never hand-edited).

- [ ] **Step 4: Commit**

```bash
git add package.json src/config/app.config.ts public/changelog.md public/changelog.json
git commit -m "chore(release): 1.4.1 — airtable sync fix + key management"
```

---

## Task 7: Final verification

- [ ] **Step 1: Unit tests**

Run: `npx vitest run`
Expected: all pass (including `src/data/airtableKey.test.ts`).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean (no new errors).

- [ ] **Step 3: Edge-function Deno suite (sanity — no function code changed)**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: all pass.

- [ ] **Step 4: Confirm the live fix**

Re-confirm in the app that "Load from Airtable" succeeds and the key panel shows "Saved · updated <date>" with working Replace/Delete.

---

## Self-review notes

- **Spec coverage:** deploy fix (Task 5) ✓; key-saved indicator (Tasks 1–4) ✓; delete key (Tasks 1–4) ✓; UI polish (Task 4) ✓; tests (Tasks 2–3, 7) ✓; types regen (Task 1) ✓; booking-engine functions explicitly out of scope (not in any task) ✓.
- **Type consistency:** `AirtableKeyStatus { present, updatedAt }` defined in Task 2 and consumed in Task 4 (`keyStatusQ.data?.present`, `…updatedAt`). RPC names identical across migration (Task 1), data layer (Task 2), pgTAP (Task 3).
- **No placeholders:** `<version>` in Task 1 is resolved at apply time via `list_migrations` (Step 2) — not a content gap.
