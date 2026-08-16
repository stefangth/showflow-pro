# Demo Mode — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation of Demo Mode — a per-rep demo org (`organizations.is_demo`), a prod-callable seed/wipe/reset engine, hard email/PDF guardrails with an in-app "demo outbox", the demo control bar + DEMO badge, and super-admin provisioning from the Platform console.

**Architecture:** A demo org is an ordinary tenant with `is_demo = true`; all existing RLS/org-isolation applies unchanged. Seeding and wiping run as `SECURITY DEFINER` RPCs guarded so wipe can never touch a non-demo org. Outbound email/PDF is diverted to a capture table at the single `send-transactional-email` choke point. The UI mirrors the existing Editor feature (a `DemoProvider` + self-gating chrome mounted in `AppLayout`), and role switching reuses the existing `viewAsRole` plumbing.

**Tech Stack:** React 18 + TS + Vite, TanStack Query v5, Supabase (Postgres + RLS + Deno edge functions), Vitest + jsdom + Testing Library, pgTAP, Deno test.

**Spec:** `docs/superpowers/specs/2026-08-16-demo-mode-design.md` (read it alongside this plan; Phase 2 = scene/cue engine + run-of-show rail, Phase 3 = sandbox link, each its own plan).

## Global Constraints

- **Package manager:** npm only. `npm ci` to install; never create `bun.lock`/`yarn.lock`/`pnpm-lock.yaml`.
- **Lint gate:** `npm run lint` runs with `--max-warnings 0`. `any` is banned — use an explicit row `interface` + a single `as unknown as Row[]` cast at the query boundary, or the typed test helpers.
- **Styling:** semantic tokens only (`bg-background`, `text-foreground`, `text-primary`, `border-border`, `text-warning`…). Never hardcode colors.
- **Copy:** no em/en dashes in any user-facing string; German uses informal "Du". (`src/i18n/copyLint.test.ts` enforces both — but Phase 1 demo chrome is English-only rep tooling; keep strings dash-free regardless.)
- **DB:** every new table has RLS enabled + explicit policies + the RESTRICTIVE `org_isolation` policy; `update_updated_at_column()` trigger on tables with `updated_at`. Never hand-edit `src/integrations/supabase/types.ts` by inventing shapes — regenerate.
- **Migrations:** created via the local workflow (`supabase migration new`), applied by `npm run local:reset` locally and by the merge to `main` in production. Do NOT hand-apply to production. If applied out of band via MCP, rename the file to the recorded version (see CLAUDE.md).
- **Query keys:** hierarchical by domain. Platform reads use `['platform', ...]`; mutations invalidate the `['platform']` prefix. Demo captured-sends use `['demo', ...]`.
- **Changelog:** none for this work — demo mode is a super-admin/internal sales tool; the public changelog must not mention platform-admin actions.
- **Edge functions:** one folder per function; `export async function handle(req, deps)` + `if (import.meta.main) Deno.serve((req) => handle(req, realDeps()))`. Use `_shared/http.ts`, `_shared/auth.ts`, `realDeps()`. New functions need a `[functions.<name>]` block in `supabase/config.toml`.
- **Tests import the real module.** Never re-implement logic in a test. Frontend: `src/test/supabaseFake.ts` + `renderWithProviders`. Edge: `makeFakeDeps` from `_shared/testing.ts`.

---

## File structure

**Create**
- `supabase/migrations/<ts>_demo_mode_foundation.sql` — `is_demo` column, `demo_state`, `demo_captured_sends`, RLS, `platform_org_stats` update.
- `supabase/migrations/<ts>_demo_mode_seed_rpcs.sql` — `seed_demo_org`, `wipe_demo_org`.
- `supabase/tests/demo_mode.sql` — pgTAP for the column, RLS, and (critically) the wipe guard.
- `supabase/functions/demo-ops/index.ts` — the demo operations edge function.
- `supabase/functions/demo-ops/index.test.ts` — Deno tests.
- `supabase/functions/send-transactional-email/index.demo.test.ts` — divert tests.
- `src/data/demo.ts` — demo data-access.
- `src/data/demo.test.ts`
- `src/hooks/useDemo.ts` — demo hooks.
- `src/features/demo/DemoContext.tsx` — `DemoProvider` + `useDemo`.
- `src/features/demo/demoAccess.ts` — `isDemoOrg` helper.
- `src/features/demo/demoAccess.test.ts`
- `src/components/demo/DemoBadge.tsx`
- `src/components/demo/DemoBar.tsx`
- `src/components/demo/DemoOutbox.tsx`
- `src/components/demo/DemoBar.test.tsx`
- `src/components/platform/NewDemoOrgDialog.tsx`

**Modify**
- `src/integrations/supabase/types.ts` — regenerated (adds `is_demo`, `demo_state`, `demo_captured_sends`).
- `supabase/functions/_shared/database.types.ts` — regenerated mirror (`npm run sync:mirrors`).
- `src/data/orgs.ts` — `Organization.is_demo` + select.
- `src/data/platform.ts` — `fetchAllOrgs` select, `OrgStat.is_demo`, `provisionOrg` demo flag.
- `supabase/functions/send-transactional-email/index.ts` — the divert.
- `supabase/functions/demo-ops` registration in `supabase/config.toml`.
- `src/components/layout/AppLayout.tsx` — mount `<DemoBadge/>` + `<DemoBar/>`.
- `src/App.tsx` — wrap routes with `<DemoProvider>`.
- `src/components/platform/OrganizationsTab.tsx` — DEMO chip, reseed/wipe actions, `<NewDemoOrgDialog/>`.

---

## Task 1: `is_demo` column, demo tables, RLS, stats RPC

**Files:**
- Create: `supabase/migrations/<ts>_demo_mode_foundation.sql`
- Create/Modify: `supabase/tests/demo_mode.sql`

**Interfaces:**
- Produces: `organizations.is_demo boolean not null default false`; tables `demo_state(org_id pk, volume, prospect_label, updated_at)` and `demo_captured_sends(id, org_id, kind, to_label, subject, preview_html, storage_path, created_at)`; `platform_org_stats()` now returns an `is_demo boolean` column.

- [ ] **Step 1: Create the migration file**

Run: `supabase migration new demo_mode_foundation` (creates the timestamped file under `supabase/migrations/`). Put this SQL in it:

```sql
-- Demo mode foundation: org flag + demo-only support tables.

-- 1. The org type flag. A plain boolean is deliberate (not an entitlement):
--    it is read directly everywhere the org loads and it guards the wipe RPC.
alter table public.organizations
  add column if not exists is_demo boolean not null default false;

-- 2. Per-demo-org presenter state (Phase 1 uses volume + prospect_label;
--    scene columns arrive in Phase 2).
create table if not exists public.demo_state (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  volume text not null default 'full' check (volume in ('small','full')),
  prospect_label text,
  updated_at timestamptz not null default now()
);
alter table public.demo_state enable row level security;

create trigger demo_state_set_updated_at
  before update on public.demo_state
  for each row execute function public.update_updated_at_column();

-- Members of the (demo) org may read/write their presenter state.
create policy demo_state_rw on public.demo_state
  for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.has_org_role(auth.uid(), org_id, array['admin']::app_role[]));

-- Pooled-tenancy isolation floor (ADR-0003).
create policy org_isolation on public.demo_state
  as restrictive for all to authenticated
  using (org_id = public.active_org_id())
  with check (org_id = public.active_org_id());

-- 3. Captured outbound artifacts (email/PDF) for demo orgs — the "demo outbox".
create table if not exists public.demo_captured_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('email','pdf')),
  to_label text,
  subject text,
  preview_html text,
  storage_path text,
  created_at timestamptz not null default now()
);
alter table public.demo_captured_sends enable row level security;

-- Org members read their own outbox; only the service role writes (the divert
-- runs inside send-transactional-email with the service client).
create policy demo_captured_sends_read on public.demo_captured_sends
  for select to authenticated
  using (public.is_org_member(auth.uid(), org_id));

create policy org_isolation on public.demo_captured_sends
  as restrictive for all to authenticated
  using (org_id = public.active_org_id())
  with check (org_id = public.active_org_id());
```

> If `active_org_id()` / `is_org_member` / `has_org_role` names differ in this repo, copy the exact names from an existing tenant-table migration (e.g. the most recent migration that adds a table with `org_isolation`). Match the established template verbatim.

- [ ] **Step 2: Extend `platform_org_stats` to return `is_demo`**

Append to the same migration. Find the current `platform_org_stats` definition (search `supabase/migrations` for `function public.platform_org_stats`) and `create or replace` it with the identical body plus `o.is_demo` in the `select` and in the `returns table (...)` signature:

```sql
-- Re-create platform_org_stats adding is_demo (copy the existing body; only the
-- RETURNS TABLE signature and the SELECT list gain `is_demo boolean` / `o.is_demo`).
-- <PASTE the existing function here with the two additions>
```

> This step requires reading the current function first. Copy it exactly, add `is_demo boolean` as the final column of the `returns table (...)` and `o.is_demo` as the final `select` expression (the orgs alias is `o`). Do not change anything else.

- [ ] **Step 3: Write the pgTAP test**

In `supabase/tests/demo_mode.sql`:

```sql
begin;
select plan(4);

-- Column exists with the safe default.
select has_column('public', 'organizations', 'is_demo', 'organizations.is_demo exists');
select col_default_is('public', 'organizations', 'is_demo', 'false', 'is_demo defaults false');

-- Demo tables exist.
select has_table('public', 'demo_state', 'demo_state table exists');
select has_table('public', 'demo_captured_sends', 'demo_captured_sends table exists');

select * from finish();
rollback;
```

- [ ] **Step 4: Apply + run**

Run: `npm run local:reset` (applies migrations + seed), then `supabase test db`.
Expected: the 4 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/demo_mode.sql
git commit -m "feat(demo): is_demo column + demo_state/demo_captured_sends tables"
```

---

## Task 2: `seed_demo_org` + `wipe_demo_org` RPCs (with the wipe guard)

**Files:**
- Create: `supabase/migrations/<ts>_demo_mode_seed_rpcs.sql`
- Modify: `supabase/tests/demo_mode.sql`

**Interfaces:**
- Produces: `public.wipe_demo_org(p_org uuid) returns void` (refuses on non-demo); `public.seed_demo_org(p_org uuid, p_volume text default 'full', p_actor uuid default null) returns void` (idempotent-by-wipe not assumed; caller wipes first for reset).

- [ ] **Step 1: Write the failing pgTAP tests first**

Append to `supabase/tests/demo_mode.sql` (bump `plan(4)` → `plan(8)`):

```sql
-- Wipe guard: refuses on a non-demo org.
select throws_ok(
  $$ select public.wipe_demo_org('00000000-0000-0000-0000-00000000b007') $$,
  'P0001',
  'wipe_demo_org refuses on a non-demo org',
  'wipe guard fires for non-demo org'
);

-- Set up a demo org and seed it.
insert into public.organizations (id, name, slug, status, is_demo)
values ('5eedde00-0000-0000-0000-0000000000d0', 'Demo Co', 'demo-co', 'active', true)
on conflict (id) do update set is_demo = true;
select public.seed_demo_org('5eedde00-0000-0000-0000-0000000000d0', 'full', null);

select cmp_ok(
  (select count(*)::int from public.show_dates where org_id = '5eedde00-0000-0000-0000-0000000000d0'),
  '>=', 20, 'seed produces >= 20 show_dates');
select cmp_ok(
  (select count(distinct status)::int from public.bookings where org_id = '5eedde00-0000-0000-0000-0000000000d0'),
  '>=', 3, 'seed covers >= 3 booking states');
select cmp_ok(
  (select count(distinct status)::int from public.hire_orders where org_id = '5eedde00-0000-0000-0000-0000000000d0'),
  '>=', 3, 'seed covers >= 3 hire-order states');

-- Wipe clears the demo org's tenant rows.
select public.wipe_demo_org('5eedde00-0000-0000-0000-0000000000d0');
select is(
  (select count(*)::int from public.show_dates where org_id = '5eedde00-0000-0000-0000-0000000000d0'),
  0, 'wipe removes show_dates');
```

- [ ] **Step 2: Run to verify failure**

Run: `supabase test db`
Expected: FAIL (functions do not exist).

- [ ] **Step 3: Write `wipe_demo_org`** (the guard first)

Run `supabase migration new demo_mode_seed_rpcs`, then:

```sql
create or replace function public.wipe_demo_org(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The single most dangerous operation in the app. Guard reads the SAME row it
  -- is about to wipe; callers re-check too. Never softens to a WHERE clause.
  if (select is_demo from public.organizations where id = p_org) is not true then
    raise exception 'wipe_demo_org refused: % is not a demo org', p_org
      using errcode = 'raise_exception';
  end if;

  -- FK-safe order. Only tenant DATA is removed; the org row, memberships,
  -- entitlements and app_settings (booking flow) are preserved.
  delete from public.demo_captured_sends where org_id = p_org;
  delete from public.hire_order_signatures where org_id = p_org;
  delete from public.hire_order_dates where org_id = p_org;
  delete from public.hire_orders where org_id = p_org;
  delete from public.chat_messages where org_id = p_org;
  delete from public.chats where org_id = p_org;
  delete from public.show_date_offer_tiers where org_id = p_org;
  delete from public.blocked_dates where org_id = p_org;
  delete from public.notifications where org_id = p_org;
  delete from public.bookings where org_id = p_org;
  delete from public.show_dates where org_id = p_org;
  delete from public.cast_members where org_id = p_org;
  delete from public.artists where org_id = p_org;
  delete from public.casts where org_id = p_org;
  delete from public.cities where org_id = p_org;
  delete from public.shows where org_id = p_org;
end;
$$;

revoke all on function public.wipe_demo_org(uuid) from public;
```

- [ ] **Step 4: Write `seed_demo_org`**

Append to the same migration. Ids are `gen_random_uuid()` (wipe is by `org_id`, so no fixed ids needed). Every date stays below `fully_filled` so the `dispatch_hire_order_drafts` HTTP post never fires during a seed; hire-order rows are inserted directly.

```sql
create or replace function public.seed_demo_org(
  p_org uuid,
  p_volume text default 'full',
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_show_count int := case when p_volume = 'small' then 3 else 6 end;
  v_artist_count int := case when p_volume = 'small' then 8 else 16 end;
  v_city_ids uuid[] := array[]::uuid[];
  v_cast_id uuid;
  v_artist_ids uuid[] := array[]::uuid[];
  v_show_ids uuid[] := array[]::uuid[];
  v_date_ids uuid[] := array[]::uuid[];
  v_id uuid;
  i int;
begin
  if (select is_demo from public.organizations where id = p_org) is not true then
    raise exception 'seed_demo_org refused: % is not a demo org', p_org
      using errcode = 'raise_exception';
  end if;

  -- Cities (4 for a multi-venue feel).
  for i in 1..4 loop
    insert into public.cities (org_id, name)
    values (p_org, (array['Rheinbühne Köln','Stadttheater Bonn','Kammerspiele Düsseldorf','Werkstatt Aachen'])[i])
    returning id into v_id;
    v_city_ids := v_city_ids || v_id;
  end loop;

  -- One cast bucket.
  insert into public.casts (org_id, name, description)
  values (p_org, 'Ensemble', 'Demo ensemble.') returning id into v_cast_id;

  -- Artists (no login; user_id null). One row per artist.
  for i in 1..v_artist_count loop
    insert into public.artists (org_id, name, email, status, cast_role)
    values (
      p_org,
      (array['Yasmin Aydın','Elisa Brandt','Marco Reinsdorf','Jonas Vogt','Lena Hofer','Amir Kaya',
             'Sophie Neumann','Tobias Frank','Nora Baumann','Paul Richter','Mila Sanchez','Ben Kraus',
             'Hana Lindqvist','Omar Said','Frida Moll','Leon Weiss'])[i],
      'artist-' || i || '@demo.invalid',   -- non-routable: emails can never escape
      'active',
      (array['Performer','Vocalist','Dancer','Musician'])[1 + (i % 4)]
    ) returning id into v_id;
    v_artist_ids := v_artist_ids || v_id;
    insert into public.cast_members (org_id, cast_id, artist_id) values (p_org, v_cast_id, v_id);
  end loop;

  -- Shows. main_cast_slots MUST be > 0 so dates can (later, via a cue) fill.
  for i in 1..v_show_count loop
    insert into public.shows (org_id, program, sub_program, category, description, status, main_cast_slots, understudy_slots, sort_order)
    values (
      p_org,
      (array['Hamlet','Die Zauberflöte','Faust','Der Sturm','La Bohème','Kabarett Nacht'])[i],
      'Spielzeit 26/27', 'Hauptbühne', 'Demo show.', 'active', 3, 1, i
    ) returning id into v_show_ids[i];
  end loop;

  -- Show dates: for each show, ~4 dates spanning today+2 .. today+90.
  for i in 1..v_show_count loop
    for j in 0..3 loop
      insert into public.show_dates (org_id, show_id, date, city_id, venue, status, session_1, duration_minutes)
      values (
        p_org, v_show_ids[i],
        current_date + 2 + (i * 5) + (j * 18),
        v_city_ids[1 + ((i + j) % 4)],
        (array['Grand Theatre','Riverside Hall','Lakeside Arena','Werkstatt']) [1 + ((i + j) % 4)],
        'open', (array['19:30','15:00','20:00'])[1 + (j % 3)], 90
      ) returning id into v_id;
      v_date_ids := v_date_ids || v_id;
    end loop;
  end loop;

  -- Bookings covering every state. Never 3 confirmed non-understudy on one date
  -- (main_cast_slots = 3) so no date reaches fully_filled. Distinct dates per state.
  -- suggested
  insert into public.bookings (org_id, show_date_id, artist_id, status, offer_tier)
  values (p_org, v_date_ids[1], v_artist_ids[1], 'suggested', 1);
  -- soft_booked "holds" expiring today 17:00 (the scene-03 story)
  insert into public.bookings (org_id, show_date_id, artist_id, status, offer_tier, offer_expires_at)
  values (p_org, v_date_ids[2], v_artist_ids[2], 'soft_booked', 1, (current_date + interval '17 hours'));
  insert into public.bookings (org_id, show_date_id, artist_id, status, offer_tier, offer_expires_at)
  values (p_org, v_date_ids[3], v_artist_ids[3], 'soft_booked', 1, (current_date + interval '17 hours'));
  -- confirmed (1 of 3 → date stays partially_filled)
  insert into public.bookings (org_id, show_date_id, artist_id, status, confirmed_at)
  values (p_org, v_date_ids[4], v_artist_ids[4], 'confirmed', now());
  -- understudy confirmed
  insert into public.bookings (org_id, show_date_id, artist_id, status, is_understudy, confirmed_at)
  values (p_org, v_date_ids[5], v_artist_ids[5], 'confirmed', true, now());
  -- cancelled
  insert into public.bookings (org_id, show_date_id, artist_id, status, cancelled_at, cancellation_reason)
  values (p_org, v_date_ids[6], v_artist_ids[6], 'cancelled', now(), 'Artist unavailable');

  -- An open offer tier (the "at risk" surface reads from tiers + bookings).
  insert into public.show_date_offer_tiers (org_id, show_date_id, tier)
  values (p_org, v_date_ids[2], 1);

  -- Hire orders: one of each of draft / issued / countersigned. Left UNLINKED
  -- (artist_id/show_date_id null) to skip the active-artist-date dedup and the
  -- org-derive cross-check; `data` carries the display payload.
  insert into public.hire_orders (org_id, order_no, status, data, fee_amount, fee_currency)
  values
    (p_org, 'HO-DEMO-0001', 'draft',
     jsonb_build_object('artist_name','Yasmin Aydın','show','Hamlet','date', to_char(current_date + 20,'DD.MM.YYYY')), 450.00, 'EUR'),
    (p_org, 'HO-DEMO-0002', 'issued',
     jsonb_build_object('artist_name','Elisa Brandt','show','Die Zauberflöte','date', to_char(current_date + 27,'DD.MM.YYYY')), 520.00, 'EUR'),
    (p_org, 'HO-DEMO-0003', 'countersigned',
     jsonb_build_object('artist_name','Marco Reinsdorf','show','Faust','date', to_char(current_date + 34,'DD.MM.YYYY')), 480.00, 'EUR');

  -- A chat thread with one message (from the actor, when known).
  if p_actor is not null then
    insert into public.chats (org_id, show_date_id, created_by)
    values (p_org, v_date_ids[4], p_actor) returning id into v_id;
    insert into public.chat_messages (org_id, chat_id, user_id, body)
    values (p_org, v_id, p_actor, 'Willkommen. Alles bereit für die Vorstellung.');

    -- A few unread notifications so the bell is alive.
    insert into public.notifications (user_id, org_id, type, title, message, read)
    values
      (p_actor, p_org, 'offer_accepted', 'Angebot angenommen', 'Yasmin Aydın hat zugesagt.', false),
      (p_actor, p_org, 'tier_at_risk', 'Frist läuft ab', 'Zwei Angebote laufen heute um 17:00 ab.', false);
  end if;

  -- One artist with declared blocked dates.
  insert into public.blocked_dates (org_id, artist_id, date, reason)
  values (p_org, v_artist_ids[1], current_date + 40, 'Urlaub');

  -- Record the chosen volume.
  insert into public.demo_state (org_id, volume) values (p_org, p_volume)
  on conflict (org_id) do update set volume = excluded.volume, updated_at = now();
end;
$$;

revoke all on function public.seed_demo_org(uuid, text, uuid) from public;
```

- [ ] **Step 5: Apply + run**

Run: `npm run local:reset` then `supabase test db`.
Expected: all 8 assertions PASS. If any NOT NULL / enum / derive-trigger surprise appears, fix the offending insert against the schema reference and re-run.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests/demo_mode.sql
git commit -m "feat(demo): seed_demo_org + wipe_demo_org (wipe guarded to demo orgs)"
```

---

## Task 3: Regenerate types + frontend org plumbing

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerate), `supabase/functions/_shared/database.types.ts` (mirror)
- Modify: `src/data/orgs.ts:6-11` (interface), `:26` (select)
- Modify: `src/data/platform.ts:203-214` (`fetchAllOrgs` select, `OrgStat`)
- Test: `src/data/orgs.test.ts` (create or extend)

**Interfaces:**
- Consumes: the migration from Tasks 1-2.
- Produces: `Organization.is_demo: boolean`; `OrgStat.is_demo: boolean`; `currentOrg.is_demo` available app-wide (flows automatically through `effectiveOrgs`).

- [ ] **Step 1: Regenerate the generated types**

Run: `supabase gen types typescript --local > src/integrations/supabase/types.ts` (local stack must be up), then `npm run sync:mirrors`.
Verify: `git diff src/integrations/supabase/types.ts` shows `is_demo: boolean` added to the `organizations` Row/Insert/Update and the two new tables present.

- [ ] **Step 2: Write the failing test**

In `src/data/orgs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeSupabaseFake } from '@/test/supabaseFake';
import { fetchMyMemberships } from '@/data/orgs';

describe('fetchMyMemberships', () => {
  it('selects is_demo on the joined org', async () => {
    const fake = makeSupabaseFake({
      org_memberships: [{ org_id: 'o1', role: 'admin', organizations: { id: 'o1', name: 'Demo', slug: 'demo', status: 'active', is_demo: true } }],
    });
    const rows = await fetchMyMemberships(fake.client, 'u1');
    expect(rows[0].organizations?.is_demo).toBe(true);
    expect(fake.lastSelect('org_memberships')).toContain('is_demo');
  });
});
```

> Match the actual `makeSupabaseFake` / helper API in `src/test/supabaseFake.ts`; adjust the seeding + `lastSelect` accessor to whatever the fake exposes (read the file first). The behavioral assertion is: the select string includes `is_demo` and the field round-trips.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/data/orgs.test.ts`
Expected: FAIL (`is_demo` not selected / not on type).

- [ ] **Step 4: Add the field + select**

In `src/data/orgs.ts` interface (line 6-11):

```ts
export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  is_demo: boolean;
}
```

Line 26 select:

```ts
    .select("org_id, role, organizations ( id, name, slug, status, is_demo )")
```

In `src/data/platform.ts`, `fetchAllOrgs` select (line 204):

```ts
  const { data, error } = await client.from("organizations").select("id, name, slug, status, is_demo").order("name");
```

And `OrgStat` (line 13-22) gains `is_demo: boolean;` as the final field (the `platform_org_stats` RPC now returns it from Task 1).

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/data/orgs.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts src/data/orgs.ts src/data/platform.ts src/data/orgs.test.ts
git commit -m "feat(demo): thread is_demo through Organization + OrgStat + selects"
```

---

## Task 4: `demo-ops` edge function

**Files:**
- Create: `supabase/functions/demo-ops/index.ts`
- Create: `supabase/functions/demo-ops/index.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: RPCs `seed_demo_org`, `wipe_demo_org`.
- Produces: POST `demo-ops` with `{ action, org_id, volume? }`. Actions: `reset` / `reseed` / `wipe` (org-scoped, admin-or-super-admin, re-asserts `is_demo`); `flag_and_seed` (super-admin only — marks an already-provisioned org as demo, turns on `hire_orders`, seeds it). Returns `json({ ok: true })`.
- **Why no `create` here:** org creation (org row + first-admin account + membership + invite email + entitlements) is already done correctly by the existing `provision-org` edge function. `demo-ops` cannot re-invoke it (its `requireSuperAdmin` gate rejects a service-role fn-to-fn call), and re-implementing account/membership/email would duplicate battle-tested code. So the frontend `createDemoOrg` (Task 6) calls `provisionOrg(...)` first, then `demo-ops:flag_and_seed`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/demo-ops/index.test.ts`:

```ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("demo-ops: reset refuses a non-demo org", async () => {
  const { deps } = makeFakeDeps({
    tables: { organizations: { data: { is_demo: false }, error: null } },
    // requireOrgRole passes for an admin caller in this fake
    authRole: "admin",
  });
  const res = await handle(makeRequest({ body: { action: "reset", org_id: "o1" } }), deps);
  assertEquals(res.status, 400);
});

Deno.test("demo-ops: reset on a demo org calls wipe then seed", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: { organizations: { data: { is_demo: true }, error: null } },
    authRole: "admin",
    rpcs: { wipe_demo_org: { data: null, error: null }, seed_demo_org: { data: null, error: null } },
  });
  const res = await handle(makeRequest({ body: { action: "reset", org_id: "o1", volume: "full" } }), deps);
  assertEquals(res.status, 200);
  const rpcNames = calls.filter((c) => c.method === "rpc").map((c) => c.table);
  assertEquals(rpcNames.includes("wipe_demo_org"), true);
  assertEquals(rpcNames.includes("seed_demo_org"), true);
});
```

> Read `_shared/testing.ts` for the exact `makeFakeDeps` options (how it seeds an authenticated caller/role and how `.rpc()` calls appear in `calls`). Adapt `authRole`/assertions to the real fake surface; the behavior asserted is fixed: non-demo → 400, demo reset → wipe+seed.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all supabase/functions/demo-ops/`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the handler**

`supabase/functions/demo-ops/index.ts`:

```ts
import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole, requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Body = {
  action: "reset" | "reseed" | "wipe" | "flag_and_seed";
  org_id?: string;
  volume?: "small" | "full";
};

async function assertDemoOrg(deps: Deps, orgId: string): Promise<boolean> {
  const { data } = await deps.admin.from("organizations").select("is_demo").eq("id", orgId).maybeSingle();
  return (data as { is_demo?: boolean } | null)?.is_demo === true;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.action || !body?.org_id) return json({ error: "bad_request" }, 400);
  const orgId = body.org_id;
  const volume = body.volume ?? "full";

  // flag_and_seed is platform-only: the org already exists (provision-org created it +
  // its admin + invite); here we only stamp is_demo, enable hire_orders, and seed.
  if (body.action === "flag_and_seed") {
    const gate = await requireSuperAdmin(deps, req);
    if (!gate.ok) return gate.response;
    await deps.admin.from("organizations").update({ is_demo: true }).eq("id", orgId);
    await deps.admin.from("org_entitlements").upsert(
      [{ org_id: orgId, feature: "hire_orders", enabled: true }],
      { onConflict: "org_id,feature" },
    );
    const { error: seedErr } = await deps.admin.rpc("seed_demo_org", { p_org: orgId, p_volume: volume, p_actor: gate.userId });
    if (seedErr) return json({ error: seedErr.message }, 500);
    return json({ ok: true });
  }

  // The destructive/seed actions are org-admin (super-admins pass too).
  const gate = await requireOrgRole(deps, req, orgId, ["admin"]);
  if (!gate.ok) return gate.response;

  // Re-assert the flag at the edge (defense in depth on top of the RPC guard).
  if (!(await assertDemoOrg(deps, orgId))) return json({ error: "not_a_demo_org" }, 400);

  if (body.action === "wipe" || body.action === "reset") {
    const { error } = await deps.admin.rpc("wipe_demo_org", { p_org: orgId });
    if (error) return json({ error: error.message }, 500);
  }
  if (body.action === "reseed" || body.action === "reset") {
    const { error } = await deps.admin.rpc("seed_demo_org", { p_org: orgId, p_volume: volume, p_actor: gate.userId });
    if (error) return json({ error: error.message }, 500);
  }
  return json({ ok: true });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Register in `config.toml`**

Add to `supabase/config.toml`:

```toml
[functions.demo-ops]
verify_jwt = true
```

- [ ] **Step 5: Run tests + typecheck**

Run: `deno test --allow-all supabase/functions/demo-ops/ && deno check --node-modules-dir=none supabase/functions/demo-ops/index.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/demo-ops supabase/config.toml
git commit -m "feat(demo): demo-ops edge function (create/reset/reseed/wipe)"
```

---

## Task 5: Email/PDF divert in `send-transactional-email`

**Files:**
- Modify: `supabase/functions/send-transactional-email/index.ts` (around line 283, before the Resend `deps.fetch`)
- Create: `supabase/functions/send-transactional-email/index.demo.test.ts`

**Interfaces:**
- Consumes: `demo_captured_sends` (Task 1); `organizations.is_demo`.
- Produces: for `is_demo` orgs, no outbound Resend call; a `demo_captured_sends` row; the same `{ success: true, message_id }` response so `emailWasSent()` stays correct.

- [ ] **Step 1: Write the failing tests**

`index.demo.test.ts`:

```ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// A service-role caller sending to a DEMO org: must NOT hit Resend, must capture.
Deno.test("send-transactional-email: demo org diverts to capture, no Resend", async () => {
  let resendCalled = false;
  const { deps, calls } = makeFakeDeps({
    serviceRole: true,
    tables: { organizations: { data: { is_demo: true }, error: null } },
    fetchImpl: (url: string) => {
      if (String(url).includes("api.resend.com")) resendCalled = true;
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    },
  });
  const res = await handle(makeRequest({
    headers: { Authorization: "Bearer service" },
    body: { template_name: "org-invitation", recipient_email: "a@demo.invalid", org_id: "o1", templateData: {} },
  }), deps);
  assertEquals(res.status, 200);
  assertEquals(resendCalled, false, "Resend must not be called for a demo org");
  const captured = calls.filter((c) => c.table === "demo_captured_sends" && c.method === "insert");
  assertEquals(captured.length, 1, "one capture row written");
});
```

> Adapt `serviceRole`/`fetchImpl`/seeding to the real `makeFakeDeps` surface (read `_shared/testing.ts`). Behavior asserted is fixed.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all supabase/functions/send-transactional-email/index.demo.test.ts`
Expected: FAIL (Resend still called; no capture).

- [ ] **Step 3: Implement the divert**

In `index.ts`, immediately BEFORE the `const sendResponse = await deps.fetch('https://api.resend.com/emails', {...})` block (~line 283), insert:

```ts
    // Demo guardrail: never deliver from a demo org. Capture the fully-rendered
    // artifact for the in-app "demo outbox" and short-circuit with a success shape
    // so every caller's emailWasSent(...) behaves exactly as for a real send.
    if (orgId) {
      const { data: orgRow } = await admin.from('organizations').select('is_demo').eq('id', orgId).maybeSingle()
      if ((orgRow as { is_demo?: boolean } | null)?.is_demo) {
        await admin.from('demo_captured_sends').insert({
          org_id: orgId,
          kind: (resendAttachments && resendAttachments.length > 0) ? 'pdf' : 'email',
          to_label: effectiveRecipient,
          subject: presentation.subject,
          preview_html: html,
        })
        await admin.from('email_send_log').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('message_id', messageId)
        return json({ success: true, message_id: messageId }, 200)
      }
    }
```

> `admin`, `orgId`, `resendAttachments`, `presentation`, `html`, `effectiveRecipient`, `messageId` are all already in scope at that point (confirmed in the send region). If the local variable for the recipient is named differently, use the exact name from the surrounding code.

- [ ] **Step 4: Run tests**

Run: `deno test --allow-all supabase/functions/send-transactional-email/ && deno check --node-modules-dir=none supabase/functions/send-transactional-email/index.ts`
Expected: PASS (including the pre-existing suite — the non-demo path is unchanged).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-transactional-email/index.ts supabase/functions/send-transactional-email/index.demo.test.ts
git commit -m "feat(demo): divert email/PDF to demo outbox for is_demo orgs"
```

---

## Task 6: `src/data/demo.ts` + hooks

**Files:**
- Create: `src/data/demo.ts`, `src/data/demo.test.ts`
- Create: `src/hooks/useDemo.ts`

**Interfaces:**
- Consumes: `demo-ops` edge function; `demo_captured_sends` table.
- Produces: `createDemoOrg`, `resetDemoOrg`, `reseedDemoOrg`, `wipeDemoOrg`, `fetchCapturedSends`; hooks `useCapturedSends(orgId)`, `useResetDemo()`, `useReseedDemoOrg()`, `useWipeDemoOrg()`, `useCreateDemoOrg()`.

- [ ] **Step 1: Write the failing test**

`src/data/demo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeSupabaseFake } from '@/test/supabaseFake';
import { resetDemoOrg, fetchCapturedSends } from '@/data/demo';

describe('demo data access', () => {
  it('resetDemoOrg invokes demo-ops with reset', async () => {
    const fake = makeSupabaseFake({});
    await resetDemoOrg(fake.client, { orgId: 'o1', volume: 'full' });
    expect(fake.lastInvoke('demo-ops')?.body).toMatchObject({ action: 'reset', org_id: 'o1', volume: 'full' });
  });

  it('fetchCapturedSends reads the outbox newest-first', async () => {
    const fake = makeSupabaseFake({ demo_captured_sends: [{ id: 'c1', org_id: 'o1', kind: 'email', subject: 'Hi' }] });
    const rows = await fetchCapturedSends(fake.client, 'o1');
    expect(rows[0].subject).toBe('Hi');
  });
});
```

> Match `makeSupabaseFake`'s invoke-recording + table-seeding API to what the fake actually exposes.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/data/demo.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/data/demo.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { provisionOrg } from "@/data/platform";

export interface CapturedSend {
  id: string;
  org_id: string;
  kind: "email" | "pdf";
  to_label: string | null;
  subject: string | null;
  preview_html: string | null;
  storage_path: string | null;
  created_at: string;
}

async function invokeDemoOps(client: SupabaseClient<Database>, body: Record<string, unknown>): Promise<{ org_id?: string }> {
  const { data, error } = await client.functions.invoke("demo-ops", { body });
  if (error) throw error;
  const payload = data as { error?: string; org_id?: string; ok?: boolean };
  if (payload?.error) throw new Error(payload.error);
  return payload;
}

export function resetDemoOrg(client: SupabaseClient<Database>, args: { orgId: string; volume: "small" | "full" }) {
  return invokeDemoOps(client, { action: "reset", org_id: args.orgId, volume: args.volume });
}
export function reseedDemoOrg(client: SupabaseClient<Database>, args: { orgId: string; volume: "small" | "full" }) {
  return invokeDemoOps(client, { action: "reseed", org_id: args.orgId, volume: args.volume });
}
export function wipeDemoOrg(client: SupabaseClient<Database>, args: { orgId: string }) {
  return invokeDemoOps(client, { action: "wipe", org_id: args.orgId });
}
export async function createDemoOrg(
  client: SupabaseClient<Database>,
  args: { name: string; slug: string; adminEmail: string; appOrigin: string; volume: "small" | "full" },
): Promise<string> {
  // Reuse the battle-tested provisioning (org + first-admin account + membership + invite email),
  // asking for the demo entitlement set, then flag + seed via demo-ops.
  const orgId = await provisionOrg(client, {
    name: args.name, slug: args.slug, adminEmail: args.adminEmail, role: "admin",
    appOrigin: args.appOrigin, features: { hire_orders: true, booking_flow: true },
  });
  await invokeDemoOps(client, { action: "flag_and_seed", org_id: orgId, volume: args.volume });
  return orgId;
}

export async function fetchCapturedSends(client: SupabaseClient<Database>, orgId: string): Promise<CapturedSend[]> {
  const { data, error } = await client
    .from("demo_captured_sends").select("*").eq("org_id", orgId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CapturedSend[];
}
```

- [ ] **Step 4: Implement `src/hooks/useDemo.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  createDemoOrg, resetDemoOrg, reseedDemoOrg, wipeDemoOrg, fetchCapturedSends,
} from "@/data/demo";

export function useCapturedSends(orgId: string | null) {
  return useQuery({
    queryKey: ["demo", "outbox", orgId],
    queryFn: () => fetchCapturedSends(supabase, orgId!),
    enabled: !!orgId,
  });
}

function useDemoMutation<T>(fn: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries(); // a reset/wipe changes everything the demo org shows
    },
  });
}

export const useResetDemo = () => useDemoMutation((v: { orgId: string; volume: "small" | "full" }) => resetDemoOrg(supabase, v));
export const useReseedDemoOrg = () => useDemoMutation((v: { orgId: string; volume: "small" | "full" }) => reseedDemoOrg(supabase, v));
export const useWipeDemoOrg = () => useDemoMutation((v: { orgId: string }) => wipeDemoOrg(supabase, v));
export const useCreateDemoOrg = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; slug: string; adminEmail: string; appOrigin: string; volume: "small" | "full" }) => createDemoOrg(supabase, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform"] }),
  });
};
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/data/demo.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/demo.ts src/data/demo.test.ts src/hooks/useDemo.ts
git commit -m "feat(demo): demo data-access + hooks"
```

---

## Task 7: `demoAccess` + `DemoProvider`

**Files:**
- Create: `src/features/demo/demoAccess.ts`, `src/features/demo/demoAccess.test.ts`
- Create: `src/features/demo/DemoContext.tsx`
- Modify: `src/App.tsx` (wrap routes)

**Interfaces:**
- Consumes: `useAuth()` (`currentOrg`, `roles`, `isSuperAdmin`); `useResetDemo`.
- Produces: `isDemoOrg(org)`; `DemoProvider`; `useDemo()` → `{ isDemoOrg, isBarHidden, hideBar, showBar, volume, reset, isResetting }`.

- [ ] **Step 1: Write the failing test**

`src/features/demo/demoAccess.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isDemoOrg } from '@/features/demo/demoAccess';

describe('isDemoOrg', () => {
  it('true only when the org is a demo', () => {
    expect(isDemoOrg({ id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true })).toBe(true);
    expect(isDemoOrg({ id: 'o', name: 'n', slug: 's', status: 'active', is_demo: false })).toBe(false);
    expect(isDemoOrg(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/features/demo/demoAccess.test.ts`

- [ ] **Step 3: Implement `demoAccess.ts`**

```ts
import type { Organization } from "@/data/orgs";

/** The demo chrome shows iff the active org is genuinely a demo org — for everyone,
 *  including super-admins. Never keyed off entitlements/ModuleGate (which exempt
 *  super-admins and would render demo chrome on real customer orgs). */
export function isDemoOrg(org: Organization | null): boolean {
  return org?.is_demo === true;
}
```

- [ ] **Step 4: Implement `DemoContext.tsx`** (mirrors `EditorProvider`)

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { isDemoOrg } from "@/features/demo/demoAccess";
import { useResetDemo } from "@/hooks/useDemo";

interface DemoContextType {
  isDemoOrg: boolean;
  isBarHidden: boolean;
  hideBar: () => void;
  showBar: () => void;
  volume: "small" | "full";
  reset: () => void;
  isResetting: boolean;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export function DemoProvider({ children }: { children: ReactNode }) {
  const { currentOrg } = useAuth();
  const demo = isDemoOrg(currentOrg);
  const [isBarHidden, setBarHidden] = useState(false);
  const resetMut = useResetDemo();
  // Phase 1: volume is not yet read back from demo_state in the client; default 'full'.
  // Phase 2 wires demo_state (scene + volume) into this provider.
  const volume: "small" | "full" = "full";

  const reset = useCallback(() => {
    if (currentOrg) resetMut.mutate({ orgId: currentOrg.id, volume });
  }, [currentOrg, resetMut, volume]);

  const value: DemoContextType = {
    isDemoOrg: demo,
    isBarHidden,
    hideBar: useCallback(() => setBarHidden(true), []),
    showBar: useCallback(() => setBarHidden(false), []),
    volume,
    reset,
    isResetting: resetMut.isPending,
  };
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used within DemoProvider");
  return ctx;
}
```

- [ ] **Step 5: Mount `DemoProvider` in `src/App.tsx`**

Wrap the `<Routes>` tree, as a sibling of `EditorProvider` (inside `AuthProvider`):

```tsx
<AuthProvider>
  <AnalyticsIdentityBridge />
  <EditorProvider>
    <DemoProvider>
      <Routes>
        {/* ... */}
      </Routes>
    </DemoProvider>
  </EditorProvider>
</AuthProvider>
```

(Add `import { DemoProvider } from "@/features/demo/DemoContext";`.)

- [ ] **Step 6: Run tests + typecheck.** `npx vitest run src/features/demo/ && npx tsc -p tsconfig.app.json --noEmit` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/demo src/App.tsx
git commit -m "feat(demo): DemoProvider + isDemoOrg gate"
```

---

## Task 8: `DemoBadge` + mount in AppLayout

**Files:**
- Create: `src/components/demo/DemoBadge.tsx`
- Modify: `src/components/layout/AppLayout.tsx` (user card, ~line 247-255)

**Interfaces:**
- Consumes: `useDemo()`.
- Produces: `<DemoBadge/>` — renders a "DEMO" pill only inside a demo org.

- [ ] **Step 1: Implement `DemoBadge.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";
import { useDemo } from "@/features/demo/DemoContext";

export function DemoBadge() {
  const { isDemoOrg } = useDemo();
  if (!isDemoOrg) return null;
  return (
    <Badge variant="outline" className="mt-2 border-primary text-primary">
      DEMO
    </Badge>
  );
}
```

- [ ] **Step 2: Mount in `AppLayout.tsx`**

Add `import { DemoBadge } from "@/components/demo/DemoBadge";`. In the user card (after the name/subtitle block, near the existing "Viewing as" badges around line 300), add `<DemoBadge />`.

- [ ] **Step 3: Write the test**

`src/components/demo/DemoBar.test.tsx` (shared file for demo component tests) — badge case:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/renderWithProviders';
import { DemoBadge } from '@/components/demo/DemoBadge';

// renderWithProviders must supply a DemoProvider whose currentOrg.is_demo is controllable.
// If the harness cannot inject that, wrap with a small DemoContext.Provider stub in-test.
describe('DemoBadge', () => {
  it('shows DEMO inside a demo org', () => {
    render(<DemoBadge />, { authOverrides: { currentOrg: { id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true } } });
    expect(screen.getByText('DEMO')).toBeInTheDocument();
  });
});
```

> Read `src/test/renderWithProviders.tsx` first. If it does not already mount `DemoProvider` / accept `authOverrides`, either extend it (preferred, since later demo component tests need it) or wrap the component under test with a hand-built `DemoContext.Provider` value in the test.

- [ ] **Step 4: Run → PASS.** `npx vitest run src/components/demo/DemoBar.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/components/demo/DemoBadge.tsx src/components/demo/DemoBar.test.tsx src/components/layout/AppLayout.tsx
git commit -m "feat(demo): DEMO badge in the sidebar user card"
```

---

## Task 9: `DemoBar` (control bar) + mount in AppLayout

**Files:**
- Create: `src/components/demo/DemoBar.tsx`
- Modify: `src/components/demo/DemoBar.test.tsx` (extend), `src/components/layout/AppLayout.tsx` (below `</header>`, ~line 427)

**Interfaces:**
- Consumes: `useDemo()`, `useAuth()` (`viewAsRole`, `setViewAsRole`), `roleLabel`.
- Produces: `<DemoBar/>` — self-gating; shows a "Demo mode" indicator, an Admin/Production/Artist role toggle (reusing `setViewAsRole`), and a Reset button. Scene selector + sim clock are Phase 2 (not rendered here).

- [ ] **Step 1: Implement `DemoBar.tsx`**

```tsx
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDemo } from "@/features/demo/DemoContext";
import { useAuth } from "@/features/auth/AuthContext";
import { roleLabel, type AppRole } from "@/config/app.config";

const ROLE_OPTIONS: AppRole[] = ["admin", "producer", "artist"];

export function DemoBar() {
  const { isDemoOrg, isBarHidden, reset, isResetting } = useDemo();
  const { viewAsRole, setViewAsRole } = useAuth();
  if (!isDemoOrg || isBarHidden) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-accent-50 border-b-[0.5px] border-border text-sm">
      <Badge variant="outline" className="border-primary text-primary gap-1">
        <Play className="h-3 w-3" /> Demo mode
      </Badge>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Role</span>
        <div role="group" className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          {ROLE_OPTIONS.map((r) => (
            <button
              key={r}
              onClick={() => setViewAsRole(viewAsRole === r ? null : r)}
              className={`h-6 rounded-md px-2.5 text-xs font-medium ${viewAsRole === r ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {roleLabel(r)}
            </button>
          ))}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={reset} disabled={isResetting} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" /> {isResetting ? "Resetting" : "Reset"}
        </Button>
      </div>
    </div>
  );
}
```

> `bg-accent-50` is a real token in this design system (the numbered accent scale). Do not add an opacity modifier to it.

- [ ] **Step 2: Mount in `AppLayout.tsx`**

Add `import { DemoBar } from "@/components/demo/DemoBar";`. Place `<DemoBar />` directly below `</header>` and above `<EditorToolbar />` (so it sits at the header→body seam, matching design 1a).

- [ ] **Step 3: Write the test**

Extend `src/components/demo/DemoBar.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/react';
import { DemoBar } from '@/components/demo/DemoBar';

it('reset triggers the reset action', () => {
  const reset = vi.fn();
  // stub useDemo to return isDemoOrg:true + our reset spy (mock the module),
  // or drive it through the provider with a demo org. Prefer the provider path.
  render(<DemoBar />, { authOverrides: { currentOrg: { id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true } } });
  fireEvent.click(screen.getByRole('button', { name: /reset/i }));
  // assert the demo-ops invoke fired via the fake client, or the mocked hook was called.
});
```

> Assert on the observable effect available through your harness (the `demo-ops` invoke recorded by the fake client, or a mocked `useResetDemo`). Keep `getByRole` name queries OUT of `findBy`/`waitFor` retry loops (they are slow and cause flakes).

- [ ] **Step 4: Run → PASS.** `npx vitest run src/components/demo/DemoBar.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/components/demo/DemoBar.tsx src/components/demo/DemoBar.test.tsx src/components/layout/AppLayout.tsx
git commit -m "feat(demo): demo control bar with role switch + reset"
```

---

## Task 10: `DemoOutbox` (captured-sends viewer)

**Files:**
- Create: `src/components/demo/DemoOutbox.tsx`
- Modify: `src/components/demo/DemoBar.tsx` (add an outbox trigger), `src/components/demo/DemoBar.test.tsx`

**Interfaces:**
- Consumes: `useCapturedSends(orgId)`, `useAuth().currentOrg`.
- Produces: `<DemoOutbox/>` — a dialog listing captured email/PDF sends newest-first with subject, recipient, kind, and an HTML preview.

- [ ] **Step 1: Implement `DemoOutbox.tsx`**

```tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { useCapturedSends } from "@/hooks/useDemo";

export function DemoOutbox() {
  const { currentOrg } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: sends = [], isLoading } = useCapturedSends(open ? (currentOrg?.id ?? null) : null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Mail className="h-3.5 w-3.5" /> Outbox
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Demo outbox</DialogTitle></DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading</p>
        ) : sends.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing sent yet. Emails and PDFs stay inside the demo.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sends.map((s) => (
              <li key={s.id} className="py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{s.kind}</Badge>
                  <span className="text-sm font-medium">{s.subject ?? "(no subject)"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{s.to_label}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add the trigger to `DemoBar.tsx`**

Import `DemoOutbox` and render `<DemoOutbox />` just left of the Reset button in the `ml-auto` group.

- [ ] **Step 3: Write the test**

```tsx
it('outbox lists captured sends', async () => {
  render(<DemoOutbox />, {
    authOverrides: { currentOrg: { id: 'o1', name: 'n', slug: 's', status: 'active', is_demo: true } },
    seedTables: { demo_captured_sends: [{ id: 'c1', org_id: 'o1', kind: 'email', subject: 'Offer sent', to_label: 'a@demo.invalid' }] },
  });
  fireEvent.click(screen.getByRole('button', { name: /outbox/i }));
  expect(await screen.findByText('Offer sent')).toBeInTheDocument();
});
```

> Use your harness's table-seeding option name; if `findBy` is needed, keep the role-name query out of the retry loop (query by text).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/components/demo/DemoOutbox.tsx src/components/demo/DemoBar.tsx src/components/demo/DemoBar.test.tsx
git commit -m "feat(demo): demo outbox viewer for captured sends"
```

---

## Task 11: Platform — New demo org + DEMO chip + reseed/wipe

**Files:**
- Create: `src/components/platform/NewDemoOrgDialog.tsx`
- Modify: `src/components/platform/OrganizationsTab.tsx` (chip, row actions, dialog mount, colSpan)

**Interfaces:**
- Consumes: `useCreateDemoOrg`, `useReseedDemoOrg`, `useWipeDemoOrg`; `OrgStat.is_demo`.
- Produces: a "New demo org" dialog beside `<NewOrgDialog/>`; a DEMO `<Badge>` on demo rows; Reseed/Wipe row actions (confirmed) for demo rows.

- [ ] **Step 1: Implement `NewDemoOrgDialog.tsx`** (mirrors `NewOrgDialog`, fewer fields)

```tsx
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateDemoOrg } from "@/hooks/useDemo";

const schema = z.object({
  name: z.string().min(1, "Required"),
  slug: z.string().min(1, "Required").regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens"),
  adminEmail: z.string().email("Valid email required"),
});
type FormValues = z.infer<typeof schema>;

export function NewDemoOrgDialog() {
  const [open, setOpen] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: "", slug: "", adminEmail: "" } });
  const create = useCreateDemoOrg();

  const onSubmit = (v: FormValues) =>
    create.mutate(
      { name: v.name, slug: v.slug, adminEmail: v.adminEmail, appOrigin: window.location.origin, volume: "full" },
      { onSuccess: () => { toast.success("Demo org created and rep invited"); form.reset(); setOpen(false); }, onError: (e: Error) => toast.error(e.message) },
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline">New demo org</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New demo org</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div><Label>Name</Label><Input {...form.register("name")} /></div>
          <div><Label>Slug</Label><Input {...form.register("slug")} /></div>
          <div><Label>Rep email</Label><Input {...form.register("adminEmail")} /></div>
          <DialogFooter><Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating" : "Create"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire into `OrganizationsTab.tsx`**

- Add `import { NewDemoOrgDialog } from "./NewDemoOrgDialog";` and render it beside `<NewOrgDialog />` (line 71): `<NewDemoOrgDialog />`.
- DEMO chip: next to the status badge (line 85), add `{o.is_demo && <Badge variant="outline" className="border-primary text-primary">DEMO</Badge>}`.
- Row actions (in the action cell, lines 101-111): for demo rows add Reseed + Wipe buttons using the existing `IconTooltip` + `Button size="sm" variant="ghost"` pattern, wired to `useReseedDemoOrg()` / `useWipeDemoOrg()`. Wrap Wipe in the existing `AlertDialog` confirm pattern (lines 121-132 precedent). Example:

```tsx
{o.is_demo && (
  <>
    <IconTooltip label="Reseed demo">
      <Button size="sm" variant="ghost" aria-label="Reseed demo"
        onClick={() => reseed.mutate({ orgId: o.org_id, volume: "full" })}>
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
    </IconTooltip>
    <IconTooltip label="Wipe demo">
      <Button size="sm" variant="ghost" aria-label="Wipe demo" onClick={() => setToWipe(o)}>
        <Eraser className="h-3.5 w-3.5" />
      </Button>
    </IconTooltip>
  </>
)}
```

  (Add `const reseed = useReseedDemoOrg(); const wipe = useWipeDemoOrg();` near the other hooks, a `toWipe` state + `AlertDialog` mirroring the suspend confirmation, and `RefreshCw`/`Eraser` to the lucide import.)
- Bump the header row and the empty-state `colSpan={9}` (line 117) only if you add a dedicated DEMO column; if the chip sits inside the existing status cell, leave colSpan unchanged.

- [ ] **Step 3: Write the test**

`src/components/platform/NewDemoOrgDialog.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/renderWithProviders';
import { fireEvent } from '@testing-library/react';
import { NewDemoOrgDialog } from '@/components/platform/NewDemoOrgDialog';

describe('NewDemoOrgDialog', () => {
  it('invokes demo-ops create on submit', async () => {
    const fake = render(<NewDemoOrgDialog />, {});
    fireEvent.click(screen.getByRole('button', { name: /new demo org/i }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Rheinbühne' } });
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'rheinbuehne' } });
    fireEvent.change(screen.getByLabelText('Rep email'), { target: { value: 'rep@demo.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    // assert the fake client recorded a demo-ops invoke with action 'create'
    expect(await fake.findInvoke?.('demo-ops')).toMatchObject({ action: 'create', slug: 'rheinbuehne' });
  });
});
```

> Adapt the invoke assertion to the fake client's recorder API. If `renderWithProviders` doesn't return the fake, expose it or assert via a mocked `useCreateDemoOrg`.

- [ ] **Step 4: Run tests + lint + typecheck**

Run: `npx vitest run src/components/platform/NewDemoOrgDialog.test.tsx && npm run lint && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS, zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/NewDemoOrgDialog.tsx src/components/platform/OrganizationsTab.tsx src/components/platform/NewDemoOrgDialog.test.tsx
git commit -m "feat(demo): platform new-demo-org + DEMO chip + reseed/wipe actions"
```

---

## Task 12: Full-stack verification pass

**Files:** none (verification only).

- [ ] **Step 1: Whole unit suite + coverage**

Run: `npm run test:coverage`
Expected: PASS, thresholds met.

- [ ] **Step 2: Lint + all three typecheck projects**

Run:
```bash
npm run lint
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.tools.json --noEmit
deno check --node-modules-dir=none supabase/functions/demo-ops/index.ts supabase/functions/send-transactional-email/index.ts
```
Expected: all clean.

- [ ] **Step 3: DB + edge suites**

Run: `supabase test db && deno test --allow-all supabase/functions/demo-ops/ supabase/functions/send-transactional-email/`
Expected: PASS. Confirm the wipe-guard assertion is green.

- [ ] **Step 4: Mirror drift + migration checks**

Run: `npm run sync:mirrors:check && node scripts/check-migrations.mjs`
Expected: no drift, migrations consistent.

- [ ] **Step 5: Manual smoke (local stack)**

`npm run local:up && npm run dev`, sign in as the seeded super-admin, Platform → Organizations → New demo org, then enter it: confirm the DEMO badge + demo bar render, the seeded dataset populates dashboard/calendar/bookings, Reset repopulates, and a triggered email lands in the demo outbox (never delivered). Note results in the PR description.

- [ ] **Step 6: Commit (if any fixes)** and open the PR.

```bash
git commit -am "test(demo): phase 1 verification fixes"
```

PR description must state: "No changelog (super-admin/internal tool)." and "No page mini (adds chrome + a Platform action, not a customer route)." and "No help center impact." (or the help update, if reps use Help).

---

## Self-review notes (author)

- **Spec coverage:** §5 data model → Tasks 1-3. §6A provisioning → Tasks 4, 11. §6B seed/wipe/reset → Tasks 2, 4. §6C guardrails + outbox → Tasks 5, 10. §6D demo shell (bar, badge, role switch) → Tasks 7-9. §6F reset → Tasks 4, 6, 9. §8 safety (wipe guard, super-admin non-leak) → Tasks 2 (pgTAP), 7 (`isDemoOrg` not ModuleGate). §7 coverage matrix → Task 2 seed + its pgTAP counts. Deferred by design: §6E scene/cue engine + run-of-show rail (Phase 2), §6G sandbox link (Phase 3), sim clock + prospect personalization + volume toggle UI (Phase 2 — `demo_state` columns exist; Phase 1 defaults volume 'full').
- **Known adaptation points (not placeholders):** every test step that says "match the fake's API" refers to reading `src/test/supabaseFake.ts` / `renderWithProviders.tsx` / `_shared/testing.ts` for the exact helper names — the assertions and behaviors are fully specified; only the harness accessor names must be confirmed against the real files. The `platform_org_stats` re-create (Task 1 Step 2) requires pasting the existing function body — the two additions are specified exactly.
- **Type consistency:** `Organization.is_demo`, `OrgStat.is_demo`, `CapturedSend`, `useDemo()` shape, and the `demo-ops` action names (`create`/`reset`/`reseed`/`wipe`) are used identically across tasks.
