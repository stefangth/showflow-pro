# Demo Mode — Phase 2 (Scene Engine + Run-of-Show Rail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the Phase 1 demo shell into a guided sales instrument: a declarative scene/cue engine, deterministic scripted cues (no real clock), a narrative sim-clock, and the docked "run-of-show" rail (design option 1a) so a rep can drive the key journey live.

**Architecture:** Cues are named, idempotent, demo-org-only server mutations — DB-mutation cues live in a `run_demo_cue` `SECURITY DEFINER` RPC (guarded to `is_demo`, testable in pgTAP); the one orchestration cue (`issue_hire_order`) is handled in the `demo-ops` edge function via a new `cue` action. Scenes are a typed bilingual data module. The `DemoProvider` (extended) holds scene + sim-clock + prospect + volume state backed by the `demo_state` table; `DemoBar` gains a scene selector + sim clock; a new `RunOfShowRail` renders the teleprompter.

**Tech Stack:** React 18 + TS, TanStack Query v5, Supabase (Postgres RPC + Deno edge), Vitest + jsdom + Testing Library, pgTAP, Deno test.

**Spec:** `docs/superpowers/specs/2026-08-16-demo-mode-design.md` (§6D UI, §6E scene/cue engine, §5 data model). Phase 1 plan (context): `docs/superpowers/plans/2026-08-16-demo-mode-phase-1.md`.

## Global Constraints

- **Package manager:** npm only. Lint gate `--max-warnings 0`. `any` banned — explicit row interfaces + single `as unknown as` boundary cast, or typed test helpers.
- **Styling:** semantic tokens only. The numbered accent scale (`accent-50`..`900`) does NOT support Tailwind opacity modifiers (`bg-accent-500/20` silently renders solid) — never use `/<alpha>` on those tokens.
- **Copy:** all rep-facing scene copy (titles, "Say:" talk-tracks, cue labels) is bilingual EN + DE, informal "Du", NO em/en dashes. Reuse `src/i18n/terms.ts` `TERMS` for domain terms. **The scene module's strings MUST be wired into `src/i18n/copyLint.test.ts`** (its lint set does not auto-cover new modules) — else the no-dash/Du rules don't apply.
- **DB:** new columns via `supabase migration new`; RLS unchanged (demo_state already has `demo_state_rw` admin-write + RESTRICTIVE `org_isolation`). Regenerate `types.ts` + `npm run sync:mirrors` after any schema change. Migrations applied by `npm run local:reset` locally / merge in prod — never hand-apply.
- **Cue safety:** every cue is demo-org-only (the RPC and the edge `cue` action both re-assert `is_demo`), idempotent (re-running a cue does not double-apply), and undone by Reset (Phase 1 `reset` = wipe+seed).
- **Query keys:** `['demo', ...]`. A cue/state change that alters many domains busts the whole cache (`invalidateEverything`), matching Phase 1 reset/wipe; `demo_state` reads use `['demo','state',orgId]`.
- **Changelog:** none (super-admin/internal tool). **No page mini** (chrome, not a customer route) — restate in PR.
- **Edge fns:** `handle(req, deps)` + `Deno.serve` idiom; `_shared/http.ts`/`auth.ts`/`deps.ts`. `demo-ops` already registered in config.toml.
- **Tests import the real module.** Frontend: `supabaseFake` + `renderWithProviders` (its `authOverrides` mounts a demo org + DemoProvider). Edge: `makeFakeDeps`. Run Deno with `--node-modules-dir=none`.

---

## File structure

**Create**
- `supabase/migrations/<ts>_demo_state_scene_columns.sql` — add `sim_now`, `current_scene_id`, `script_id` to `demo_state`.
- `supabase/migrations/<ts>_demo_run_cue_rpc.sql` — `run_demo_cue(p_org, p_cue, p_actor)` RPC.
- `supabase/tests/demo_cues.sql` — pgTAP for the columns + each cue + the guard.
- `src/lib/demo/scenes.ts` — `Scene`/`CueId` types + `SEASON_HANDOVER` scene list (EN/DE) + `resolveScenes`.
- `src/lib/demo/scenes.test.ts` — structure + EN≠DE + cue-id integrity.
- `src/components/demo/RunOfShowRail.tsx` — the docked teleprompter rail.
- `src/components/demo/SceneSelect.tsx` — the bar's scene dropdown (extracted for testability).

**Modify**
- `src/integrations/supabase/types.ts` + `supabase/functions/_shared/database.types.ts` — regenerated.
- `supabase/functions/demo-ops/index.ts` — add the `cue` action.
- `supabase/functions/demo-ops/index.test.ts` — cue-action tests.
- `src/data/demo.ts` — `fetchDemoState`, `updateDemoState`, `runCue`.
- `src/hooks/useDemo.ts` — `useDemoState`, `useUpdateDemoState`, `useRunCue`.
- `src/data/demo.test.ts` — new data-fn tests.
- `src/features/demo/DemoContext.tsx` — scene/sim-clock/prospect/volume state + `runCue`/`goToScene`/`advanceClock`/`setProspectLabel`/`setVolume`.
- `src/components/demo/DemoBar.tsx` — mount `<SceneSelect/>` + sim-clock (`+10m`/`+1d`) + hide/exit.
- `src/components/demo/DemoBar.test.tsx` — extended.
- `src/components/layout/AppLayout.tsx` — mount `<RunOfShowRail/>` (right dock, demo-only).
- `src/i18n/copyLint.test.ts` — add the scene module strings to the lint set.

---

## Task 1: `demo_state` scene columns

**Files:** Create `supabase/migrations/<ts>_demo_state_scene_columns.sql`; create `supabase/tests/demo_cues.sql`.

**Interfaces:** Produces `demo_state.sim_now timestamptz`, `demo_state.current_scene_id text`, `demo_state.script_id text` (all nullable).

- [ ] **Step 1: Migration** — `supabase migration new demo_state_scene_columns`:

```sql
alter table public.demo_state
  add column if not exists sim_now timestamptz,
  add column if not exists current_scene_id text,
  add column if not exists script_id text;
```

- [ ] **Step 2: pgTAP** — create `supabase/tests/demo_cues.sql` starting with the column checks:

```sql
begin;
select plan(3);
select has_column('public','demo_state','sim_now','demo_state.sim_now exists');
select has_column('public','demo_state','current_scene_id','demo_state.current_scene_id exists');
select has_column('public','demo_state','script_id','demo_state.script_id exists');
select * from finish();
rollback;
```

- [ ] **Step 3:** `npm run local:reset && supabase test db` → 3/3 pass. Regenerate types: `supabase gen types typescript --local > src/integrations/supabase/types.ts && npm run sync:mirrors`, then `npm run sync:mirrors:check`. Confirm `demo_state` Row gains the three fields.
- [ ] **Step 4: Commit** `git add supabase/migrations supabase/tests/demo_cues.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts && git commit -m "feat(demo): demo_state scene + sim-clock columns"`

---

## Task 2: `run_demo_cue` RPC (DB-mutation cues)

**Files:** Create `supabase/migrations/<ts>_demo_run_cue_rpc.sql`; extend `supabase/tests/demo_cues.sql`.

**Interfaces:** Produces `public.run_demo_cue(p_org uuid, p_cue text, p_actor uuid) returns void` — `SECURITY DEFINER`, guarded to `is_demo`, handling cues `artist_accepts_offer`, `run_clock_to_1700`, `drop_notifications`, `fill_date`, `advance_clock`. Idempotent. (`issue_hire_order` is edge-orchestrated, Task 3.)

- [ ] **Step 1: Write pgTAP first** (extend `demo_cues.sql`, bump plan). For a seeded demo org, assert each cue's effect and idempotency. Example assertions (adapt ids to the seed's shape — the seed uses `gen_random_uuid()`, so query by state, not fixed ids):

```sql
-- setup: a demo org, seeded
insert into public.organizations (id,name,slug,status,is_demo)
values ('5eedc0e0-0000-0000-0000-0000000000c0','Cue Co','cue-co','active',true)
on conflict (id) do update set is_demo=true;
select public.seed_demo_org('5eedc0e0-0000-0000-0000-0000000000c0','full',null);

-- artist_accepts_offer: at least one soft_booked exists before; after, a previously-suggested/pending offer became soft_booked (count of soft_booked does not decrease)
-- run_clock_to_1700: the two holds (offer_expires_at = today 17:00, status soft_booked) become cancelled/expired
select lives_ok($$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0','run_clock_to_1700', null) $$, 'run_clock_to_1700 runs');
select is( (select count(*)::int from public.bookings b join public.show_dates d on d.id=b.show_date_id where d.org_id='5eedc0e0-0000-0000-0000-0000000000c0' and b.status='soft_booked' and b.offer_expires_at is not null and b.offer_expires_at <= now()), 0, 'expired holds no longer soft_booked');
-- idempotency: running again does not error and does not change the count further
select lives_ok($$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0','run_clock_to_1700', null) $$, 'run_clock_to_1700 idempotent');
-- drop_notifications with an actor inserts 3 unread for that actor
-- guard: refuses a non-demo org
select throws_ok($$ select public.run_demo_cue('00000000-0000-0000-0000-00000000b007','drop_notifications', null) $$, 'P0001', null, 'run_demo_cue refuses non-demo org');
```

> The exact assertions must match the seed's staged state (2 holds on `offer_expires_at = current_date + 17h`; one `suggested` offer; `main_cast_slots=3`). Read `20260816205135_demo_mode_seed_rpcs.sql` to align the queries. Every cue gets at least one effect assertion + the guard is asserted once.

- [ ] **Step 2: Run → RED** (`supabase test db`, function missing).
- [ ] **Step 3: Implement the RPC.** `supabase migration new demo_run_cue_rpc`:

```sql
create or replace function public.run_demo_cue(p_org uuid, p_cue text, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
begin
  if (select is_demo from public.organizations where id = p_org) is not true then
    raise exception 'run_demo_cue refused: % is not a demo org', p_org using errcode = 'raise_exception';
  end if;

  if p_cue = 'artist_accepts_offer' then
    -- Promote the earliest still-pending suggested/soft offer to soft_booked (idempotent:
    -- if none pending, no-op). Pick one deterministic row.
    update public.bookings b set status = 'soft_booked', offered_at = coalesce(offered_at, now())
    where b.id = (
      select b2.id from public.bookings b2
      join public.show_dates d on d.id = b2.show_date_id
      where d.org_id = p_org and b2.status = 'suggested'
      order by b2.created_at limit 1
    );

  elsif p_cue = 'run_clock_to_1700' then
    -- Expire the staged holds: soft_booked with a due-today deadline -> cancelled (same
    -- visible effect as expire-offers). Idempotent: already-cancelled rows are untouched.
    update public.bookings b set status = 'cancelled', cancelled_at = now(),
      cancellation_reason = 'Offer expired'
    from public.show_dates d
    where d.id = b.show_date_id and d.org_id = p_org
      and b.status = 'soft_booked' and b.offer_expires_at is not null
      and b.offer_expires_at <= (current_date + interval '17 hours');
    update public.demo_state set sim_now = (current_date + interval '17 hours'), updated_at = now()
      where org_id = p_org;

  elsif p_cue = 'drop_notifications' then
    if p_actor is not null then
      -- Idempotent: remove any prior cue-dropped notifications for this actor first.
      delete from public.notifications
        where user_id = p_actor and org_id = p_org and type = 'demo_cue';
      insert into public.notifications (user_id, org_id, type, title, message, read) values
        (p_actor, p_org, 'demo_cue', 'Angebot angenommen', 'Yasmin Aydin hat zugesagt.', false),
        (p_actor, p_org, 'demo_cue', 'Frist laeuft ab', 'Zwei Angebote laufen heute um 17:00 ab.', false),
        (p_actor, p_org, 'demo_cue', 'Vertrag bereit', 'Ein Engagementvertrag wartet auf Ausstellung.', false);
    end if;

  elsif p_cue = 'fill_date' then
    -- Confirm remaining main slots on a chosen date so it reaches fully_filled, firing the
    -- real auto-draft trigger. Pick the date that already has one confirmed non-understudy
    -- booking (partially_filled) and confirm enough suggested/soft rows to hit main_cast_slots.
    select d.id into v_target from public.show_dates d
      join public.shows s on s.id = d.show_id
      where d.org_id = p_org and d.status = 'partially_filled'
      order by d.date limit 1;
    if v_target is not null then
      -- confirm up to (main_cast_slots) non-understudy bookings on that date
      update public.bookings b set status = 'confirmed', confirmed_at = now()
      where b.show_date_id = v_target and b.is_understudy = false and b.status <> 'cancelled'
        and b.status <> 'confirmed';
    end if;

  elsif p_cue = 'advance_clock' then
    update public.demo_state set sim_now = coalesce(sim_now, now()) + interval '1 day', updated_at = now()
      where org_id = p_org;

  else
    raise exception 'run_demo_cue: unknown cue %', p_cue using errcode = 'raise_exception';
  end if;
end;
$$;

revoke all on function public.run_demo_cue(uuid, text, uuid) from public;
```

> `fill_date` intentionally triggers `dispatch_hire_order_drafts` (the auto-draft `net.http_post`). In local/CI this posts to the local stack (harmless). Verify after: the target date reaches `fully_filled` and a `hire_orders` draft appears for it. If confirming ALL non-understudy bookings overshoots `main_cast_slots`, cap the update with a subquery `limit`; align to the seed's per-date booking counts when you read the seed.

- [ ] **Step 4:** `npm run local:reset && supabase test db` → all green. Manually confirm `fill_date` produces a `fully_filled` date + a draft order; note in report.
- [ ] **Step 5: Commit** `git add supabase/migrations supabase/tests/demo_cues.sql && git commit -m "feat(demo): run_demo_cue RPC (scripted cues, demo-org guarded)"`

---

## Task 3: demo-ops `cue` action

**Files:** Modify `supabase/functions/demo-ops/index.ts`, `index.test.ts`.

**Interfaces:** Consumes `run_demo_cue`; `generate-hire-orders`. Produces a `cue` action: `POST demo-ops {action:"cue", org_id, cue_id}` — org-admin gated, re-asserts `is_demo`; dispatches DB cues to `run_demo_cue(p_org, p_cue, p_actor=gate.userId)`; dispatches `issue_hire_order` to `deps.invokeFunction("generate-hire-orders", {action:"issue", org_id, ...})`.

- [ ] **Step 1: Tests first** (`index.test.ts`): (a) `cue` with `cue_id:"drop_notifications"` on a demo org (admin) calls `run_demo_cue` rpc with `p_actor` = the caller; (b) `cue` on a NON-demo org → 400 `not_a_demo_org`; (c) `cue` with an unknown `cue_id` → 400; (d) `cue_id:"issue_hire_order"` invokes `generate-hire-orders`. Use `makeFakeDeps` — assert `calls` for the rpc and `invokeCalls` for the edge invoke.
- [ ] **Step 2: RED** — `deno test --allow-all --node-modules-dir=none supabase/functions/demo-ops/`.
- [ ] **Step 3: Implement.** Add to `VALID_ACTIONS` → include `"cue"`. Extend `Body` with `cue_id?: string`. After the `assertDemoOrg` re-check (shared with reset/reseed/wipe), add:

```ts
  if (body.action === "cue") {
    const cueId = body.cue_id;
    const DB_CUES = ["artist_accepts_offer", "run_clock_to_1700", "drop_notifications", "fill_date", "advance_clock"];
    if (cueId === "issue_hire_order") {
      const { error } = await deps.invokeFunction("generate-hire-orders", { action: "issue", org_id: orgId });
      if (error) return json({ error: (error as Error).message }, 500);
      return json({ ok: true });
    }
    if (!cueId || !DB_CUES.includes(cueId)) return json({ error: "unknown_cue" }, 400);
    const { error } = await deps.admin.rpc("run_demo_cue", { p_org: orgId, p_cue: cueId, p_actor: gate.userId });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }
```

> Place this inside the org-admin branch (after `requireOrgRole` + `assertDemoOrg`), alongside the wipe/reset/reseed handling. `cue` must NOT be reachable from `flag_and_seed`'s super-admin-only path. Keep the existing unknown-action 400 guard working (add `"cue"` to `VALID_ACTIONS`).

- [ ] **Step 4: GREEN** — `deno test --allow-all --node-modules-dir=none supabase/functions/demo-ops/ && deno check --node-modules-dir=none supabase/functions/demo-ops/index.ts`.
- [ ] **Step 5: Commit** `git add supabase/functions/demo-ops && git commit -m "feat(demo): demo-ops cue action (run_demo_cue + hire-order issue)"`

---

## Task 4: Scene module + copyLint wiring

**Files:** Create `src/lib/demo/scenes.ts`, `src/lib/demo/scenes.test.ts`; modify `src/i18n/copyLint.test.ts`.

**Interfaces:** Produces `CueId` (union of the six cue ids), `Persona = 'admin'|'producer'|'artist'`, `Scene` interface, `SEASON_HANDOVER: Scene[]`, `resolveSceneCopy(scene, lang)`.

- [ ] **Step 1: Test first** (`scenes.test.ts`): every scene has a unique `id`, a `route`, a valid `persona`, EN and DE `title`/`say` that are non-empty and EN≠DE, `estMin>0`, and every `cues` entry is a member of the `CueId` union. Assert the script has the 7 scenes from spec §6E.

```ts
import { describe, it, expect } from 'vitest';
import { SEASON_HANDOVER, CUE_IDS } from '@/lib/demo/scenes';

describe('SEASON_HANDOVER', () => {
  it('has unique ids and valid cue references', () => {
    const ids = SEASON_HANDOVER.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SEASON_HANDOVER) {
      expect(s.route).toMatch(/^\//);
      expect(['admin','producer','artist']).toContain(s.persona);
      expect(s.estMin).toBeGreaterThan(0);
      expect(s.title.en).not.toBe(s.title.de);
      s.cues.forEach(c => expect(CUE_IDS).toContain(c));
    }
  });
});
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement `scenes.ts`.** Define types + the 7-scene script (from spec §6E table: 01 season stands, 02 build routing, 03 two holds expire, 04 artist's side, 05 hire order auto-drafted, 06 your rules, 07 leave the sandbox). Copy bilingual, informal Du, no dashes. `route` uses `ROUTES` from `@/config/app.config`. `persona` drives view-as. Example shape:

```ts
import { ROUTES } from "@/config/app.config";

export const CUE_IDS = ["artist_accepts_offer","run_clock_to_1700","drop_notifications","fill_date","issue_hire_order","advance_clock"] as const;
export type CueId = (typeof CUE_IDS)[number];
export type Persona = "admin" | "producer" | "artist";
export interface Bilingual { en: string; de: string }
export interface Scene {
  id: string;
  title: Bilingual;
  route: string;
  persona: Persona;
  say: Bilingual;       // the "Say:" teleprompter line
  cues: CueId[];
  estMin: number;
}

export const SEASON_HANDOVER: Scene[] = [
  { id: "season-stands", title: { en: "Where the season stands", de: "Wo die Spielzeit steht" },
    route: ROUTES.DASHBOARD, persona: "admin",
    say: { en: "Six shows, twenty plus dates, live fill rate. This is a real season.",
           de: "Sechs Produktionen, ueber zwanzig Termine, Live Besetzungsquote. Das ist eine echte Spielzeit." },
    cues: [], estMin: 2 },
  // ... scenes 02..07, scene 03 carries cues:
  //   ["artist_accepts_offer","run_clock_to_1700","drop_notifications"], scene 05 ["fill_date","issue_hire_order"]
];
```

> Write all 7 scenes fully (no ellipsis in the real file). German must be genuine translation, informal Du, no dashes. Use `TERMS` for domain words (hold/Vormerkung, Engagementvertrag) where they occur.

- [ ] **Step 4: Wire copyLint.** In `src/i18n/copyLint.test.ts`, import `SEASON_HANDOVER` and add its `title.en`/`say.en` to the EN content set and `title.de`/`say.de` to the DE set (follow how the file assembles `enContent`/`deContent`). Run `npx vitest run src/i18n/copyLint.test.ts` — must pass (proves no dashes + Du).
- [ ] **Step 5: GREEN** — `npx vitest run src/lib/demo/ src/i18n/copyLint.test.ts && npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 6: Commit** `git add src/lib/demo src/i18n/copyLint.test.ts && git commit -m "feat(demo): season-handover scene module + copy lint"`

---

## Task 5: Data-access + hooks for state & cues

**Files:** Modify `src/data/demo.ts`, `src/hooks/useDemo.ts`, `src/data/demo.test.ts`.

**Interfaces:** Produces `DemoStateRow`; `fetchDemoState(client, orgId)`; `updateDemoState(client, {orgId, patch})` (upsert `demo_state`); `runCue(client, {orgId, cueId})` (invoke demo-ops cue); hooks `useDemoState(orgId)`, `useUpdateDemoState()`, `useRunCue()`.

- [ ] **Step 1: Test first** (`demo.test.ts`): `runCue` invokes `demo-ops` with `{action:'cue', org_id, cue_id}`; `updateDemoState` upserts `demo_state` with the patch; `fetchDemoState` reads the row. Use `supabaseFake` (follow Phase 1 demo.test.ts patterns).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** In `demo.ts`:

```ts
export interface DemoStateRow {
  org_id: string; volume: "small" | "full"; prospect_label: string | null;
  sim_now: string | null; current_scene_id: string | null; script_id: string | null; updated_at: string;
}
export async function fetchDemoState(client: SupabaseClient<Database>, orgId: string): Promise<DemoStateRow | null> {
  const { data, error } = await client.from("demo_state").select("*").eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  return (data as unknown as DemoStateRow | null);
}
export async function updateDemoState(client: SupabaseClient<Database>, args: { orgId: string; patch: Partial<Pick<DemoStateRow,"volume"|"prospect_label"|"sim_now"|"current_scene_id"|"script_id">> }): Promise<void> {
  const { error } = await client.from("demo_state").upsert({ org_id: args.orgId, ...args.patch }, { onConflict: "org_id" });
  if (error) throw error;
}
export function runCue(client: SupabaseClient<Database>, args: { orgId: string; cueId: string }) {
  return invokeDemoOps(client, { action: "cue", org_id: args.orgId, cue_id: args.cueId });
}
```

In `useDemo.ts`: `useDemoState(orgId)` (query key `["demo","state",orgId]`, enabled on orgId), `useUpdateDemoState()` (invalidates `["demo","state"]`), `useRunCue()` (a cue mutates domain data → `invalidateEverything(qc)`).

- [ ] **Step 4: GREEN** — `npx vitest run src/data/demo.test.ts && npx tsc -p tsconfig.app.json --noEmit && npm run lint`.
- [ ] **Step 5: Commit** `git add src/data/demo.ts src/hooks/useDemo.ts src/data/demo.test.ts && git commit -m "feat(demo): demo_state + cue data-access and hooks"`

---

## Task 6: Extend DemoProvider

**Files:** Modify `src/features/demo/DemoContext.tsx`; add cases to `src/features/demo/*` tests (or a new `DemoContext.test.tsx`).

**Interfaces:** Consumes `useDemoState`, `useUpdateDemoState`, `useRunCue`, `SEASON_HANDOVER`. Produces extended `useDemo()`: adds `scenes`, `currentScene`, `simNow`, `prospectLabel`, real `volume` (from state), `goToScene(id)`, `runCue(cueId)`, `advanceClock('10m'|'1d')`, `setProspectLabel(s)`, `setVolume(v)`, `setRole(role)`.

- [ ] **Step 1: Test first.** Render `DemoProvider` (via `renderWithProviders` demo org + a mocked `useDemoState` returning a row) and assert: `currentScene` resolves from `demo_state.current_scene_id` (falls back to first scene), `goToScene` calls `useUpdateDemoState` with `current_scene_id`, `runCue` calls `useRunCue`. Mock the three hooks.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** Read `demo_state` via `useDemoState(currentOrg?.id)`. Derive `volume`/`prospectLabel`/`simNow`/`currentScene` from the row (defaults: volume from row or 'full'; currentScene = `SEASON_HANDOVER.find(id) ?? SEASON_HANDOVER[0]`). `goToScene`/`setVolume`/`setProspectLabel`/`advanceClock` call `updateDemoState.mutate`. `advanceClock('10m')` computes the next `sim_now` client-side and upserts it (narrative only). `runCue` calls `runCueMut.mutate({orgId, cueId})`. `setRole` delegates to `useAuth().setViewAsRole`. Keep `reset`/bar-hidden from Phase 1.
- [ ] **Step 4: GREEN** — `npx vitest run src/features/demo/ && npx tsc -p tsconfig.app.json --noEmit && npm run lint`.
- [ ] **Step 5: Commit** `git add src/features/demo && git commit -m "feat(demo): DemoProvider scene + sim-clock + cue state"`

---

## Task 7: DemoBar — scene selector + sim clock + hide/exit

**Files:** Create `src/components/demo/SceneSelect.tsx`; modify `src/components/demo/DemoBar.tsx`, `DemoBar.test.tsx`.

**Interfaces:** Consumes the extended `useDemo()`. `SceneSelect` renders the current scene + a dropdown of `scenes` (number + title) → `goToScene`. DemoBar adds: `SceneSelect`, a sim-clock display with `+10m`/`+1d` buttons (→ `advanceClock`), and hide/exit buttons (`hideBar`; exit clears view-as + hides).

- [ ] **Step 1: Test first** (extend `DemoBar.test.tsx`): clicking a scene in the selector calls `goToScene`; clicking `+10m` calls `advanceClock('10m')`; the sim-clock shows the `simNow` value. Mock `useDemo` or drive via provider with a mocked `useDemoState`. Query by text/role synchronously (no role-name inside retry loops).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** `SceneSelect.tsx` uses the shadcn `Select` (or `DropdownMenu`) listing `scenes` with a 2-digit index + title (localized via the app language). DemoBar: insert `<SceneSelect/>` before the role toggle; add the sim-clock group (mono font, `Clock` icon, `+10m`/`+1d`), and hide/exit icon buttons in the `ml-auto` group. Keep accent-token rules (no opacity modifier). Match design 1a ordering: Scene · Role · clock · (Outbox) · Reset · hide · exit.
- [ ] **Step 4: GREEN** — `npx vitest run src/components/demo/ && npx tsc -p tsconfig.app.json --noEmit && npm run lint`.
- [ ] **Step 5: Commit** `git add src/components/demo/SceneSelect.tsx src/components/demo/DemoBar.tsx src/components/demo/DemoBar.test.tsx && git commit -m "feat(demo): scene selector + sim clock in demo bar"`

---

## Task 8: RunOfShowRail

**Files:** Create `src/components/demo/RunOfShowRail.tsx`; modify `src/components/layout/AppLayout.tsx`, `AppLayout.test.tsx`, `src/components/demo/DemoBar.test.tsx` (or a new `RunOfShowRail.test.tsx`).

**Interfaces:** Consumes the extended `useDemo()` + `useNavigate` (react-router). Renders the right-docked teleprompter (design §6D / option 1a right rail): a "RUN OF SHOW" header with progress (`n / total`), the scene list (index + title + `estMin`, active highlighted), the active scene expanded with the "Say:" line + a cue button per `currentScene.cues` (→ `runCue`) + a "Next scene" button (→ `goToScene(next)` and `navigate(next.route)` + `setRole(next.persona)`), and a footer with prospect-label input (→ `setProspectLabel`) + a Small/Full volume toggle (→ `setVolume`, which reseeds at that volume — call the existing reset/reseed path).

- [ ] **Step 1: Test first** (`RunOfShowRail.test.tsx`): with a mocked demo state on scene 03, the rail shows the active scene's "Say:" text and one button per cue; clicking a cue button calls `runCue(cueId)`; clicking "Next scene" calls `goToScene` with the next id. Query by text.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement `RunOfShowRail.tsx`.** Self-gates on `isDemoOrg && !isBarHidden` (or a dedicated rail-visible flag). Localize scene copy via the app language (`useLanguage`/`i18n`). "Next scene" advances `goToScene`, navigates to `next.route`, and sets `setRole(next.persona)`. Volume toggle calls the reseed-at-volume path (reuse `reset` with the chosen volume via `setVolume` → updateDemoState + reset). Semantic tokens; fixed-width right dock (~308px) like design 1a.
- [ ] **Step 4: Mount in AppLayout.** Render `<RunOfShowRail/>` as a right-side sibling of the main content (so it docks beside the page). Add a stub in `AppLayout.test.tsx` mirroring the existing `DemoBar`/`DemoBadge` stubs (that suite mocks auth and won't wire DemoProvider).
- [ ] **Step 5: GREEN** — `npx vitest run src/components/demo/ src/components/layout/ && npx tsc -p tsconfig.app.json --noEmit && npm run lint`.
- [ ] **Step 6: Commit** `git add src/components/demo/RunOfShowRail.tsx src/components/layout/AppLayout.tsx src/components/layout/AppLayout.test.tsx src/components/demo/RunOfShowRail.test.tsx && git commit -m "feat(demo): run-of-show rail (design 1a)"`

---

## Task 9: Full verification + final review

**Files:** none (verification).

- [ ] **Step 1:** `npm run lint && npx tsc -p tsconfig.app.json --noEmit && npx tsc -p tsconfig.tools.json --noEmit`.
- [ ] **Step 2:** `deno check --node-modules-dir=none supabase/functions/demo-ops/index.ts` and `deno test --allow-all --node-modules-dir=none supabase/functions/demo-ops/`.
- [ ] **Step 3:** `supabase test db` (demo_mode.sql + demo_cues.sql green) and `npm run sync:mirrors:check`.
- [ ] **Step 4:** `npm run test:coverage` (full suite + thresholds).
- [ ] **Step 5: Manual smoke (local):** enter a demo org, open the rail, walk scene 01→07: role switches per scene, `run_clock_to_1700` expires the two holds on screen, `fill_date` auto-drafts a hire order, `issue_hire_order` lands a PDF in the outbox (never delivered), Reset returns to baseline. Note results.
- [ ] **Step 6:** whole-branch review of the Phase 2 commit range; fold in fixes.

---

## Self-review notes (author)

- **Spec coverage:** §6E scene engine → Tasks 2,3,4; §6E cue catalog → Task 2 (DB cues) + Task 3 (`issue_hire_order`); §6D run-of-show rail → Task 8; sim clock (narrative) → Tasks 1,2,6,7; prospect/volume → Tasks 5,6,8; §5 demo_state columns → Task 1. Phase-1 follow-up M1 (notifications target the rep) → the `drop_notifications` cue inserts for `p_actor` = the authed rep (Task 2/3).
- **Deferred / not in Phase 2:** `highlightRef` element-highlighting is included in the `Scene` type but rendering a highlight overlay is optional polish — Task 8 may render it or leave the field unused (state "no highlight overlay" in the PR if skipped). Sandbox-link cue (`generate_sandbox_link`) is Phase 3.
- **Known adaptation points (not placeholders):** cue pgTAP assertions and the `fill_date`/`artist_accepts_offer` row selection must be aligned to the seed's actual staged state (read `20260816205135_demo_mode_seed_rpcs.sql`); the exact seed booking counts determine the `fill_date` cap. Test-harness accessor names follow the real `supabaseFake`/`makeFakeDeps`/`renderWithProviders` APIs.
- **Type consistency:** `CueId` union (6 ids) is the single source used by `scenes.ts`, the DB `DB_CUES` list (5 ids, excludes `issue_hire_order`), and the edge dispatch; keep them aligned (the edge routes `issue_hire_order` separately).
