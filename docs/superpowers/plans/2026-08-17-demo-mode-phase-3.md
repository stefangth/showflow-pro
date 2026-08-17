# Demo Mode Phase 3 — Read-Only Sandbox Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a rep mint a read-only, 14-day-expiring public "sandbox link" for their demo org — a polished leave-behind a prospect can open later with no login — while keeping the crown-jewel isolation intact (no real tenant ever exposed, no new public RLS on domain tables).

**Architecture:** A public visitor never receives a Supabase session or direct table access. Minting stays authenticated on the existing `demo-ops` edge function (`verify_jwt = true`, org-admin, `is_demo` re-assert) via two new actions `link_create` / `link_revoke`, backed by a new `demo_sandbox_links` table. Reading is a **separate** public edge function `sandbox-view` (`verify_jwt = false`) that takes `{ token }`, validates it **inline via the service-role client** (`deps.admin` — exists, not revoked, `expires_at > now()`, `org.is_demo = true`), and returns a **curated, display-safe JSON snapshot** (KPIs, shows/dates, booking-status counts, hire-order statuses). A standalone public route `/sandbox/:token` (outside `ProtectedRoute`/`AppLayout`, modeled on `UnsubscribePage`) renders that snapshot as a read-only tour. **No new SECURITY DEFINER RPC** is introduced (validation is inline TS over the service-role client, mirroring `handle-email-unsubscribe`), which deliberately sidesteps the service-role-grant footgun and keeps the token guard Deno-testable.

**Tech Stack:** React 18 + Vite + TypeScript; Supabase Postgres + RLS; Deno edge functions (`handle(req, deps)` DI pattern); TanStack Query v5; shadcn/ui; Vitest + Deno test + pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-16-demo-mode-design.md` (§5 data model, §6G sandbox link, §8 isolation & safety, §9 testing, §12 open question "Sandbox-link scope"). This plan resolves that open question.

## Global Constraints

- **No changelog entry.** Demo mode is a super-admin/internal sales tool; the public changelog must not mention platform-admin actions (spec §11, CLAUDE.md).
- **No page mini; no help-center change.** The sandbox link is demo chrome + a public non-customer route. State "No mini." and "No help center impact." in the PR (spec §11).
- **Ships dark.** No production org has `is_demo = true`, so every new path is inert for real customers. The public route + function exist but only ever resolve `is_demo` orgs.
- **Copy rules:** all user-visible strings (viewer page, dialog, scene talk-track) are EN + DE, informal **Du**, **no em/en dashes** (enforced by `src/i18n/copyLint.test.ts`). Reuse `src/i18n/terms.ts` `TERMS` where a domain term applies. The public viewer page respects the current language like other public pages.
- **Display-safe snapshot only.** The snapshot NEVER includes: artist email/phone, user ids, chat message bodies, captured-send bodies/HTML, PDF bytes, `storage_path`, or signed URLs. Only presentation fields (names, cities, dates, statuses, counts). This is a security requirement, not a style choice.
- **RLS convention (post-#216, ADR-0003):** new tenant tables use plain `is_org_member(auth.uid(), org_id)` on USING/WITH CHECK with **no** `active_org_id()` conjunct, plus the RESTRICTIVE `org_isolation` floor. No `to anon` policy on `demo_sandbox_links` — the public read path goes through the service-role edge function, never anon RLS.
- **Types are generated.** After the migration, regenerate `src/integrations/supabase/types.ts` from the DB and run `npm run sync:mirrors` to update `supabase/functions/_shared/database.types.ts`. Never hand-edit either.
- **Tests import the real module.** No re-implementing production logic in a test. Data-access tested via `src/test/supabaseFake.ts`; edge functions via `makeFakeDeps`; DB via pgTAP.
- **Do not push or open a PR.** The branch `claude/demo-mode-design-edf4d3` is shared; the owner handles the merge. Stop after the final review + ledger.

---

## File structure

**Created:**
- `supabase/migrations/<ts>_demo_sandbox_links.sql` — the table + RLS.
- `supabase/tests/demo_sandbox_links.test.sql` — pgTAP for the table + RLS (anon denied, member read own-org, service-role write, cross-org isolation).
- `supabase/functions/sandbox-view/index.ts` — public read function (`verify_jwt = false`).
- `supabase/functions/sandbox-view/index.test.ts` — Deno tests (validation matrix + snapshot shape + display-safe assertions).
- `src/pages/SandboxViewerPage.tsx` — public `/sandbox/:token` viewer.
- `src/pages/SandboxViewerPage.test.tsx` — page states (loading/valid/expired/revoked/not-found).
- `src/components/demo/SandboxLinkDialog.tsx` — mint/copy/list/revoke dialog opened from the demo bar.
- `src/components/demo/SandboxLinkDialog.test.tsx` — dialog behavior.

**Modified:**
- `supabase/functions/demo-ops/index.ts` — add `link_create` / `link_revoke` actions.
- `supabase/functions/demo-ops/index.test.ts` (or the existing demo-ops test file) — cover the two new actions.
- `supabase/config.toml` — add `[functions.sandbox-view]` `verify_jwt = false`.
- `src/data/demo.ts` — `SandboxLink` + `SandboxSnapshot` types; `fetchSandboxLinks`, `createSandboxLink`, `revokeSandboxLink`, `fetchSandboxSnapshot`.
- `src/data/demo.test.ts` — data-access tests for the four new functions.
- `src/hooks/useDemo.ts` — `useSandboxLinks`, `useCreateSandboxLink`, `useRevokeSandboxLink`.
- `src/components/demo/DemoBar.tsx` — add the "Sandbox link" button that opens the dialog.
- `src/config/app.config.ts` — add `ROUTES.SANDBOX = '/sandbox/:token'`.
- `src/App.tsx` — register the bare public route.
- `src/lib/demo/scenes.ts` — align the `leave-sandbox` scene talk-track to the read-only reality + point to the button.
- `src/integrations/supabase/types.ts` + `supabase/functions/_shared/database.types.ts` — regenerated (Task 1).
- `CLAUDE.md` — add `sandbox-view` to the edge-function catalog, note the `demo-ops` link actions, the `demo_sandbox_links` table, and the `/sandbox/:token` route (Task 8).

---

### Task 1: `demo_sandbox_links` table + RLS + pgTAP

**Files:**
- Create: `supabase/migrations/<ts>_demo_sandbox_links.sql`
- Create: `supabase/tests/demo_sandbox_links.test.sql`
- Regenerate: `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts`

**Interfaces:**
- Produces (SQL surface later tasks rely on): table `public.demo_sandbox_links` with columns `id uuid`, `token text` (unique, 64-hex default), `org_id uuid` (FK → organizations, `on delete cascade`), `expires_at timestamptz` (default `now() + interval '14 days'`), `revoked_at timestamptz null`, `created_by uuid null`, `created_at timestamptz`. RLS: org members SELECT; **no** authenticated INSERT/UPDATE/DELETE policy (writes are service-role only, from demo-ops); RESTRICTIVE `org_isolation` floor; **no** anon policy.
- Produces (TS): after regen, `Database['public']['Tables']['demo_sandbox_links']` Row/Insert/Update types are available to `src/data/demo.ts` and the edge `database.types.ts`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/demo_sandbox_links.test.sql`. Mirror the style of the existing demo pgTAP tests (search `supabase/tests/` for `demo_` for the seed helpers — reuse whatever helper creates a demo org + a member; if none exists, create rows inline with `insert`). Assert:

```sql
begin;
select plan(7);

-- table + columns exist
select has_table('public','demo_sandbox_links','demo_sandbox_links table exists');
select has_column('public','demo_sandbox_links','token','has token');
select has_column('public','demo_sandbox_links','expires_at','has expires_at');
select has_column('public','demo_sandbox_links','revoked_at','has revoked_at');

-- RLS is enabled
select is(relrowsecurity,true,'RLS enabled')
  from pg_class where oid = 'public.demo_sandbox_links'::regclass;

-- default token is 64 chars and default expiry is ~14 days out
-- (insert as service role / superuser in the test harness, then read back)
insert into public.organizations (id, name, slug, status, is_demo)
  values ('00000000-0000-0000-0000-0000000000d1','Demo Co','demo-co-slink','active',true)
  on conflict (id) do update set is_demo = true;
insert into public.demo_sandbox_links (org_id) values ('00000000-0000-0000-0000-0000000000d1');
select is(
  (select length(token) from public.demo_sandbox_links where org_id='00000000-0000-0000-0000-0000000000d1' limit 1),
  64, 'token defaults to 64 hex chars');
select ok(
  (select expires_at > now() + interval '13 days' and expires_at < now() + interval '15 days'
     from public.demo_sandbox_links where org_id='00000000-0000-0000-0000-0000000000d1' limit 1),
  'expires_at defaults ~14 days out');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase test db` (or the repo's `npm run` wrapper for pgTAP; check `package.json` scripts — likely `verify:full` runs it, but run the single file directly if the CLI supports it). Expected: FAIL — relation `public.demo_sandbox_links` does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/<ts>_demo_sandbox_links.sql` (use a timestamp AFTER `20260816224800`; match the local-time naming of the other demo migrations). Content:

```sql
-- Demo mode Phase 3: read-only public sandbox links (leave-behind).
--
-- A token here grants a public, read-only, expiring VIEW of a demo org, served
-- exclusively by the `sandbox-view` edge function (verify_jwt=false) reading via
-- the service role. There is deliberately NO anon RLS policy: the public read
-- path never touches this table (or any tenant table) through anon RLS. Minting
-- and revoking happen through demo-ops (service-role writes); org members may
-- READ their own org's links to manage them.
--
-- NOTE (deliberate): wipe_demo_org does NOT delete rows here, so a leave-behind
-- link keeps working across a rep's mid-demo Reset until it expires or is
-- revoked. The snapshot is assembled live at view time, so a surviving link just
-- reflects the reseeded data. Org deletion still cascades via the FK below.

create table if not exists public.demo_sandbox_links (
  id uuid primary key default gen_random_uuid(),
  -- pgcrypto-free 64-char token, same idiom as org_invitations.token.
  token text not null unique
    default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  org_id uuid not null references public.organizations(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists demo_sandbox_links_org_idx on public.demo_sandbox_links(org_id);
create index if not exists demo_sandbox_links_token_idx on public.demo_sandbox_links(token);

alter table public.demo_sandbox_links enable row level security;

-- Org members read their own org's links (to manage/copy/revoke in the UI).
create policy demo_sandbox_links_read on public.demo_sandbox_links
  for select to authenticated
  using (public.is_org_member(auth.uid(), org_id));

-- No authenticated write policy: inserts/updates come only from the service
-- role inside demo-ops. Pooled-tenancy isolation floor (ADR-0003).
create policy org_isolation on public.demo_sandbox_links
  as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));
```

- [ ] **Step 4: Apply the migration to the local stack and regenerate types**

Run (the implementer confirms the local stack is up; `npm run local:up` if not, per CLAUDE.md):
```bash
supabase db reset   # or: supabase migration up  — applies pending migrations locally
```
Then regenerate types from the local DB and sync the edge mirror:
```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts
npm run sync:mirrors
```
If the local stack cannot be brought up in this environment, STOP and report BLOCKED with the exact error — do not hand-edit `types.ts`.

- [ ] **Step 5: Run the pgTAP test to verify it passes**

Run: `supabase test db`. Expected: the `demo_sandbox_links` file PASSES (7/7). Also run the full pgTAP suite to confirm no regression.

- [ ] **Step 6: Verify types + mirror**

Run: `npx tsc -p tsconfig.app.json --noEmit` and `npm run sync:mirrors:check`. Expected: clean; `demo_sandbox_links` present in both `types.ts` and `database.types.ts`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations supabase/tests/demo_sandbox_links.test.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "feat(demo): demo_sandbox_links table + RLS + pgTAP"
```

---

### Task 2: `sandbox-view` public edge function

**Files:**
- Create: `supabase/functions/sandbox-view/index.ts`
- Create: `supabase/functions/sandbox-view/index.test.ts`
- Modify: `supabase/config.toml` (add `[functions.sandbox-view]` `verify_jwt = false`)

**Interfaces:**
- Consumes: `demo_sandbox_links` (Task 1), the `_shared/http.ts` (`preflight`, `json`), `_shared/deps.ts` (`Deps`, `realDeps`), `makeFakeDeps` from `_shared/testing.ts`.
- Produces (HTTP contract the frontend consumes): `POST { token }` →
  - `200 { ok: true, snapshot: SandboxSnapshot }` when valid.
  - `404 { ok: false, reason: "not_found" }` when the token is unknown or the org is not `is_demo`.
  - `410 { ok: false, reason: "expired" }` when `expires_at <= now()`.
  - `410 { ok: false, reason: "revoked" }` when `revoked_at is not null`.
  - `400 { error: "bad_request" }` when the body has no token.
- Produces (`SandboxSnapshot` shape — MUST match the TS interface added in Task 4; keep in sync by hand, documented in both files):
  ```ts
  {
    org: { label: string; volume: "small" | "full" };
    generatedAt: string;                // ISO
    kpis: { upcomingDates: number; confirmedBookings: number; fillRate: number; hireOrdersIssued: number };
    shows: Array<{ label: string }>;               // cap 20; label = program + sub_program
    dates: Array<{ id: string; date: string; showLabel: string; city: string | null; status: string; filled: number; needed: number }>; // cap 60, ascending by date
    bookingsByStatus: Record<string, number>;
    hireOrders: Array<{ status: string; showLabel: string | null; dateOn: string | null }>; // cap 40, status/label only
  }
  ```

> **Schema facts (verified against `types.ts`) — the snapshot MUST use these, there is no `shows.name` / `shows.city`:**
> - A show's display label is `[program, sub_program].filter(Boolean).join(" · ") || "Untitled show"` (the app's convention, see `referenceLabel` in `src/lib/bookingFlow.ts:374`). `shows` columns: `id, program, sub_program, main_cast_slots` (no name, no city).
> - Cast-slot count ("needed") is `shows.main_cast_slots` (nullable), joined via `show_dates.show_id`. It is NOT on `show_dates`.
> - City is `show_dates.city_id` (nullable FK) → `cities.name`. Fetch the org's `cities` (`id, name`) once and map `city_id → name`.
> - `show_dates` columns used: `id, date, status, show_id, city_id`.

- [ ] **Step 1: Write the failing Deno test**

Create `supabase/functions/sandbox-view/index.test.ts`. Import `handle` and `makeFakeDeps`. Drive the `deps.admin` fake (`bindFakeFrom`/`setFakeFrom` from `_shared/testing.ts`, same as other edge tests — inspect a sibling test e.g. `handle-email-unsubscribe/index.test.ts` for the exact fake-query wiring). Cases:

```ts
// bad request: no token
Deno.test("400 when token missing", async () => {
  const res = await handle(new Request("http://x", { method: "POST", body: "{}" }), makeFakeDeps({...}));
  assertEquals(res.status, 400);
});

// not_found: token has no row
Deno.test("404 not_found for unknown token", async () => { /* fake returns no link row */ });

// not_found: link points at a non-demo org (is_demo false)
Deno.test("404 not_found when org is not a demo org", async () => { /* link row + org.is_demo=false */ });

// expired
Deno.test("410 expired when expires_at in the past", async () => { /* expires_at < now */ });

// revoked
Deno.test("410 revoked when revoked_at set", async () => { /* revoked_at not null */ });

// ok: valid link → snapshot with the documented shape
Deno.test("200 returns a display-safe snapshot for a valid token", async () => {
  // fake org (is_demo true), shows, show_dates, bookings, hire_orders
  const res = await handle(validReq, deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  // shape assertions
  assert(typeof body.snapshot.kpis.confirmedBookings === "number");
  // display-safe: the serialized snapshot must NOT contain PII/secret keys
  const serialized = JSON.stringify(body.snapshot);
  for (const banned of ["email","phone","storage_path","preview_html","user_id","signedUrl","token"]) {
    assert(!serialized.includes(banned), `snapshot must not contain "${banned}"`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all supabase/functions/sandbox-view/` (with `--node-modules-dir=none` per CLAUDE.md if needed). Expected: FAIL — `index.ts` does not exist.

- [ ] **Step 3: Implement `sandbox-view/index.ts`**

Model the handler on `handle-email-unsubscribe` (inline `deps.admin` lookup, no RPC) and `exchange-invitation` (status→HTTP mapping). Full implementation:

```ts
// Public read-only sandbox viewer for demo orgs. verify_jwt=false: a leave-behind
// link a prospect opens with no login. Validation is INLINE over the service-role
// client (no SECURITY DEFINER RPC, so no service-role-grant footgun); the snapshot
// is curated + display-safe (no PII, no PDF bytes, no signed URLs). Only ever
// resolves is_demo orgs. Ships dark.
import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

interface LinkRow { org_id: string; expires_at: string; revoked_at: string | null; }

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  const token = body?.token;
  if (!token) return json({ error: "bad_request" }, 400);

  const { data: linkData } = await deps.admin
    .from("demo_sandbox_links")
    .select("org_id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();
  const link = linkData as unknown as LinkRow | null;
  if (!link) return json({ ok: false, reason: "not_found" }, 404);
  if (link.revoked_at) return json({ ok: false, reason: "revoked" }, 410);
  if (new Date(link.expires_at).getTime() <= deps.now().getTime())
    return json({ ok: false, reason: "expired" }, 410);

  // Defense in depth: only demo orgs are ever exposed.
  const { data: orgData } = await deps.admin
    .from("organizations").select("name, is_demo").eq("id", link.org_id).maybeSingle();
  const org = orgData as unknown as { name: string; is_demo: boolean } | null;
  if (!org?.is_demo) return json({ ok: false, reason: "not_found" }, 404);

  const snapshot = await buildSnapshot(deps, link.org_id, org.name);
  return json({ ok: true, snapshot });
}

// Assemble a curated, DISPLAY-SAFE snapshot. NEVER select email/phone/user_id/
// storage_path/preview_html or any PDF/signed-url field.
function showLabel(s: { program: string | null; sub_program: string | null } | undefined): string {
  return [s?.program, s?.sub_program].filter(Boolean).join(" · ") || "Untitled show";
}

async function buildSnapshot(deps: Deps, orgId: string, orgName: string) {
  const { data: stateData } = await deps.admin
    .from("demo_state").select("volume, prospect_label").eq("org_id", orgId).maybeSingle();
  const state = stateData as unknown as { volume: "small" | "full"; prospect_label: string | null } | null;

  const { data: showsData } = await deps.admin
    .from("shows").select("id, program, sub_program, main_cast_slots").eq("org_id", orgId).limit(20);
  const shows = (showsData ?? []) as unknown as Array<{ id: string; program: string | null; sub_program: string | null; main_cast_slots: number | null }>;
  const showById = new Map(shows.map((s) => [s.id, s]));

  const { data: citiesData } = await deps.admin
    .from("cities").select("id, name").eq("org_id", orgId);
  const cityName = new Map(((citiesData ?? []) as unknown as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));

  const { data: datesData } = await deps.admin
    .from("show_dates")
    .select("id, date, status, show_id, city_id")
    .eq("org_id", orgId)
    .order("date", { ascending: true })
    .limit(60);
  const dates = (datesData ?? []) as unknown as Array<{ id: string; date: string; status: string; show_id: string; city_id: string | null }>;

  const { data: bookingsData } = await deps.admin
    .from("bookings").select("status, show_date_id").eq("org_id", orgId);
  const bookings = (bookingsData ?? []) as unknown as Array<{ status: string; show_date_id: string }>;

  const bookingsByStatus: Record<string, number> = {};
  const confirmedByDate = new Map<string, number>();
  for (const b of bookings) {
    bookingsByStatus[b.status] = (bookingsByStatus[b.status] ?? 0) + 1;
    if (b.status === "confirmed")
      confirmedByDate.set(b.show_date_id, (confirmedByDate.get(b.show_date_id) ?? 0) + 1);
  }

  const { data: hoData } = await deps.admin
    .from("hire_orders").select("status, show_date_id").eq("org_id", orgId).limit(40);
  const hos = (hoData ?? []) as unknown as Array<{ status: string; show_date_id: string | null }>;
  const dateById = new Map(dates.map((d) => [d.id, d]));

  const now = deps.now().getTime();
  const upcomingDates = dates.filter((d) => new Date(d.date).getTime() >= now).length;
  const confirmedBookings = bookingsByStatus["confirmed"] ?? 0;
  // "needed" per date is the date's show's main_cast_slots.
  const totalNeeded = dates.reduce((s, d) => s + (showById.get(d.show_id)?.main_cast_slots ?? 0), 0);
  const fillRate = totalNeeded > 0 ? Math.round((confirmedBookings / totalNeeded) * 100) : 0;
  const hireOrdersIssued = hos.filter((h) => h.status === "issued" || h.status === "countersigned").length;

  return {
    org: { label: state?.prospect_label ?? orgName, volume: state?.volume ?? "full" },
    generatedAt: deps.now().toISOString(),
    kpis: { upcomingDates, confirmedBookings, fillRate, hireOrdersIssued },
    shows: shows.map((s) => ({ label: showLabel(s) })),
    dates: dates.map((d) => ({
      id: d.id, date: d.date,
      showLabel: showLabel(showById.get(d.show_id)),
      city: d.city_id ? (cityName.get(d.city_id) ?? null) : null,
      status: d.status,
      filled: confirmedByDate.get(d.id) ?? 0,
      needed: showById.get(d.show_id)?.main_cast_slots ?? 0,
    })),
    bookingsByStatus,
    hireOrders: hos.map((h) => {
      const d = h.show_date_id ? dateById.get(h.show_date_id) : null;
      return {
        status: h.status,
        showLabel: d ? showLabel(showById.get(d.show_id)) : null,
        dateOn: d?.date ?? null,
      };
    }),
  };
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

> **Implementer note:** the column names above were verified against `src/integrations/supabase/types.ts` (see the Schema facts block in this task's Interfaces). Do NOT reintroduce `shows.name`/`shows.city`/`show_dates.main_cast_slots` — they do not exist. Re-confirm after Task 1's type regen and use only the columns listed. Do NOT select any column not needed for the snapshot (no email/phone/user_id/storage_path/preview_html).

- [ ] **Step 4: Add the config.toml block**

In `supabase/config.toml`, add next to the other public functions:
```toml
[functions.sandbox-view]
verify_jwt = false
```

- [ ] **Step 5: Run the Deno test to verify it passes**

Run: `deno test --allow-all supabase/functions/sandbox-view/`. Expected: PASS (all cases, including the display-safe assertion). Then run the whole `supabase/functions/` Deno suite to confirm no regression (`deno test --allow-all supabase/functions/`).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/sandbox-view supabase/config.toml
git commit -m "feat(demo): sandbox-view public read-only snapshot function"
```

---

### Task 3: demo-ops `link_create` + `link_revoke` actions

**Files:**
- Modify: `supabase/functions/demo-ops/index.ts`
- Modify: the demo-ops Deno test file (find it: `supabase/functions/demo-ops/index.test.ts` and/or `index.di.test.ts`)

**Interfaces:**
- Consumes: `demo_sandbox_links` (Task 1), existing `requireOrgRole`, `assertDemoOrg`.
- Produces (HTTP, for `src/data/demo.ts` in Task 4):
  - `POST { action: "link_create", org_id }` → `200 { ok: true, token, expires_at }`.
  - `POST { action: "link_revoke", org_id, token }` → `200 { ok: true }` (idempotent — revoking an already-revoked/unknown token still returns ok).
  - Both require org-admin (super-admin passes via the `requireOrgRole` fallback) and re-assert `is_demo` (existing gate at line ~71-75 already runs for non-`flag_and_seed` actions).

- [ ] **Step 1: Write the failing Deno test**

Extend the demo-ops test file. Cases (reuse the file's existing auth-fake helpers):
```ts
Deno.test("link_create rejects a non-admin", async () => { /* requireOrgRole fails → gate.response */ });
Deno.test("link_create rejects a non-demo org", async () => { /* assertDemoOrg false → 400 not_a_demo_org */ });
Deno.test("link_create inserts a link and returns token + expires_at", async () => {
  // fake insert().select().single() returns { token: "abc...", expires_at: "..." }
  // assert body.ok && body.token && body.expires_at
});
Deno.test("link_revoke stamps revoked_at scoped to org+token and returns ok", async () => { /* update called with eq org_id + eq token */ });
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all supabase/functions/demo-ops/`. Expected: FAIL — `link_create`/`link_revoke` not handled (falls through to `{ ok: true }` or `bad_request`).

- [ ] **Step 3: Implement the two actions**

In `supabase/functions/demo-ops/index.ts`:
1. Extend the `Action` union and `VALID_ACTIONS` with `"link_create"` and `"link_revoke"`.
2. Add `token?: string` to the `Body` type.
3. After the existing `cue` block (before the final `return json({ ok: true })`), add:

```ts
if (body.action === "link_create") {
  const { data, error } = await deps.admin
    .from("demo_sandbox_links")
    .insert({ org_id: orgId, created_by: gate.userId ?? null })
    .select("token, expires_at")
    .single();
  if (error) return json({ error: error.message }, 500);
  const row = data as unknown as { token: string; expires_at: string };
  return json({ ok: true, token: row.token, expires_at: row.expires_at });
}

if (body.action === "link_revoke") {
  const token = body.token;
  if (!token) return json({ error: "bad_request" }, 400);
  const { error } = await deps.admin
    .from("demo_sandbox_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("token", token)
    .is("revoked_at", null);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
```

> Both run AFTER the `requireOrgRole` + `assertDemoOrg` gates (they are non-`flag_and_seed` actions), so admin-of-this-demo-org is already enforced. Update the top-of-file doc comment to mention the two new link actions.

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-all supabase/functions/demo-ops/` then the whole `supabase/functions/` suite. Expected: PASS, no regression.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/demo-ops
git commit -m "feat(demo): demo-ops link_create + link_revoke actions"
```

---

### Task 4: Frontend data-access + hooks

**Files:**
- Modify: `src/data/demo.ts`
- Modify: `src/data/demo.test.ts` (create if it does not exist)
- Modify: `src/hooks/useDemo.ts`

**Interfaces:**
- Consumes: `invokeDemoOps` (existing), the `supabase` client, `demo_sandbox_links` types (Task 1), the `sandbox-view` HTTP contract (Task 2), the demo-ops link actions (Task 3).
- Produces:
  - `interface SandboxLink { id; org_id; token; expires_at; revoked_at; created_by; created_at; }`
  - `interface SandboxSnapshot { ... }` (the exact shape from Task 2's Produces block — copy it verbatim, with a comment pointing to `supabase/functions/sandbox-view/index.ts` as the peer that must stay in sync).
  - `fetchSandboxLinks(client, orgId): Promise<SandboxLink[]>` — RLS-scoped select, newest first.
  - `createSandboxLink(client, orgId): Promise<{ token: string; expires_at: string }>` — via `invokeDemoOps({ action: "link_create", org_id })`.
  - `revokeSandboxLink(client, args: { orgId; token }): Promise<void>` — via `invokeDemoOps({ action: "link_revoke", org_id, token })`.
  - `fetchSandboxSnapshot(client, token): Promise<{ ok: boolean; reason?: string; snapshot?: SandboxSnapshot }>` — `client.functions.invoke("sandbox-view", { body: { token } })`; return the parsed body (do NOT throw on `ok:false` — the reason drives the viewer's state).
  - Hooks: `useSandboxLinks(orgId)` (queryKey `["demo","sandbox-links",orgId]`), `useCreateSandboxLink()`, `useRevokeSandboxLink()` (both invalidate `["demo","sandbox-links"]`).

- [ ] **Step 1: Write failing data-access tests**

In `src/data/demo.test.ts`, using `supabaseFake` (see how `fetchCapturedSends` / existing demo tests are set up). Assert:
- `fetchSandboxLinks` queries `demo_sandbox_links` filtered by `org_id`, ordered `created_at` desc, and returns rows.
- `createSandboxLink` invokes `demo-ops` with `{ action: "link_create", org_id }` and returns `{ token, expires_at }` from the payload.
- `revokeSandboxLink` invokes `demo-ops` with `{ action: "link_revoke", org_id, token }`.
- `fetchSandboxSnapshot` invokes `sandbox-view` with `{ token }` and returns the body (including an `ok:false` reason case without throwing).

`invokeDemoOps` currently returns `{ org_id?: string }`. Widen its return type (or add a parallel helper) so `link_create`'s `{ token, expires_at }` payload is preserved — extend the payload cast in `invokeDemoOps` to `{ error?; org_id?; ok?; token?; expires_at? }` and return `payload ?? {}`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/data/demo.test.ts`. Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement in `src/data/demo.ts`**

Add the two interfaces and four functions per the Interfaces block. Example bodies:
```ts
export async function fetchSandboxLinks(client: SupabaseClient<Database>, orgId: string): Promise<SandboxLink[]> {
  const { data, error } = await client
    .from("demo_sandbox_links").select("*").eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as SandboxLink[];
}

export async function createSandboxLink(client: SupabaseClient<Database>, orgId: string): Promise<{ token: string; expires_at: string }> {
  const payload = await invokeDemoOps(client, { action: "link_create", org_id: orgId });
  return { token: payload.token as string, expires_at: payload.expires_at as string };
}

export function revokeSandboxLink(client: SupabaseClient<Database>, args: { orgId: string; token: string }) {
  return invokeDemoOps(client, { action: "link_revoke", org_id: args.orgId, token: args.token });
}

export async function fetchSandboxSnapshot(client: SupabaseClient<Database>, token: string): Promise<{ ok: boolean; reason?: string; snapshot?: SandboxSnapshot }> {
  const { data, error } = await client.functions.invoke("sandbox-view", { body: { token } });
  if (error) {
    // A 404/410 from the function surfaces as a FunctionsHttpError; recover the JSON body.
    const ctx = (error as { context?: Response }).context;
    if (ctx) { try { return await ctx.json(); } catch { /* fall through */ } }
    return { ok: false, reason: "not_found" };
  }
  return data as { ok: boolean; reason?: string; snapshot?: SandboxSnapshot };
}
```
> **Implementer note on the error path:** `supabase-js` `functions.invoke` treats non-2xx as an error with the `Response` on `error.context`. The viewer needs the `reason` from a 404/410 body, so recover it as shown. Verify against the installed supabase-js version; if `error.context` is unavailable, fall back to `{ ok: false, reason: "not_found" }`.

- [ ] **Step 4: Implement the hooks in `src/hooks/useDemo.ts`**

Mirror the existing `useCapturedSends` / `useRunCue` shape:
```ts
export function useSandboxLinks(orgId: string | undefined) {
  return useQuery({
    queryKey: ["demo", "sandbox-links", orgId],
    queryFn: () => fetchSandboxLinks(supabase, orgId as string),
    enabled: !!orgId,
  });
}
export function useCreateSandboxLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) => createSandboxLink(supabase, orgId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["demo", "sandbox-links"] }),
  });
}
export function useRevokeSandboxLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { orgId: string; token: string }) => revokeSandboxLink(supabase, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["demo", "sandbox-links"] }),
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/data/demo.test.ts` and `npx tsc -p tsconfig.app.json --noEmit`. Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/data/demo.ts src/data/demo.test.ts src/hooks/useDemo.ts
git commit -m "feat(demo): sandbox-link data-access + hooks"
```

---

### Task 5: SandboxLinkDialog + DemoBar button + scene copy

**Files:**
- Create: `src/components/demo/SandboxLinkDialog.tsx`
- Create: `src/components/demo/SandboxLinkDialog.test.tsx`
- Modify: `src/components/demo/DemoBar.tsx`
- Modify: `src/lib/demo/scenes.ts` (align `leave-sandbox` copy)

**Interfaces:**
- Consumes: `useSandboxLinks`, `useCreateSandboxLink`, `useRevokeSandboxLink` (Task 4), `useDemo()` for `orgId` (the demo org id — confirm `DemoContext` exposes the demo org id; if it only exposes `isDemoOrg`, read `currentOrg.id` from `useAuth()` in the dialog).
- Produces: a `<SandboxLinkDialog />` (self-contained trigger button + dialog), imported by `DemoBar`.

- [ ] **Step 1: Write the failing component test**

`src/components/demo/SandboxLinkDialog.test.tsx` with `renderWithProviders` + the demo-capable `authOverrides` (added in Phase 1). Assert:
- Renders a "Sandbox link" trigger button.
- Opening it and clicking "Create link" calls the create mutation and shows a copyable URL of the form `.../sandbox/<token>`.
- An existing active link renders with a "Revoke" control that calls the revoke mutation.
- Guard against RTL role+name-in-retry-loop flake (per repo memory): use `findByText`/`getByRole` without wrapping a `name`-filtered role query in `waitFor`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/demo/SandboxLinkDialog.test.tsx`. Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `SandboxLinkDialog.tsx`**

A shadcn `Dialog` triggered by a bar button. Behavior:
- Header: "Share a read-only sandbox" + a one-line explainer ("A read-only view your prospect can open for 14 days. No login. It resets when you reset.").
- "Create link" button → `useCreateSandboxLink().mutate(orgId)`; on success show the URL `${window.location.origin}/sandbox/${token}` with a Copy button (`navigator.clipboard.writeText`, `toast.success`).
- List active links from `useSandboxLinks(orgId)`: for each non-revoked, non-expired link show the URL (or a shortened token), the expiry date (`formatDateDMY` from `src/lib/dates`), a Copy button, and a Revoke button (`useRevokeSandboxLink().mutate({ orgId, token })`). Expired/revoked links show a muted status badge.
- All copy EN only in the dialog is NOT acceptable — but the demo bar/rail are currently English-only chrome (Phase 1/2). **Ruling latitude:** match the surrounding demo-chrome language convention (Phase 1/2 DemoBar/RunOfShowRail copy). If that chrome is English-only, keep the dialog English to match; the copyLint no-dash rule still applies. (Scene talk-tracks in `scenes.ts` remain bilingual — that is separate, see Step 5.)

- [ ] **Step 4: Wire the button into `DemoBar.tsx`**

Import `SandboxLinkDialog` and render it in the right-side action cluster (`ml-auto` group), before or after the Reset button. Keep the bar layout intact.

- [ ] **Step 5: Align the `leave-sandbox` scene copy**

In `src/lib/demo/scenes.ts`, replace the `leave-sandbox` scene `say` so it matches the read-only reality and points at the button (keep `cues: []`, EN + DE, Du, no dashes):
```ts
say: {
  en: 'Hand them a link they can open for the next two weeks. It is read only, so nothing they click changes your demo. Use the Sandbox link button up top.',
  de: 'Gib ihnen einen Link, den sie zwei Wochen lang offen haben. Er ist nur zum Ansehen, also verandert niemand deine Demo. Nutz den Sandbox Link Knopf oben.',
},
```
> Verify against `src/lib/demo/scenes.test.ts` (structure + EN≠DE) and `src/i18n/copyLint.test.ts` (no dashes, Du). Avoid umlaut-free workarounds only if the lint requires it; `verandert` above dodges an em-dash, not an umlaut — keep proper German (`verändert`) unless a test forbids it; the copyLint rule is about dashes, not umlauts.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/demo/SandboxLinkDialog.test.tsx src/lib/demo/scenes.test.ts src/i18n/copyLint.test.ts` and `npx tsc -p tsconfig.app.json --noEmit`. Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/demo/SandboxLinkDialog.tsx src/components/demo/SandboxLinkDialog.test.tsx src/components/demo/DemoBar.tsx src/lib/demo/scenes.ts
git commit -m "feat(demo): sandbox-link dialog + demo-bar button + scene copy"
```

---

### Task 6: `SandboxViewerPage` public route

**Files:**
- Create: `src/pages/SandboxViewerPage.tsx`
- Create: `src/pages/SandboxViewerPage.test.tsx`
- Modify: `src/config/app.config.ts` (`ROUTES.SANDBOX`)
- Modify: `src/App.tsx` (bare public route)

**Interfaces:**
- Consumes: `fetchSandboxSnapshot` (Task 4), `useParams` for `:token`, `SandboxSnapshot` type.
- Produces: a default-exported page component; a new bare route.

- [ ] **Step 1: Write the failing page test**

`src/pages/SandboxViewerPage.test.tsx` with `renderWithProviders` and a `MemoryRouter` entry at `/sandbox/<token>` (or mock `useParams`). Mock `fetchSandboxSnapshot` to return each case. Assert:
- Loading state renders a skeleton/spinner initially.
- `ok: true` snapshot renders the org label, a "Read only" / "Demo" banner, KPI numbers, and at least one show-date row.
- `reason: "expired"` renders an "expired" message (and no KPIs).
- `reason: "revoked"` renders a "no longer available" message.
- `reason: "not_found"` renders a "not found" message.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pages/SandboxViewerPage.test.tsx`. Expected: FAIL — page does not exist.

- [ ] **Step 3: Implement `SandboxViewerPage.tsx`**

Standalone full-page shell (model on `UnsubscribePage` / `PrivacyPage`; **no** `AppLayout`). Use React Query (`useQuery` keyed `["sandbox", token]`, `queryFn: () => fetchSandboxSnapshot(supabase, token)`, `enabled: !!token`). Render:
- A minimal top bar: `StageMark`/brand wordmark (imported like `AppLayout` does) + a right-aligned pill "Demo, read only".
- Loading: centered `Skeleton`s.
- Error/invalid (`data.ok === false`): a centered `Card` with a message keyed off `data.reason` (expired / revoked / not_found), styled like `UnsubscribePage`'s status card. No data shown.
- Valid: a read-only dashboard-style layout —
  - Header with `snapshot.org.label` + `generatedAt` ("As of ...").
  - A KPI row (4 stat cards): upcoming dates, confirmed bookings, fill rate %, hire orders issued.
  - A "Shows" chip list.
  - A "Dates" table: date (`formatDateDMY`), show, city, status badge, `filled/needed`. Cap the visible rows; note "+N more" if truncated by the snapshot cap.
  - A booking-status summary (small badges with counts) + a hire-orders status summary.
  - A footer line: "This is a read only demo. Links expire after 14 days." No interactive controls that mutate anything (no buttons that POST).
- Respect the app language if trivial; otherwise English is acceptable for this public page (match `UnsubscribePage`'s approach). No dashes in any literal copy.

- [ ] **Step 4: Register the route**

`src/config/app.config.ts` `ROUTES`: add `SANDBOX: '/sandbox/:token'`. Do NOT add to `ROUTE_FEATURES`.
`src/App.tsx`: add a bare route alongside the other public routes (lines ~118-123), lazy or eager import to match the file's convention:
```tsx
<Route path={ROUTES.SANDBOX} element={<SandboxViewerPage />} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/pages/SandboxViewerPage.test.tsx` and `npx tsc -p tsconfig.app.json --noEmit`. Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/SandboxViewerPage.tsx src/pages/SandboxViewerPage.test.tsx src/config/app.config.ts src/App.tsx
git commit -m "feat(demo): public /sandbox/:token read-only viewer page"
```

---

### Task 7: Verification, docs, and browser smoke

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full verification suite**

Run and make green (per CLAUDE.md):
```bash
npm run lint
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.tools.json --noEmit
deno check --node-modules-dir=none supabase/functions/sandbox-view/index.ts supabase/functions/demo-ops/index.ts
npm run sync:mirrors:check
deno test --allow-all supabase/functions/
npx vitest run
```
Also run the pgTAP suite (`supabase test db`) if the local stack is up. Fix any failure in place (fold into this task).

- [ ] **Step 2: Docs**

Update `CLAUDE.md`:
- Edge-function catalog: add `sandbox-view` (public, `verify_jwt=false`, read-only demo snapshot) and note the `demo-ops` `link_create`/`link_revoke` actions.
- Data-access / pages / components sections: note `demo_sandbox_links`, `src/pages/SandboxViewerPage.tsx` (public `/sandbox/:token`), and `SandboxLinkDialog`.
Do NOT touch `public/changelog.md` (Global Constraint). Do NOT add to `docs/system-map.md` — `sandbox-view` is an on-demand request/response endpoint (like `demo-ops`), not part of the automation engine; add a one-line ledger ruling recording this.

- [ ] **Step 3: Browser smoke (best-effort)**

If the local stack + dev server can run: seed a demo org, mint a link from the demo bar, open `/sandbox/:token` in the preview browser, confirm the read-only tour renders and no mutate controls exist; confirm an expired/revoked token shows the right state. Capture one screenshot. If the stack is unavailable in this environment, record that in the ledger and rely on the unit/edge/page tests (which cover every state).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(demo): document sandbox link function, table, and route"
```

---

## Self-Review (author checklist — completed before execution)

**Spec coverage:** §6G (mint read-only expiring public token) → Tasks 1-6. §5 `demo_sandbox_links` → Task 1. §8 isolation (no real tenant exposed; `is_demo` re-assert; no anon RLS) → Tasks 1-2. §9 testing (pgTAP RLS, edge auth/validation matrix, page states) → Tasks 1,2,3,6. §12 open question (read-only surface + public RLS shape) → resolved: service-role-mediated snapshot, no anon RLS, curated display-safe shape.

**Placeholder scan:** every code step has concrete code; column-name verification is explicitly flagged as an implementer note tied to the real schema, not a placeholder.

**Type consistency:** `SandboxSnapshot` is defined once (Task 4) and its shape is stated verbatim in Task 2's Produces block with a hand-sync comment on both files; `SandboxLink` fields match the Task 1 columns; hook query keys are consistent (`["demo","sandbox-links",...]`); demo-ops action names (`link_create`/`link_revoke`) are identical across Tasks 3-4.

**Known residual risks (for the reviewer to weight):**
1. `SandboxSnapshot` is hand-synced across the Deno function and the TS frontend (no mirror). Mitigated by the shared documented shape + Task 2's display-safe test + Task 6's render test. Acceptable (matches the documented `hireOrders/types.ts` structural-mirror exception).
2. Snapshot column names must match the live schema — pinned by the implementer note + `tsc`/Deno check + the snapshot render test.
3. The public function is unauthenticated by design; the security surface is a single service-role read that can only resolve `is_demo` orgs and returns display-safe fields. The final whole-branch review must scrutinize this path specifically.
