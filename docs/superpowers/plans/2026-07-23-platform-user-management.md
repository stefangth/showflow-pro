# Platform User Management Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give super-admins a cross-org Users console to view every user and manage their full lifecycle (roles, memberships, artist linking, login email, password reset, suspend, delete), fixing the hire-order visibility bug at its root (artist↔account re-linking).

**Architecture:** A new Platform → Users tab (master table + right detail Sheet). Reads and auth-mutations go through two super-admin edge functions (`platform-list-users`, `platform-manage-user`); DB-only mutations go through three `is_super_admin`-guarded SECURITY DEFINER RPCs called directly from the client. Inviting a new user reuses `create-invitation`. Every mutation appends to a new append-only `platform_audit_log`.

**Tech Stack:** React 18 + TS + @tanstack/react-query + shadcn/ui; Supabase Postgres (RPCs, RLS) + Deno edge functions; vitest, pgTAP, Deno test.

**Design spec:** `docs/superpowers/specs/2026-07-23-platform-user-management-design.md`

## Global Constraints

- **TypeScript:** `any` is a CI-failing lint error (`--max-warnings 0`). For joined Supabase rows, define a local `interface` and cast once with `as unknown as Row[]` right after the error check (confined to `src/data/**`, hook `queryFn`s, `supabase/functions/**`). Test stubs use the typed helpers (`src/test/castHelpers.ts`, `supabase/functions/_shared/testing.ts`) — never per-site `as any`.
- **Styling:** semantic tokens only (`bg-background`, `text-foreground`, `text-primary`, `border-border`, `text-destructive`). No hardcoded colors.
- **Copy:** no em/en dashes in any UI string, toast, or email body (use period, comma, colon, middot; arrows fine).
- **React data:** reads via `useQuery`, writes via `useMutation`; on success invalidate the whole domain prefix `['platform','users']`. Side effects → `sonner` toast (`toast.success` / `toast.error`).
- **Edge functions:** export `handle(req, deps)`, wire `Deno.serve((req) => handle(req, realDeps()))` at the bottom only. Use `_shared/http.ts` (`preflight`, `json`), `_shared/auth.ts` (`requireSuperAdmin`), never inline CORS/auth/client creation. Read secrets via `deps.env(...)`. Time via `deps.now()`.
- **New edge functions need a `config.toml` block** (`verify_jwt = true` for both here) or they deploy with JWT forced on incorrectly.
- **DB:** schema changes via migration + `apply_migration` (records a real-timestamp version; name the file to match). Never hand-edit `src/integrations/supabase/types.ts`. Regenerate it AND its mirror `supabase/functions/_shared/database.types.ts` together (byte-equality tested by `typesMirror.test.ts`). Every new table: RLS enabled, explicit policies, no `WITH CHECK (true)` on the audit table.
- **Super-admin SQL predicate is `public.is_super_admin(auth.uid())`.** The SQL RPCs are called with the caller's JWT, so `auth.uid()` is the super-admin.
- **Test-first (TDD):** failing test before implementation for every unit; a bug fix starts with a failing regression test.
- **Local test commands:** frontend `npx vitest run <path>`; edge `deno test --allow-all --node-modules-dir=none supabase/functions/<name>/`; pgTAP `supabase test db` (or run the file wrapped in `BEGIN; CREATE EXTENSION IF NOT EXISTS pgtap ...; ROLLBACK;` via the Supabase MCP `execute_sql`).
- **Ships dark to customers:** super-admin-only surface. No `FEATURE_REGISTRY`/entitlement change, no `public/changelog.md` entry.

---

## File Structure

**Create:**
- `supabase/migrations/<ts>_platform_audit_log.sql` — audit table + RLS.
- `supabase/migrations/<ts>_platform_user_rpcs.sql` — `platform_set_membership`, `platform_remove_membership`, `platform_link_artist`.
- `supabase/tests/rpc/platform_user_rpcs.sql` — pgTAP for the three RPCs + guards + the hire-order re-link regression.
- `supabase/tests/rls/platform_audit_log.sql` — pgTAP for audit-table RLS.
- `supabase/functions/platform-list-users/index.ts` + `index.test.ts`.
- `supabase/functions/platform-manage-user/index.ts` + `index.test.ts`.
- `supabase/functions/_shared/transactional-email-templates/account-email-changed.tsx` — security notice template.
- `src/data/platformUsers.ts` + `src/data/platformUsers.test.ts`.
- `src/hooks/usePlatformUsers.ts`.
- `src/components/platform/UsersTab.tsx` + `UsersTab.test.tsx`.
- `src/components/platform/UserDetailSheet.tsx` + `UserDetailSheet.test.tsx`.

**Modify:**
- `supabase/config.toml` — add `[functions.platform-list-users]` and `[functions.platform-manage-user]`.
- `supabase/functions/_shared/transactional-email-templates/registry.ts` — register the new template.
- `src/pages/PlatformPage.tsx` — add the Users tab.
- `src/components/platform/OrgInvitePopover.tsx` — add a create-invite form (closes the resend-only gap).
- `src/components/artists/ArtistProfileSheet.tsx` — relabel the email field "Booking / contact email".
- `src/integrations/supabase/types.ts` + `supabase/functions/_shared/database.types.ts` — regenerate after migrations.

---

## Task 1: `platform_audit_log` table + RLS

**Files:**
- Create: `supabase/migrations/<ts>_platform_audit_log.sql`
- Create (test): `supabase/tests/rls/platform_audit_log.sql`
- Modify: `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts` (regenerate)

**Interfaces:**
- Produces: table `public.platform_audit_log(id, actor_user_id, action, target_user_id, org_id, detail jsonb, created_at)`; readable/insertable only by super-admins.

- [ ] **Step 1: Write the failing RLS test**

Create `supabase/tests/rls/platform_audit_log.sql`:
```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111111','authenticated','authenticated','sa@test.com',now(),now()),
  ('22222222-2222-2222-2222-222222222222','authenticated','authenticated','reg@test.com',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('11111111-1111-1111-1111-111111111111');
SET session_replication_role = DEFAULT;

-- non-super-admin cannot insert
SELECT set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ INSERT INTO public.platform_audit_log(actor_user_id, action) VALUES ('22222222-2222-2222-2222-222222222222','x') $$,
  '42501', null, 'regular user cannot insert into platform_audit_log');
RESET ROLE;

-- super-admin can insert
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ INSERT INTO public.platform_audit_log(actor_user_id, action) VALUES ('11111111-1111-1111-1111-111111111111','change_email') $$,
  'super-admin can insert');
-- super-admin can read
SELECT isnt_empty(
  $$ SELECT 1 FROM public.platform_audit_log $$,
  'super-admin can read the audit log');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run (Supabase MCP `execute_sql` with the file contents, or `supabase test db`).
Expected: FAIL — relation `public.platform_audit_log` does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/<ts>_platform_audit_log.sql`:
```sql
create table public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  action text not null,
  target_user_id uuid,
  org_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.platform_audit_log enable row level security;

create policy "super admins read platform audit"
  on public.platform_audit_log for select
  to authenticated
  using (public.is_super_admin(auth.uid()));

create policy "super admins write platform audit"
  on public.platform_audit_log for insert
  to authenticated
  with check (public.is_super_admin(auth.uid()));

create index platform_audit_log_target_idx on public.platform_audit_log (target_user_id, created_at desc);
```
Apply it with the Supabase MCP `apply_migration` (name `platform_audit_log`).

- [ ] **Step 4: Regenerate types**

Run the Supabase MCP `generate_typescript_types`; write the result to `src/integrations/supabase/types.ts` and copy byte-for-byte to `supabase/functions/_shared/database.types.ts`.
Run: `npx vitest run src/integrations/supabase/typesMirror.test.ts`
Expected: PASS (mirror byte-equal).

- [ ] **Step 5: Run the RLS test to verify it passes**

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations supabase/tests/rls/platform_audit_log.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "add platform_audit_log table with super-admin rls"
```

---

## Task 2: `platform_set_membership` + `platform_remove_membership` RPCs

**Files:**
- Create: `supabase/migrations/<ts>_platform_user_rpcs.sql` (all three RPCs land here; add link in Task 3)
- Create (test): `supabase/tests/rpc/platform_user_rpcs.sql`

**Interfaces:**
- Produces:
  - `platform_set_membership(p_org uuid, p_user uuid, p_role app_role, p_action text) returns void`
  - `platform_remove_membership(p_org uuid, p_user uuid) returns void`
  - Both raise `42501` for non-super-admins and when removing the last admin of an org.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/rpc/platform_user_rpcs.sql`:
```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('aaaa0000-0000-0000-0000-000000000001','authenticated','authenticated','sa@test.com',now(),now()),
  ('aaaa0000-0000-0000-0000-000000000002','authenticated','authenticated','admin@test.com',now(),now()),
  ('aaaa0000-0000-0000-0000-000000000003','authenticated','authenticated','reg@test.com',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('aaaa0000-0000-0000-0000-000000000001');
INSERT INTO public.organizations (id, name, slug) VALUES ('bbbb0000-0000-0000-0000-000000000001','Org','pm-org');
INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES ('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000002','admin');
SET session_replication_role = DEFAULT;

-- non-super-admin is rejected
SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.platform_set_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003','producer','add') $$,
  '42501', null, 'non-super-admin cannot set membership');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- super-admin adds a producer role
SELECT lives_ok(
  $$ SELECT public.platform_set_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003','producer','add') $$,
  'super-admin adds a role');
SELECT isnt_empty(
  $$ SELECT 1 FROM public.org_memberships WHERE user_id='aaaa0000-0000-0000-0000-000000000003' AND role='producer' $$,
  'producer role present');
-- removing the only admin is blocked
SELECT throws_ok(
  $$ SELECT public.platform_set_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000002','admin','remove') $$,
  'P0001', null, 'cannot remove the last admin');
-- remove_membership on non-admin succeeds
SELECT lives_ok(
  $$ SELECT public.platform_remove_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003') $$,
  'super-admin removes a non-admin member');
SELECT is_empty(
  $$ SELECT 1 FROM public.org_memberships WHERE user_id='aaaa0000-0000-0000-0000-000000000003' AND org_id='bbbb0000-0000-0000-0000-000000000001' $$,
  'member removed from org');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — function `platform_set_membership` does not exist.

- [ ] **Step 3: Write the migration (RPCs)**

Create `supabase/migrations/<ts>_platform_user_rpcs.sql`:
```sql
create or replace function public.platform_set_membership(
  p_org uuid, p_user uuid, p_role app_role, p_action text
) returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_action not in ('add','remove') then
    raise exception 'Invalid action' using errcode = '22023';
  end if;

  if p_action = 'add' then
    insert into public.org_memberships (org_id, user_id, role)
    values (p_org, p_user, p_role)
    on conflict (org_id, user_id, role) do nothing;
  else
    lock table public.org_memberships in share row exclusive mode;
    if p_role = 'admin'
       and exists (select 1 from public.org_memberships
                   where org_id = p_org and user_id = p_user and role = 'admin')
       and (select count(distinct user_id) from public.org_memberships
            where org_id = p_org and role = 'admin') <= 1
    then
      raise exception 'org must keep at least one admin' using errcode = 'P0001';
    end if;
    delete from public.org_memberships
    where org_id = p_org and user_id = p_user and role = p_role;
  end if;

  insert into public.platform_audit_log(actor_user_id, action, target_user_id, org_id, detail)
  values (auth.uid(), 'set_membership', p_user, p_org,
          jsonb_build_object('role', p_role, 'action', p_action));
end;
$$;

create or replace function public.platform_remove_membership(
  p_org uuid, p_user uuid
) returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  lock table public.org_memberships in share row exclusive mode;
  if exists (select 1 from public.org_memberships
             where org_id = p_org and user_id = p_user and role = 'admin')
     and (select count(distinct user_id) from public.org_memberships
          where org_id = p_org and role = 'admin') <= 1
  then
    raise exception 'org must keep at least one admin' using errcode = 'P0001';
  end if;
  delete from public.org_memberships where org_id = p_org and user_id = p_user;

  insert into public.platform_audit_log(actor_user_id, action, target_user_id, org_id)
  values (auth.uid(), 'remove_membership', p_user, p_org);
end;
$$;

revoke all on function public.platform_set_membership(uuid, uuid, app_role, text) from public, anon;
revoke all on function public.platform_remove_membership(uuid, uuid) from public, anon;
grant execute on function public.platform_set_membership(uuid, uuid, app_role, text) to authenticated;
grant execute on function public.platform_remove_membership(uuid, uuid) to authenticated;
```
Apply with `apply_migration` (name `platform_user_rpcs`). (Task 3 appends `platform_link_artist` to the same file before applying, or applies as a follow-up migration — either is fine; keep the pgTAP file covering all three.)

- [ ] **Step 4: Run the pgTAP test to verify it passes**

Expected: PASS (6 tests) — run after Task 3's function is also present if you kept one migration; otherwise the 6 membership assertions pass now.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations supabase/tests/rpc/platform_user_rpcs.sql
git commit -m "add platform membership rpcs with last-admin guard"
```

---

## Task 3: `platform_link_artist` RPC + hire-order re-link regression

**Files:**
- Modify: `supabase/migrations/<ts>_platform_user_rpcs.sql` (append the function) — or a new follow-up migration
- Modify (test): `supabase/tests/rpc/platform_user_rpcs.sql` (bump `plan(...)`, add assertions)

**Interfaces:**
- Produces: `platform_link_artist(p_org uuid, p_user uuid, p_artist_id uuid) returns void`. `p_artist_id` null = unlink the user's artist in that org. Enforces one artist per (org, user) and same-org membership of the artist row.

- [ ] **Step 1: Add the failing regression assertions**

Append to `supabase/tests/rpc/platform_user_rpcs.sql` (and raise the `plan(6)` to `plan(9)`), before `finish()`:
```sql
SET session_replication_role = replica;
INSERT INTO public.artists (id, org_id, name, email, status)
  VALUES ('cccc0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000001','Artist','a@test.com','active');
INSERT INTO public.show_dates (id, org_id, date)
  VALUES ('dddd0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000001','2026-08-01');
INSERT INTO public.hire_orders (org_id, artist_id, show_date_id, order_no, status)
  VALUES ('bbbb0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000001','HO-TEST-1','issued');
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- super-admin links the artist to the regular user (aaaa…003)
SELECT lives_ok(
  $$ SELECT public.platform_link_artist('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003','cccc0000-0000-0000-0000-000000000001') $$,
  'super-admin links artist to a user');
RESET ROLE;

-- REGRESSION: the newly-linked user can now see the issued order under hire_orders RLS
SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT isnt_empty(
  $$ SELECT 1 FROM public.hire_orders WHERE order_no = 'HO-TEST-1' $$,
  'linked user now sees the issued hire order (bug fix)');
RESET ROLE;

-- unlink clears user_id
SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.platform_link_artist('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003', null) $$,
  'super-admin unlinks the artist');
RESET ROLE;
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — function `platform_link_artist` does not exist.

- [ ] **Step 3: Write the function**

Append to the RPC migration and apply:
```sql
create or replace function public.platform_link_artist(
  p_org uuid, p_user uuid, p_artist_id uuid
) returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if p_artist_id is null then
    update public.artists set user_id = null
    where org_id = p_org and user_id = p_user;
  else
    if not exists (select 1 from public.artists where id = p_artist_id and org_id = p_org) then
      raise exception 'artist not found in org' using errcode = 'P0001';
    end if;
    -- one artist per (org, user): detach any other artist this user owns in the org
    update public.artists set user_id = null
    where org_id = p_org and user_id = p_user and id <> p_artist_id;
    update public.artists set user_id = p_user where id = p_artist_id;
  end if;

  insert into public.platform_audit_log(actor_user_id, action, target_user_id, org_id, detail)
  values (auth.uid(), 'link_artist', p_user, p_org, jsonb_build_object('artist_id', p_artist_id));
end;
$$;

revoke all on function public.platform_link_artist(uuid, uuid, uuid) from public, anon;
grant execute on function public.platform_link_artist(uuid, uuid, uuid) to authenticated;
```

- [ ] **Step 4: Run the full pgTAP file to verify it passes**

Expected: PASS (9 tests), including the regression that the re-linked user sees the issued order.

- [ ] **Step 5: Regenerate types (new RPC signatures) and commit**

Regenerate `types.ts` + mirror (as Task 1 Step 4), then:
```bash
git add supabase/migrations supabase/tests/rpc/platform_user_rpcs.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "add platform_link_artist rpc + hire-order re-link regression test"
```

---

## Task 4: `platform-list-users` edge function

**Files:**
- Create: `supabase/functions/platform-list-users/index.ts`, `.../index.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces: POST endpoint (super-admin) returning `{ users: PlatformUser[], truncated: boolean }` where
```ts
interface PlatformUser {
  id: string; email: string | null; display_name: string | null;
  created_at: string; last_sign_in_at: string | null; suspended: boolean;
  memberships: Array<{ org_id: string; org_name: string; roles: string[]; artist: { id: string; name: string } | null }>;
}
```
- Consumed by `src/data/platformUsers.ts` (Task 7).

- [ ] **Step 1: Write the failing Deno test**

Create `supabase/functions/platform-list-users/index.test.ts`:
```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps } from "../_shared/testing.ts";

const AUTH = { Authorization: "Bearer x" };

Deno.test("rejects non-super-admin", async () => {
  const { deps } = makeFakeDeps({ tables: { platform_admins: { data: null, error: null } } });
  const res = await handle(new Request("http://x", { method: "POST", headers: AUTH, body: "{}" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("assembles per-user memberships + artist link", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      platform_admins: { data: { user_id: "sa" }, error: null },
      org_memberships: { data: [{ org_id: "o1", user_id: "u1", role: "artist" }], error: null },
      organizations: { data: [{ id: "o1", name: "Org One" }], error: null },
      artists: { data: [{ id: "a1", name: "Ada", user_id: "u1", org_id: "o1" }], error: null },
      profiles: { data: [{ user_id: "u1", display_name: "Ada L" }], error: null },
    },
    authUsers: [{ id: "u1", email: "u1@test.com", created_at: "2026-01-01", last_sign_in_at: null, banned_until: null }],
  });
  const res = await handle(new Request("http://x", { method: "POST", headers: AUTH, body: "{}" }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.users[0].memberships[0].org_name, "Org One");
  assertEquals(body.users[0].memberships[0].artist.name, "Ada");
});
```
Note: `makeFakeDeps` needs an `authUsers` option feeding a fake `admin.auth.admin.listUsers`. If not present, extend `FakeDepsOptions` in `supabase/functions/_shared/testing.ts` to accept `authUsers` and back `admin.auth = { admin: { listUsers: async () => ({ data: { users: authUsers }, error: null }) } }`. Do this as the first sub-step and commit it with this task.

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/platform-list-users/`
Expected: FAIL — `./index.ts` not found.

- [ ] **Step 3: Write the handler**

Create `supabase/functions/platform-list-users/index.ts`:
```ts
import { preflight, json } from "../_shared/http.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

interface MembershipRow { org_id: string; user_id: string; role: string }
interface OrgRow { id: string; name: string }
interface ArtistRow { id: string; name: string; user_id: string | null; org_id: string }
interface ProfileRow { user_id: string; display_name: string | null }

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  try {
    const auth = await requireSuperAdmin(deps, req);
    if (!auth.ok) return auth.response;
    const admin = deps.admin;

    const { data: page, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) throw listErr;
    const truncated = page.users.length >= 1000;

    const [{ data: mships }, { data: orgs }, { data: artists }, { data: profiles }] = await Promise.all([
      admin.from("org_memberships").select("org_id, user_id, role"),
      admin.from("organizations").select("id, name"),
      admin.from("artists").select("id, name, user_id, org_id"),
      admin.from("profiles").select("user_id, display_name"),
    ]);
    const M = (mships ?? []) as unknown as MembershipRow[];
    const orgName = new Map(((orgs ?? []) as unknown as OrgRow[]).map((o) => [o.id, o.name]));
    const A = (artists ?? []) as unknown as ArtistRow[];
    const nameByUser = new Map(((profiles ?? []) as unknown as ProfileRow[]).map((p) => [p.user_id, p.display_name]));
    const now = deps.now().getTime();

    const users = page.users.map((u) => {
      const byOrg = new Map<string, { org_id: string; org_name: string; roles: string[]; artist: { id: string; name: string } | null }>();
      for (const m of M.filter((x) => x.user_id === u.id)) {
        const e = byOrg.get(m.org_id) ?? { org_id: m.org_id, org_name: orgName.get(m.org_id) ?? "Unknown", roles: [], artist: null };
        e.roles.push(m.role);
        const art = A.find((a) => a.org_id === m.org_id && a.user_id === u.id);
        e.artist = art ? { id: art.id, name: art.name } : null;
        byOrg.set(m.org_id, e);
      }
      const banned = (u as { banned_until?: string | null }).banned_until ?? null;
      return {
        id: u.id, email: u.email ?? null, display_name: nameByUser.get(u.id) ?? null,
        created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null,
        suspended: !!banned && new Date(banned).getTime() > now,
        memberships: Array.from(byOrg.values()),
      };
    });
    return json({ users, truncated });
  } catch (e) {
    console.error("platform-list-users error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Add the config.toml block**

Add to `supabase/config.toml`:
```toml
[functions.platform-list-users]
verify_jwt = true
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/platform-list-users/`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**
```bash
git add supabase/functions/platform-list-users supabase/functions/_shared/testing.ts supabase/config.toml
git commit -m "add platform-list-users edge function (super-admin roster)"
```

---

## Task 5: `account-email-changed` email template

**Files:**
- Create: `supabase/functions/_shared/transactional-email-templates/account-email-changed.tsx`
- Modify: `supabase/functions/_shared/transactional-email-templates/registry.ts`

**Interfaces:**
- Produces: template key `account-email-changed`; `templateData` = `{ oldEmail: string; newEmail: string; appOrigin: string }`.
- Consumed by `platform-manage-user` (Task 6).

- [ ] **Step 1: Write the template**

Model it on an existing template (e.g. `org-invitation.tsx`). Create `account-email-changed.tsx`:
```tsx
/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import type { TemplateData, TemplateEntry } from './registry.ts'

function AccountEmailChanged(data: TemplateData) {
  const oldEmail = String(data.oldEmail ?? '')
  const newEmail = String(data.newEmail ?? '')
  return (
    <div>
      <p>The login email for your Showflow Pro account was changed by an administrator.</p>
      <p>Previous: {oldEmail}</p>
      <p>New: {newEmail}</p>
      <p>If you did not expect this, contact your administrator right away.</p>
    </div>
  )
}

export const template: TemplateEntry = {
  component: AccountEmailChanged,
  subject: 'Your Showflow Pro login email was changed',
  displayName: 'Account email changed',
  previewData: { oldEmail: 'old@example.com', newEmail: 'new@example.com', appOrigin: 'https://app.showflow.pro' },
}
```
(No em dashes; semantic content only.)

- [ ] **Step 2: Register it**

In `registry.ts`, add the import and the `TEMPLATES` entry:
```ts
import { template as accountEmailChanged } from './account-email-changed.tsx'
// ...
'account-email-changed': accountEmailChanged,
```

- [ ] **Step 3: Verify the registry test passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/transactional-email-templates/`
Expected: PASS (the template renders / registry stays consistent).

- [ ] **Step 4: Commit**
```bash
git add supabase/functions/_shared/transactional-email-templates
git commit -m "add account-email-changed email template"
```

---

## Task 6: `platform-manage-user` edge function

**Files:**
- Create: `supabase/functions/platform-manage-user/index.ts`, `.../index.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `requireSuperAdmin`; `account-email-changed` template; `anonymize_user` RPC (called via the caller's JWT client).
- Produces: POST body `{ action, target_user_id, new_email? }`, `action ∈ {change_email, send_password_reset, suspend, unsuspend, delete}`; returns `{ ok: true }` or `{ error }`.

- [ ] **Step 1: Write the failing Deno test**

Create `supabase/functions/platform-manage-user/index.test.ts`:
```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps } from "../_shared/testing.ts";

const AUTH = { Authorization: "Bearer x" };
const post = (body: unknown) => new Request("http://x", { method: "POST", headers: AUTH, body: JSON.stringify(body) });

Deno.test("rejects non-super-admin", async () => {
  const { deps } = makeFakeDeps({ tables: { platform_admins: { data: null, error: null } } });
  const res = await handle(post({ action: "suspend", target_user_id: "u2" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("change_email rejects a duplicate address", async () => {
  const { deps } = makeFakeDeps({
    tables: { platform_admins: { data: { user_id: "sa" }, error: null } },
    authUsers: [{ id: "u2", email: "old@test.com" }],
    authUsersByEmail: { "taken@test.com": { id: "other" } },
  });
  const res = await handle(post({ action: "change_email", target_user_id: "u2", new_email: "taken@test.com" }), deps);
  assertEquals(res.status, 409);
});

Deno.test("change_email updates + notifies both addresses", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: { platform_admins: { data: { user_id: "sa" }, error: null } },
    authUsers: [{ id: "u2", email: "old@test.com" }],
  });
  const res = await handle(post({ action: "change_email", target_user_id: "u2", new_email: "new@test.com" }), deps);
  assertEquals(res.status, 200);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 2); // old + new
});

Deno.test("delete blocks the last super-admin acting on themselves", async () => {
  const { deps } = makeFakeDeps({
    tables: { platform_admins: { data: [{ user_id: "sa" }], error: null } },
  });
  const res = await handle(post({ action: "delete", target_user_id: "sa" }), deps);
  assertEquals(res.status, 400);
});
```
Extend `FakeDepsOptions`/`makeFakeDeps` so `admin.auth.admin` also exposes `getUserById`, `updateUserById`, `deleteUser`, and lookup-by-email (`authUsersByEmail`), returning recorded results. Add these as the first sub-step of this task.

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/platform-manage-user/`
Expected: FAIL — `./index.ts` not found.

- [ ] **Step 3: Write the handler**

Create `supabase/functions/platform-manage-user/index.ts`:
```ts
import { preflight, json } from "../_shared/http.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

const APP_ORIGIN = "https://app.showflow.pro";
type Action = "change_email" | "send_password_reset" | "suspend" | "unsuspend" | "delete";
interface Body { action: Action; target_user_id: string; new_email?: string }

async function audit(deps: Deps, actor: string, action: string, target: string, detail?: unknown) {
  await deps.admin.from("platform_audit_log").insert({
    actor_user_id: actor, action, target_user_id: target, detail: (detail ?? null) as never,
  });
}

async function isLastSuperAdmin(deps: Deps, userId: string): Promise<boolean> {
  const { data } = await deps.admin.from("platform_admins").select("user_id");
  const rows = (data ?? []) as { user_id: string }[];
  return rows.length <= 1 && rows.some((r) => r.user_id === userId);
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  try {
    const auth = await requireSuperAdmin(deps, req);
    if (!auth.ok) return auth.response;
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.action || !body?.target_user_id) return json({ error: "Invalid payload" }, 400);
    const admin = deps.admin;
    const actor = auth.userId!;
    const target = body.target_user_id;

    if (body.action === "change_email") {
      const newEmail = body.new_email?.trim().toLowerCase();
      if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return json({ error: "Invalid email" }, 400);
      const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 } as never); // see note
      // Prefer a direct lookup: getUserByEmail is not in supabase-js; query auth via admin.
      const { data: current } = await admin.auth.admin.getUserById(target);
      const oldEmail = current?.user?.email ?? "";
      // Reject duplicates by scanning (small scale) or a dedicated RPC get_user_id_by_email.
      const { data: dupId } = await admin.rpc("get_user_id_by_email", { p_email: newEmail });
      if (dupId && dupId !== target) return json({ error: "That email is already in use" }, 409);
      const { error: upErr } = await admin.auth.admin.updateUserById(target, { email: newEmail, email_confirm: true });
      if (upErr) throw upErr;
      if (oldEmail) await deps.sendEmail({ template_name: "account-email-changed", recipient_email: oldEmail, templateData: { oldEmail, newEmail, appOrigin: APP_ORIGIN } });
      await deps.sendEmail({ template_name: "account-email-changed", recipient_email: newEmail, templateData: { oldEmail, newEmail, appOrigin: APP_ORIGIN } });
      await audit(deps, actor, "change_email", target, { oldEmail, newEmail });
      return json({ ok: true });
    }

    if (body.action === "send_password_reset") {
      const { data: u } = await admin.auth.admin.getUserById(target);
      const email = u?.user?.email;
      if (!email) return json({ error: "User has no email" }, 400);
      const { error } = await admin.auth.admin.generateLink({ type: "recovery", email } as never);
      if (error) throw error;
      await audit(deps, actor, "send_password_reset", target);
      return json({ ok: true });
    }

    if (body.action === "suspend" || body.action === "unsuspend") {
      if (body.action === "suspend" && target === actor) return json({ error: "You cannot suspend yourself" }, 400);
      if (body.action === "suspend" && await isLastSuperAdmin(deps, target)) return json({ error: "Cannot suspend the last super-admin" }, 400);
      const { error } = await admin.auth.admin.updateUserById(target, { ban_duration: body.action === "suspend" ? "876000h" : "none" } as never);
      if (error) throw error;
      await audit(deps, actor, body.action, target);
      return json({ ok: true });
    }

    if (body.action === "delete") {
      if (target === actor) return json({ error: "You cannot delete yourself" }, 400);
      if (await isLastSuperAdmin(deps, target)) return json({ error: "Cannot delete the last super-admin" }, 400);
      // anonymize_user guards on auth.uid(): call it with the caller's (super-admin) JWT.
      const authHeader = req.headers.get("Authorization")!;
      const { error: anonErr } = await deps.userClient(authHeader).rpc("anonymize_user", { p_user: target });
      if (anonErr) throw anonErr;
      const { error: delErr } = await admin.auth.admin.deleteUser(target);
      if (delErr) throw delErr;
      await audit(deps, actor, "delete", target);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("platform-manage-user error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```
Note: remove the stray `listUsers` probe line shown above — duplicate detection uses the existing `get_user_id_by_email(p_email text)` RPC (confirmed present in prod). Keep only the `getUserById` call for `oldEmail` and the `get_user_id_by_email` dup check.

- [ ] **Step 4: Add the config.toml block**
```toml
[functions.platform-manage-user]
verify_jwt = true
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/platform-manage-user/`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**
```bash
git add supabase/functions/platform-manage-user supabase/functions/_shared/testing.ts supabase/config.toml
git commit -m "add platform-manage-user edge function (email/reset/suspend/delete)"
```

---

## Task 7: `src/data/platformUsers.ts` data layer

**Files:**
- Create: `src/data/platformUsers.ts`, `src/data/platformUsers.test.ts`

**Interfaces:**
- Consumes: `platform-list-users`, `platform-manage-user` (via `client.functions.invoke`); `platform_set_membership` / `platform_remove_membership` / `platform_link_artist` RPCs; `createInvitation` from `src/data/invitations.ts`.
- Produces:
```ts
export interface PlatformUser { /* mirror of Task 4 response item */ }
export function fetchPlatformUsers(client): Promise<PlatformUser[]>
export function setMembership(client, {orgId,userId,role,action}): Promise<void>
export function removeMembership(client, {orgId,userId}): Promise<void>
export function linkArtist(client, {orgId,userId,artistId}): Promise<void>  // artistId null = unlink
export function manageUser(client, body): Promise<void>   // change_email/send_password_reset/suspend/unsuspend/delete
```

- [ ] **Step 1: Write the failing test**

Create `src/data/platformUsers.test.ts` using `createFakeSupabase` from `src/test/supabaseFake.ts` (seed keys are `rpc:<name>` and `fn:<name>`; assert against `fake.calls`) and `asSupabase` from `src/test/castHelpers.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { setMembership, linkArtist, fetchPlatformUsers } from "./platformUsers";

describe("platformUsers data layer", () => {
  it("setMembership calls the platform RPC with the right params", async () => {
    const fake = createFakeSupabase({ "rpc:platform_set_membership": { data: null, error: null } });
    await setMembership(asSupabase(fake), { orgId: "o1", userId: "u1", role: "producer", action: "add" });
    expect(fake.calls).toContainEqual({ table: "rpc:platform_set_membership", method: "rpc", args: [{ p_org: "o1", p_user: "u1", p_role: "producer", p_action: "add" }] });
  });
  it("linkArtist passes null artistId for unlink", async () => {
    const fake = createFakeSupabase({ "rpc:platform_link_artist": { data: null, error: null } });
    await linkArtist(asSupabase(fake), { orgId: "o1", userId: "u1", artistId: null });
    expect(fake.calls).toContainEqual({ table: "rpc:platform_link_artist", method: "rpc", args: [{ p_org: "o1", p_user: "u1", p_artist_id: null }] });
  });
  it("fetchPlatformUsers reads the edge-function payload", async () => {
    const fake = createFakeSupabase({ "fn:platform-list-users": { data: { users: [{ id: "u1" }] }, error: null } });
    const users = await fetchPlatformUsers(asSupabase(fake));
    expect(users[0].id).toBe("u1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/platformUsers.test.ts`
Expected: FAIL — `./platformUsers` has no such export.

- [ ] **Step 3: Write the data layer**

Create `src/data/platformUsers.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "@/config/app.config";

export interface PlatformUserMembership { org_id: string; org_name: string; roles: AppRole[]; artist: { id: string; name: string } | null }
export interface PlatformUser {
  id: string; email: string | null; display_name: string | null;
  created_at: string; last_sign_in_at: string | null; suspended: boolean;
  memberships: PlatformUserMembership[];
}

export async function fetchPlatformUsers(client: SupabaseClient<Database>): Promise<PlatformUser[]> {
  const { data, error } = await client.functions.invoke("platform-list-users", { body: {} });
  if (error) throw error;
  const payload = data as { error?: string; users?: PlatformUser[] };
  if (payload?.error) throw new Error(payload.error);
  return payload.users ?? [];
}

export async function setMembership(client: SupabaseClient<Database>, a: { orgId: string; userId: string; role: AppRole; action: "add" | "remove" }): Promise<void> {
  const { error } = await client.rpc("platform_set_membership", { p_org: a.orgId, p_user: a.userId, p_role: a.role, p_action: a.action });
  if (error) throw error;
}
export async function removeMembership(client: SupabaseClient<Database>, a: { orgId: string; userId: string }): Promise<void> {
  const { error } = await client.rpc("platform_remove_membership", { p_org: a.orgId, p_user: a.userId });
  if (error) throw error;
}
export async function linkArtist(client: SupabaseClient<Database>, a: { orgId: string; userId: string; artistId: string | null }): Promise<void> {
  const { error } = await client.rpc("platform_link_artist", { p_org: a.orgId, p_user: a.userId, p_artist_id: a.artistId });
  if (error) throw error;
}

export type ManageUserBody =
  | { action: "change_email"; target_user_id: string; new_email: string }
  | { action: "send_password_reset" | "suspend" | "unsuspend" | "delete"; target_user_id: string };

export async function manageUser(client: SupabaseClient<Database>, body: ManageUserBody): Promise<void> {
  const { data, error } = await client.functions.invoke("platform-manage-user", { body });
  if (error) throw error;
  const payload = data as { error?: string };
  if (payload?.error) throw new Error(payload.error);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/data/platformUsers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/data/platformUsers.ts src/data/platformUsers.test.ts
git commit -m "add platformUsers data layer"
```

---

## Task 8: `usePlatformUsers` hooks

**Files:**
- Create: `src/hooks/usePlatformUsers.ts`

**Interfaces:**
- Consumes: `src/data/platformUsers.ts`.
- Produces: `usePlatformUsers()` (query key `['platform','users']`), `useSetMembership()`, `useRemoveMembership()`, `useLinkArtist()`, `useManageUser()`. Every mutation invalidates `['platform','users']` on success.

- [ ] **Step 1: Write the hooks**

Create `src/hooks/usePlatformUsers.ts`:
```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchPlatformUsers, setMembership, removeMembership, linkArtist, manageUser,
  type ManageUserBody,
} from "@/data/platformUsers";
import type { AppRole } from "@/config/app.config";

const KEY = ["platform", "users"] as const;

export function usePlatformUsers() {
  return useQuery({ queryKey: KEY, queryFn: () => fetchPlatformUsers(supabase) });
}

function useInvalidating<T>(fn: (vars: T) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export const useSetMembership = () =>
  useInvalidating((v: { orgId: string; userId: string; role: AppRole; action: "add" | "remove" }) => setMembership(supabase, v));
export const useRemoveMembership = () =>
  useInvalidating((v: { orgId: string; userId: string }) => removeMembership(supabase, v));
export const useLinkArtist = () =>
  useInvalidating((v: { orgId: string; userId: string; artistId: string | null }) => linkArtist(supabase, v));
export const useManageUser = () =>
  useInvalidating((v: ManageUserBody) => manageUser(supabase, v));
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 3: Commit**
```bash
git add src/hooks/usePlatformUsers.ts
git commit -m "add usePlatformUsers hooks"
```

---

## Task 9: `UsersTab` master table + filters

**Files:**
- Create: `src/components/platform/UsersTab.tsx`, `.../UsersTab.test.tsx`

**Interfaces:**
- Consumes: `usePlatformUsers`; opens `UserDetailSheet` (Task 10) with the selected `PlatformUser`.
- Produces: `<UsersTab />`.

- [ ] **Step 1: Write the failing test**

Create `src/components/platform/UsersTab.test.tsx` using `renderWithProviders` from `src/test/renderWithProviders.tsx`; mock `usePlatformUsers` to return two users; assert the table renders both names and that the search box filters. (Follow the existing `OrganizationsTab.test.tsx` mocking style.)
```tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
vi.mock("./UserDetailSheet", () => ({ UserDetailSheet: () => null }));
vi.mock("@/hooks/usePlatformUsers", () => ({
  usePlatformUsers: () => ({ data: [
    { id: "u1", email: "ada@x.com", display_name: "Ada", created_at: "", last_sign_in_at: null, suspended: false, memberships: [] },
    { id: "u2", email: "grace@x.com", display_name: "Grace", created_at: "", last_sign_in_at: null, suspended: true, memberships: [] },
  ], isLoading: false, isError: false }),
}));
import { UsersTab } from "./UsersTab";

describe("UsersTab", () => {
  it("lists users and filters by search", async () => {
    renderWithProviders(<UsersTab />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "grace" } });
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/platform/UsersTab.test.tsx`
Expected: FAIL — no `UsersTab` export.

- [ ] **Step 3: Write the component**

Create `src/components/platform/UsersTab.tsx`: a `useState` selected-user + search string; render `usePlatformUsers()` with `Skeleton` on `isLoading` and `Alert variant="destructive"` on `isError`; a shadcn `Input` for search, a table (name, email, org chips via `Badge`, roles, artist indicator, last sign-in, `Active`/`Suspended` status via `Badge`); row `onClick` sets the selected user; render `<UserDetailSheet user={selected} open={!!selected} onOpenChange={...} />`. Client-side filter across `display_name` + `email`. Use semantic tokens only.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/platform/UsersTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/platform/UsersTab.tsx src/components/platform/UsersTab.test.tsx
git commit -m "add platform UsersTab master table"
```

---

## Task 10: `UserDetailSheet` drawer

**Files:**
- Create: `src/components/platform/UserDetailSheet.tsx`, `.../UserDetailSheet.test.tsx`

**Interfaces:**
- Consumes: `useSetMembership`, `useRemoveMembership`, `useLinkArtist`, `useManageUser`; the org list (`useAllOrgs`/`fetchAllOrgs` from `src/data/platform.ts`) for "Add to organization"; org artists via `fetchArtistsLite(client, orgId)` from `src/data/hireOrders.ts` for the "Link artist" picker.
- Produces: `<UserDetailSheet user={PlatformUser | null} open onOpenChange />`.

- [ ] **Step 1: Write the failing test**

Create `UserDetailSheet.test.tsx`: mock the four hooks with `vi.fn()` mutateAsync spies; render with one user having one membership; assert the login email renders, clicking "Suspend" (through its `AlertDialog` confirm) calls `useManageUser().mutate` with `{ action: "suspend", target_user_id }`, and changing the role select calls `useSetMembership().mutate`. Follow existing Sheet test patterns (`ArtistProfileSheet` tests).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/platform/UserDetailSheet.test.tsx`
Expected: FAIL — no `UserDetailSheet` export.

- [ ] **Step 3: Write the component**

Create `src/components/platform/UserDetailSheet.tsx` using shadcn `Sheet`. Sections exactly as the approved mock:
- **Header:** display name, login email, `Active`/`Suspended` `Badge`, copyable `user_id`, created + last sign-in.
- **Account:** login email with a "Change email" dialog (Input + confirm → `useManageUser().mutate({action:'change_email', target_user_id, new_email})`); "Send reset link" → `manageUser({action:'send_password_reset'})`.
- **Organizations & roles:** one card per `user.memberships`: role `Select` (admin/producer/artist) → `useSetMembership().mutate({orgId,userId,role,action})` (diff old vs new to add/remove); nested Artist link row: current artist name or "none", a picker (`fetchArtistsLite`) → `useLinkArtist().mutate`, and Unlink → `linkArtist({artistId:null})`; "Remove from org" (`AlertDialog`) → `useRemoveMembership()`. "Add to an organization": org `Select` (orgs the user is not already in) + role `Select` → `setMembership(add)`.
- **Danger zone:** Suspend/Unsuspend (`AlertDialog`) → `manageUser`; Delete (`AlertDialog`, typed confirm) → `manageUser({action:'delete'})` then close the sheet.
Each mutation: `onSuccess` toast.success, `onError` toast.error. Semantic tokens; no em dashes.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/platform/UserDetailSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/platform/UserDetailSheet.tsx src/components/platform/UserDetailSheet.test.tsx
git commit -m "add platform UserDetailSheet drawer"
```

---

## Task 11: Wire the Users tab into `PlatformPage`

**Files:**
- Modify: `src/pages/PlatformPage.tsx`

- [ ] **Step 1: Add the tab**

Import `UsersTab`; add `<TabsTrigger value="users">Users</TabsTrigger>` (after Organizations) and `<TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>`. Update the page subtitle to include "users".

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**
```bash
git add src/pages/PlatformPage.tsx
git commit -m "wire Users tab into platform console"
```

---

## Task 12: Close the invite gap + relabel artist email

**Files:**
- Modify: `src/components/platform/OrgInvitePopover.tsx`
- Modify: `src/components/artists/ArtistProfileSheet.tsx`

**Interfaces:**
- Consumes: `createInvitation` from `src/data/invitations.ts`.

- [ ] **Step 1: Write a failing test for the invite form**

In a new `src/components/platform/OrgInvitePopover.test.tsx` (or extend if present), mock `createInvitation`; assert submitting the email + role form invokes it with `{ orgId, email, role }`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/platform/OrgInvitePopover.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the create-invite form**

In `OrgInvitePopover.tsx`, above the pending list, add an email `Input` + role `Select` + Invite `Button` wired to a `useMutation` calling `createInvitation(supabase, { orgId, email, role })`; on success invalidate `["platform","org-invites",orgId]` and toast. No em dashes.

- [ ] **Step 4: Relabel the artist email field**

In `ArtistProfileSheet.tsx`, change the email field label to `Booking / contact email` and add helper text `Separate from the login account` near it (the login account is already shown by `LinkedAccountPanel`).

- [ ] **Step 5: Run tests + lint**

Run: `npx vitest run src/components/platform/OrgInvitePopover.test.tsx && npm run lint`
Expected: PASS + clean.

- [ ] **Step 6: Commit**
```bash
git add src/components/platform/OrgInvitePopover.tsx src/components/platform/OrgInvitePopover.test.tsx src/components/artists/ArtistProfileSheet.tsx
git commit -m "add super-admin invite form + clarify artist booking email label"
```

---

## Task 13: Full verification + deploy readiness

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend suite**

Run: `npx vitest run`
Expected: all green (existing count + the new tests).

- [ ] **Step 2: Lint + typecheck the whole repo**

Run: `npm run lint && npx tsc --noEmit`
Expected: zero warnings/errors.

- [ ] **Step 3: Run the whole edge-function Deno suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: all green (the two new functions + unchanged others; the shared `testing.ts` extensions did not regress existing tests).

- [ ] **Step 4: Run the DB tests**

Run: `supabase test db` (or execute each new pgTAP file via the Supabase MCP wrapped in `BEGIN; ... ROLLBACK;`).
Expected: `platform_user_rpcs.sql` (9) and `platform_audit_log.sql` (3) pass.

- [ ] **Step 5: Confirm deploy wiring**

Verify `supabase/config.toml` has both `[functions.platform-list-users]` and `[functions.platform-manage-user]` with `verify_jwt = true`. Edge functions auto-deploy on merge to `main`; migrations are already applied via `apply_migration`. No changelog entry (super-admin surface).

- [ ] **Step 6: Update the system map**

If any automation trigger changed — it did not here (no new cron/trigger), so confirm `docs/system-map.md` needs no edit and note that in the PR description.

- [ ] **Step 7: Final commit / open PR**
```bash
git add -A && git commit -m "verify platform user management console" --allow-empty
```
Open a PR from `claude/admin-user-assignment-8fd641` summarizing the console + the hire-order re-link fix; call out that it ships dark (super-admin only).

---

## Self-review notes (author)

- **Spec coverage:** roster read (T4), roles/membership (T2), artist re-link + bug regression (T3), email change immediate+notify (T5/T6), password reset/suspend/delete (T6), invite-any-org + gap close (T12), audit log (T1, written by every RPC/handler), guardrails last-admin (T2) / last-super-admin + self (T6), placement (T11), relabel (T12), tests across all layers (each task + T13). All spec sections map to a task.
- **Verified against prod:** frontend fake factory is `createFakeSupabase(seed)` with `.calls` + `rpc:`/`fn:` seed keys (T7); `get_user_id_by_email(p_email text)` and `is_super_admin(_uid uuid)` both exist; `renderWithProviders` is the test wrapper; `fetchArtistsLite` (hireOrders.ts) and `fetchAllOrgs` (platform.ts) exist for the drawer pickers.
- **The one real extension needed:** `makeFakeDeps`/`FakeDepsOptions` in `_shared/testing.ts` must gain an `authUsers` (+ `authUsersByEmail`) option and a fake `admin.auth.admin` (`listUsers`/`getUserById`/`updateUserById`/`deleteUser`/`generateLink`). This is the first sub-step of Tasks 4 and 6, committed with them.
