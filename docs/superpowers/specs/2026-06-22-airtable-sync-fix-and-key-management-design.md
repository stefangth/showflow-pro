# Airtable Sync — deploy fix + API-key management & UI polish

**Date:** 2026-06-22
**Branch:** `claude/kind-pare-55cabc`
**Status:** Approved (design); spec under review

## Problem

In Settings → Airtable Sync, clicking **Load from Airtable** fails with
*"Failed to send a request to the Edge Function."* Separately, the user wants
(a) a visible indication that an API key is saved and (b) the ability to delete
it, and considers the tab's UI not yet best-in-class.

## Root cause

The `airtable-schema` edge function — invoked by "Load from Airtable" via
`supabase.functions.invoke("airtable-schema")` — **is not deployed** to the
Supabase project (`epweartpzwvcasrzyueh`). A browser call to a non-existent
function gets a 404 with no CORS headers, which `supabase-js` surfaces as a
`FunctionsFetchError` ("Failed to send a request to the Edge Function") rather
than an HTTP error.

Evidence gathered:
- `list_edge_functions` returns 11 functions; neither `airtable-schema` nor
  `airtable-poll` is among them (both exist in the repo).
- The `airtable-poll` cron job (`jobid 5`, `*/5 * * * *`, `active`) is firing
  `net.http_post` at `…/functions/v1/airtable-poll` every 5 minutes against a
  function that 404s → **no sync has ever completed**.
- Vault holds exactly **1** `airtable_api_key:*` secret (created 2026-06-16,
  updated 2026-06-22) → `set_org_airtable_key` works; the user just gets no
  confirmation the key is stored, and there is no way to delete it.

## Goals

1. Make "Load from Airtable" work and let the existing cron actually sync.
2. Show whether an API key is saved (presence + last-updated), without ever
   exposing the key value.
3. Let an org admin delete the stored key.
4. Polish the connection panel (status chips, saved-key control, gated load
   button, light step numbering) — a focused polish, not a structural rewrite.

## Non-goals

- The other undeployed functions (`open-offer-tier`, `expire-offers`,
  `send-offer-digest`, `send-confirmation-digest`, `tier-at-risk-watcher`) are
  **out of scope** here. They are also undeployed and likely non-functional;
  flagged to the user as a separate follow-up (deploying email-sending cron
  functions warrants its own careful change).
- No change to the catalog-linking, custom-fields, duplicate-cities, or
  sync-report sections beyond shared spacing/empty-state polish.
- No change to the `airtable-poll` cron schedule (already correct).

## Design

### Part 1 — Deploy the functions (fixes the live error)

Deploy `airtable-schema` and `airtable-poll`, with their transitive `_shared`
dependencies, to the live project via the Supabase integration
(`deploy_edge_function`).

- `verify_jwt` per each function's auth model:
  - `airtable-schema`: user-JWT invoked from the browser, self-checks via
    `requireOrgRole`. Deploy with `verify_jwt = true` (matches `create-invitation`).
  - `airtable-poll`: cron-invoked. Set `verify_jwt` to match how the existing
    cron command authenticates (confirm from the `cron.job` command + the
    handler's auth before deploying).
- No cron changes — `jobid 5` already targets the correct URL and will begin
  succeeding the moment the function exists.
- Verify post-deploy: `list_edge_functions` shows both; a manual
  `airtable-schema` invoke from the UI returns bases (or the documented
  `schemaAccessible:false` fallback); `airtable-poll` logs/`airtable_sync_log`
  show a run on the next cron tick.

### Part 2 — Two new Vault RPCs (new migration)

Mirror the existing `set_org_airtable_key` pattern in
`20260604131000_org_airtable_vault.sql`: `SECURITY DEFINER`,
`set search_path = public`, admin-guarded via `has_org_role` (which
short-circuits on super-admin), granted to `authenticated`. Neither RPC ever
reads or returns the decrypted secret.

```sql
-- Presence + timestamp ONLY. Never returns the secret value.
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

Migration file named with the real apply-time timestamp
(`20260622HHMMSS_org_airtable_key_status.sql`) so the local file matches the
version recorded by `apply_migration`. After applying to the live DB,
regenerate `src/integrations/supabase/types.ts` via `generate_typescript_types`
so `client.rpc(...)` stays typed (file is auto-generated — regenerated, never
hand-edited).

### Part 3 — Data-access layer

New `src/data/airtableKey.ts` (extract the existing inline `set_org_airtable_key`
call out of the component so all three are testable with `supabaseFake`):

```ts
export interface AirtableKeyStatus { present: boolean; updatedAt: string | null }

export async function saveAirtableKey(client, orgId, key): Promise<void>          // set_org_airtable_key
export async function fetchAirtableKeyStatus(client, orgId): Promise<AirtableKeyStatus> // get_org_airtable_key_status (unwraps TABLE row)
export async function deleteAirtableKey(client, orgId): Promise<void>             // delete_org_airtable_key
```

`get_org_airtable_key_status` returns `TABLE(...)`, so the RPC yields an array;
`fetchAirtableKeyStatus` unwraps `data[0]` → `{ present, updatedAt }`.

### Part 4 — UI (`AirtableSyncTab.tsx`)

- Key-status query: `useQuery(["airtable","key-status",orgId], …, { enabled: !!orgId })`.
- `saveKey` mutation → `saveAirtableKey`; on success clear input, exit "replace"
  mode, invalidate `["airtable","key-status"]`.
- `deleteKey` mutation → `deleteAirtableKey`, behind an `AlertDialog` confirm; on
  success invalidate key-status, reset `schemaState` to `"idle"`, clear
  `bases`/`tables`.
- Connection panel (per the approved mockup):
  - **No key:** password input + Save key; a "No API key" chip; "Load from
    Airtable" **disabled** with a hint ("Save a key first…").
  - **Key saved:** an "API key saved" success chip + "updated <date>" chip; a
    masked, read-only row with **Replace** (reveals the input again) and
    **Delete** (confirm dialog); "Load from Airtable" enabled.
  - After loading: a "Schema connected" / "Manual mode" chip reflecting
    `schemaState`.
  - Light step numbering (1 Connect → 2 Base/table → 3 Map → 4 Link) and
    tightened spacing/empty states. No IA rewrite.
- Inline warning when `airtable_sync_enabled` is on but no key is present
  (sync can't run without a key).
- `updatedAt` rendered with the timezone-safe `formatDateDMY` from
  `src/lib/dates.ts`.

### Part 5 — Testing (test-first)

- `src/data/airtableKey.test.ts` (supabaseFake): each of the three functions
  calls the correct RPC with the correct args and unwraps/propagates results &
  errors. Written before the implementation.
- pgTAP (`supabase/tests/`, CI-run): `get_org_airtable_key_status` returns
  `present=false` when absent and `present=true` + a timestamp when present;
  both RPCs raise `forbidden` for a non-admin; admin/super-admin pass;
  `delete_org_airtable_key` removes the secret.
- Re-run the full `supabase/functions/` Deno suite after any deploy-related
  touch (per the multi-test-file rule).
- `npx vitest run` + `npm run lint` green before completion.

## Rollout / verification order

1. Write failing data-layer test → implement `src/data/airtableKey.ts`.
2. Author migration → `apply_migration` to live → `generate_typescript_types`.
3. pgTAP test for the RPCs.
4. Implement UI changes against the new data layer.
5. Deploy `airtable-schema` + `airtable-poll`; confirm via `list_edge_functions`
   and a live "Load from Airtable".
6. Watch the next cron tick / `airtable_sync_log` for a successful poll.
7. `vitest`, `lint`, Deno suite green.

## Risks

- **Deploying `airtable-poll` activates real sync** for any org with
  `airtable_sync_enabled = true`. Acceptable — that is the intended behavior and
  what the user is trying to achieve; the poll holds (never drops) unresolved
  records.
- **Type regeneration drift:** regenerating `types.ts` from live pulls the whole
  schema; review the diff is limited to the two new functions (plus any expected
  existing drift) before committing.
- **Vault delete semantics:** removing the `vault.secrets` row is the supported
  delete path (no `vault.delete_secret` helper exists); guarded to org admins.
