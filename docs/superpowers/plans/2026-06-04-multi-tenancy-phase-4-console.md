# Multi-Tenancy Phase 4 — Platform Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the super-admin platform console at `/platform` — provision orgs (with first-admin account bootstrap), god-mode "enter any org", suspend/reactivate, per-org usage metrics, and platform-level self-service (edit org, manage platform admins, edit platform defaults + starter catalog, first-admin invite lifecycle) — then scope catalog read keys per-org and promote `dev → main`.

**Architecture:** Pooled multi-tenancy (one DB + RLS) already exists (Phases 0–3). Phase 4 adds platform-layer RPCs (`provision_org`, `platform_org_stats`, `add/remove/list_platform_admin`) that are `SECURITY DEFINER` and gated by `is_super_admin(auth.uid())`; a super-admin-guarded `provision-org` edge function that bootstraps the first admin's auth account; an org-aware `AuthContext` that exposes `isSuperAdmin` and lists **all** orgs for super-admins (god-mode = the existing switcher); a `/platform` route behind a new `PlatformRoute` gate; and a console UI (Organizations / Platform Admins / Platform Defaults). Isolation is unchanged — every new read path is super-admin-gated.

**Tech Stack:** React 18 + Vite + TS, Tailwind + shadcn/ui, `@tanstack/react-query` v5, `react-hook-form` + `zod`, Supabase (Postgres + RLS + Edge Functions/Deno), Vitest + jsdom, pgTAP, Deno test, Playwright.

---

## Spec

This plan implements **§8 / §8.1 / §11 (Phase 4)** of [`docs/superpowers/specs/2026-06-03-multi-tenancy-design.md`](../specs/2026-06-03-multi-tenancy-design.md). Read §8.1 ("Phase-4 implementation decisions") before starting.

## Branch

All work lands on `feature/multi-tenancy-phase-4-console` (already created), PR'd into `dev` (squash merge `… (#NN)`). Part 9 (`dev → main`) is a **separate** PR.

## Environment & how tests run (READ THIS)

**No Node / supabase-CLI / Docker locally — only Deno.** That means:

- **Deno tests** (edge functions, `_shared/*`) run locally: `deno test --allow-all <path>`.
- **Vitest, pgTAP (`supabase test db`), Playwright, and `tsc` Typecheck run in CI only.** The oracle is `gh pr checks <PR#>`. Workflow: write the failing test → push → CI shows red → implement → push → CI shows green.
- Every "Run:" step below gives the command and expected result. For non-Deno layers, "Expected: FAIL/PASS" is what you should see **in CI** after pushing, not locally.
- **`types.ts` regeneration** uses the Supabase MCP `generate_typescript_types` against the **PR's Supabase preview branch ref** (there is no persistent `dev` preview branch). It is required after Part 1's migration, because later parts call new RPCs that must be typed.

## Conventions to follow

- Data access lives in `src/data/<domain>.ts` as `fn(client, args)`; hooks/components pass the `supabase` singleton. Test with `src/test/supabaseFake.ts` (`createFakeSupabase`) + `renderWithProviders`.
- Edge functions: `export async function handle(req, deps)` + `if (import.meta.main) Deno.serve((req) => handle(req, realDeps()))`. Use `_shared/http.ts` (`json`/`preflight`) and `_shared/auth.ts`. Test with `makeFakeDeps` + `makeRequest` from `_shared/testing.ts`.
- Query keys: hierarchical, prefix-invalidate. New platform keys use the `['platform', …]` prefix.
- Styling: semantic tokens only; mirror `AdminPage.tsx` (Card + bordered rows) and `InvitesTab.tsx`.
- Migrations: one new file via the migration tool's naming; never hand-edit `types.ts`.

---

## Task overview

1. **DB migration + pgTAP** — `provision_org`, `platform_org_stats`, `add/remove/list_platform_admin`; regen `types.ts`.
2. **Edge layer** — `requireSuperAdmin` + super-admin bypass in `requireOrgRole`; `provision-org` (with account bootstrap); `resend-invitation`; config + Deno tests.
3. **Data access** — `src/data/platform.ts` + Vitest.
4. **AuthContext god-mode** — `isSuperAdmin`, all-orgs switcher, `hasRole` short-circuit + Vitest.
5. **Routing & nav** — `ROUTES.PLATFORM`, `PlatformRoute`, `ProtectedRoute` exemptions, `App.tsx`, sidebar item + Vitest.
6. **Console: Organizations tab** — stats table, new-org dialog, enter/suspend/edit, invite lifecycle + Vitest.
7. **Console: Platform Admins + Platform Defaults tabs** + Vitest.
8. **Catalog read query-key org-scoping** + Vitest.
9. **E2E** — Playwright `platform-console.spec.ts`.
10. **dev → main promotion** (separate PR).

---

## Task 1: DB migration — platform RPCs (test-first with pgTAP)

**Files:**
- Test: `supabase/tests/db/platform_console.sql`
- Create: `supabase/migrations/20260604140000_phase4_platform_console.sql`
- Regen: `src/integrations/supabase/types.ts` (via Supabase MCP)

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/db/platform_console.sql`:

```sql
-- Phase 4 platform RPCs: provision_org (atomic + super-admin only), platform_org_stats
-- (super-admin only), add/remove/list_platform_admin (last-admin + self-demote guards).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

-- ── Seed two auth users (super sA, normal sN) + a target user for add_platform_admin.
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000a1','authenticated','authenticated','super@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000a2','authenticated','authenticated','normal@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000a3','authenticated','authenticated','promote@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-0000-4000-a000-0000000000a1');
-- Deterministic starter template so seed counts are exact (overrides the migration seed).
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL,'starter_catalog_template','{"skills":["Vocals","Dance"],"cities":[],"casts":[{"name":"Main Cast","description":null}]}'::jsonb)
ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value;
SET session_replication_role = DEFAULT;

-- Helper to act as a given uid.
CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- ── provision_org: super-admin succeeds, atomically creating org + catalog + invite.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.provision_org('Acme Circus','acme','first-admin@acme.com')$$,
  'super-admin can provision an org');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.organizations WHERE slug='acme'),1,'org row created');
SELECT is((SELECT count(*)::int FROM public.skills s JOIN public.organizations o ON o.id=s.org_id WHERE o.slug='acme'),2,'starter skills seeded into org');
SELECT is((SELECT count(*)::int FROM public.org_invitations i JOIN public.organizations o ON o.id=i.org_id WHERE o.slug='acme' AND i.email='first-admin@acme.com' AND i.role='admin'),1,'first-admin invitation created');

-- ── provision_org: duplicate slug rejected (unique_violation).
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.provision_org('Acme Two','acme','x@acme.com')$$,
  '23505', NULL, 'duplicate slug is rejected');
RESET ROLE;

-- ── provision_org: non-super-admin forbidden.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a2');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.provision_org('Nope','nope','y@nope.com')$$,
  '42501', NULL, 'non-super-admin cannot provision');
RESET ROLE;

-- ── platform_org_stats: super-admin sees the org; non-super-admin is forbidden.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.platform_org_stats() WHERE slug='acme'),1,'super-admin sees org stats');
SELECT is((SELECT member_count FROM public.platform_org_stats() WHERE slug='acme'),0,'new org has 0 members');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.platform_org_stats()$$,'42501',NULL,'non-super-admin cannot read stats');
RESET ROLE;

-- ── add/remove/list_platform_admin guards.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.add_platform_admin('promote@test.com')$$,'super-admin can promote by email');
SELECT throws_ok($$SELECT public.remove_platform_admin('aaaaaaaa-0000-4000-a000-0000000000a1'::uuid)$$,
  '42501', NULL, 'cannot remove your own platform-admin access');
-- now there are 2 admins (a1, a3); removing the OTHER is allowed.
SELECT lives_ok($$SELECT public.remove_platform_admin('aaaaaaaa-0000-4000-a000-0000000000a3'::uuid)$$,'can remove a non-self admin when >1 remain');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test — expect FAIL (functions do not exist)**

Run (CI): `supabase test db` (push to the PR; read `gh pr checks <PR#>`).
Expected: FAIL — `function public.provision_org(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260604140000_phase4_platform_console.sql`:

```sql
-- Phase 4: platform console RPCs. All SECURITY DEFINER + is_super_admin-gated.
-- provision_org is atomic (one function = one txn): org + starter catalog + first-admin invite.

-- ── provision_org: create an org, seed its catalog, create the first-admin invite.
-- Returns { org_id, token }. auth.uid() must be a platform admin (call via the user's JWT).
create or replace function public.provision_org(
  p_name text, p_slug text, p_admin_email text, p_role app_role default 'admin'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_token text; v_uid uuid := auth.uid();
begin
  if not public.is_super_admin(v_uid) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name),'') = '' or coalesce(btrim(p_slug),'') = '' or coalesce(btrim(p_admin_email),'') = '' then
    raise exception 'name, slug and admin_email are required' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), v_uid)
  returning id into v_org;            -- duplicate slug bubbles up as 23505

  perform public.seed_org_starter_catalog(v_org);

  insert into public.org_invitations (org_id, email, role, invited_by)
  values (v_org, lower(btrim(p_admin_email)), p_role, v_uid)
  returning token into v_token;

  return jsonb_build_object('org_id', v_org, 'token', v_token);
end;
$$;
revoke all on function public.provision_org(text,text,text,app_role) from public, anon;
grant execute on function public.provision_org(text,text,text,app_role) to authenticated;

-- ── platform_org_stats: one row per org (super-admin only). The only cross-tenant read.
create or replace function public.platform_org_stats()
returns table (
  org_id uuid, name text, slug text, status text,
  member_count int, active_artist_count int, bookings_30d int, last_activity_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  return query
    select
      o.id, o.name, o.slug, o.status,
      (select count(distinct m.user_id)::int from public.org_memberships m where m.org_id = o.id),
      (select count(*)::int from public.artists a where a.org_id = o.id and a.status = 'active'),
      (select count(*)::int from public.bookings b where b.org_id = o.id and b.created_at >= now() - interval '30 days'),
      greatest(
        (select max(b.created_at)  from public.bookings b      where b.org_id  = o.id),
        (select max(sd.created_at) from public.show_dates sd    where sd.org_id = o.id),
        (select max(cm.created_at) from public.chat_messages cm where cm.org_id = o.id)
      )
    from public.organizations o
    order by o.created_at desc;
end;
$$;
revoke all on function public.platform_org_stats() from public, anon;
grant execute on function public.platform_org_stats() to authenticated;

-- ── Manage platform admins (super-admin only) with last-admin + self-demote guards.
create or replace function public.add_platform_admin(p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_caller uuid := auth.uid();
begin
  if not public.is_super_admin(v_caller) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then
    raise exception 'No user with that email' using errcode = 'P0002';
  end if;
  insert into public.platform_admins (user_id) values (v_uid) on conflict (user_id) do nothing;
  return v_uid;
end;
$$;
revoke all on function public.add_platform_admin(text) from public, anon;
grant execute on function public.add_platform_admin(text) to authenticated;

create or replace function public.remove_platform_admin(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.is_super_admin(v_caller) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  if p_user_id = v_caller then
    raise exception 'You cannot remove your own platform-admin access' using errcode = '42501';
  end if;
  if (select count(*) from public.platform_admins) <= 1 then
    raise exception 'Cannot remove the last platform admin' using errcode = '42501';
  end if;
  delete from public.platform_admins where user_id = p_user_id;
end;
$$;
revoke all on function public.remove_platform_admin(uuid) from public, anon;
grant execute on function public.remove_platform_admin(uuid) to authenticated;

create or replace function public.list_platform_admins()
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  return query
    select pa.user_id, u.email::text, pa.created_at
    from public.platform_admins pa join auth.users u on u.id = pa.user_id
    order by pa.created_at;
end;
$$;
revoke all on function public.list_platform_admins() from public, anon;
grant execute on function public.list_platform_admins() to authenticated;
```

- [ ] **Step 4: Run the test — expect PASS**

Run (CI): `supabase test db`.
Expected: PASS — 12 assertions in `platform_console.sql` green; `org_id_parent_child_consistency.sql` + `seed_and_catalog_isolation.sql` still green.

- [ ] **Step 5: Regenerate `types.ts` from the PR's Supabase preview branch**

After the migration is pushed and the PR's preview branch builds, use the Supabase MCP `generate_typescript_types` with the **preview branch ref** for this PR, and write the result to `src/integrations/supabase/types.ts` (never hand-edit). This makes `rpc('provision_org' | 'platform_org_stats' | 'add_platform_admin' | 'remove_platform_admin' | 'list_platform_admins')` typed for later parts.

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/db/platform_console.sql supabase/migrations/20260604140000_phase4_platform_console.sql src/integrations/supabase/types.ts
git commit -m "feat(db): phase 4 platform console rpcs"
```

---

## Task 2: Edge layer — super-admin auth, provision-org, resend-invitation

**Files:**
- Modify: `supabase/functions/_shared/auth.ts` (add `requireSuperAdmin`; super-admin bypass in `requireOrgRole`)
- Modify: `supabase/functions/_shared/testing.ts` (fake `auth.admin.inviteUserByEmail`)
- Test: `supabase/functions/_shared/requireSuperAdmin.test.ts`
- Create: `supabase/functions/provision-org/index.ts`
- Test: `supabase/functions/provision-org/index.di.test.ts`
- Create: `supabase/functions/resend-invitation/index.ts`
- Test: `supabase/functions/resend-invitation/index.di.test.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write the failing Deno test for `requireSuperAdmin`**

Create `supabase/functions/_shared/requireSuperAdmin.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requireSuperAdmin } from "./auth.ts";
import { makeFakeDeps, makeRequest } from "./testing.ts";

Deno.test("requireSuperAdmin: 401 without bearer", async () => {
  const { deps } = makeFakeDeps({});
  const out = await requireSuperAdmin(deps, makeRequest({ headers: {} }));
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 401);
});

Deno.test("requireSuperAdmin: 403 when not a platform admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: null, error: null } },
  });
  const out = await requireSuperAdmin(deps, makeRequest({ headers: { Authorization: "Bearer x" } }));
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 403);
});

Deno.test("requireSuperAdmin: ok for a platform admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
  });
  const out = await requireSuperAdmin(deps, makeRequest({ headers: { Authorization: "Bearer x" } }));
  assertEquals(out.ok, true);
  if (out.ok) assertEquals(out.userId, "u1");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `deno test --allow-all supabase/functions/_shared/requireSuperAdmin.test.ts`
Expected: FAIL — `requireSuperAdmin is not a function`.

- [ ] **Step 3: Implement `requireSuperAdmin` + super-admin bypass in `requireOrgRole`**

In `supabase/functions/_shared/auth.ts`, append `requireSuperAdmin`:

```ts
/**
 * Validate a user JWT and require the caller to be a platform admin (super-admin).
 * Used by /platform edge endpoints (provision-org).
 */
export async function requireSuperAdmin(deps: Deps, req: Request): Promise<AuthOutcome> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
  const { data: { user }, error } = await deps.userClient(authHeader).auth.getUser();
  if (error || !user) return { ok: false, response: json({ error: "Unauthorized" }, 401) };

  const { data: row } = await deps.admin
    .from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!row) return { ok: false, response: json({ error: "Forbidden" }, 403) };

  return { ok: true, userId: user.id };
}
```

Then make `requireOrgRole` short-circuit for super-admins so god-mode works on org-scoped endpoints. Replace its membership lookup block:

```ts
  const { data: { user }, error } = await deps.userClient(authHeader).auth.getUser();
  if (error || !user) return { ok: false, response: json({ error: "Unauthorized" }, 401) };

  // Platform admins pass every org gate (mirrors the SQL is_super_admin short-circuit).
  const { data: superRow } = await deps.admin
    .from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (superRow) return { ok: true, userId: user.id };

  const { data: roleRow } = await deps.admin
    .from("org_memberships").select("role")
    .eq("user_id", user.id).eq("org_id", orgId).in("role", roles).limit(1).maybeSingle();
  if (!roleRow) return { ok: false, response: json({ error: "Forbidden" }, 403) };

  return { ok: true, userId: user.id };
```

- [ ] **Step 4: Run — expect PASS**

Run: `deno test --allow-all supabase/functions/_shared/requireSuperAdmin.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `inviteUserByEmail` to the fake admin client**

In `supabase/functions/_shared/testing.ts`, extend `FakeClientOptions` and the fake `auth.admin`:

In `FakeClientOptions` add:
```ts
  /** Seeded result for auth.admin.inviteUserByEmail (default: a new user). */
  inviteResult?: { data?: unknown; error?: unknown };
```

In `createFakeClient`, inside `auth.admin`, add after `listUsers`:
```ts
        inviteUserByEmail: (email: string, _opts?: unknown) =>
          Promise.resolve(opts.inviteResult ?? { data: { user: { id: "invited", email } }, error: null }),
```

- [ ] **Step 6: Write the failing Deno test for `provision-org`**

Create `supabase/functions/provision-org/index.di.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const body = { name: "Acme", slug: "acme", admin_email: "a@acme.com", role: "admin", app_origin: "https://app.test" };

Deno.test("provision-org: 403 for non-super-admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: null, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 403);
});

Deno.test("provision-org: net-new admin → RPC + inviteUserByEmail, returns org_id", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: {}, // no existing user with that email → invite path
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).org_id, "org-9");
  // net-new path does NOT send our org-invitation email (Supabase invite handles it)
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
});

Deno.test("provision-org: existing admin → sends org-invitation email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: { u2: { email: "a@acme.com" } }, // existing user → email path
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
});

Deno.test("provision-org: 409 on duplicate slug", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: null, error: { code: "23505", message: "duplicate key" } } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 409);
});
```

- [ ] **Step 7: Implement `provision-org`**

Create `supabase/functions/provision-org/index.ts`:

```ts
import { preflight, json } from "../_shared/http.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Body = {
  name: string;
  slug: string;
  admin_email: string;
  role?: "admin" | "producer" | "artist";
  app_origin: string;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const name = body?.name?.trim();
    const slug = body?.slug?.trim().toLowerCase();
    const email = body?.admin_email?.trim().toLowerCase();
    const role = body?.role ?? "admin";
    const appOrigin = body?.app_origin?.replace(/\/$/, "");
    if (!name || !slug || !email || !appOrigin) return json({ error: "Invalid payload" }, 400);
    if (!["admin", "producer", "artist"].includes(role)) return json({ error: "Invalid role" }, 400);

    const auth = await requireSuperAdmin(deps, req);
    if (!auth.ok) return auth.response;

    // Atomic DB work runs as the caller (auth.uid() = the super-admin) so provision_org's
    // internal is_super_admin check passes; SECURITY DEFINER does the privileged inserts.
    const authHeader = req.headers.get("Authorization")!;
    const { data, error } = await deps.userClient(authHeader)
      .rpc("provision_org", { p_name: name, p_slug: slug, p_admin_email: email, p_role: role });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return json({ error: "That slug is already taken" }, 409);
      return json({ error: (error as Error).message ?? "Could not provision org" }, 500);
    }
    const { org_id, token } = data as { org_id: string; token: string };
    const acceptUrl = `${appOrigin}/accept-invite?token=${token}`;

    // Bootstrap the first admin's account so they can authenticate + accept.
    try {
      const { data: list } = await deps.admin.auth.admin.listUsers();
      const exists = (list?.users ?? []).some((u: { email?: string }) => u.email?.toLowerCase() === email);
      if (!exists) {
        // Net-new: Supabase invite email carries a magic link → redirect to accept-invite.
        await deps.admin.auth.admin.inviteUserByEmail(email, { redirectTo: acceptUrl });
      } else {
        // Existing user: send our branded org-invitation email with the accept link.
        const inviter = auth.userId ? await deps.admin.auth.admin.getUserById(auth.userId) : null;
        await deps.sendEmail({
          template_name: "org-invitation",
          recipient_email: email,
          templateData: { orgName: name, role, token, inviterEmail: inviter?.data?.user?.email ?? undefined },
          idempotency_key: `org-invitation-${org_id}`,
        });
      }
    } catch (e) {
      console.error("provision-org: invite delivery failed", (e as Error).message);
    }

    return json({ org_id });
  } catch (e) {
    console.error("provision-org error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 8: Run — expect PASS**

Run: `deno test --allow-all supabase/functions/provision-org/index.di.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Write the failing Deno test for `resend-invitation`**

Create `supabase/functions/resend-invitation/index.di.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

Deno.test("resend-invitation: super-admin re-sends the invite email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: { data: { id: "inv1", org_id: "org1", email: "a@acme.com", role: "admin", token: "tok", status: "pending" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "inv1" } }), deps);
  assertEquals(res.status, 200);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
});

Deno.test("resend-invitation: 404 for unknown invitation", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: { data: null, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { invitation_id: "nope" } }), deps);
  assertEquals(res.status, 404);
});
```

- [ ] **Step 10: Implement `resend-invitation`**

Create `supabase/functions/resend-invitation/index.ts`:

```ts
import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Body = { invitation_id: string };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.invitation_id) return json({ error: "Invalid payload" }, 400);

    const { data: invite } = await deps.admin
      .from("org_invitations")
      .select("id, org_id, email, role, token, status")
      .eq("id", body.invitation_id)
      .maybeSingle();
    if (!invite) return json({ error: "Invitation not found" }, 404);
    if (invite.status !== "pending") return json({ error: "Invitation is not pending" }, 409);

    // Org admin OR platform admin (requireOrgRole short-circuits for super-admins).
    const auth = await requireOrgRole(deps, req, invite.org_id, ["admin"]);
    if (!auth.ok) return auth.response;

    const { data: org } = await deps.admin
      .from("organizations").select("name").eq("id", invite.org_id).maybeSingle();
    await deps.sendEmail({
      template_name: "org-invitation",
      recipient_email: invite.email,
      templateData: { orgName: org?.name ?? undefined, role: invite.role, token: invite.token },
      idempotency_key: `org-invitation-resend-${invite.id}-${Date.now()}`,
    });

    return json({ ok: true });
  } catch (e) {
    console.error("resend-invitation error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 11: Run — expect PASS**

Run: `deno test --allow-all supabase/functions/resend-invitation/index.di.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 12: Register both functions in `config.toml`**

In `supabase/config.toml`, add:

```toml
[functions.provision-org]
verify_jwt = true

[functions.resend-invitation]
verify_jwt = true
```

- [ ] **Step 13: Commit**

```bash
git add supabase/functions/_shared/auth.ts supabase/functions/_shared/testing.ts supabase/functions/_shared/requireSuperAdmin.test.ts supabase/functions/provision-org/ supabase/functions/resend-invitation/ supabase/config.toml
git commit -m "feat(edge): provision-org + resend-invitation + super-admin auth"
```

---

## Task 3: Data access — `src/data/platform.ts`

**Files:**
- Create: `src/data/platform.ts`
- Test: `src/data/platform.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/data/platform.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  fetchIsSuperAdmin, fetchAllOrgs, fetchPlatformOrgStats, provisionOrg,
  setOrgStatus, updateOrg, fetchPlatformAdmins, addPlatformAdmin,
  removePlatformAdmin, resendInvitation, savePlatformSetting,
} from "./platform";

describe("data/platform", () => {
  it("fetchIsSuperAdmin calls the rpc and returns the boolean", async () => {
    const fake = createFakeSupabase({ "rpc:is_super_admin": { data: true, error: null } });
    expect(await fetchIsSuperAdmin(fake as never, "u1")).toBe(true);
    expect(fake.calls).toContainEqual({ table: "rpc:is_super_admin", method: "rpc", args: [{ _uid: "u1" }] });
  });

  it("fetchAllOrgs reads organizations ordered by name", async () => {
    const rows = [{ id: "o1", name: "A", slug: "a", status: "active" }];
    const fake = createFakeSupabase({ organizations: { data: rows, error: null } });
    expect(await fetchAllOrgs(fake as never)).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "organizations", method: "order", args: ["name"] });
  });

  it("fetchPlatformOrgStats calls the rpc", async () => {
    const stats = [{ org_id: "o1", name: "A", slug: "a", status: "active", member_count: 1, active_artist_count: 0, bookings_30d: 0, last_activity_at: null }];
    const fake = createFakeSupabase({ "rpc:platform_org_stats": { data: stats, error: null } });
    expect(await fetchPlatformOrgStats(fake as never)).toEqual(stats);
  });

  it("provisionOrg invokes the edge function with the mapped body and returns org_id", async () => {
    const fake = createFakeSupabase({ "fn:provision-org": { data: { org_id: "o9" }, error: null } });
    const id = await provisionOrg(fake as never, { name: "Acme", slug: "acme", adminEmail: "a@acme.com", appOrigin: "https://app.test" });
    expect(id).toBe("o9");
    expect(fake.calls).toContainEqual({ table: "fn:provision-org", method: "invoke", args: [{ name: "Acme", slug: "acme", admin_email: "a@acme.com", role: "admin", app_origin: "https://app.test" }] });
  });

  it("setOrgStatus updates organizations.status by id", async () => {
    const fake = createFakeSupabase({ organizations: { data: null, error: null } });
    await setOrgStatus(fake as never, "o1", "suspended");
    expect(fake.calls).toContainEqual({ table: "organizations", method: "update", args: [{ status: "suspended" }] });
    expect(fake.calls).toContainEqual({ table: "organizations", method: "eq", args: ["id", "o1"] });
  });

  it("updateOrg patches name/slug by id", async () => {
    const fake = createFakeSupabase({ organizations: { data: null, error: null } });
    await updateOrg(fake as never, "o1", { name: "New", slug: "new" });
    expect(fake.calls).toContainEqual({ table: "organizations", method: "update", args: [{ name: "New", slug: "new" }] });
  });

  it("addPlatformAdmin / removePlatformAdmin / fetchPlatformAdmins call their rpcs", async () => {
    const fake = createFakeSupabase({
      "rpc:add_platform_admin": { data: "u2", error: null },
      "rpc:remove_platform_admin": { data: null, error: null },
      "rpc:list_platform_admins": { data: [{ user_id: "u1", email: "a@b.c", created_at: "t" }], error: null },
    });
    await addPlatformAdmin(fake as never, "a@b.c");
    await removePlatformAdmin(fake as never, "u2");
    expect(await fetchPlatformAdmins(fake as never)).toHaveLength(1);
    expect(fake.calls).toContainEqual({ table: "rpc:add_platform_admin", method: "rpc", args: [{ p_email: "a@b.c" }] });
    expect(fake.calls).toContainEqual({ table: "rpc:remove_platform_admin", method: "rpc", args: [{ p_user_id: "u2" }] });
  });

  it("resendInvitation invokes the edge function", async () => {
    const fake = createFakeSupabase({ "fn:resend-invitation": { data: { ok: true }, error: null } });
    await resendInvitation(fake as never, "inv1");
    expect(fake.calls).toContainEqual({ table: "fn:resend-invitation", method: "invoke", args: [{ invitation_id: "inv1" }] });
  });

  it("savePlatformSetting upserts a NULL-org row", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    await savePlatformSetting(fake as never, "starter_catalog_template", { skills: [] } as never);
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "upsert", args: [{ org_id: null, key: "starter_catalog_template", value: { skills: [] } }, { onConflict: "org_id,key" }] });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run (CI): `npx vitest run src/data/platform.test.ts`
Expected: FAIL — `./platform` has no such exports.

- [ ] **Step 3: Implement `src/data/platform.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Organization } from "@/data/orgs";
import type { AppRole } from "@/config/app.config";

export interface OrgStat {
  org_id: string;
  name: string;
  slug: string;
  status: string;
  member_count: number;
  active_artist_count: number;
  bookings_30d: number;
  last_activity_at: string | null;
}

export interface PlatformAdmin {
  user_id: string;
  email: string;
  created_at: string;
}

export interface StarterCatalogTemplate {
  skills: string[];
  cities: string[];
  casts: { name: string; description: string | null }[];
}

export const EMPTY_STARTER_TEMPLATE: StarterCatalogTemplate = { skills: [], cities: [], casts: [] };

/** True if the user is a platform (super) admin. */
export async function fetchIsSuperAdmin(client: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data, error } = await client.rpc("is_super_admin", { _uid: userId });
  if (error) throw error;
  return data === true;
}

/** Every organization (super-admin only; RLS short-circuits is_org_member). */
export async function fetchAllOrgs(client: SupabaseClient<Database>): Promise<Organization[]> {
  const { data, error } = await client.from("organizations").select("id, name, slug, status").order("name");
  if (error) throw error;
  return (data ?? []) as Organization[];
}

/** Per-org usage metrics (super-admin only). */
export async function fetchPlatformOrgStats(client: SupabaseClient<Database>): Promise<OrgStat[]> {
  const { data, error } = await client.rpc("platform_org_stats");
  if (error) throw error;
  return (data ?? []) as unknown as OrgStat[];
}

/** Provision a new org + seed catalog + invite first admin (super-admin only). Returns org_id. */
export async function provisionOrg(
  client: SupabaseClient<Database>,
  args: { name: string; slug: string; adminEmail: string; role?: AppRole; appOrigin: string },
): Promise<string> {
  const { data, error } = await client.functions.invoke("provision-org", {
    body: { name: args.name, slug: args.slug, admin_email: args.adminEmail, role: args.role ?? "admin", app_origin: args.appOrigin },
  });
  if (error) throw error;
  const payload = data as { error?: string; org_id?: string };
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.org_id) throw new Error("Org was not created");
  return payload.org_id;
}

/** Suspend / reactivate an org (super-admin only via organizations RLS). */
export async function setOrgStatus(client: SupabaseClient<Database>, orgId: string, status: "active" | "suspended"): Promise<void> {
  const { error } = await client.from("organizations").update({ status }).eq("id", orgId);
  if (error) throw error;
}

/** Edit an org's name / slug (super-admin only). */
export async function updateOrg(client: SupabaseClient<Database>, orgId: string, patch: { name?: string; slug?: string }): Promise<void> {
  const { error } = await client.from("organizations").update(patch).eq("id", orgId);
  if (error) throw error;
}

export async function fetchPlatformAdmins(client: SupabaseClient<Database>): Promise<PlatformAdmin[]> {
  const { data, error } = await client.rpc("list_platform_admins");
  if (error) throw error;
  return (data ?? []) as unknown as PlatformAdmin[];
}

export async function addPlatformAdmin(client: SupabaseClient<Database>, email: string): Promise<void> {
  const { error } = await client.rpc("add_platform_admin", { p_email: email });
  if (error) throw error;
}

export async function removePlatformAdmin(client: SupabaseClient<Database>, userId: string): Promise<void> {
  const { error } = await client.rpc("remove_platform_admin", { p_user_id: userId });
  if (error) throw error;
}

/** Re-send a first-admin invitation email. */
export async function resendInvitation(client: SupabaseClient<Database>, invitationId: string): Promise<void> {
  const { error } = await client.functions.invoke("resend-invitation", { body: { invitation_id: invitationId } });
  if (error) throw error;
}

/** Upsert a platform-default setting (org_id IS NULL). Super-admin only via app_settings RLS. */
export async function savePlatformSetting(client: SupabaseClient<Database>, key: string, value: Json): Promise<void> {
  const { error } = await client.from("app_settings").upsert({ org_id: null, key, value }, { onConflict: "org_id,key" });
  if (error) throw error;
}
```

- [ ] **Step 4: Run — expect PASS**

Run (CI): `npx vitest run src/data/platform.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/platform.ts src/data/platform.test.ts
git commit -m "feat(data): platform console data-access layer"
```

---

## Task 4: AuthContext god-mode (isSuperAdmin + all-orgs switcher)

**Files:**
- Modify: `src/features/auth/orgRoles.ts` (pure helpers)
- Test: `src/features/auth/orgRoles.test.ts`
- Modify: `src/features/auth/AuthContext.tsx`

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `src/features/auth/orgRoles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rolesForOrg, effectiveHasRole, effectiveOrgs } from "./orgRoles";

describe("rolesForOrg", () => {
  it("returns only the roles for the given org", () => {
    const m = [{ org_id: "a", role: "admin" as const }, { org_id: "b", role: "artist" as const }];
    expect(rolesForOrg(m, "a")).toEqual(["admin"]);
    expect(rolesForOrg(m, null)).toEqual([]);
  });
});

describe("effectiveHasRole", () => {
  const base = { isSuperAdmin: false, viewAsUser: null, viewAsRole: null, roles: ["producer" as const] };
  it("uses real roles when nothing overrides", () => {
    expect(effectiveHasRole({ ...base, role: "producer" })).toBe(true);
    expect(effectiveHasRole({ ...base, role: "admin" })).toBe(false);
  });
  it("super-admin sees every role", () => {
    expect(effectiveHasRole({ ...base, isSuperAdmin: true, roles: [], role: "admin" })).toBe(true);
  });
  it("editor view-as overrides win over super-admin", () => {
    expect(effectiveHasRole({ ...base, isSuperAdmin: true, viewAsRole: "artist", role: "admin" })).toBe(false);
    expect(effectiveHasRole({ ...base, isSuperAdmin: true, viewAsRole: "artist", role: "artist" })).toBe(true);
    expect(effectiveHasRole({ ...base, isSuperAdmin: true, viewAsUser: { roles: ["producer"] }, role: "admin" })).toBe(false);
  });
});

describe("effectiveOrgs", () => {
  const all = [{ id: "a" }, { id: "b" }];
  const mine = [{ id: "a" }];
  it("super-admin gets all orgs; others get memberships", () => {
    expect(effectiveOrgs(true, all, mine)).toBe(all);
    expect(effectiveOrgs(false, all, mine)).toBe(mine);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run (CI): `npx vitest run src/features/auth/orgRoles.test.ts`
Expected: FAIL — `effectiveHasRole`/`effectiveOrgs` not exported.

- [ ] **Step 3: Add the pure helpers to `orgRoles.ts`**

Append to `src/features/auth/orgRoles.ts`:

```ts
/** UI role check: editor impersonation wins, then super-admin sees all, then real roles. */
export function effectiveHasRole(opts: {
  isSuperAdmin: boolean;
  viewAsUser: { roles: AppRole[] } | null;
  viewAsRole: AppRole | null;
  roles: AppRole[];
  role: AppRole;
}): boolean {
  const { isSuperAdmin, viewAsUser, viewAsRole, roles, role } = opts;
  if (viewAsUser) return viewAsUser.roles.includes(role);
  if (viewAsRole !== null) return role === viewAsRole;
  if (isSuperAdmin) return true;
  return roles.includes(role);
}

/** Which orgs the switcher lists: ALL orgs for super-admins, else the user's memberships. */
export function effectiveOrgs<T extends { id: string }>(isSuperAdmin: boolean, allOrgs: T[], membershipOrgs: T[]): T[] {
  return isSuperAdmin ? allOrgs : membershipOrgs;
}
```

- [ ] **Step 4: Run — expect PASS**

Run (CI): `npx vitest run src/features/auth/orgRoles.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire god-mode into `AuthContext.tsx`**

Edit `src/features/auth/AuthContext.tsx`:

(a) Update imports (lines 6–7):
```ts
import { fetchMyMemberships, type Membership, type Organization } from '@/data/orgs';
import { fetchIsSuperAdmin, fetchAllOrgs } from '@/data/platform';
import { rolesForOrg, effectiveHasRole, effectiveOrgs } from './orgRoles';
```

(b) Add to `AuthContextType` (after `currentOrg`):
```ts
  /** True if the signed-in user is a platform (super) admin. */
  isSuperAdmin: boolean;
```

(c) Add state (after the `currentOrgId` state, ~line 66):
```ts
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
```

(d) Replace the `orgs`/`currentOrg`/`roles` block (lines 76–84):
```ts
  const membershipOrgs = useMemo<Organization[]>(() => {
    const byId = new Map<string, Organization>();
    for (const m of memberships) if (m.organizations) byId.set(m.organizations.id, m.organizations);
    return Array.from(byId.values());
  }, [memberships]);

  const orgs = effectiveOrgs(isSuperAdmin, allOrgs, membershipOrgs);
  const currentOrg = orgs.find((o) => o.id === currentOrgId) ?? orgs[0] ?? null;
  /** Roles are scoped to the active org, so hasRole() keeps its signature. */
  const roles = rolesForOrg(memberships, currentOrg?.id ?? null);
```

(e) Replace `fetchMemberships` (lines 92–101) with `loadIdentity`:
```ts
  /** Fetch memberships + super-admin status (+ all orgs for super-admins); default the active org. */
  const loadIdentity = async (userId: string) => {
    try {
      const data = await fetchMyMemberships(supabase, userId);
      setMemberships(data);
      setCurrentOrgId((prev) => prev ?? data[0]?.org_id ?? null);
    } catch {
      setMemberships([]);
    }
    try {
      const su = await fetchIsSuperAdmin(supabase, userId);
      setIsSuperAdmin(su);
      setAllOrgs(su ? await fetchAllOrgs(supabase) : []);
    } catch {
      setIsSuperAdmin(false);
      setAllOrgs([]);
    }
  };
```

(f) In the `onAuthStateChange` effect, replace the two `fetchMemberships(...)` calls with `loadIdentity(...)`, and in the signed-out branch (after `setCurrentOrgId(null);`) add:
```ts
          setIsSuperAdmin(false);
          setAllOrgs([]);
```
Also replace `fetchMemberships(session.user.id);` in the `getSession().then(...)` block with `loadIdentity(session.user.id);`.

(g) Replace `hasRole` (lines 163–167):
```ts
  const hasRole = (role: AppRole) =>
    effectiveHasRole({ isSuperAdmin, viewAsUser, viewAsRole, roles, role });
```

(h) Add `isSuperAdmin` to the provider value object (line 170):
```tsx
    <AuthContext.Provider value={{ user, session, roles, memberships, orgs, currentOrg, isSuperAdmin, switchOrg, loading, signIn, signOut, hasRole, viewAsRole, setViewAsRole, viewAsUser, setViewAsUser }}>
```

- [ ] **Step 6: Run the full suite — expect PASS (no regressions)**

Run (CI): `npx vitest run` and the Typecheck job.
Expected: PASS — existing `OrgSwitcher.test.tsx` and others still green; `tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add src/features/auth/orgRoles.ts src/features/auth/orgRoles.test.ts src/features/auth/AuthContext.tsx
git commit -m "feat(auth): god-mode isSuperAdmin + all-orgs switcher"
```

---

## Task 5: Routing, gate & sidebar nav

**Files:**
- Modify: `src/config/app.config.ts` (`ROUTES.PLATFORM`)
- Modify: `src/features/auth/ProtectedRoute.tsx` (super-admin exemptions + `PlatformRoute`)
- Create: `src/components/layout/navItems.ts`
- Test: `src/components/layout/navItems.test.ts`
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the route constant**

In `src/config/app.config.ts`, add to `ROUTES` (after `ACCEPT_INVITE`):
```ts
  PLATFORM: '/platform',
```

- [ ] **Step 2: Write the failing nav-visibility test**

Create `src/components/layout/navItems.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NAV_ITEMS, visibleNavItems } from "./navItems";

const ctx = (over: Partial<{ isEditorMode: boolean; isRealAdmin: boolean; isSuperAdmin: boolean; roles: string[] }> = {}) => {
  const { isEditorMode = false, isRealAdmin = false, isSuperAdmin = false, roles = [] } = over;
  return { isEditorMode, isRealAdmin, isSuperAdmin, hasRole: (r: string) => roles.includes(r) };
};

describe("visibleNavItems", () => {
  it("an artist sees Availability but not Admin or Platform", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx({ roles: ["artist"] })).map((i) => i.label);
    expect(labels).toContain("Availability");
    expect(labels).not.toContain("Admin");
    expect(labels).not.toContain("Platform");
  });
  it("an org admin sees Admin but not Platform", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"] })).map((i) => i.label);
    expect(labels).toContain("Admin");
    expect(labels).not.toContain("Platform");
  });
  it("a super-admin sees Platform", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx({ isSuperAdmin: true })).map((i) => i.label);
    expect(labels).toContain("Platform");
  });
  it("editor admin sees role items but Platform only if super-admin", () => {
    expect(visibleNavItems(NAV_ITEMS, ctx({ isEditorMode: true, isRealAdmin: true })).map((i) => i.label)).not.toContain("Platform");
    expect(visibleNavItems(NAV_ITEMS, ctx({ isEditorMode: true, isRealAdmin: true, isSuperAdmin: true })).map((i) => i.label)).toContain("Platform");
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run (CI): `npx vitest run src/components/layout/navItems.test.ts`
Expected: FAIL — `./navItems` does not exist.

- [ ] **Step 4: Create `navItems.ts` (extracted from AppLayout)**

Create `src/components/layout/navItems.ts`:

```ts
import { LayoutDashboard, BookOpen, Clock, Settings, Shield, MessageSquare, Users, Building2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROUTES } from '@/config/app.config';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  roles?: string[];
  superAdmin?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.DASHBOARD, icon: LayoutDashboard, label: 'Dashboard' },
  { to: ROUTES.BOOKINGS, icon: BookOpen, label: 'Shows & Bookings', roles: ['admin', 'producer'] },
  { to: ROUTES.ARTISTS, icon: Users, label: 'Artists', roles: ['admin', 'producer'] },
  { to: ROUTES.AVAILABILITY, icon: Clock, label: 'Availability', roles: ['artist'] },
  { to: ROUTES.CHATS, icon: MessageSquare, label: 'Chats' },
  { to: ROUTES.ADMIN, icon: Shield, label: 'Admin', roles: ['admin'] },
  { to: ROUTES.SETTINGS, icon: Settings, label: 'Settings', roles: ['admin', 'producer'] },
  { to: ROUTES.PLATFORM, icon: Building2, label: 'Platform', superAdmin: true },
];

/** Base nav visibility (before editor view-as styling). */
export function visibleNavItems(
  items: NavItem[],
  ctx: { isEditorMode: boolean; isRealAdmin: boolean; isSuperAdmin: boolean; hasRole: (r: string) => boolean },
): NavItem[] {
  if (ctx.isEditorMode && ctx.isRealAdmin) {
    return items.filter((i) => !i.superAdmin || ctx.isSuperAdmin);
  }
  return items.filter((item) => {
    if (item.superAdmin) return ctx.isSuperAdmin;
    if (!item.roles) return true;
    return item.roles.some((r) => ctx.hasRole(r));
  });
}
```

- [ ] **Step 5: Run — expect PASS**

Run (CI): `npx vitest run src/components/layout/navItems.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Use `navItems.ts` from `AppLayout.tsx`**

In `src/components/layout/AppLayout.tsx`:
- Remove the inline `navItems` array (lines 39–47) and the now-unused icon imports it owned; import instead:
```ts
import { Settings, LogOut, Bell, ChevronLeft, ChevronRight, Menu, EyeOff } from 'lucide-react';
import { NAV_ITEMS, visibleNavItems } from '@/components/layout/navItems';
```
  (Keep `Settings` — it is used for the warning-dot route check. Drop `LayoutDashboard, BookOpen, Clock, Shield, MessageSquare, Users` from the AppLayout import since they now live in `navItems.ts`.)
- Derive `ROUTE_TO_LABEL` from `NAV_ITEMS` (replace the existing derivation, ~line 50):
```ts
const ROUTE_TO_LABEL: Record<string, string> = Object.fromEntries(NAV_ITEMS.map((i) => [i.to, i.label]));
```
- Pull `isSuperAdmin` from `useAuth()` (line 55):
```ts
  const { user, signOut, roles, hasRole, viewAsRole, viewAsUser, isSuperAdmin } = useAuth();
```
- Replace the `filteredNav` computation (lines 73–78):
```ts
  const filteredNav = visibleNavItems(NAV_ITEMS, { isEditorMode, isRealAdmin, isSuperAdmin, hasRole: (r) => hasRole(r as any) });
```
  (Type `isHiddenForViewAs(item: typeof NAV_ITEMS[number])`.)

- [ ] **Step 7: Add `PlatformRoute` + super-admin exemptions to `ProtectedRoute.tsx`**

In `src/features/auth/ProtectedRoute.tsx`:
- Pull `isSuperAdmin` from `useAuth()` (line 16):
```ts
  const { user, loading, roles, currentOrg, isSuperAdmin } = useAuth();
```
- Replace the no-org / suspended block (lines 32–38):
```ts
  // Invite-only: access is org membership. No active org → ask for an invite
  // (super-admins go to the console instead of being trapped).
  if (!currentOrg) {
    return isSuperAdmin ? <Navigate to={ROUTES.PLATFORM} replace /> : <NoOrgScreen />;
  }
  // Super-admins may enter a suspended org (god-mode); members cannot.
  if (currentOrg.status === 'suspended' && !isSuperAdmin) {
    return <SuspendedOrgScreen />;
  }
```
- Add a super-admin bypass for the **role** gate (god-mode must pass role-gated pages, since a super-admin in a non-member org has `roles === []`). Place it right after the existing editor-mode bypass (`if (isEditorMode && isRealAdmin) return <>{children}</>;`):
```ts
  // Platform admins (god-mode) bypass org role gates, like editor-mode admins.
  if (isSuperAdmin) {
    return <>{children}</>;
  }
```
- Append a new gate component at the end of the file:
```tsx
/** Gate for the /platform console: platform admins only, no org gating. */
export function PlatformRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isSuperAdmin } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!user) return <Navigate to={ROUTES.LOGIN} replace />;
  if (!isSuperAdmin) return <Navigate to={ROUTES.DASHBOARD} replace />;
  return <>{children}</>;
}
```

- [ ] **Step 8: Register the route in `App.tsx`**

In `src/App.tsx`:
- Imports:
```ts
import { ProtectedRoute, PlatformRoute } from "@/features/auth/ProtectedRoute";
import PlatformPage from "./pages/PlatformPage";
```
- Add the route (after the `CHATS` route, line 48):
```tsx
            <Route path={ROUTES.PLATFORM} element={<PlatformRoute><AppLayout><PlatformPage /></AppLayout></PlatformRoute>} />
```

> Note: `PlatformPage` is created in Task 6. To keep this task's commit compiling, create a one-line placeholder now and flesh it out in Task 6: `src/pages/PlatformPage.tsx` → `export default function PlatformPage() { return null; }`. Task 6 Step 1 replaces it.

- [ ] **Step 9: Run Typecheck + suite — expect PASS**

Run (CI): `npx vitest run` + Typecheck.
Expected: PASS — nav tests green, `tsc` clean, no import errors.

- [ ] **Step 10: Commit**

```bash
git add src/config/app.config.ts src/features/auth/ProtectedRoute.tsx src/components/layout/navItems.ts src/components/layout/navItems.test.ts src/components/layout/AppLayout.tsx src/App.tsx src/pages/PlatformPage.tsx
git commit -m "feat(routing): /platform route, gate and sidebar item"
```

---

## Task 6: Console — Organizations tab

**Files:**
- Create: `src/components/platform/platformFormat.ts`
- Test: `src/components/platform/platformFormat.test.ts`
- Modify: `src/pages/PlatformPage.tsx` (replace the Task-5 placeholder)
- Create: `src/components/platform/OrganizationsTab.tsx`
- Create: `src/components/platform/NewOrgDialog.tsx`
- Create: `src/components/platform/EditOrgDialog.tsx`
- Create: `src/components/platform/OrgInvitePopover.tsx`

> Component behavior is verified end-to-end in Task 9 (Playwright). Per repo convention we do NOT deep-mock the supabase singleton for component render tests; instead we unit-test the extracted pure helpers and rely on Typecheck + e2e for the JSX.

- [ ] **Step 1: Write the failing helper test**

Create `src/components/platform/platformFormat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slugify, formatLastActivity } from "./platformFormat";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Circus!")).toBe("acme-circus");
    expect(slugify("  Hello   World  ")).toBe("hello-world");
  });
});

describe("formatLastActivity", () => {
  it("returns an em dash for null", () => {
    expect(formatLastActivity(null)).toBe("—");
  });
  it("formats an ISO date as dd/MM/yyyy", () => {
    expect(formatLastActivity("2026-06-04T10:00:00.000Z")).toBe("04/06/2026");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run (CI): `npx vitest run src/components/platform/platformFormat.test.ts`
Expected: FAIL — `./platformFormat` does not exist.

- [ ] **Step 3: Implement `platformFormat.ts`**

```ts
import { format } from "date-fns";

export const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function formatLastActivity(iso: string | null): string {
  if (!iso) return "—";
  return format(new Date(iso), "dd/MM/yyyy");
}
```

- [ ] **Step 4: Run — expect PASS**

Run (CI): `npx vitest run src/components/platform/platformFormat.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace the `PlatformPage` placeholder**

Overwrite `src/pages/PlatformPage.tsx`:

```tsx
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrganizationsTab } from "@/components/platform/OrganizationsTab";
import { PlatformAdminsTab } from "@/components/platform/PlatformAdminsTab";
import { PlatformDefaultsTab } from "@/components/platform/PlatformDefaultsTab";

export default function PlatformPage() {
  const [tab, setTab] = useState("orgs");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Platform Console</h1>
        <p className="text-muted-foreground mt-1">Organizations, platform admins and defaults</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orgs">Organizations</TabsTrigger>
          <TabsTrigger value="admins">Platform Admins</TabsTrigger>
          <TabsTrigger value="defaults">Platform Defaults</TabsTrigger>
        </TabsList>
        <TabsContent value="orgs" className="mt-4"><OrganizationsTab /></TabsContent>
        <TabsContent value="admins" className="mt-4"><PlatformAdminsTab /></TabsContent>
        <TabsContent value="defaults" className="mt-4"><PlatformDefaultsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
```

> `PlatformAdminsTab` and `PlatformDefaultsTab` are created in Task 7. To keep this commit compiling, create one-line placeholders now: each file `export function X() { return null; }`. Task 7 replaces them.

- [ ] **Step 6: Implement `NewOrgDialog.tsx`**

```tsx
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { provisionOrg } from "@/data/platform";
import { slugify } from "./platformFormat";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const schema = z.object({
  name: z.string().min(1, "Required"),
  slug: z.string().min(1, "Required").regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens"),
  adminEmail: z.string().email("Valid email required"),
  role: z.enum(["admin", "producer", "artist"]),
});
type FormValues = z.infer<typeof schema>;

export function NewOrgDialog() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: "", slug: "", adminEmail: "", role: "admin" } });
  const nameReg = form.register("name");

  const mutation = useMutation({
    mutationFn: (v: FormValues) => provisionOrg(supabase, { name: v.name, slug: v.slug, adminEmail: v.adminEmail, role: v.role, appOrigin: window.location.origin }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      toast.success("Organization created and first admin invited");
      form.reset();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>New organization</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New organization</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...nameReg} onChange={(e) => {
              nameReg.onChange(e);
              if (!form.getFieldState("slug").isDirty) form.setValue("slug", slugify(e.target.value));
            }} />
            {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" {...form.register("slug")} />
            {form.formState.errors.slug && <p className="text-xs text-destructive">{form.formState.errors.slug.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adminEmail">First admin email</Label>
            <Input id="adminEmail" type="email" {...form.register("adminEmail")} />
            {form.formState.errors.adminEmail && <p className="text-xs text-destructive">{form.formState.errors.adminEmail.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.watch("role")} onValueChange={(v) => form.setValue("role", v as FormValues["role"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="producer">producer</SelectItem>
                <SelectItem value="artist">artist</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Creating…" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Implement `EditOrgDialog.tsx`**

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { updateOrg, type OrgStat } from "@/data/platform";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  name: z.string().min(1, "Required"),
  slug: z.string().min(1, "Required").regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens"),
});
type Values = z.infer<typeof schema>;

export function EditOrgDialog({ org, onClose }: { org: OrgStat | null; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: { name: org?.name ?? "", slug: org?.slug ?? "" } });

  const mutation = useMutation({
    mutationFn: (v: Values) => updateOrg(supabase, org!.org_id, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform"] }); toast.success("Org updated"); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!org} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit organization</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="e-name">Name</Label>
            <Input id="e-name" {...form.register("name")} />
            {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-slug">Slug</Label>
            <Input id="e-slug" {...form.register("slug")} />
            {form.formState.errors.slug && <p className="text-xs text-destructive">{form.formState.errors.slug.message}</p>}
          </div>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 8: Implement `OrgInvitePopover.tsx`**

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchOrgInvitations, revokeInvitation } from "@/data/invitations";
import { resendInvitation } from "@/data/platform";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";

export function OrgInvitePopover({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data: invites } = useQuery({
    queryKey: ["platform", "org-invites", orgId],
    queryFn: () => fetchOrgInvitations(supabase, orgId),
    enabled: open,
  });
  const pending = (invites ?? []).filter((i) => i.status === "pending");

  const resend = useMutation({
    mutationFn: (id: string) => resendInvitation(supabase, id),
    onSuccess: () => toast.success("Invitation re-sent"),
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(supabase, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform", "org-invites", orgId] }); toast.success("Invitation revoked"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label="Invitations"><Mail className="h-3.5 w-3.5" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 space-y-2">
        {pending.length === 0 && <p className="text-sm text-muted-foreground px-1 py-2">No pending invitations</p>}
        {pending.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{i.email}</span>
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => resend.mutate(i.id)}>Resend</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => revoke.mutate(i.id)}>Revoke</Button>
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 9: Implement `OrganizationsTab.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { ROUTES } from "@/config/app.config";
import { fetchPlatformOrgStats, setOrgStatus, type OrgStat } from "@/data/platform";
import { formatLastActivity } from "./platformFormat";
import { NewOrgDialog } from "./NewOrgDialog";
import { EditOrgDialog } from "./EditOrgDialog";
import { OrgInvitePopover } from "./OrgInvitePopover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogIn, Pause, Play, Pencil } from "lucide-react";

export function OrganizationsTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { switchOrg } = useAuth();
  const [editing, setEditing] = useState<OrgStat | null>(null);

  const { data: orgs, isLoading, isError, error } = useQuery({
    queryKey: ["platform", "org-stats"],
    queryFn: () => fetchPlatformOrgStats(supabase),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "suspended" }) => setOrgStatus(supabase, id, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform"] }); toast.success("Org updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const enter = (orgId: string) => { switchOrg(orgId); navigate(ROUTES.DASHBOARD); };

  if (isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (isError) return <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><NewOrgDialog /></div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead><TableHead>Slug</TableHead><TableHead>Status</TableHead>
            <TableHead>Members</TableHead><TableHead>Active artists</TableHead><TableHead>Bookings 30d</TableHead>
            <TableHead>Last activity</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(orgs ?? []).map((o) => (
            <TableRow key={o.org_id}>
              <TableCell className="font-medium">{o.name}</TableCell>
              <TableCell className="text-muted-foreground">{o.slug}</TableCell>
              <TableCell><Badge variant={o.status === "suspended" ? "destructive" : "secondary"}>{o.status}</Badge></TableCell>
              <TableCell>{o.member_count}</TableCell>
              <TableCell>{o.active_artist_count}</TableCell>
              <TableCell>{o.bookings_30d}</TableCell>
              <TableCell className="text-muted-foreground">{formatLastActivity(o.last_activity_at)}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <OrgInvitePopover orgId={o.org_id} />
                  <Button size="sm" variant="ghost" onClick={() => setEditing(o)} aria-label="Edit org"><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label={o.status === "suspended" ? "Reactivate" : "Suspend"}
                    onClick={() => statusMutation.mutate({ id: o.org_id, status: o.status === "suspended" ? "active" : "suspended" })}>
                    {o.status === "suspended" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => enter(o.org_id)}><LogIn className="h-3.5 w-3.5 mr-1" />Enter</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {orgs?.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No organizations yet</TableCell></TableRow>}
        </TableBody>
      </Table>
      <EditOrgDialog org={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
```

- [ ] **Step 10: Run Typecheck + build — expect PASS**

Run (CI): Typecheck + `npm run build` + `npx vitest run`.
Expected: PASS — `platformFormat` tests green, `tsc` clean, build succeeds.

- [ ] **Step 11: Commit**

```bash
git add src/pages/PlatformPage.tsx src/components/platform/
git commit -m "feat(platform): organizations console tab"
```

---

## Task 7: Console — Platform Admins & Platform Defaults tabs

**Files:**
- Create: `src/components/platform/templateText.ts`
- Test: `src/components/platform/templateText.test.ts`
- Create/replace: `src/components/platform/PlatformAdminsTab.tsx`
- Create/replace: `src/components/platform/PlatformDefaultsTab.tsx`

- [ ] **Step 1: Write the failing template-text test**

Create `src/components/platform/templateText.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLines, serializeLines, parseCasts, serializeCasts } from "./templateText";

describe("parseLines / serializeLines", () => {
  it("splits and trims, dropping blanks", () => {
    expect(parseLines("Vocals\n  Dance \n\nAerial")).toEqual(["Vocals", "Dance", "Aerial"]);
  });
  it("round-trips", () => {
    expect(serializeLines(["A", "B"])).toBe("A\nB");
  });
});

describe("parseCasts / serializeCasts", () => {
  it("parses 'Name :: Description' lines (description optional)", () => {
    expect(parseCasts("Main Cast :: Default\nSwing")).toEqual([
      { name: "Main Cast", description: "Default" },
      { name: "Swing", description: null },
    ]);
  });
  it("round-trips", () => {
    const casts = [{ name: "Main Cast", description: "Default" }, { name: "Swing", description: null }];
    expect(parseCasts(serializeCasts(casts))).toEqual(casts);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run (CI): `npx vitest run src/components/platform/templateText.test.ts`
Expected: FAIL — `./templateText` does not exist.

- [ ] **Step 3: Implement `templateText.ts`**

```ts
export const parseLines = (s: string): string[] => s.split("\n").map((l) => l.trim()).filter(Boolean);
export const serializeLines = (arr: string[]): string => arr.join("\n");

export function parseCasts(s: string): { name: string; description: string | null }[] {
  return parseLines(s).map((line) => {
    const [name, ...rest] = line.split("::");
    const description = rest.join("::").trim();
    return { name: name.trim(), description: description || null };
  }).filter((c) => c.name);
}

export function serializeCasts(casts: { name: string; description: string | null }[]): string {
  return casts.map((c) => (c.description ? `${c.name} :: ${c.description}` : c.name)).join("\n");
}
```

- [ ] **Step 4: Run — expect PASS**

Run (CI): `npx vitest run src/components/platform/templateText.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `PlatformAdminsTab.tsx`**

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchPlatformAdmins, addPlatformAdmin, removePlatformAdmin } from "@/data/platform";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function PlatformAdminsTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const { data: admins, isLoading, isError, error } = useQuery({ queryKey: ["platform", "admins"], queryFn: () => fetchPlatformAdmins(supabase) });

  const add = useMutation({
    mutationFn: (e: string) => addPlatformAdmin(supabase, e),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform", "admins"] }); setEmail(""); toast.success("Platform admin added"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (uid: string) => removePlatformAdmin(supabase, uid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform", "admins"] }); toast.success("Platform admin removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Platform admins</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form className="flex gap-2" onSubmit={(ev) => { ev.preventDefault(); if (email.trim()) add.mutate(email.trim()); }}>
          <Input type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" disabled={add.isPending}>Add</Button>
        </form>
        {isLoading && <Skeleton className="h-10 w-full" />}
        {isError && <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>}
        <div className="space-y-2">
          {(admins ?? []).map((a) => (
            <div key={a.user_id} className="flex items-center justify-between p-3 rounded-lg border border-border text-sm">
              <span className="truncate">{a.email}</span>
              <Button size="sm" variant="ghost" disabled={a.user_id === user?.id}
                onClick={() => { if (confirm(`Remove ${a.email} as platform admin?`)) remove.mutate(a.user_id); }}>
                {a.user_id === user?.id ? "You" : "Remove"}
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Implement `PlatformDefaultsTab.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import { savePlatformSetting, EMPTY_STARTER_TEMPLATE, type StarterCatalogTemplate } from "@/data/platform";
import { parseLines, serializeLines, parseCasts, serializeCasts } from "./templateText";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

export function PlatformDefaultsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["platform", "starter-template"],
    queryFn: () => resolveOrgSetting<StarterCatalogTemplate>(supabase, null, "starter_catalog_template", EMPTY_STARTER_TEMPLATE),
  });

  const [skills, setSkills] = useState("");
  const [cities, setCities] = useState("");
  const [casts, setCasts] = useState("");

  useEffect(() => {
    if (!data) return;
    setSkills(serializeLines(data.skills ?? []));
    setCities(serializeLines(data.cities ?? []));
    setCasts(serializeCasts(data.casts ?? []));
  }, [data]);

  const save = useMutation({
    mutationFn: () => savePlatformSetting(supabase, "starter_catalog_template", {
      skills: parseLines(skills), cities: parseLines(cities), casts: parseCasts(casts),
    } as never),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform", "starter-template"] }); toast.success("Starter catalog saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Starter catalog template</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          New organizations are seeded with these skills, cities and casts. One item per line. Casts use <code>Name :: Description</code>.
        </p>
        <div className="space-y-1.5"><Label htmlFor="t-skills">Skills</Label><Textarea id="t-skills" rows={6} value={skills} onChange={(e) => setSkills(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="t-cities">Cities</Label><Textarea id="t-cities" rows={3} value={cities} onChange={(e) => setCities(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="t-casts">Casts</Label><Textarea id="t-casts" rows={3} value={casts} onChange={(e) => setCasts(e.target.value)} /></div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save defaults</Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Run Typecheck + suite — expect PASS**

Run (CI): Typecheck + `npx vitest run` + `npm run build`.
Expected: PASS — `templateText` tests green; both tabs typecheck and build.

- [ ] **Step 8: Commit**

```bash
git add src/components/platform/templateText.ts src/components/platform/templateText.test.ts src/components/platform/PlatformAdminsTab.tsx src/components/platform/PlatformDefaultsTab.tsx
git commit -m "feat(platform): platform admins + defaults tabs"
```

---

## Task 8: Catalog read query-key org-scoping

**Why:** Per-org catalog **reads** currently key on `['skills']` / `['cities']` / `['casts']` / `['cast-city-priority']` / `['shows-program-sub-programs']` with no org dimension. They stay correct today only because `switchOrg` calls a blanket `invalidateQueries()`. With god-mode switching now frequent, scope each **read** key by `currentOrg?.id` so two orgs cache separately. Invalidations stay as the bare prefix (`['skills']` etc.) — a prefix match still catches `['skills', orgId]`, so only the read keys change.

> No new unit test: this is a mechanical key change across inline `useQuery` sites with no clean unit seam. Verification is Typecheck + the existing suite (no regressions) + the org-switch path exercised by the Task 9 e2e. Each edit below is an exact string replacement; where `currentOrg` is not already in scope, add `const { currentOrg } = useAuth();` and `import { useAuth } from '@/features/auth/AuthContext';`.

**Files & exact read-key edits:**

- [ ] **Step 1: `src/hooks/useSkills.ts:10`** — `queryKey: ['skills'],` → `queryKey: ['skills', currentOrg?.id],` (add `useAuth`/`currentOrg`). Leave the line-31 invalidation as `['skills']`.
- [ ] **Step 2: `src/components/casts/CastsSection.tsx:21`** — `queryKey: ['casts'],` → `queryKey: ['casts', currentOrg?.id],`.
- [ ] **Step 3: `src/components/casts/CastDetailsSheet.tsx:87`** — `queryKey: ['cities'],` → `queryKey: ['cities', currentOrg?.id],`.
- [ ] **Step 4: `src/components/shows/ShowDateDetailSheet.tsx:84` and `:94`** — `['cities']` → `['cities', currentOrg?.id]`; `['casts']` → `['casts', currentOrg?.id]`.
- [ ] **Step 5: `src/hooks/useSettingsWarnings.ts:16`** — `queryKey: ['shows-program-sub-programs'],` → `queryKey: ['shows-program-sub-programs', currentOrg?.id],`.
- [ ] **Step 6: `src/pages/SettingsPage.tsx`** read keys at `:469` (`['cities']`), `:497` (`['shows-program-sub-programs']`), `:521` (`['casts']`), `:545` (`['cast-city-priority']`)** — append `, currentOrg?.id` to each. `SettingsPage` already uses `currentOrg` for catalog writes (Phase 2), so no new import is needed. Leave all `invalidateQueries({ queryKey: [...] })` calls unchanged.

- [ ] **Step 7: Verify — Typecheck + suite, expect PASS**

Run (CI): Typecheck + `npx vitest run`.
Expected: PASS — no regressions; `tsc` clean. (Behavioral proof: Task 9 e2e switches orgs and sees distinct catalogs.)

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useSkills.ts src/components/casts/CastsSection.tsx src/components/casts/CastDetailsSheet.tsx src/components/shows/ShowDateDetailSheet.tsx src/hooks/useSettingsWarnings.ts src/pages/SettingsPage.tsx
git commit -m "fix(catalogs): scope per-org catalog read keys by org id"
```

At this point, open the **dev** PR (`feature/multi-tenancy-phase-4-console` → `dev`) and get all CI gates green (Typecheck, Vitest, pgTAP, Deno, Supabase preview). Squash-merge as `… (#NN)`.

---

## Task 9: E2E — platform console (Playwright)

**Files:**
- Modify: `e2e/helpers/users.ts` (add `ensurePlatformAdmin`)
- Create: `e2e/platform-console.spec.ts`

> The Playwright job runs **only on PRs targeting `main`** (see `e2e/playwright.config.ts` + `.github/workflows/ci.yml`). So this spec is authored on the feature branch but actually executes during Task 10 (dev → main). On the dev PR the gates are Vitest/pgTAP/Deno/Typecheck. DB assertions use the service-role `adminClient` (the repo's e2e convention).

- [ ] **Step 1: Add the `ensurePlatformAdmin` helper**

Append to `e2e/helpers/users.ts`:

```ts
/** Ensure a user exists, knows `password`, and is a platform (super) admin. */
export async function ensurePlatformAdmin(email: string, password: string): Promise<SeededUser> {
  const admin = adminClient();
  let existing = await findUserByEmail(email);
  if (!existing) {
    const created = await createConfirmedUser(email, password);
    existing = { id: created.id };
  } else {
    await admin.auth.admin.updateUserById(existing.id, { password });
  }
  await admin.from("platform_admins").upsert({ user_id: existing.id });
  return { id: existing.id, email, password };
}
```

- [ ] **Step 2: Write the e2e spec**

Create `e2e/platform-console.spec.ts`:

```ts
/**
 * Platform console (Phase 4): super-admin-only access, provision → invite → accept,
 * and suspend/reactivate. DB is the source of truth (adminClient); UI drives the actions.
 */
import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { createConfirmedUser, deleteUserByEmail, ensurePlatformAdmin } from "./helpers/users";
import { loginAs, loginAsAndAwaitDashboard, navViaSidebar, signOut } from "./helpers/auth";
import { TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD } from "./global-setup";

const SUPER_EMAIL = tagEmail("phase4-super", "fixed");
const SUPER_PASSWORD = "E2ePlatformSuper!1";
const stamp = Date.now();
const NEW_ORG_SLUG = `e2e-org-${stamp}`;
const NEW_ORG_NAME = `E2E Org ${stamp}`;
const INVITEE_EMAIL = tagEmail("phase4-admin", stamp);
const INVITEE_PASSWORD = "E2ePlatformInvitee!1";

test.describe.configure({ mode: "serial" });

test.describe("Platform console", () => {
  test.beforeAll(async () => {
    await ensurePlatformAdmin(SUPER_EMAIL, SUPER_PASSWORD);
    // Pre-create the invitee so provision-org takes the existing-user path (deterministic).
    await deleteUserByEmail(INVITEE_EMAIL);
    await createConfirmedUser(INVITEE_EMAIL, INVITEE_PASSWORD);
  });

  test.afterAll(async () => {
    const admin = adminClient();
    await admin.from("organizations").delete().eq("slug", NEW_ORG_SLUG);
    await deleteUserByEmail(INVITEE_EMAIL);
  });

  test("non-super-admin cannot reach /platform", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD);
    await expect(page.getByRole("link", { name: /platform/i })).toHaveCount(0);
    await page.goto("/platform");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test("super-admin provisions an org, then the invitee accepts and lands in it", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, SUPER_EMAIL, SUPER_PASSWORD);
    await navViaSidebar(page, /platform/i);

    await page.getByRole("button", { name: /new organization/i }).click();
    await page.getByLabel("Name").fill(NEW_ORG_NAME);
    await page.getByLabel("Slug").fill(NEW_ORG_SLUG);
    await page.getByLabel("First admin email").fill(INVITEE_EMAIL);
    await page.getByRole("button", { name: /^create$/i }).click();

    // Org appears in the table.
    await expect(page.getByText(NEW_ORG_SLUG)).toBeVisible({ timeout: 15_000 });

    // Read the org + its pending invitation token from the DB.
    const admin = adminClient();
    const { data: org } = await admin.from("organizations").select("id").eq("slug", NEW_ORG_SLUG).single();
    expect(org?.id).toBeTruthy();
    const { data: invite } = await admin
      .from("org_invitations").select("token").eq("org_id", org!.id).eq("status", "pending").single();
    expect(invite?.token).toBeTruthy();

    // Invitee logs in and accepts via the token link.
    await signOut(page);
    await loginAs(page, INVITEE_EMAIL, INVITEE_PASSWORD);
    await page.goto(`/accept-invite?token=${invite!.token}`);
    const acceptBtn = page.getByRole("button", { name: /accept|join/i });
    if (await acceptBtn.isVisible().catch(() => false)) await acceptBtn.click();

    // Membership exists (DB is the oracle).
    await expect(async () => {
      const { count } = await admin
        .from("org_memberships")
        .select("*", { count: "exact", head: true })
        .eq("org_id", org!.id);
      expect(count ?? 0).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });
  });

  test("super-admin can suspend and reactivate an org", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, SUPER_EMAIL, SUPER_PASSWORD);
    await navViaSidebar(page, /platform/i);
    const admin = adminClient();

    const row = page.getByRole("row", { name: new RegExp(NEW_ORG_SLUG) });
    await row.getByRole("button", { name: /suspend/i }).click();
    await expect(async () => {
      const { data } = await admin.from("organizations").select("status").eq("slug", NEW_ORG_SLUG).single();
      expect(data?.status).toBe("suspended");
    }).toPass({ timeout: 15_000 });

    await row.getByRole("button", { name: /reactivate/i }).click();
    await expect(async () => {
      const { data } = await admin.from("organizations").select("status").eq("slug", NEW_ORG_SLUG).single();
      expect(data?.status).toBe("active");
    }).toPass({ timeout: 15_000 });
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add e2e/helpers/users.ts e2e/platform-console.spec.ts
git commit -m "test(e2e): platform console provision, accept and suspend"
```

> If `getByLabel("Name")` doesn't resolve (shadcn `Label`+`Input` association), fall back to `page.locator('#name')` / `#slug` / `#adminEmail` — the inputs carry those ids (Task 6 Step 6). The login form already uses `input[type=...]` targeting for the same reason (see `helpers/auth.ts`).

---

## Task 10: Promote `dev → main` (separate, owner-approved PR)

**This touches production.** Do not run the reset without explicit owner approval. This is the closing step of Phase 4 and its own PR.

- [ ] **Step 1: Confirm `dev` is green and complete**

All Phase 4 PRs (Tasks 1–9) merged to `dev`; `gh pr checks` green on the last merge.

- [ ] **Step 2: Open the promotion PR**

```bash
git checkout dev && git pull
gh pr create --base main --head dev --title "Multi-tenancy: promote phases 0–4 to main" \
  --body "Promotes the full multi-tenancy stack (Phases 0–4) from dev to main. Runs e2e + vite build."
```

- [ ] **Step 3: If the `main` Supabase branch is in `MIGRATIONS_FAILED`, reset it first**

`main`'s Supabase branch was `MIGRATIONS_FAILED` pre-retirement, so migrations may not apply cleanly. With **owner approval**, run the manual production DB-reset workflow (added in `ci: add manual production DB-reset workflow`):

```bash
gh workflow list
gh workflow run "<production DB-reset workflow name>"   # confirm the exact name from the list
gh run watch
```

This is **destructive to the target database** — greenfield is acceptable per the spec (no real data), but confirm with the owner before running.

- [ ] **Step 4: Get CI green on the promotion PR**

Run: `gh pr checks <PR#>`
Expected: PASS — Playwright (`platform-console.spec.ts` + the existing specs), `vite build`, Typecheck, Vitest, pgTAP, Deno, Supabase deploy all green.

- [ ] **Step 5: Merge**

Merge the PR (per repo norms for main). Phase 4 — and the multi-tenancy initiative — is complete.

---

## Self-review (completed by the plan author)

**Spec coverage (§8 / §8.1 / §11 Phase 4):**

- `/platform` route + super-admin gate → Task 5. ✓
- `provision_org` (atomic: org + `seed_org_starter_catalog` + first-admin invite) → Task 1; edge wrapper + **invitee account bootstrap** → Task 2. ✓
- God-mode "Enter" = all-orgs switcher + `hasRole` short-circuit + suspended-gate exemption → Tasks 4–5. ✓
- Suspend / reactivate → Tasks 3 (data) + 6 (UI). ✓
- `platform_org_stats` metrics (members, active artists, bookings-30d, last activity), super-admin only → Task 1 + 6. ✓
- Self-service: edit org → Task 6; manage platform admins (last-admin/self-demote guards) → Tasks 1 + 7; platform-defaults + starter-catalog editor → Tasks 3 + 7; first-admin invite lifecycle (status/resend/revoke) → Tasks 2 + 6. ✓
- Catalog read query-key scoping → Task 8. ✓
- dev → main promotion → Task 10. ✓
- Testing strategy (pgTAP isolation/guards, Vitest data+logic, Deno edge, Playwright provision→invite→login) → Tasks 1,2,3,4,5,6,7,9. ✓
- Phase 5 items (`/profile`, `/reset-password`, member removal, org-admin resend) are explicitly **out of this plan** (spec §11 Phase 5). ✓

**Placeholder scan:** The two `export … { return null; }` files (`PlatformPage` in Task 5, the two tabs in Task 6) are intentional compile-time placeholders, each replaced in a named later step — not unresolved TODOs. No "TBD"/"add error handling"/"similar to" placeholders remain.

**Type/name consistency:** `OrgStat`, `PlatformAdmin`, `StarterCatalogTemplate`, `EMPTY_STARTER_TEMPLATE` defined in `src/data/platform.ts` (Task 3) and consumed in Tasks 6–7. RPC names (`provision_org`, `platform_org_stats`, `add_platform_admin`, `remove_platform_admin`, `list_platform_admins`, `is_super_admin`) match between the migration (Task 1), the data layer (Task 3), and the edge fn (Task 2). `requireSuperAdmin` (Task 2) consumed by `provision-org`. `effectiveHasRole`/`effectiveOrgs` (Task 4) consumed by `AuthContext`. `NAV_ITEMS`/`visibleNavItems` (Task 5) consumed by `AppLayout`. Query keys use the `['platform', …]` prefix consistently.

**Known sequencing note:** Task 1 Step 5 (regen `types.ts` from the PR preview branch) must complete before Tasks 3+ typecheck against the new RPCs.

---

## Execution handoff

Tasks 1–8 land on `feature/multi-tenancy-phase-4-console` → one **dev** PR (or a few stacked PRs). Task 9 is authored there but runs in CI at Task 10. Task 10 is a separate, owner-approved **dev → main** PR.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration (superpowers:subagent-driven-development).
2. **Inline Execution** — execute tasks in this session with checkpoints (superpowers:executing-plans).

Because the local environment is Deno-only, every Vitest/pgTAP/Playwright/Typecheck gate is observed in CI (`gh pr checks`). Build incrementally: push after each task and read CI as the oracle.



