# Multi-Tenancy Phase 3 — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cron/booking-engine edge functions and the Airtable sync fully org-aware (loop over active orgs, resolve each org's settings, per-(org,artist) digests, per-org email overrides, per-org Airtable with Vault-stored keys), and make `org_id` correct-by-construction on every write path via derive-from-parent triggers so the bootstrap-org column DEFAULTs can be dropped.

**Architecture:** Pooled multi-tenancy (one DB, `org_id` + RLS). Phase 3 adds a Deno settings resolver mirroring the SQL `get_org_setting`, `BEFORE INSERT` triggers that copy `org_id` from each row's FK parent, and per-org iteration in the five cron functions + `open-offer-tier`. Per-org Airtable API keys live in Supabase Vault, read by a service-role getter RPC and written by an org-admin setter RPC. See the approved spec: [docs/superpowers/specs/2026-06-03-multi-tenancy-design.md](../specs/2026-06-03-multi-tenancy-design.md) §7 (§7.4 added in planning).

**Tech Stack:** Supabase (Postgres 17, RLS, pg_cron, Vault), Deno edge functions (DI pattern: `handle(req, deps)` + `makeFakeDeps`), React 18 + Vitest (Settings UI), pgTAP.

---

## Environment & how to run each layer

This machine has **Deno only** — no Node, no Supabase CLI, no Docker (see memory `env-no-node-supabase-cli`). Work is **CI-driven**: author → commit → push → open PR to `dev` → `gh pr checks <n>` is the oracle.

| Layer | How to run | When |
|---|---|---|
| Deno edge-fn tests | `deno test --allow-all supabase/functions/<fn>/` (runs locally) | Every TDD step in Parts 1, 3–8 |
| Migrations | **Author** each migration as a new timestamped file under `supabase/migrations/` and commit it. On push, the PR's Supabase **preview branch** + CI's `supabase test db` apply and verify it. **Do NOT `apply_migration` against the live project `epweartpzwvcasrzyueh`** — it is the only/prod project (no separate dev DB; "main lags dev" because dev migrations live only on preview branches until merge). If you must dry-run SQL, create a throwaway preview branch via MCP `create_branch` first. Never edit an existing migration. | Parts 2, 8, 9 |
| pgTAP | CI job `supabase test db` (runs on PR). New files under `supabase/tests/**` are auto-discovered. | Parts 2, 8, 9 |
| Vitest (frontend) | CI (no Node locally) — push and read `gh pr checks` | Part 8 (Settings UI) |
| Typecheck (`tsc --noEmit`) | CI Typecheck job | every PR |
| `types.ts` regen | Supabase MCP `generate_typescript_types(<dev-PR preview ref>)` | Part 10 |

New migration timestamps must sort **after** the latest existing migration `20260604121000`. This plan uses `20260604130000`, `20260604131000`, `20260604132000`. If the branch is authored later, bump consistently but keep relative order.

**Branch:** all work lands on `feature/multi-tenancy-phase-3-backend` (already created; the spec reconciliation commit is its first commit). One squash PR `… (#NN)` to `dev` at the end, per the Phase 0/1/2 workflow.

---

## File Structure

**Create:**
- `supabase/functions/_shared/settings.ts` — Deno settings resolver: `resolveOrgSetting(admin, orgId, key, fallback)`, `getActiveOrgs(admin)`. Mirrors `src/data/settings.ts` + SQL `get_org_setting`. One responsibility: per-org config resolution for edge functions.
- `supabase/functions/_shared/settings.test.ts` — resolver unit tests (fake client).
- `supabase/migrations/20260604130000_org_id_derivation_triggers.sql` — `BEFORE INSERT` derive-`org_id` triggers on FK-child tenant tables + add `org_id` to the notification/audit inserts inside the booking triggers. (DEFAULT not yet dropped.)
- `supabase/tests/triggers/org_id_derivation.sql` — pgTAP: children inherit parent `org_id`.
- `supabase/migrations/20260604131000_org_airtable_vault.sql` — Vault getter/setter RPCs for per-org Airtable keys.
- `supabase/tests/rpc/org_airtable_key.sql` — pgTAP: setter auth guard + getter not callable by `authenticated`.
- `supabase/functions/airtable-poll/index.org.test.ts` — per-org iteration / skip / org-scoped lookup / sync_log org_id tests.
- `supabase/migrations/20260604132000_drop_bootstrap_org_defaults.sql` — drop the bootstrap `org_id` column DEFAULT from every tenant table.
- `supabase/tests/db/org_id_parent_child_consistency.sql` — pgTAP: every child row's `org_id` equals its parent's.

**Modify:**
- `supabase/functions/_shared/deps.ts` — add `org_id?: string` to `EmailMessage`.
- `supabase/functions/_shared/auth.ts` — `requireCronOrRole` reads `cron_secret` with `.is("org_id", null)`.
- `supabase/functions/send-transactional-email/index.ts` — resolve `resend_from_address` + `email_template_overrides` per `body.org_id`.
- `supabase/functions/send-offer-digest/index.ts` + `index.di.test.ts` — loop active orgs, per-org hour gate, per-(org,artist) grouping, org-scoped idempotency key + `org_id` on email.
- `supabase/functions/send-confirmation-digest/index.ts` + `index.di.test.ts` — same treatment.
- `supabase/functions/expire-offers/index.ts` + `index.di.test.ts` — resolve slot defaults per `show_date`'s org; `org_id` on notification inserts.
- `supabase/functions/tier-at-risk-watcher/index.ts` + `index.di.test.ts` — same.
- `supabase/functions/airtable-poll/index.ts` + `index.di.test.ts` — loop active orgs, per-org base/table/key, org-scoped show/city lookups, `org_id` on `airtable_sync_log`, harden cron-secret read.
- `src/pages/SettingsPage.tsx` — write-only Airtable API-key field calling the setter RPC.
- `src/integrations/supabase/types.ts` — regenerated (Part 10).
- `src/data/invitations.ts` — drop the `client.rpc as any` cast once types include `accept_invitation` (Part 10).

**Note on test files:** `supabase/functions/<fn>/index.test.ts` are legacy logic-mirror tests (they re-implement logic — the house rule forbids that pattern). Do **not** add to them. All new behavioral tests go in `index.di.test.ts` (real `handle()` + `makeFakeDeps`) per CLAUDE.md.

---

## Part 1 — Edge settings resolver (`_shared/settings.ts`)

Foundation for every per-org cron loop. Mirrors `src/data/settings.ts:resolveOrgSetting` and the SQL `get_org_setting(_org,_key)` (org override ?? platform default).

### Task 1.1: Resolver + active-orgs helper

**Files:**
- Create: `supabase/functions/_shared/settings.ts`
- Test: `supabase/functions/_shared/settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/settings.test.ts
import { assertEquals } from "./test-asserts.ts";
import { createFakeClient } from "./testing.ts";
import { getActiveOrgs, resolveOrgSetting } from "./settings.ts";

const ORG_A = "00000000-0000-0000-0000-0000000000a1";

function adminWith(tables: Record<string, unknown>) {
  // settings.ts only uses the `admin` client surface (from().select()...).
  const { client } = createFakeClient({ tables: tables as never });
  return client as unknown as Parameters<typeof resolveOrgSetting>[0];
}

Deno.test("resolveOrgSetting: prefers the org row over the platform default", async () => {
  const admin = adminWith({
    app_settings: [{
      when: { key: "offer_digest_hour_berlin" },
      data: [{ org_id: ORG_A, value: 20 }, { org_id: null, value: 19 }],
    }],
  });
  assertEquals(await resolveOrgSetting<number>(admin, ORG_A, "offer_digest_hour_berlin", 0), 20);
});

Deno.test("resolveOrgSetting: falls back to the platform default when no org row", async () => {
  const admin = adminWith({
    app_settings: [{
      when: { key: "offer_digest_hour_berlin" },
      data: [{ org_id: null, value: 19 }],
    }],
  });
  assertEquals(await resolveOrgSetting<number>(admin, ORG_A, "offer_digest_hour_berlin", 0), 19);
});

Deno.test("resolveOrgSetting: returns the fallback when neither row exists", async () => {
  const admin = adminWith({ app_settings: [{ when: { key: "missing" }, data: [] }] });
  assertEquals(await resolveOrgSetting<number>(admin, ORG_A, "missing", 48), 48);
});

Deno.test("getActiveOrgs: returns active org ids", async () => {
  const admin = adminWith({ organizations: { data: [{ id: ORG_A }], error: null } });
  assertEquals(await getActiveOrgs(admin), [{ id: ORG_A }]);
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `deno test --allow-all supabase/functions/_shared/settings.test.ts`
Expected: FAIL — `Module not found "./settings.ts"`.

- [ ] **Step 3: Implement the resolver**

```ts
// supabase/functions/_shared/settings.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** A row of the app_settings table as the resolver reads it. */
interface SettingRow { org_id: string | null; value: unknown }

/**
 * Effective value for a setting: the org's own row if present, else the platform
 * default (org_id IS NULL), else `fallback`. One round-trip. Mirrors the SQL
 * get_org_setting() and the frontend src/data/settings.ts:resolveOrgSetting().
 * When orgId is null, only the platform default is consulted.
 */
export async function resolveOrgSetting<T>(
  admin: SupabaseClient,
  orgId: string | null,
  key: string,
  fallback: T,
): Promise<T> {
  let q = admin.from("app_settings").select("org_id, value").eq("key", key);
  q = orgId ? q.or(`org_id.eq.${orgId},org_id.is.null`) : q.is("org_id", null);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as SettingRow[];
  const orgRow = orgId ? rows.find((r) => r.org_id === orgId) : undefined;
  const platformRow = rows.find((r) => r.org_id === null);
  const chosen = orgRow ?? platformRow;
  return chosen ? (chosen.value as T) : fallback;
}

/** Active organizations (status = 'active'). The set every cron loop iterates. */
export async function getActiveOrgs(admin: SupabaseClient): Promise<Array<{ id: string }>> {
  const { data, error } = await admin
    .from("organizations").select("id").eq("status", "active");
  if (error) throw error;
  return (data ?? []) as Array<{ id: string }>;
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `deno test --allow-all supabase/functions/_shared/settings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/settings.ts supabase/functions/_shared/settings.test.ts
git commit -m "feat(edge): add per-org settings resolver for cron loops"
```

---

## Part 2 — Derive-`org_id` triggers + booking-trigger notification/audit `org_id`

Add `BEFORE INSERT` triggers that copy `org_id` from each row's FK parent (overwrite-always → wrong-org child impossible), and fix the notification/audit-log inserts inside the existing booking triggers to set `org_id`. The bootstrap DEFAULT stays in place until Part 9, so this part cannot break inserts.

### Task 2.1: pgTAP — children inherit the parent's `org_id`

**Files:**
- Create: `supabase/tests/triggers/org_id_derivation.sql`

- [ ] **Step 1: Write the failing pgTAP test**

UUID literals must be valid hex — a stray non-hex char throws `invalid input syntax for type uuid` (memory `multi-tenancy-initiative`). Parents are seeded under `session_replication_role = replica` so triggers stay off during setup; the child inserts run under `DEFAULT` so the derive trigger fires.

```sql
-- supabase/tests/triggers/org_id_derivation.sql
-- A child row inserted WITHOUT org_id (or with a wrong one) ends up with its
-- parent's org_id, via the Part-2 BEFORE INSERT derive triggers.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

-- Parents seeded under replica (org_id supplied explicitly — triggers off here).
SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000de01', 'Der org', 'der-org');
INSERT INTO public.shows (id, program, sub_program, org_id) VALUES
  ('11111111-0000-0000-0000-00000000de01', 'theatre', 'musical', '00000000-0000-0000-0000-00000000de01');
INSERT INTO public.artists (id, name, org_id) VALUES
  ('22222222-0000-0000-0000-00000000de01', 'Der artist', '00000000-0000-0000-0000-00000000de01');
SET session_replication_role = DEFAULT;

-- 1) show_dates inserted with NO org_id → inherits the show's org.
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('33333333-0000-0000-0000-00000000de01', '11111111-0000-0000-0000-00000000de01', '2099-01-01', '19:00');
SELECT is(
  (SELECT org_id FROM public.show_dates WHERE id = '33333333-0000-0000-0000-00000000de01'),
  '00000000-0000-0000-0000-00000000de01'::uuid,
  'show_dates.org_id derived from shows');

-- 2) bookings inserted with NO org_id → inherits the show_date's org.
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy)
VALUES ('44444444-0000-0000-0000-00000000de01', '33333333-0000-0000-0000-00000000de01',
        '22222222-0000-0000-0000-00000000de01', 'soft_booked', false);
SELECT is(
  (SELECT org_id FROM public.bookings WHERE id = '44444444-0000-0000-0000-00000000de01'),
  '00000000-0000-0000-0000-00000000de01'::uuid,
  'bookings.org_id derived from show_dates');

-- 3) blocked_dates inserted with NO org_id → inherits the artist's org.
INSERT INTO public.blocked_dates (id, artist_id, date)
VALUES ('55555555-0000-0000-0000-00000000de01', '22222222-0000-0000-0000-00000000de01', '2099-01-02');
SELECT is(
  (SELECT org_id FROM public.blocked_dates WHERE id = '55555555-0000-0000-0000-00000000de01'),
  '00000000-0000-0000-0000-00000000de01'::uuid,
  'blocked_dates.org_id derived from artists');

-- 4) A WRONG org_id is OVERWRITTEN by the parent's (overwrite-always guarantee).
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000de02', 'Other', 'other-org');
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id)
VALUES ('66666666-0000-0000-0000-00000000de01', '33333333-0000-0000-0000-00000000de01',
        '22222222-0000-0000-0000-00000000de01', 'soft_booked', false,
        '00000000-0000-0000-0000-00000000de02');
SELECT is(
  (SELECT org_id FROM public.bookings WHERE id = '66666666-0000-0000-0000-00000000de01'),
  '00000000-0000-0000-0000-00000000de01'::uuid,
  'a wrong child org_id is overwritten by the parent org_id');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: (CI) confirm it fails** — push the branch; the `supabase test db` job fails this file (no derive triggers yet). Locally you cannot run pgTAP (no CLI); rely on the PR check. Proceed to write the migration, then re-push.

### Task 2.2: The derive-trigger migration

**Files:**
- Create: `supabase/migrations/20260604130000_org_id_derivation_triggers.sql`

- [ ] **Step 3: Write the migration**

```sql
-- Phase 3 (Part 2): derive org_id from the FK parent on every tenant CHILD table,
-- and stamp org_id on the notification/audit inserts inside the booking triggers.
-- The bootstrap org_id column DEFAULT is left in place (dropped in Part 9) so this
-- migration is purely additive and cannot break any existing insert path.
--
-- Design (spec §7.4): one BEFORE INSERT trigger per child table sets
-- NEW.org_id := (parent's org_id), UNCONDITIONALLY (overwrite-always), so a row
-- can never land in the wrong org regardless of client/edge input. Root tenant
-- tables (shows, artists, casts, cities, skills, app_settings) and the two
-- parentless writers (notifications, airtable_sync_log) set org_id explicitly at
-- their insert site, so they get no trigger here.

-- ── Generic derive functions (one per parent table / FK column) ──────────────
create or replace function public.derive_org_id_from_show_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id into NEW.org_id from public.shows where id = NEW.show_id;
  return NEW;
end; $$;

create or replace function public.derive_org_id_from_show_date_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id into NEW.org_id from public.show_dates where id = NEW.show_date_id;
  return NEW;
end; $$;

create or replace function public.derive_org_id_from_booking_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id into NEW.org_id from public.bookings where id = NEW.booking_id;
  return NEW;
end; $$;

create or replace function public.derive_org_id_from_cast_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id into NEW.org_id from public.casts where id = NEW.cast_id;
  return NEW;
end; $$;

create or replace function public.derive_org_id_from_artist_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id into NEW.org_id from public.artists where id = NEW.artist_id;
  return NEW;
end; $$;

create or replace function public.derive_org_id_from_chat_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id into NEW.org_id from public.chats where id = NEW.chat_id;
  return NEW;
end; $$;

-- ── Attach triggers (drop-if-exists for idempotency) ─────────────────────────
-- parent = shows
drop trigger if exists trg_derive_org_id on public.show_dates;
create trigger trg_derive_org_id before insert on public.show_dates
  for each row execute function public.derive_org_id_from_show_id();
drop trigger if exists trg_derive_org_id on public.show_cast_eligibility;
create trigger trg_derive_org_id before insert on public.show_cast_eligibility
  for each row execute function public.derive_org_id_from_show_id();

-- parent = show_dates
drop trigger if exists trg_derive_org_id on public.bookings;
create trigger trg_derive_org_id before insert on public.bookings
  for each row execute function public.derive_org_id_from_show_date_id();
drop trigger if exists trg_derive_org_id on public.show_date_offer_tiers;
create trigger trg_derive_org_id before insert on public.show_date_offer_tiers
  for each row execute function public.derive_org_id_from_show_date_id();
drop trigger if exists trg_derive_org_id on public.show_date_cast_eligibility;
create trigger trg_derive_org_id before insert on public.show_date_cast_eligibility
  for each row execute function public.derive_org_id_from_show_date_id();
drop trigger if exists trg_derive_org_id on public.chats;
create trigger trg_derive_org_id before insert on public.chats
  for each row execute function public.derive_org_id_from_show_date_id();

-- parent = bookings
drop trigger if exists trg_derive_org_id on public.booking_audit_log;
create trigger trg_derive_org_id before insert on public.booking_audit_log
  for each row execute function public.derive_org_id_from_booking_id();

-- parent = casts
drop trigger if exists trg_derive_org_id on public.cast_members;
create trigger trg_derive_org_id before insert on public.cast_members
  for each row execute function public.derive_org_id_from_cast_id();
drop trigger if exists trg_derive_org_id on public.cast_city_priority;
create trigger trg_derive_org_id before insert on public.cast_city_priority
  for each row execute function public.derive_org_id_from_cast_id();

-- parent = artists
drop trigger if exists trg_derive_org_id on public.artist_skills;
create trigger trg_derive_org_id before insert on public.artist_skills
  for each row execute function public.derive_org_id_from_artist_id();
drop trigger if exists trg_derive_org_id on public.blocked_dates;
create trigger trg_derive_org_id before insert on public.blocked_dates
  for each row execute function public.derive_org_id_from_artist_id();

-- parent = chats
drop trigger if exists trg_derive_org_id on public.chat_messages;
create trigger trg_derive_org_id before insert on public.chat_messages
  for each row execute function public.derive_org_id_from_chat_id();
```

- [ ] **Step 4: Stamp `org_id` on the booking triggers' notification + audit inserts**

The booking triggers (`notify_booking_transition`, `promote_understudy_on_cancellation`) insert into `notifications` and `booking_audit_log` **without** `org_id` today (they rely on the DEFAULT). `booking_audit_log` is now covered by its derive trigger (Step 3). `notifications` is parentless, so add `org_id => NEW.org_id` to its inserts. Append to the **same** migration file a `CREATE OR REPLACE` of both functions, copied verbatim from `supabase/migrations/20260603130300_org_scoped_notification_fallback.sql` with this single change: every `INSERT INTO public.notifications (user_id, type, title, message, related_entity_type, related_entity_id)` gains a leading `org_id` column set to `NEW.org_id`.

Concretely, for each of the four notification inserts in those two functions, change:

```sql
  INSERT INTO public.notifications (user_id, type, title, message, related_entity_type, related_entity_id)
  VALUES ( <recipient>, '<type>', '<title>', <message>, '<entity_type>', <entity_id> );
```

to:

```sql
  INSERT INTO public.notifications (org_id, user_id, type, title, message, related_entity_type, related_entity_id)
  VALUES ( NEW.org_id, <recipient>, '<type>', '<title>', <message>, '<entity_type>', <entity_id> );
```

(The `SELECT … FROM public.artists … INSERT … SELECT a.user_id, …` form in `promote_understudy_on_cancellation` likewise gains `NEW.org_id` as the first selected column and `org_id` as the first insert column.) Reproduce the full bodies — do not abbreviate; the engineer may read tasks out of order. The functions are otherwise identical to `20260603130300`.

> Also check `auto_cancel_on_slot_fill` (search `grep -rn "INSERT INTO public.notifications" supabase/migrations/ | tail`). If it inserts notifications without `org_id`, give it the same `org_id => NEW.org_id` treatment in this migration. (`resolve_show_assignments` is a read-only `SELECT` function — no change.)

- [ ] **Step 5: Apply the migration**

Save the SQL as `supabase/migrations/20260604130000_org_id_derivation_triggers.sql` and commit. Do **not** apply to the live project — push and let the PR's Supabase preview branch + CI's `supabase test db` apply and verify it (see the environment table).

- [ ] **Step 6: (CI) verify pgTAP passes**

Push; confirm `supabase test db` is green (Task 2.1's `org_id_derivation.sql` now passes; existing trigger/RLS suites stay green). If a pre-existing seed inserted a child with a deliberately-mismatched `org_id`, the overwrite-always trigger corrects it — update any such fixture so its expectation matches the parent's org.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260604130000_org_id_derivation_triggers.sql supabase/tests/triggers/org_id_derivation.sql
git commit -m "feat(db): derive org_id from parent on child inserts; stamp notif org_id"
```

> **`open-offer-tier` needs no code change.** It inserts `bookings` and upserts `show_date_offer_tiers` without `org_id`; both are FK-children of `show_dates`, so the Part-2 derive triggers stamp the correct org automatically. (Spec §7.3 was reconciled to reflect this — the function no longer "threads" `org_id` manually.) Add a one-line regression test to `supabase/functions/open-offer-tier/index.di.test.ts` only if you want to pin that the insert payload deliberately omits `org_id`; otherwise the pgTAP derivation + consistency tests (Parts 2, 9) cover it.

---

## Part 3 — Per-org transactional-email overrides

`send-transactional-email` currently resolves `resend_from_address` and `email_template_overrides` globally. Make them resolve per the message's `org_id` (org override ?? platform default). Backward compatible: when `org_id` is absent (person-level mails — invites, unsubscribe), the resolver consults only the platform default, exactly as today.

### Task 3.1: `EmailMessage.org_id`

**Files:**
- Modify: `supabase/functions/_shared/deps.ts:3-8`

- [ ] **Step 1: Add the field**

In `EmailMessage`, add `org_id?: string;`:

```ts
export interface EmailMessage {
  template_name: string;
  recipient_email: string;
  org_id?: string;
  templateData?: Record<string, unknown>;
  idempotency_key?: string;
}
```

- [ ] **Step 2: Typecheck** — `deno check supabase/functions/_shared/deps.ts` → no errors. Commit with Task 3.2.

### Task 3.2: Resolve overrides per org in `send-transactional-email`

**Files:**
- Modify: `supabase/functions/send-transactional-email/index.ts:142-159`
- Test: `supabase/functions/send-transactional-email/index.di.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing di test)

```ts
// add near the other imports if missing:
// import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
// import { handle } from "./index.ts";

Deno.test("send-transactional-email: uses the org's resend_from_address override", async () => {
  const ORG = "00000000-0000-0000-0000-0000000000a1";
  const { deps, calls } = makeFakeDeps({
    envVars: {
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "svc",
      RESEND_API_KEY: "re_key",
    },
    tables: {
      suppressed_emails: { data: null, error: null },
      email_unsubscribe_tokens: { data: { token: "tok", used_at: null }, error: null },
      email_send_log: { data: null, error: null },
      app_settings: [
        { when: { key: "resend_from_address" }, data: [{ org_id: ORG, value: "Org A <a@org-a.com>" }, { org_id: null, value: "Showflow Pro <noreply@showflow.pro>" }] },
        { when: { key: "email_template_overrides" }, data: [{ org_id: null, value: {} }] },
      ],
    },
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ id: "re_1" }), { status: 200 })),
  });

  // Capture the Resend request body
  let sentFrom = "";
  const baseFetch = deps.fetch;
  deps.fetch = (url, init) => {
    if (String(url).includes("api.resend.com")) {
      sentFrom = JSON.parse(String((init as RequestInit).body)).from;
    }
    return baseFetch(url, init);
  };

  const res = await handle(makeRequest({
    body: { template_name: "artist-offer-digest", recipient_email: "jo@x.com", org_id: ORG, templateData: { displayName: "Jo", offers: [] } },
  }), deps);
  assertEquals(res.status, 200);
  assertEquals(sentFrom, "Org A <a@org-a.com>");
});
```

> If `artist-offer-digest` requires specific `templateData`, swap to any registered template that renders with minimal data (check `supabase/functions/_shared/transactional-email-templates/registry.ts`). The assertion under test is the `from` address, not the body.

- [ ] **Step 2: Run it — verify it fails**

Run: `deno test --allow-all supabase/functions/send-transactional-email/index.di.test.ts`
Expected: FAIL — `sentFrom` is the platform default (`Showflow Pro <noreply@showflow.pro>`), not the org override.

- [ ] **Step 3: Implement per-org resolution**

Add the import at the top: `import { resolveOrgSetting } from "../_shared/settings.ts";`

Parse `org_id` from the body (in the `try` block alongside the other fields):

```ts
    orgId = body.org_id ?? body.orgId ?? null
```

(declare `let orgId: string | null` next to the other `let` declarations.)

Replace lines 142–159 (the two `.from('app_settings').select('value').eq('key', …).maybeSingle()` reads) with:

```ts
  // Read from-address and template overrides for this org (org override ?? platform default).
  const fromAddress = await resolveOrgSetting<string>(
    admin, orgId, 'resend_from_address', 'Showflow Pro <noreply@showflow.pro>')

  const overrides = await resolveOrgSetting<Record<string, any>>(
    admin, orgId, 'email_template_overrides', {})
  const templateOverride = overrides[templateName] ?? {}
```

(Delete the now-unused `fromSetting`/`overridesSetting` locals; keep the existing `templateOverride` usage below.)

- [ ] **Step 4: Run it — verify it passes**

Run: `deno test --allow-all supabase/functions/send-transactional-email/index.di.test.ts`
Expected: PASS. Re-run the whole function dir to confirm no regression: `deno test --allow-all supabase/functions/send-transactional-email/`.

> If pre-existing tests seeded `app_settings` as single-object `{ when: { key: "resend_from_address" }, data: { value: "…" } }`, update them to the array row form `data: [{ org_id: null, value: "…" }]` so the resolver's `.or().then()` path returns rows it can filter.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/deps.ts supabase/functions/send-transactional-email/
git commit -m "feat(email): resolve from-address and template overrides per org"
```

---

## Part 4 — `send-offer-digest` → per-(org, artist)

Loop active orgs; gate each by **its own** `offer_digest_hour_berlin`; query that org's pending offers; group by artist; org-scoped idempotency key; pass `org_id` so Part 3 applies the org's email overrides.

### Task 4.1: Harden the cron-secret read (shared)

**Files:**
- Modify: `supabase/functions/_shared/auth.ts:81-84`

- [ ] **Step 1: Scope the read to the platform row**

In `requireCronOrRole`, change the `cron_secret` read to target the platform default explicitly:

```ts
    const { data: setting } = await deps.admin
      .from("app_settings").select("value").eq("key", "cron_secret").is("org_id", null).maybeSingle();
```

(The fake harness records `.is()` and still resolves the `when:{key:"cron_secret"}` seed, so existing auth tests stay green. Verify: `deno test --allow-all supabase/functions/_shared/auth.test.ts`.)

### Task 4.2: Org-aware offer digest

**Files:**
- Modify: `supabase/functions/send-offer-digest/index.ts` (full rewrite of `handle`)
- Test: `supabase/functions/send-offer-digest/index.di.test.ts`

- [ ] **Step 1: Update the test harness + add per-org tests**

Replace the shared seed/helper block (lines ~17–29 of `index.di.test.ts`) with the org-aware version, and add two new tests:

```ts
const ORG_1 = "00000000-0000-0000-0000-0000000000a1";
const ORG_2 = "00000000-0000-0000-0000-0000000000a2";
const cronOK = { "X-Cron-Secret": "s" };

// app_settings: cron_secret via maybeSingle (object); hour/window via resolver (rows).
const APP_SETTINGS_SEED = [
  { when: { key: "cron_secret" }, data: { value: "s" } },
  { when: { key: "offer_digest_hour_berlin" }, data: [{ org_id: null, value: 19 }] },
  { when: { key: "offer_response_window_hours" }, data: [{ org_id: null, value: 48 }] },
];

function baseDeps(extraTables: Record<string, unknown> = {}, now = BERLIN_19_CEST) {
  return makeFakeDeps({
    now,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      ...extraTables,
    },
  });
}
```

Update the two idempotency-key assertions to include the org prefix:
- `"offer-digest-artist-xyz-2026-06-01T17"` → `` `offer-digest-${ORG_1}-artist-xyz-2026-06-01T17` ``
- in the "derives from the CAPTURED now" test: `` `offer-digest-a1-${hourPrefix}` `` → `` `offer-digest-${ORG_1}-a1-${hourPrefix}` `` and `` `offer-digest-a2-${hourPrefix}` `` → `` `offer-digest-${ORG_1}-a2-${hourPrefix}` ``.

Add new per-org tests:

```ts
Deno.test("send-offer-digest: only orgs whose digest hour == Berlin hour are processed", async () => {
  // ORG_1 hour 19 (matches now=19:00), ORG_2 hour 20 (skipped).
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_19_CEST,
    tables: {
      organizations: { data: [{ id: ORG_1 }, { id: ORG_2 }], error: null },
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" } },
        { when: { key: "offer_digest_hour_berlin" }, data: [{ org_id: ORG_2, value: 20 }, { org_id: null, value: 19 }] },
        { when: { key: "offer_response_window_hours" }, data: [{ org_id: null, value: 48 }] },
      ],
      // bookings seeded per org via `when` on org_id
      bookings: [
        { when: { org_id: ORG_1 }, data: [{ id: "b1", artist_id: "a1", artists: { id: "a1", name: "Jo", email: "jo@x.com" }, show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } } }] },
        { when: { org_id: ORG_2 }, data: [{ id: "b2", artist_id: "a2", artists: { id: "a2", name: "Mo", email: "mo@x.com" }, show_dates: null }] },
      ],
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.digests_sent, 1); // only ORG_1
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  assertEquals((emails[0].body as { recipient_email: string }).recipient_email, "jo@x.com");
  assertEquals((emails[0].body as { org_id?: string }).org_id, ORG_1);
});

Deno.test("send-offer-digest: no active org matches the hour → skipped", async () => {
  const { deps } = makeFakeDeps({
    now: BERLIN_18_CEST, // 18:00, default target 19
    tables: {
      organizations: { data: [{ id: ORG_1 }], error: null },
      app_settings: APP_SETTINGS_SEED,
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.skipped, true);
});
```

- [ ] **Step 2: Run — verify failures**

Run: `deno test --allow-all supabase/functions/send-offer-digest/index.di.test.ts`
Expected: FAIL (handler is still global: no `org_id` on email, no per-org gate, idempotency key lacks org).

- [ ] **Step 3: Rewrite the handler**

```ts
// supabase/functions/send-offer-digest/index.ts
import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { getActiveOrgs, resolveOrgSetting } from "../_shared/settings.ts";

/**
 * Daily offer digest (hourly cron). For each ACTIVE org whose own
 * offer_digest_hour_berlin matches the current Berlin hour: group that org's
 * undigested suggested offers by artist, send one email per artist (rendered
 * with the org's email overrides), then stamp digest_sent_at + offer_expires_at.
 * Auth: X-Cron-Secret (pg_cron) or admin/producer JWT.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  const admin = deps.admin;

  const auth = await requireCronOrRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  const now = deps.now();
  const berlinHour = parseInt(
    new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false }).format(now),
    10,
  ) % 24;

  const orgs = await getActiveOrgs(admin);
  let digestsSent = 0;
  const processedOrgs: string[] = [];

  for (const org of orgs) {
    const targetHour = await resolveOrgSetting<number>(admin, org.id, 'offer_digest_hour_berlin', 19);
    if (berlinHour !== targetHour) continue;
    processedOrgs.push(org.id);

    const offerWindowHours = await resolveOrgSetting<number>(admin, org.id, 'offer_response_window_hours', 48);
    const offerExpiresAt = new Date(now.getTime() + offerWindowHours * 60 * 60 * 1000);
    const expiresDisplay = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(offerExpiresAt);

    const { data: pendingBookings, error: queryErr } = await admin
      .from('bookings')
      .select(`
        id,
        artist_id,
        artists ( id, name, email ),
        show_dates ( date, shows ( program, sub_program ), cities ( name ) )
      `)
      .eq('org_id', org.id)
      .eq('status', 'suggested')
      .is('digest_sent_at', null)
      .or(`offer_expires_at.is.null,offer_expires_at.gt.${now.toISOString()}`);

    if (queryErr) { console.error('send-offer-digest: query error', { org: org.id, error: queryErr.message }); continue; }
    if (!pendingBookings || pendingBookings.length === 0) continue;

    type GroupedEntry = { recipientEmail: string; displayName: string; bookingIds: string[]; offers: Array<{ show: string; date: string; city: string; expires: string }> };
    const grouped = new Map<string, GroupedEntry>();
    for (const b of pendingBookings as any[]) {
      const artist = b.artists;
      const recipientEmail = artist?.email;
      if (!recipientEmail) continue;
      const sd = b.show_dates;
      const program = sd?.shows?.program;
      const subProgram = sd?.shows?.sub_program;
      const show = program ? (subProgram ? `${program} — ${subProgram}` : program) : 'Unknown show';
      if (!grouped.has(b.artist_id)) {
        grouped.set(b.artist_id, { recipientEmail, displayName: artist?.name ?? '', bookingIds: [], offers: [] });
      }
      const entry = grouped.get(b.artist_id)!;
      entry.bookingIds.push(b.id);
      entry.offers.push({ show, date: sd?.date ?? '—', city: sd?.cities?.name ?? '—', expires: expiresDisplay });
    }

    for (const [artistId, entry] of grouped) {
      try {
        await deps.sendEmail({
          template_name: 'artist-offer-digest',
          recipient_email: entry.recipientEmail,
          org_id: org.id,
          templateData: { displayName: entry.displayName, offers: entry.offers },
          idempotency_key: `offer-digest-${org.id}-${artistId}-${now.toISOString().slice(0, 13)}`,
        });
        const { error: stampErr } = await admin
          .from('bookings')
          .update({ digest_sent_at: now.toISOString(), offer_expires_at: offerExpiresAt.toISOString() })
          .in('id', entry.bookingIds);
        if (stampErr) { console.error('send-offer-digest: stamp failed — will re-send next run', { org: org.id, artistId, error: stampErr.message }); continue; }
        digestsSent += 1;
      } catch (e) {
        console.error('send-offer-digest: email send failed', { org: org.id, artistId, error: (e as Error).message });
      }
    }
  }

  if (processedOrgs.length === 0) {
    return json({ skipped: true, reason: `No active org has digest hour ${berlinHour}` });
  }
  return json({ digests_sent: digestsSent });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run — verify passes**

Run: `deno test --allow-all supabase/functions/send-offer-digest/`
Expected: PASS (updated di tests + new per-org tests). The legacy `index.test.ts` is unaffected (it tests local mirror helpers).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/auth.ts supabase/functions/send-offer-digest/
git commit -m "feat(digest): per-(org,artist) offer digest with per-org hour gate"
```

---

## Part 5 — `send-confirmation-digest` → per-(org, artist)

Identical shape to Part 4: loop active orgs, gate by each org's `confirmation_digest_hour_berlin` (default 20), query that org's confirmed-but-undigested bookings, group by artist, org-scoped idempotency key, pass `org_id`.

### Task 5.1: Org-aware confirmation digest

**Files:**
- Modify: `supabase/functions/send-confirmation-digest/index.ts` (full rewrite of `handle`)
- Test: `supabase/functions/send-confirmation-digest/index.di.test.ts`

- [ ] **Step 1: Update test harness + add per-org tests** — mirror Task 4.2 Step 1: add `organizations` to the base seed; convert `confirmation_digest_hour_berlin` to resolver row form `data: [{ org_id: null, value: 20 }]`; update idempotency-key assertions to `` `confirmation-digest-${ORG_1}-<artist>-<hour>` ``; add the "only matching-hour orgs processed" and "no org matches → skipped" tests (same structure, hour default 20).

- [ ] **Step 2: Run — verify failures**

Run: `deno test --allow-all supabase/functions/send-confirmation-digest/index.di.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite the handler**

```ts
// supabase/functions/send-confirmation-digest/index.ts
import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { getActiveOrgs, resolveOrgSetting } from "../_shared/settings.ts";

/**
 * Daily confirmation digest (hourly cron). For each ACTIVE org whose own
 * confirmation_digest_hour_berlin matches the current Berlin hour: group that
 * org's confirmed bookings without a confirmation_digest_sent_at stamp by artist,
 * send one email per artist (org email overrides), then stamp.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  const admin = deps.admin;

  const auth = await requireCronOrRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  const now = deps.now();
  const berlinHour = parseInt(
    new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false }).format(now),
    10,
  ) % 24;

  const orgs = await getActiveOrgs(admin);
  let digestsSent = 0;
  const processedOrgs: string[] = [];

  for (const org of orgs) {
    const targetHour = await resolveOrgSetting<number>(admin, org.id, 'confirmation_digest_hour_berlin', 20);
    if (berlinHour !== targetHour) continue;
    processedOrgs.push(org.id);

    const { data: confirmedBookings, error: queryErr } = await admin
      .from('bookings')
      .select(`
        id,
        artist_id,
        artists ( id, name, email ),
        show_dates ( date, shows ( program, sub_program ), cities ( name ) )
      `)
      .eq('org_id', org.id)
      .eq('status', 'confirmed')
      .is('confirmation_digest_sent_at', null);

    if (queryErr) { console.error('send-confirmation-digest: query error', { org: org.id, error: queryErr.message }); continue; }
    if (!confirmedBookings || confirmedBookings.length === 0) continue;

    type GroupedEntry = { recipientEmail: string; displayName: string; bookingIds: string[]; bookings: Array<{ show: string; date: string; city: string }> };
    const grouped = new Map<string, GroupedEntry>();
    for (const b of confirmedBookings as any[]) {
      const artist = b.artists;
      const recipientEmail = artist?.email;
      if (!recipientEmail) continue;
      const sd = b.show_dates;
      const program = sd?.shows?.program;
      const subProgram = sd?.shows?.sub_program;
      const show = program ? (subProgram ? `${program} — ${subProgram}` : program) : 'Unknown show';
      if (!grouped.has(b.artist_id)) {
        grouped.set(b.artist_id, { recipientEmail, displayName: artist?.name ?? '', bookingIds: [], bookings: [] });
      }
      const entry = grouped.get(b.artist_id)!;
      entry.bookingIds.push(b.id);
      entry.bookings.push({ show, date: sd?.date ?? '—', city: sd?.cities?.name ?? '—' });
    }

    for (const [artistId, entry] of grouped) {
      try {
        await deps.sendEmail({
          template_name: 'artist-confirmation-digest',
          recipient_email: entry.recipientEmail,
          org_id: org.id,
          templateData: { displayName: entry.displayName, bookings: entry.bookings },
          idempotency_key: `confirmation-digest-${org.id}-${artistId}-${now.toISOString().slice(0, 13)}`,
        });
        const { error: stampErr } = await admin
          .from('bookings')
          .update({ confirmation_digest_sent_at: now.toISOString() })
          .in('id', entry.bookingIds);
        if (stampErr) { console.error('send-confirmation-digest: stamp failed', { org: org.id, artistId, error: stampErr.message }); }
        digestsSent += 1;
      } catch (e) {
        console.error('send-confirmation-digest: email send failed', { org: org.id, artistId, error: (e as Error).message });
      }
    }
  }

  if (processedOrgs.length === 0) {
    return json({ skipped: true, reason: `No active org has confirmation digest hour ${berlinHour}` });
  }
  return json({ digests_sent: digestsSent });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

> Note: the original incremented `digestsSent` even when the stamp errored (it only logs). This rewrite preserves that exact behavior.

- [ ] **Step 4: Run — verify passes**

Run: `deno test --allow-all supabase/functions/send-confirmation-digest/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-confirmation-digest/
git commit -m "feat(digest): per-(org,artist) confirmation digest with per-org hour gate"
```

---

## Part 6 — `expire-offers` → per-org slot defaults + notification `org_id`

`expire_soft_bookings()` stays a single global RPC (expiry is a pure per-booking timestamp). The escalation pass resolves `sub_program_slots_defaults` per the show_date's **own** org (cached per org), and the escalation notifications gain `org_id`.

### Task 6.1: Per-org slot resolution in expire-offers

**Files:**
- Modify: `supabase/functions/expire-offers/index.ts:37-42, 91-103`
- Test: `supabase/functions/expire-offers/index.di.test.ts`

- [ ] **Step 1: Write the failing test** (append to di test)

```ts
import { assertExists } from "../_shared/test-asserts.ts"; // add to the existing import if missing

Deno.test("expire-offers: resolves slot defaults per the show_date's org and stamps notification org_id", async () => {
  const ORG = "00000000-0000-0000-0000-0000000000a1";
  const { deps } = makeFakeDeps({
    now: new Date("2026-06-01T12:00:00.000Z"),
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" } },
        // resolver row form — P/S needs 1 slot, so an expired tier with 0 accepted escalates
        { when: { key: "sub_program_slots_defaults" }, data: [{ org_id: null, value: { P: { S: { main_cast: 1, understudies: 0 } } } }] },
      ],
      show_date_offer_tiers: { data: [{ id: "t1", show_date_id: "sd1", tier: 1, escalation_notified_at: null }], error: null },
      show_dates: { data: { id: "sd1", date: "2026-06-10", city_id: "c1", org_id: ORG, show: { program: "P", sub_program: "S" } }, error: null },
      bookings: { data: [{ status: "suggested", offer_expires_at: "2026-05-01T00:00:00Z" }], error: null }, // expired, 0 accepted
      org_memberships: { data: [{ user_id: "admin-1" }], error: null }, // admin fallback (resolve_show_assignments empty)
      notifications: { data: null, error: null },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null }, resolve_show_assignments: { data: [], error: null } },
  });

  // Capture the notifications insert payload.
  let notifPayload: any = null;
  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (t: string) => {
    const chain = originalFrom(t);
    if (t === "notifications") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { notifPayload = p; return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "s" } }), deps);
  assertEquals(res.status, 200);
  assertExists(notifPayload); // escalation fired
  assertEquals(notifPayload[0].org_id, ORG); // notification carries the show_date's org_id
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `deno test --allow-all supabase/functions/expire-offers/index.di.test.ts`
Expected: FAIL — global slot read; notification rows have no `org_id`.

- [ ] **Step 3: Implement**

Add the import: `import { resolveOrgSetting } from "../_shared/settings.ts";` and `type SlotDefaults = Record<string, Record<string, { main_cast: number; understudies: number }>>;`

Delete the global slot read (lines 37–42). Add a per-org cache before the loop:

```ts
  const slotCache = new Map<string, SlotDefaults>();
  const slotsForOrg = async (orgId: string): Promise<SlotDefaults> => {
    if (!slotCache.has(orgId)) {
      slotCache.set(orgId, await resolveOrgSetting<SlotDefaults>(admin, orgId, 'sub_program_slots_defaults', {}));
    }
    return slotCache.get(orgId)!;
  };
```

Inside the loop, after fetching `sd`, resolve slots for its org:

```ts
    const slotDefaults = await slotsForOrg((sd as any).org_id);
    const slotCfg = slotDefaults?.[program]?.[subProgram];
    if (!slotCfg) continue;
```

Add `org_id` to the notification rows:

```ts
    const notifRows = recipientIds.map((uid: string) => ({
      org_id: (sd as any).org_id,
      user_id: uid,
      type: 'cast_escalation_requested',
      title: 'Escalation needed',
      message,
      related_entity_type: 'show_date_offer_tier',
      related_entity_id: row.id,
    }))
```

- [ ] **Step 4: Run — verify passes**

Run: `deno test --allow-all supabase/functions/expire-offers/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/expire-offers/
git commit -m "feat(expire-offers): per-org slot defaults; stamp escalation notif org_id"
```

---

## Part 7 — `tier-at-risk-watcher` → per-org slot defaults + notification `org_id`

### Task 7.1: Per-org slot resolution in tier-at-risk-watcher

**Files:**
- Modify: `supabase/functions/tier-at-risk-watcher/index.ts:49-54, 64-78, 114-127`
- Test: `supabase/functions/tier-at-risk-watcher/index.di.test.ts`

- [ ] **Step 1: Write the failing test** (append to di test) — mirror Task 6.1: seed one open tier whose show_date is in `ORG`, `sub_program_slots_defaults` resolver seed requiring more slots than present (so it is at risk), and assert the inserted `tier_at_risk` notification row has `org_id === ORG`.

- [ ] **Step 2: Run — verify it fails**

Run: `deno test --allow-all supabase/functions/tier-at-risk-watcher/index.di.test.ts`
Expected: FAIL — global slot read; notification rows lack `org_id`.

- [ ] **Step 3: Implement** — same pattern as Part 6:
  - Add `import { resolveOrgSetting } from "../_shared/settings.ts";` + the `SlotDefaults` type + `slotCache`/`slotsForOrg` helper.
  - Delete the global slot read (lines 49–54).
  - Inside the per-tier loop, after fetching `sd`: `const slotDefaults = await slotsForOrg((sd as any).org_id);` then `const slotCfg = slotDefaults?.[program]?.[subProgram];`.
  - Add `org_id: (sd as any).org_id` as the first field of each `newRows` notification object.

- [ ] **Step 4: Run — verify passes**

Run: `deno test --allow-all supabase/functions/tier-at-risk-watcher/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/tier-at-risk-watcher/
git commit -m "feat(tier-at-risk): per-org slot defaults; stamp notif org_id"
```

---

## Part 8 — `airtable-poll` → per-org sync with Vault-stored keys

Per-org base/table (settings resolver) + per-org API key (Vault). Iterate active orgs with `airtable_sync_enabled`; org-scope the `shows`/`cities` lookup maps so a record only matches that org's shows; stamp `org_id` on `airtable_sync_log`. `show_dates.org_id` is derived from the matched show by the Part-2 trigger.

### Task 8.1: Vault getter/setter RPCs

**Files:**
- Create: `supabase/migrations/20260604131000_org_airtable_vault.sql`
- Test: `supabase/tests/rpc/org_airtable_key.sql`

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/rpc/org_airtable_key.sql
-- set_org_airtable_key: only an admin of the org may set; get_org_airtable_key
-- is not executable by `authenticated`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000a17a', 'AirOrg', 'air-org');
-- a member who is an admin of the org
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000a17a', '00000000-0000-0000-0000-0000000ad317', 'admin');
SET session_replication_role = DEFAULT;

-- getter must NOT be granted to authenticated
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.get_org_airtable_key(uuid)', 'EXECUTE'),
  'get_org_airtable_key is not executable by authenticated');

-- setter as the org admin succeeds
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000ad317"}', true);
SELECT lives_ok(
  $$ SELECT public.set_org_airtable_key('00000000-0000-0000-0000-00000000a17a', 'key_abc') $$,
  'org admin can set the org airtable key');

-- setter as a non-member is rejected
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000beef"}', true);
SELECT throws_ok(
  $$ SELECT public.set_org_airtable_key('00000000-0000-0000-0000-00000000a17a', 'key_xyz') $$,
  'forbidden',
  'non-admin cannot set the org airtable key');

SELECT * FROM finish();
ROLLBACK;
```

> `has_org_role` reads `auth.uid()`, which derives from `request.jwt.claims.sub`. Confirm the helper resolves `auth.uid()` from that GUC in this project's pgTAP setup (the existing `supabase/tests/rpc/accept_invitation.sql` uses the same `set_config('request.jwt.claims', …)` idiom — match whatever it does).

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/20260604131000_org_airtable_vault.sql
-- Per-org Airtable API keys, stored in Supabase Vault (encrypted at rest), kept
-- OUT of member-readable app_settings. Setter is guarded by org-admin; getter is
-- service-role only (read by airtable-poll). Secret name: 'airtable_api_key:'||org.

create or replace function public.set_org_airtable_key(_org uuid, _key text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := 'airtable_api_key:' || _org::text; v_id uuid;
begin
  if not public.has_org_role(auth.uid(), _org, 'admin') then
    raise exception 'forbidden';
  end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(_key, v_name, 'Airtable API key for org ' || _org::text);
  else
    perform vault.update_secret(v_id, _key);
  end if;
end; $$;

create or replace function public.get_org_airtable_key(_org uuid)
returns text language sql security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'airtable_api_key:' || _org::text
  limit 1
$$;

-- Setter: callable by authenticated (guarded internally by has_org_role).
revoke all on function public.set_org_airtable_key(uuid, text) from public;
grant execute on function public.set_org_airtable_key(uuid, text) to authenticated;

-- Getter: service-role only (edge functions). NOT authenticated.
revoke all on function public.get_org_airtable_key(uuid) from public, authenticated;
grant execute on function public.get_org_airtable_key(uuid) to service_role;
```

- [ ] **Step 3: Commit + (CI) verify** — save as `supabase/migrations/20260604131000_org_airtable_vault.sql`, commit, push. The PR preview branch + CI apply it; confirm `supabase test db` is green for `org_airtable_key.sql`. Do **not** apply to the live project.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260604131000_org_airtable_vault.sql supabase/tests/rpc/org_airtable_key.sql
git commit -m "feat(db): per-org Airtable key vault RPCs (admin setter, service getter)"
```

### Task 8.2: Org-aware airtable-poll handler

**Files:**
- Modify: `supabase/functions/airtable-poll/index.ts` (extract per-org sync; loop active orgs)
- Create: `supabase/functions/airtable-poll/index.org.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/airtable-poll/index.org.test.ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG_ON = "00000000-0000-0000-0000-0000000000a1";
const ORG_OFF = "00000000-0000-0000-0000-0000000000a2";
const auth = { "X-Cron-Secret": "s" };

Deno.test("airtable-poll: skips orgs with sync disabled or no key; syncs the enabled+keyed org", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    envVars: {},
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG_ON, value: true }, { org_id: ORG_OFF, value: false }, { org_id: null, value: false }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG_ON, value: "appABCDEFGHIJKLMNO" }, { org_id: null, value: null }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG_ON, value: "ShowDates" }, { org_id: null, value: null }] },
      ],
      organizations: { data: [{ id: ORG_ON }, { id: ORG_OFF }], error: null },
      shows: { data: [{ id: "show-on", program: "P", sub_program: null }], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: null, error: null },
    },
    rpcs: {
      get_org_airtable_key: { data: "key_on", error: null },
    },
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ records: [] }), { status: 200 })),
  });

  // capture sync_log inserts
  const logs: any[] = [];
  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (t: string) => {
    const chain = originalFrom(t);
    if (t === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { logs.push(p); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  const res = await handle(makeRequest({ headers: auth }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  // one org synced
  assertEquals(body.orgs_synced, 1);
  // sync_log carries the org_id of the synced org
  assertEquals(logs.length, 1);
  assertEquals(logs[0].org_id, ORG_ON);
});

Deno.test("airtable-poll: org with sync enabled but no Vault key is skipped (no fetch)", async () => {
  let fetched = 0;
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG_ON, value: true }, { org_id: null, value: false }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG_ON, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG_ON, value: "ShowDates" }] },
      ],
      organizations: { data: [{ id: ORG_ON }], error: null },
      shows: { data: [], error: null }, cities: { data: [], error: null },
      show_dates: { data: [], error: null }, airtable_sync_log: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: null, error: null } }, // no key
    fetchImpl: () => { fetched++; return Promise.resolve(new Response("{}", { status: 200 })); },
  });
  const res = await handle(makeRequest({ headers: auth }), deps);
  assertEquals(res.status, 200);
  assertEquals(fetched, 0);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `deno test --allow-all supabase/functions/airtable-poll/index.org.test.ts`
Expected: FAIL (handler is global; no `orgs_synced`, no per-org key, no `org_id` on sync_log).

- [ ] **Step 3: Rewrite the handler**

Restructure `index.ts` so the cron-secret check + active-org loop live in `handle`, and the existing per-base sync body becomes `syncOrg(deps, orgId, baseId, tableName, apiKey, now)`. Key changes from the current file:
- Harden the cron-secret read: `.eq('key','cron_secret').is('org_id', null).maybeSingle()`.
- Read config per org via `resolveOrgSetting(admin, orgId, 'airtable_sync_enabled'|'airtable_base_id'|'airtable_table_name', …)`; **skip** the org when disabled, unconfigured, or invalid base format.
- Read the key via `const { data: apiKey } = await admin.rpc('get_org_airtable_key', { _org: orgId })`; **skip** the org when `!apiKey` (replaces the `env('AIRTABLE_API_KEY')` read).
- Scope the lookup maps per org: `shows` and `cities` queries gain `.eq('org_id', orgId)`; the existing-`show_dates` bulk-load gains `.eq('org_id', orgId)`.
- Stamp `org_id: orgId` on every `airtable_sync_log` insert inside `syncOrg`.
- `handle` accumulates `{ orgs_synced, processed, new_dates, tiers_opened, skipped }` across orgs and returns the totals.

```ts
// supabase/functions/airtable-poll/index.ts
import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { getActiveOrgs, resolveOrgSetting } from "../_shared/settings.ts";

const OFFER_TIER_BATCH_SIZE = 10;

async function openOfferTierBatch(deps: Deps, ids: string[]): Promise<number> {
  let opened = 0;
  for (let i = 0; i < ids.length; i += OFFER_TIER_BATCH_SIZE) {
    const batch = ids.slice(i, i + OFFER_TIER_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((id) => deps.invokeFunction('open-offer-tier', { show_date_id: id, tier: 1 })),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.error) console.error('airtable-poll: open-offer-tier failed', { error: result.value.error });
        else opened += 1;
      } else {
        console.error('airtable-poll: open-offer-tier threw', { reason: result.reason });
      }
    }
  }
  return opened;
}

interface OrgSyncResult { processed: number; new_dates: number; tiers_opened: number; skipped: number }

/** Sync one org's Airtable base into its show_dates. org_id on show_dates comes
 *  from the derive trigger (parent show); the lookup maps are org-scoped here so
 *  a record only ever matches THIS org's shows/cities. */
async function syncOrg(deps: Deps, orgId: string, baseId: string, tableName: string, apiKey: string): Promise<OrgSyncResult> {
  const admin = deps.admin;

  const { data: shows } = await admin.from('shows').select('id, program, sub_program').eq('org_id', orgId).limit(10000);
  const showsByName = new Map<string, string>();
  for (const s of shows ?? []) {
    if (s.program) {
      const key = `${String(s.program).toLowerCase()}|${s.sub_program ? String(s.sub_program).toLowerCase() : ''}`;
      showsByName.set(key, s.id);
    }
  }

  const { data: citiesRows } = await admin.from('cities').select('id, name').eq('org_id', orgId).limit(10000);
  const citiesByName = new Map<string, string>();
  for (const c of citiesRows ?? []) citiesByName.set(c.name.toLowerCase(), c.id);

  const existingByAirtableId = new Map<string, string>();
  {
    const PAGE_SIZE = 1000;
    let page = 0;
    while (true) {
      const { data: batch } = await admin
        .from('show_dates').select('id, airtable_record_id')
        .eq('org_id', orgId).not('airtable_record_id', 'is', null)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (!batch || batch.length === 0) break;
      for (const r of batch as any[]) if (r.airtable_record_id) existingByAirtableId.set(r.airtable_record_id as string, r.id as string);
      if (batch.length < PAGE_SIZE) break;
      page += 1;
    }
  }

  const encodedTable = encodeURIComponent(tableName);
  const airtableBaseUrl = `https://api.airtable.com/v0/${baseId}/${encodedTable}?view=Grid%20view`;
  let processed = 0, newDates = 0, skippedRecords = 0;
  const newDateIds: string[] = [];
  let offset: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 100;

  do {
    pageCount += 1;
    const url = offset ? `${airtableBaseUrl}&offset=${encodeURIComponent(offset)}` : airtableBaseUrl;
    const airtableRes = await deps.fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!airtableRes.ok) {
      const errBody = (await airtableRes.text()).slice(0, 500);
      const partial = await openOfferTierBatch(deps, newDateIds);
      await admin.from('airtable_sync_log').insert({ org_id: orgId, sync_type: 'airtable_poll', status: 'error', records_processed: processed, error_details: `Airtable API error ${airtableRes.status}: ${errBody}`, synced_at: deps.now().toISOString() });
      throw { httpStatus: 502, body: { error: `Airtable API error: ${airtableRes.status}`, org_id: orgId, new_dates: newDates, tiers_opened: partial } };
    }
    const pageData = await airtableRes.json();
    offset = pageData.offset;
    for (const record of (pageData.records ?? []) as Array<{ id: string; fields: Record<string, any> }>) {
      const fields = record.fields;
      const airtableRecordId = record.id;
      const dateValue = fields['Date'] ?? fields['date'] ?? fields['Show Date'] ?? null;
      if (!dateValue) continue;
      const showName = fields['Show'] ?? fields['show'] ?? fields['Show Name'] ?? null;
      const showSubProgram = fields['Sub Program'] ?? fields['sub_program'] ?? null;
      let showId: string | null = null;
      if (showName) {
        const nameKey = String(showName).toLowerCase();
        const subKey = showSubProgram ? String(showSubProgram).toLowerCase() : '';
        showId = showsByName.get(`${nameKey}|${subKey}`) ?? showsByName.get(`${nameKey}|`) ?? null;
      }
      if (!showId) { skippedRecords += 1; continue; }
      const cityName = fields['City'] ?? fields['city'] ?? null;
      let cityId: string | null = null;
      if (cityName && citiesByName.has(String(cityName).toLowerCase())) cityId = citiesByName.get(String(cityName).toLowerCase())!;
      const rawSession1 = fields['Session 1'] ?? fields['session_1'] ?? fields['Start Time'];
      const m = rawSession1 ? String(rawSession1).match(/T?(\d{2}:\d{2})(:\d{2})?/) : null;
      const session1 = m ? m[1] : '00:00';

      const existingId = existingByAirtableId.get(airtableRecordId);
      if (existingId) {
        const payload: Record<string, unknown> = { date: dateValue, session_1: session1 };
        if (cityId !== null) payload.city_id = cityId;
        const { error } = await admin.from('show_dates').update(payload).eq('id', existingId);
        if (!error) processed += 1;
        continue;
      }
      // org_id is set by the derive trigger from show_id.
      const { data: inserted, error: insertErr } = await admin.from('show_dates')
        .insert({ show_id: showId, date: dateValue, airtable_record_id: airtableRecordId, city_id: cityId, session_1: session1 })
        .select('id').single();
      if (insertErr) continue;
      if (inserted?.id) { processed += 1; newDates += 1; newDateIds.push(inserted.id); existingByAirtableId.set(airtableRecordId, inserted.id); }
    }
  } while (offset && pageCount < MAX_PAGES);

  const tiersOpened = await openOfferTierBatch(deps, newDateIds);
  const truncated = pageCount >= MAX_PAGES && !!offset;
  const parts: string[] = [];
  if (truncated) parts.push(`Reached MAX_PAGES (${MAX_PAGES}); sync is incomplete`);
  if (newDateIds.length - tiersOpened > 0) parts.push(`${newDateIds.length - tiersOpened} of ${newDateIds.length} open-offer-tier calls failed`);
  if (skippedRecords > 0) parts.push(`${skippedRecords} records skipped (unresolved show)`);
  await admin.from('airtable_sync_log').insert({ org_id: orgId, sync_type: 'airtable_poll', status: (truncated || newDateIds.length - tiersOpened > 0) ? 'partial' : 'success', records_processed: processed, error_details: parts.length ? parts.join('; ') : null, synced_at: deps.now().toISOString() });

  return { processed, new_dates: newDates, tiers_opened: tiersOpened, skipped: skippedRecords };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  const admin = deps.admin;

  // Cron-only auth (hardened to the platform cron_secret row).
  const cronSecretHeader = req.headers.get('X-Cron-Secret');
  if (!cronSecretHeader) return json({ error: 'Unauthorized' }, 401);
  const { data: secretSetting } = await admin
    .from('app_settings').select('value').eq('key', 'cron_secret').is('org_id', null).maybeSingle();
  if (cronSecretHeader !== ((secretSetting?.value as string | null) ?? '')) return json({ error: 'Unauthorized' }, 401);

  const orgs = await getActiveOrgs(admin);
  const totals = { orgs_synced: 0, processed: 0, new_dates: 0, tiers_opened: 0, skipped: 0 };

  for (const org of orgs) {
    const enabled = await resolveOrgSetting<boolean>(admin, org.id, 'airtable_sync_enabled', false);
    if (!enabled) continue;
    const baseId = await resolveOrgSetting<string | null>(admin, org.id, 'airtable_base_id', null);
    const tableName = await resolveOrgSetting<string | null>(admin, org.id, 'airtable_table_name', null);
    if (!baseId || !tableName) continue;
    if (!/^app[A-Za-z0-9]{14,}$/.test(baseId)) {
      await admin.from('airtable_sync_log').insert({ org_id: org.id, sync_type: 'airtable_poll', status: 'error', records_processed: 0, error_details: 'airtable_base_id has unexpected format; expected app + 14 alphanumeric chars', synced_at: deps.now().toISOString() });
      continue;
    }
    const { data: apiKey } = await admin.rpc('get_org_airtable_key', { _org: org.id });
    if (!apiKey) continue; // sync enabled but no key configured

    try {
      const r = await syncOrg(deps, org.id, baseId, tableName, apiKey as string);
      totals.orgs_synced += 1;
      totals.processed += r.processed; totals.new_dates += r.new_dates;
      totals.tiers_opened += r.tiers_opened; totals.skipped += r.skipped;
    } catch (e) {
      console.error('airtable-poll: org sync failed', { org: org.id, error: (e as any)?.body ?? (e as Error).message });
      // continue with the next org; sync_log already recorded the error inside syncOrg
    }
  }

  return json(totals);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run the new test — verify passes**

Run: `deno test --allow-all supabase/functions/airtable-poll/index.org.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the existing `index.di.test.ts` for the per-org shape**

The legacy di tests assert single-base behavior + an `AIRTABLE_API_KEY` env. Update them to the per-org model:
- Add `organizations: { data: [{ id: ORG }], error: null }` (define `const ORG = "00000000-0000-0000-0000-0000000000a1";`) to every `makeFakeDeps` call.
- Replace the `{ data: BASE_SETTINGS_DATA }` fallback seed with per-key resolver rows scoped to `ORG`:
  ```ts
  { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
  { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
  { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "ShowDates" }] },
  ```
- Replace `envVars: { AIRTABLE_API_KEY: "…" }` with `rpcs: { get_org_airtable_key: { data: "key", error: null } }`.
- Update response-shape assertions: the handler now returns `{ orgs_synced, processed, new_dates, tiers_opened, skipped }` (no top-level error on a single org's Airtable failure — that org is logged and skipped). Tests that asserted a 502 for an Airtable API error should instead assert the run still returns 200 with `orgs_synced: 0` and that `airtable_sync_log` got an `error` row carrying `org_id`. Tests for "sync disabled / missing base / invalid base" now assert the org is skipped (`orgs_synced: 0`) rather than a top-level `skipped` body.
- Keep the field-mapping / show-resolution / session parsing tests; they exercise `syncOrg` through `handle` with one enabled org. The `from()`-wrapping insert-capture pattern is unchanged.

Run: `deno test --allow-all supabase/functions/airtable-poll/` until green. (This is the most labor-intensive test update in the plan; CI's Deno job is the final oracle.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/airtable-poll/
git commit -m "feat(airtable): per-org sync (base/table/Vault key), org-scoped lookups + sync_log"
```

### Task 8.3: Settings UI — write-only Airtable API-key field

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (Airtable section, near the `airtable_base_id`/`airtable_table_name` controls)
- Test: extend the existing `SettingsPage` test if present (else CI vitest covers compile/typecheck)

- [ ] **Step 1: Add the field + mutation**

In the Airtable settings section, add a password-type input bound to local state and a "Save key" button whose mutation calls the setter RPC for the active org:

```tsx
// inside the Airtable settings component, with the other useState hooks:
const [airtableKey, setAirtableKey] = useState('');

const saveAirtableKey = useMutation({
  mutationFn: async () => {
    if (!currentOrg) throw new Error('No active organization');
    if (!airtableKey.trim()) throw new Error('Enter an API key');
    const { error } = await supabase.rpc('set_org_airtable_key', {
      _org: currentOrg.id,
      _key: airtableKey.trim(),
    });
    if (error) throw error;
  },
  onSuccess: () => { setAirtableKey(''); toast.success('Airtable API key saved'); },
  onError: (e: any) => toast.error(e.message),
});
```

```tsx
{/* Write-only: the key is stored in Vault and never read back into the UI. */}
<div className="space-y-2">
  <Label htmlFor="airtable-key">Airtable API key</Label>
  <div className="flex gap-2">
    <Input id="airtable-key" type="password" autoComplete="off" placeholder="key… (write-only)"
      value={airtableKey} onChange={(e) => setAirtableKey(e.target.value)} />
    <Button onClick={() => saveAirtableKey.mutate()} disabled={saveAirtableKey.isPending}>Save key</Button>
  </div>
  <p className="text-sm text-muted-foreground">Stored encrypted; never displayed. Required for Airtable sync.</p>
</div>
```

> `set_org_airtable_key` won't exist in `types.ts` until Part 10; until then cast: `supabase.rpc('set_org_airtable_key' as never, { _org: currentOrg.id, _key: airtableKey.trim() } as never)`. Remove the cast in Part 10. Match the file's existing imports (`useMutation`, `toast`, `Input`, `Label`, `Button`, `currentOrg` from `useAuth`).

- [ ] **Step 2: (CI) typecheck + vitest** — push; confirm the Typecheck and vitest jobs pass. Commit:

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat(settings): write-only Airtable API key field (Vault setter RPC)"
```

---

## Part 9 — Drop the bootstrap `org_id` column DEFAULTs

The gated finale. By now **every** insert path sets `org_id`: FK-children via Part-2 triggers, roots explicitly (casts/cities/skills from Phase 2; shows/show_dates via dashboard or the show derive), notifications/audit via Parts 2/6/7, airtable_sync_log via Part 8. Now remove the `b007` DEFAULT so a missed path fails loudly instead of silently landing in the bootstrap org.

### Task 9.1: Pre-drop audit (no code — a checklist)

- [ ] **Step 1: Confirm coverage.** Run and eyeball:

```bash
cd "/Users/stefanschaal/Claude Code/showflow-pro"
# Tenant tables still carrying the bootstrap DEFAULT:
grep -rn "b007" supabase/migrations/20260603120100_add_org_id_to_tenant_tables.sql
# Every client insert sets org_id OR writes to an FK-child covered by a Part-2 trigger:
grep -rEn "\.from\((['\"])(shows|artists|casts|cities|skills|show_assignments|notifications|airtable_sync_log)\1\)" src --include=*.ts --include=*.tsx
```

For each **root / parentless** tenant table (`shows`, `artists`, `casts`, `cities`, `skills`, `show_assignments`, `notifications`, `airtable_sync_log`), confirm every insert path sets `org_id` (client, edge, RPC, trigger). FK-children are covered by Part 2. Note findings in the commit body. If `show_assignments` has any insert path lacking `org_id`, fix it (set the active org / derive from the show) before proceeding — it has no FK-parent trigger.

### Task 9.2: pgTAP — parent↔child consistency

**Files:**
- Create: `supabase/tests/db/org_id_parent_child_consistency.sql`

- [ ] **Step 2: Write the test**

```sql
-- supabase/tests/db/org_id_parent_child_consistency.sql
-- Structural invariant: no child row's org_id diverges from its parent's. With the
-- Part-2 derive triggers and the Part-9 DEFAULT drop, this must hold for all data.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SELECT is((SELECT count(*) FROM public.show_dates sd JOIN public.shows s ON s.id = sd.show_id WHERE sd.org_id <> s.org_id), 0::bigint, 'show_dates.org_id matches shows');
SELECT is((SELECT count(*) FROM public.bookings b JOIN public.show_dates sd ON sd.id = b.show_date_id WHERE b.org_id <> sd.org_id), 0::bigint, 'bookings.org_id matches show_dates');
SELECT is((SELECT count(*) FROM public.show_date_offer_tiers t JOIN public.show_dates sd ON sd.id = t.show_date_id WHERE t.org_id <> sd.org_id), 0::bigint, 'tiers.org_id matches show_dates');
SELECT is((SELECT count(*) FROM public.cast_members cm JOIN public.casts c ON c.id = cm.cast_id WHERE cm.org_id <> c.org_id), 0::bigint, 'cast_members.org_id matches casts');
SELECT is((SELECT count(*) FROM public.artist_skills a JOIN public.artists ar ON ar.id = a.artist_id WHERE a.org_id <> ar.org_id), 0::bigint, 'artist_skills.org_id matches artists');
SELECT is((SELECT count(*) FROM public.chat_messages m JOIN public.chats ch ON ch.id = m.chat_id WHERE m.org_id <> ch.org_id), 0::bigint, 'chat_messages.org_id matches chats');

SELECT * FROM finish();
ROLLBACK;
```

### Task 9.3: The drop-default migration

**Files:**
- Create: `supabase/migrations/20260604132000_drop_bootstrap_org_defaults.sql`

- [ ] **Step 3: Write the migration**

```sql
-- Phase 3 (Part 9): drop the bootstrap-org column DEFAULT from every tenant table.
-- org_id is now set on every insert path (Part-2 derive triggers for FK-children;
-- explicit for roots and the parentless writers). Removing the DEFAULT makes a
-- missed path fail loudly (NOT NULL) rather than silently land in the bootstrap org.
-- (app_settings already dropped its default in 20260604120000.)
do $$
declare t text;
begin
  foreach t in array array[
    'shows','show_dates','show_date_offer_tiers','show_cast_eligibility',
    'show_date_cast_eligibility','bookings','booking_audit_log','casts',
    'cast_members','cast_city_priority','cities','skills','artist_skills',
    'blocked_dates','show_assignments','chats','chat_messages',
    'notifications','airtable_sync_log','artists'
  ] loop
    execute format('alter table public.%I alter column org_id drop default', t);
  end loop;
end $$;
```

- [ ] **Step 4: Commit + (CI) verify** — save as `supabase/migrations/20260604132000_drop_bootstrap_org_defaults.sql`, commit, push. The preview branch + CI apply it. Confirm the FULL pgTAP suite is green: the new consistency test, the Part-2 derivation test, **and the existing isolation + coverage suites**. Then exercise the edge functions' Deno suite once more (`deno test --allow-all supabase/functions/`) — nothing should regress. Do **not** apply to the live project.

> If any pgTAP fixture inserts a root row (shows/artists/etc.) without `org_id` relying on the old default, it will now fail with a NOT NULL violation. Fix those fixtures to supply `org_id` (the isolation/coverage suites already seed it explicitly; this mainly affects older trigger fixtures).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260604132000_drop_bootstrap_org_defaults.sql supabase/tests/db/org_id_parent_child_consistency.sql
git commit -m "feat(db): drop bootstrap org_id DEFAULTs; assert parent-child org_id consistency"
```

---

## Part 10 — Regenerate `types.ts` + cleanup `as any` casts

`types.ts` is stale (missing `accept_invitation`, `get_org_setting`, `seed_org_starter_catalog`, and now `set_org_airtable_key`/`get_org_airtable_key`; still lists dropped `user_roles`/`has_role`/`user_approvals`). Regenerate from the dev PR's Supabase preview branch (memory: there is no persistent dev branch; regen against the PR preview ref).

### Task 10.1: Regenerate types and drop casts

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerated — never hand-edited)
- Modify: `src/data/invitations.ts` (drop `client.rpc as any`), `src/pages/SettingsPage.tsx` (drop the `set_org_airtable_key as never` cast from Task 8.3)

- [ ] **Step 1: Regenerate** — once the PR is open and its Supabase preview branch exists, run Supabase MCP `generate_typescript_types(<preview branch ref>)` and write the result to `src/integrations/supabase/types.ts`.

- [ ] **Step 2: Remove now-unneeded casts**

In `src/data/invitations.ts`, change `(client.rpc as any)('accept_invitation', …)` → `client.rpc('accept_invitation', …)`. In `src/pages/SettingsPage.tsx`, change `supabase.rpc('set_org_airtable_key' as never, … as never)` → `supabase.rpc('set_org_airtable_key', { _org: currentOrg.id, _key: airtableKey.trim() })`.

- [ ] **Step 3: (CI) typecheck** — push; the Typecheck (`tsc --noEmit`) + lint + vitest jobs must pass with the regenerated types and removed casts.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts src/data/invitations.ts src/pages/SettingsPage.tsx
git commit -m "chore(types): regenerate supabase types; drop accept_invitation/airtable rpc casts"
```

---

## Part 11 — Final verification & PR

- [ ] **Step 1: Full local Deno suite**

Run: `deno test --allow-all supabase/functions/`
Expected: PASS (all functions + `_shared`).

- [ ] **Step 2: Open the PR to `dev`**

```bash
git push -u origin feature/multi-tenancy-phase-3-backend
gh pr create --base dev --title "Multi-tenancy Phase 3 — backend (cron loops, per-org digests/email/Airtable, org_id triggers)" \
  --body "Implements docs/superpowers/plans/2026-06-04-multi-tenancy-phase-3-backend.md. Closes the Phase 3 row of the spec."
```

- [ ] **Step 3: CI is the oracle**

Run: `gh pr checks <n> --watch`
Expected GREEN gates: Typecheck, lint, vitest, **Deno** (per-org digests/airtable/resolver), **pgTAP** (`supabase test db` — org_id derivation, parent↔child consistency, vault RPC guards, plus the unchanged isolation + coverage suites), and the Supabase preview deploy. Fix red checks and re-push until all green. Do **not** mark Phase 3 done until the coverage + isolation + consistency pgTAP tests are green (spec §10: the coverage test gates the merge).

- [ ] **Step 4: Update project memory** — set `multi-tenancy-initiative.md` to "Phase 3 DONE (PR #NN); resume at Phase 4 (console + provision_org + metrics)", and fix the stale `MEMORY.md` index line still reading "resume at Phase 2 (catalogs)".

---

## Self-Review notes (for the implementer)

- **Resilience pattern for every per-org loop (Parts 4–8):** `getActiveOrgs` and `resolveOrgSetting` THROW on a DB error (they don't return an error object). A cron job must not let one org's transient fault abort the rest. So: wrap the `getActiveOrgs` call in try/catch and return a logged `500` on failure (nothing to process); wrap the per-org settings resolution (and, in airtable-poll, the per-org config reads + `get_org_airtable_key` rpc) in try/catch that **logs and `continue`s** to the next org. The per-item inner work (per-artist email send, per-record sync) keeps its own narrower try/catch. This was applied to `send-offer-digest` in Part 4 — mirror it in Parts 5, 6, 7, 8.
- **Settings shape in tests:** the resolver reads via `.eq('key',K).or('org_id.eq.X,org_id.is.null')`, so seed those keys as **array rows** `data: [{ org_id, value }]`. Keys read via `.maybeSingle()` (`cron_secret`) stay **single objects** `data: { value }`. A single `app_settings` array seed can hold both forms (one `when` entry each).
- **`getActiveOrgs` everywhere:** every cron loop seeds `organizations` in tests — forgetting it yields zero orgs and a misleading "skipped"/empty result.
- **Overwrite-always triggers** may correct older pgTAP fixtures that deliberately set a mismatched child `org_id`; that's expected — align the fixture to the parent.
- **Idempotency keys now include the org** (`<kind>-digest-<org>-<artist>-<hour>`). Any external dashboard or doc referencing the old key format should be updated (out of scope here).
- **Vault getter is service-role only.** Never grant it to `authenticated`; the setter is the only authenticated entry point and is `has_org_role`-guarded.
