# Named Production Slots (design 1g) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Read the Global Constraints in `2026-08-11-skills-ux-index.md` first.

**Goal:** Replace a production's two bare slot-count fields and its flat required-skills picker with named **slot rows** (role name, count, main|understudy, per-slot skills). The production's required skills become the union of slot skills; its main/understudy slot totals become the sum of slot counts.

**Architecture — maintained derived caches (low blast radius):** Introduce `show_slots` + `show_slot_required_skills` as the new authoring model. Keep `shows.main_cast_slots`, `shows.understudy_slots`, and the `show_required_skills` table as **trigger-maintained caches** recomputed from slots. This is safe because a repo-wide audit confirms **nothing except `ShowFormDialog` writes** those columns/table (the booking engine, `compute_show_date_status`, `auto_cancel_on_slot_fill`, `expire-offers`, and all eligibility reads only READ them). So the entire engine stays UNCHANGED; only the authoring surface + a maintenance trigger + new tables are added.

**Tech Stack:** React 18 + TS, Tailwind + shadcn, react-query v5, react-hook-form + zod, Supabase (Postgres, RLS, triggers), vitest + supabaseFake, pgTAP.

## Global Constraints

See `2026-08-11-skills-ux-index.md` → "Global Constraints". Most load-bearing here: new tenant tables need RLS + `is_org_member`/`has_org_role` + RESTRICTIVE `org_isolation` + a `derive_org_id_*` BEFORE-INSERT trigger + a `check_..._same_org` guard (mirror `20260715130000_configurable_eligibility.sql`); `update_updated_at_column()` on tables with `updated_at`; regenerate `types.ts`, never hand-edit; migrations apply on merge (don't hand-apply to prod); `any` banned; no em/en dashes in UI copy; data-access `fetch/mutate(client,args)` + supabaseFake tests.

**Design source:** `section-1g.html` in the session scratchpad. Slot row = a name input, a count stepper, a Main/Understudy tag, per-slot skill chips (+Skill), and a remove control; plus an "Add slot" button and a computed callout "Every date of this production will require <union skills> — N of M artists qualify."

**Backwards-compatibility invariant (must hold after every task):** for a show with existing `main_cast_slots=M`, `understudy_slots=U`, and required skills `S`, after backfill the derived caches must read back EXACTLY `M`, `U`, and `S`. A show with NULL counts must stay NULL (unconfigured), i.e. no slot rows.

---

## Phase B1 — data model + maintained-cache derivation (migration)

### Task 1: `show_slots` + `show_slot_required_skills` tables

**Files:**
- Create: `supabase/migrations/2026081213xxxx_show_slots.sql` (timestamp after the latest migration at authoring time)
- Test: `supabase/tests/show_slots_rls.test.sql`
- Regenerate: `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts`

**Interfaces / Produces:**
- `show_slots(id uuid pk, org_id uuid, show_id uuid → shows on delete cascade, name text not null, slot_count smallint not null check (slot_count >= 0), kind text not null check (kind in ('main','understudy')), sort_order smallint, created_at, updated_at)`.
- `show_slot_required_skills(id uuid pk, org_id uuid, slot_id uuid → show_slots on delete cascade, skill_id uuid → skills on delete restrict, created_at, unique(slot_id, skill_id))`.
  (skill_id RESTRICT mirrors Plan A's delete guard so a required skill can't be deleted out from under a slot; if Plan A is not yet merged into this base, still use RESTRICT here.)

- [ ] **Step 1:** Write the migration. Create both tables. Add `derive_org_id_for_show_slot()` (org from the parent show) and `derive_org_id_for_show_slot_skill()` (org from the parent slot) BEFORE-INSERT triggers, plus `check_show_slot_skill_same_org()` guard (skill must be same org as slot). Enable RLS; SELECT = `is_org_member(auth.uid(), org_id)`; ALL (insert/update/delete) = `has_org_role(auth.uid(), org_id, ARRAY['admin','producer'])`; add the RESTRICTIVE `org_isolation` policy (`USING`/`WITH CHECK` = `org_id = ...active org or member`, mirror the exact form used in `20260715130000_configurable_eligibility.sql`). Add `update_updated_at_column()` trigger on `show_slots`. Add both tables to `supabase_realtime`.
- [ ] **Step 2:** Apply locally (`supabase migration up --local`), regen types (`supabase gen types typescript --local > ...`), `npm run sync:mirrors && npm run sync:mirrors:check`, verify the types diff is limited to the two new tables.
- [ ] **Step 3:** pgTAP `show_slots_rls.test.sql`: assert both tables exist with RLS enabled; assert the FK `show_slot_required_skills.skill_id` is `RESTRICT` and `slot_id`/`show_id` are `CASCADE`; assert an artist cannot insert a slot (role gate).
- [ ] **Step 4:** Run pgTAP (container psql). Expect all ok.
- [ ] **Step 5:** Commit.

### Task 2: derivation function + triggers

**Files:** append to the Task 1 migration (or a follow-on `..._show_slots_derivation.sql`); test `supabase/tests/show_slots_derivation.test.sql`.

**Produces:** `recompute_show_slot_derivations(p_show_id uuid)` (SECURITY DEFINER) that:
1. sets `shows.main_cast_slots = (select nullif(sum(slot_count),0)... )` — actually: `main_cast_slots = (select sum(slot_count) from show_slots where show_id=p_show_id and kind='main')`, `understudy_slots = (select sum(slot_count) ... kind='understudy')`. When a show has NO slots of a kind, the sum is NULL → column stays NULL (preserves the unconfigured state). Do NOT coalesce to 0.
2. rebuilds `show_required_skills` for the show: `delete from show_required_skills where show_id=p_show_id; insert into show_required_skills (org_id, show_id, skill_id) select distinct sh.org_id, p_show_id, ssrs.skill_id from show_slot_required_skills ssrs join show_slots ss on ss.id=ssrs.slot_id where ss.show_id=p_show_id;` (org from the show).

- [ ] **Step 1:** Write `recompute_show_slot_derivations`. Add AFTER INSERT/UPDATE/DELETE row triggers on `show_slots` and `show_slot_required_skills` that call it for the affected `show_id` (resolve show_id from slot_id for the skills table; use OLD on delete). Guard against recursion (these triggers write shows + show_required_skills, which have their own triggers — ensure no cycle: `shows` recompute trigger fires only on program/sub_program/main_cast_slots/understudy_slots UPDATE via `sync_show_dates_on_show_update`, which resyncs show_dates status — that is desired and terminates).
- [ ] **Step 2:** pgTAP: insert a show + a main slot(count 3) + an understudy slot(count 2) + slot skills {Vocals, Stage combat on the main slot, Vocals on understudy}; assert `shows.main_cast_slots=3`, `understudy_slots=2`, and `show_required_skills` = {Vocals, Stage combat} (deduped union). Delete a slot → assert the caches recompute. Delete all main slots → `main_cast_slots` back to NULL.
- [ ] **Step 3:** Run pgTAP. **Step 4:** Commit.

### Task 3: backfill existing shows

**Files:** append to the migration; test `supabase/tests/show_slots_backfill.test.sql` (or fold into derivation test using seed rows).

- [ ] **Step 1:** Backfill, wrapped so it runs once at migration time:
  - For each show with `main_cast_slots IS NOT NULL`: insert a `show_slots` row `(org_id, show_id, name='Main cast', slot_count=main_cast_slots, kind='main', sort_order=0)`.
  - For each show with `understudy_slots IS NOT NULL`: insert `(name='Understudy', slot_count=understudy_slots, kind='understudy', sort_order=1)`.
  - For each existing `show_required_skills` row: insert a `show_slot_required_skills` row attaching that skill to the show's **Main cast** slot (create a Main slot with count 0 if the show had required skills but NULL main_cast_slots, so the union is preserved — decide: prefer attaching to the main slot; if no main slot exists, attach to an understudy slot; if neither, create a `name='Cast'` main slot count 0 to hold the skills). Do the inserts with triggers DISABLED or in an order that lets the recompute reproduce the same caches, then run `recompute_show_slot_derivations` for every touched show at the end. **Invariant check:** after backfill, `main_cast_slots`/`understudy_slots`/`show_required_skills` must be unchanged from before.
- [ ] **Step 2:** pgTAP asserting the invariant on a representative seed show. **Step 3:** Commit.

---

## Phase B2 — slots data layer + hooks

### Task 4: `src/data/slots.ts` + `src/hooks/useShowSlots.ts`

**Produces:**
- `type SlotDraft = { id?: string; name: string; count: number; kind: 'main'|'understudy'; skillIds: string[] }`
- `fetchShowSlots(client, showId): Promise<SlotDraft[]>` (joins show_slot_required_skills, ordered by sort_order).
- `saveShowSlots(client, { showId, orgId, slots: SlotDraft[] }): Promise<void>` — diffs against current rows: insert new slots, update changed (name/count/kind/sort_order), delete removed; for each slot diff its skill set (insert/delete show_slot_required_skills). Incremental-baseline + retry-safe like `applyRequiredSkillsDiff`.
- `useShowSlots(showId)` hook.

- [ ] TDD each function with supabaseFake (assert the recorded insert/update/delete calls for a representative diff). Commit.

---

## Phase B3 — ShowFormDialog rewrite (design 1g)

### Task 5: replace the count fields + required-skills picker with a slot-row repeater

**Files:** modify `src/components/catalog/ShowFormDialog.tsx`; test `ShowFormDialog.test.tsx` (rework the existing required-skills tests).

- [ ] Remove: the `mainCastSlots`/`understudySlots` zod fields + inputs, and the `SkillPicker` "Required skills" block + `requiredSkillIds`/`applyRequiredSkillsDiff`/`addShowRequiredSkill`/`removeShowRequiredSkill` machinery.
- [ ] Add: a slot-row repeater backed by local `slots: SlotDraft[]` state, seeded once per open session from `fetchShowSlots(show.id)` (mirror the existing seed-once-per-open-session ref pattern already in this file). Each row: name Input, a count stepper (Input inputMode numeric, min 0), a Main/Understudy toggle or Select, a per-row `SkillPicker` over active `useSkills()`, and a remove button. An "Add slot" button appends a blank main slot. The computed callout: "Every date of this production will require <union of all slot skills>. N of M artists in your workspace qualify." (compute union client-side; M = artist count; N = artists holding all union skills — reuse existing eligibility count helpers if present, else show just the union without N/M to avoid a new query — keep faithful but do not add a heavy query if one does not already exist).
- [ ] Submit: upsert the show (createShow/updateShow WITHOUT main_cast_slots/understudy_slots — those are now derived), then `saveShowSlots({showId, orgId, slots})`. The derivation trigger fills the caches. Keep synced-show identity locking (program/sub_program disabled when synced); slots stay editable on synced shows.
- [ ] `src/data/shows.ts`: drop `mainCastSlots`/`understudySlots` from `CreateShowArgs`/`UpdateShowPatch`/`SHOW_COLS` insert/patch (keep them on `ShowRow` for reads — they are still selected/derived). Update `useCreateShow`/`useUpdateShow` types accordingly.
- [ ] Tests: creating a production with two slots writes the slots and the derived caches read back the sums/union; editing adds/removes a slot and a slot skill; synced show keeps program/sub_program locked but slots editable. Commit.

---

## Phase B4 — read-side + docs

### Task 6: verify read surfaces + system map

- [ ] `src/lib/settings.ts` `showSlots()` and `ProductionsPage.tsx` slot columns: still read `shows.main_cast_slots`/`understudy_slots` (now derived) — confirm no change needed; add a test that a slot-configured show renders its computed "M + U" slot column.
- [ ] `RequiredSkillsSection` (Setup tab) "From show" chips: still read `show_required_skills` (now derived from slots) — confirm they render the slot-derived union; no code change expected.
- [ ] Update `docs/system-map.md` + `src/data/systemMap.ts` in the same commit: add the show_slots → recompute_show_slot_derivations → (shows.slot columns + show_required_skills) derivation, since it is a new automation. Commit.

### Task 7: changelog + version (owner-confirmed)

- [ ] `public/changelog.md` (New: name production roles/slots with their own skills) + regen JSON; version bump held until owner confirms (same as Plan A).

---

## Self-Review (run after writing; fix inline)

- **Spec coverage:** 1g slot rows → Task 5; slot data model + union/count derivation → Tasks 1-3; read surfaces unchanged → Task 6. ✔
- **BC invariant:** Tasks 2-3 assert the derived caches reproduce the pre-change values; nothing else writes those caches (audited). ✔
- **Blast radius:** compute_show_date_status / auto_cancel_on_slot_fill / expire-offers / eligibility unchanged (they read the maintained caches). ✔
- **Open decision for the implementer:** backfill attachment of legacy `show_required_skills` when a show has skills but NULL main_cast_slots — create a count-0 'Cast' main slot to hold them so the union survives; assert the invariant.
