# Configurable Eligibility (Booking Flow Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-show cast priority ladders (falling back to the org-wide city list), uniform required skills per show/date enforced across the offer engine and all booking surfaces, a per-open skill filter for producers, the show-gate fix, and skill-aware understudy promotion.

**Architecture:** One additive schema migration (priority column on `show_cast_eligibility`, two skills-requirement tables) plus one function-replacement migration (promotion ORDER BY). A new Deno module `_shared/eligibility.ts` is the single home for ladder/gate/skills resolution, consumed by `open-offer-tier` and `expire-offers`. Frontend gets `src/data/eligibility.ts` + `src/lib/eligibility.ts` and extends the existing hooks/surfaces. Spec: `docs/superpowers/specs/2026-07-15-configurable-eligibility-design.md` (read it for semantics; this plan is the how).

**Tech Stack:** Postgres/Supabase (migrations, RLS, pgTAP), Deno edge functions (DI pattern), React 18 + TanStack Query v5 + Vitest, Playwright e2e.

## Global Constraints

- **No em dashes and no en dashes anywhere** in code, comments, SQL, copy, tests, or docs. Use period, comma, colon, parentheses, or middot. ASCII arrows `->` are fine.
- **Copy strings, verbatim where they appear:** "Using show-specific priorities" · "Only offer to artists with" · "Not eligible for this show" · "Missing required skills" · "From show" · "Artists must have all of these skills to receive offers or be booked." · "Overrides the organization default for this show only. Cities without show priorities keep the organization default."
- **Tests import the real module.** Frontend: `src/test/supabaseFake.ts` + `src/test/renderWithProviders.tsx`; never `vi.mock('@/integrations/supabase/client')`. Edge: import `handle`/module functions and pass `makeFakeDeps(...)` from `supabase/functions/_shared/testing.ts`.
- **Commands:** unit `npx vitest run`, edge `deno test --allow-all --node-modules-dir=none supabase/functions/`, types `npx tsc -p tsconfig.app.json --noEmit`, lint `npm run lint` (0 errors; ~365 pre-existing warnings are fine). pgTAP and Playwright browsers are CI-only: write the tests, verify SQL syntax by eye, and run `npx playwright test --config=e2e/playwright.config.ts --list` for collection only.
- **Never pipe test output through grep/head in a way that masks the exit code.** Run the bare command; read the summary.
- **New tables/columns are not in `src/integrations/supabase/types.ts`** (auto-generated, never hand-edit). At the data-access boundary use `(client as any).from("show_required_skills")` style casts with a one-line comment `// table not yet in generated types`. Same for the new `priority` column selects.
- **Query keys:** new reads live under the `['eligibility', ...]` domain. Any mutation touching `show_cast_eligibility.priority`, `show_required_skills`, or `show_date_required_skills` invalidates the `['eligibility']` prefix PLUS `['eligible-artists']`, `['artist-eligible-dates']`, and `['offer-tiers']`.
- **`_shared/eligibility.ts` (Deno) and `src/lib/eligibility.ts` (frontend) are NOT dual-home mirrors.** The Deno module owns server-side resolution (DB reads); the frontend lib holds pure helpers only. Do not copy one into the other; do not add a mirror-rule comment.
- **Migrations:** files under `supabase/migrations/` are created here as plain files (never edit existing ones). Do NOT apply anything to production; prod apply happens at the end of the project with explicit user approval, via the Supabase MCP.
- **DB writes in edge functions and RLS:** reads gated by `public.is_org_member(auth.uid(), org_id)`, writes by `public.has_org_role(auth.uid(), org_id, 'admin'::app_role) OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role)`, plus the RESTRICTIVE `org_isolation` policy (same body as migration `20260603120200`).
- **pgTAP UUIDs must be hex-only** (0-9a-f). Use the `e11a0000-...` prefix family for this feature's fixtures.
- **Commit style:** imperative, lowercase, <=72 chars, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

## File structure (locked decomposition)

| Unit | Path | Responsibility |
|---|---|---|
| Schema migration | `supabase/migrations/20260715130000_configurable_eligibility.sql` | priority column + partial unique, 2 skills tables, RLS, derivation triggers, same-org skill guard |
| Promotion migration | `supabase/migrations/20260715130100_skill_aware_understudy_promotion.sql` | verbatim function copy, ORDER BY change only |
| DB tests | `supabase/tests/db/configurable_eligibility.sql`, `supabase/tests/db/skill_aware_promotion.sql` | RLS/constraints/guards; promotion ordering |
| Engine resolution | `supabase/functions/_shared/eligibility.ts` (+ `eligibility.test.ts`) | ladder, next tier, gate, required skills, skills filter |
| Engine consumers | `supabase/functions/open-offer-tier/index.ts`, `supabase/functions/expire-offers/index.ts` (+ their `.di.test.ts`) | pipeline + escalation rewires |
| Frontend pure | `src/lib/eligibility.ts` (+ `.test.ts`) | skill-set subset test, union helper |
| Frontend data | `src/data/eligibility.ts` (+ `.test.ts`) | requirement/priority reads + mutations |
| Bookings updates | `src/lib/bookings.ts`, `src/data/bookings.ts` (+ existing tests) | deriveDirectBookList 4th arg; fetchOfferTiers show layer; skillFilterIds on open/dry-run |
| Artist calendar | `src/hooks/useArtistEligibleDates.ts` (+ test) | hard-requirement date filtering |
| Date sheet | `src/components/shows/date/RequiredSkillsSection.tsx` (new), `EligibilityBookList.tsx`, `TierTimeline.tsx`, `DryRunDialog.tsx`, `src/components/shows/ShowDateDetailSheet.tsx` | per-date skills editor, chips, skill picker, counts |
| Catalog | `src/components/catalog/ShowFormDialog.tsx` | show-level required-skills editor |
| Settings | `src/components/settings/CastsCitiesTab.tsx` | scoped priority editor |
| Docs | `docs/app-logic.md`, `docs/system-map.md`, `src/data/systemMap.ts` | eligibility + escalation + promotion rows |
| e2e | `e2e/configurable-eligibility.spec.ts`, `e2e/helpers/booking.ts` | ladder override + skill exclusion scenario |

Milestones: A = Tasks 1-2 (DB), B = Tasks 3-5 (engine), C = Tasks 6-7 (frontend foundations), D = Tasks 8-13 (surfaces), E = Tasks 14-15 (docs, e2e).

---

### Task 1: Schema migration + pgTAP

**Files:**
- Create: `supabase/migrations/20260715130000_configurable_eligibility.sql`
- Create: `supabase/tests/db/configurable_eligibility.sql`

**Interfaces:**
- Consumes: existing helpers `public.derive_org_id_from_show_id()`, `public.derive_org_id_from_show_date_id()` (migration `20260604130000`), `public.is_org_member`, `public.has_org_role(_uid, _org, _role app_role)`.
- Produces: `show_cast_eligibility.priority integer NULL CHECK >= 1` with partial unique `(show_id, city_id, priority)`; tables `show_required_skills(id, org_id, show_id, skill_id, created_at)` and `show_date_required_skills(id, org_id, show_date_id, skill_id, created_at)`. Every later task relies on these exact names.

- [ ] **Step 1: Write the migration**

```sql
-- Configurable eligibility (booking flow phase 4), spec:
-- docs/superpowers/specs/2026-07-15-configurable-eligibility-design.md
-- 1) Show-scoped cast priorities: nullable priority on show_cast_eligibility.
--    priority IS NULL keeps the row's existing meaning (eligible, untiered).
-- 2) Uniform required skills per show and per date (union semantics).
-- 3) Guards: org derivation (client org_id is overwritten) and same-org skill check.

ALTER TABLE public.show_cast_eligibility
  ADD COLUMN priority integer CHECK (priority >= 1);

-- One cast per tier per (show, city), mirroring cast_city_priority's UNIQUE (city_id, priority).
CREATE UNIQUE INDEX show_cast_eligibility_show_city_priority_uniq
  ON public.show_cast_eligibility (show_id, city_id, priority)
  WHERE priority IS NOT NULL;

CREATE TABLE public.show_required_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (show_id, skill_id)
);

CREATE TABLE public.show_date_required_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  show_date_id uuid NOT NULL REFERENCES public.show_dates(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (show_date_id, skill_id)
);

-- org_id derivation: BEFORE INSERT, server-derived from the FK parent. Reuses the
-- existing derive functions; whatever the client sends is overwritten.
DROP TRIGGER IF EXISTS trg_derive_org_id ON public.show_required_skills;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.show_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_from_show_id();

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.show_date_required_skills;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.show_date_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_from_show_date_id();

-- Same-org guard: a required skill must belong to the same org as its show/date.
-- BEFORE INSERT triggers fire in name order: trg_derive_org_id runs before
-- trg_required_skill_same_org ('d' < 'r'), so NEW.org_id is already derived here.
CREATE OR REPLACE FUNCTION public.check_required_skill_same_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_skill_org uuid;
BEGIN
  SELECT org_id INTO v_skill_org FROM public.skills WHERE id = NEW.skill_id;
  IF v_skill_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'required skill must belong to the same organization';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_required_skill_same_org ON public.show_required_skills;
CREATE TRIGGER trg_required_skill_same_org BEFORE INSERT OR UPDATE ON public.show_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.check_required_skill_same_org();

DROP TRIGGER IF EXISTS trg_required_skill_same_org ON public.show_date_required_skills;
CREATE TRIGGER trg_required_skill_same_org BEFORE INSERT OR UPDATE ON public.show_date_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.check_required_skill_same_org();

-- RLS: uniform org-isolation template (see migration 20260603120200).
ALTER TABLE public.show_required_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.show_date_required_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view show required skills"
  ON public.show_required_skills FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins and producers manage show required skills"
  ON public.show_required_skills FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role));

CREATE POLICY "Org members can view show date required skills"
  ON public.show_date_required_skills FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins and producers manage show date required skills"
  ON public.show_date_required_skills FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role));

-- RESTRICTIVE cross-org isolation, same body as 20260603120200_org_isolation_rls.sql.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['show_required_skills','show_date_required_skills'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (public.is_org_member(auth.uid(), org_id)) '
      || 'WITH CHECK (public.is_org_member(auth.uid(), org_id))',
      t);
  END LOOP;
END $$;
```

NOTE on INSERT + WITH CHECK: the org-derivation trigger rewrites `NEW.org_id` BEFORE row-level `WITH CHECK` is evaluated, so callers can insert without knowing org_id and the check still passes for their own org only. This matches how `show_date_cast_eligibility` behaves today.

- [ ] **Step 2: Write the pgTAP test**

Before writing, open `supabase/tests/db/slots_on_shows.sql` and copy its header/footer conventions (`BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`) and its seeding style for orgs/shows. Then write `supabase/tests/db/configurable_eligibility.sql` covering exactly these assertions (hex-only UUIDs, prefix `e11a`):

```sql
BEGIN;
SELECT plan(8);

-- Seed: one org, one city, one cast, one show, one date, one skill; a second org + skill.
INSERT INTO public.organizations (id, name, slug) VALUES
  ('e11a0000-0000-0000-0000-00000000000a', 'Elig Org A', 'elig-org-a'),
  ('e11a0000-0000-0000-0000-00000000000b', 'Elig Org B', 'elig-org-b');
INSERT INTO public.cities (id, org_id, name) VALUES
  ('e11a0000-0000-0000-0000-0000000000c1', 'e11a0000-0000-0000-0000-00000000000a', 'Berlin');
INSERT INTO public.casts (id, org_id, name) VALUES
  ('e11a0000-0000-0000-0000-0000000000ca', 'e11a0000-0000-0000-0000-00000000000a', 'Cast A'),
  ('e11a0000-0000-0000-0000-0000000000cb', 'e11a0000-0000-0000-0000-00000000000a', 'Cast B');
INSERT INTO public.shows (id, org_id, program) VALUES
  ('e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-00000000000a', 'Show A');
INSERT INTO public.show_dates (id, org_id, show_id, city_id, date) VALUES
  ('e11a0000-0000-0000-0000-0000000000d1', 'e11a0000-0000-0000-0000-00000000000a',
   'e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-0000000000c1', '2027-01-15');
INSERT INTO public.skills (id, org_id, name) VALUES
  ('e11a0000-0000-0000-0000-000000000541', 'e11a0000-0000-0000-0000-00000000000a', 'judge'),
  ('e11a0000-0000-0000-0000-000000000542', 'e11a0000-0000-0000-0000-00000000000b', 'foreign');

-- 1: priority accepts NULL (legacy gate rows unchanged)
SELECT lives_ok($$
  INSERT INTO public.show_cast_eligibility (show_id, city_id, cast_id, org_id)
  VALUES ('e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-0000000000c1',
          'e11a0000-0000-0000-0000-0000000000ca', 'e11a0000-0000-0000-0000-00000000000a')
$$, 'gate row without priority inserts');

-- 2: priority >= 1 enforced
SELECT throws_ok($$
  UPDATE public.show_cast_eligibility SET priority = 0
  WHERE cast_id = 'e11a0000-0000-0000-0000-0000000000ca'
$$, '23514', NULL, 'priority 0 violates the check');

-- 3: assigning a valid priority works
SELECT lives_ok($$
  UPDATE public.show_cast_eligibility SET priority = 1
  WHERE cast_id = 'e11a0000-0000-0000-0000-0000000000ca'
$$, 'priority 1 assigns');

-- 4: partial unique blocks a second cast at the same (show, city, priority)
SELECT throws_ok($$
  INSERT INTO public.show_cast_eligibility (show_id, city_id, cast_id, org_id, priority)
  VALUES ('e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-0000000000c1',
          'e11a0000-0000-0000-0000-0000000000cb', 'e11a0000-0000-0000-0000-00000000000a', 1)
$$, '23505', NULL, 'one cast per tier per show and city');

-- 5: two NULL-priority rows coexist (partial index ignores NULLs)
SELECT lives_ok($$
  INSERT INTO public.show_cast_eligibility (show_id, city_id, cast_id, org_id)
  VALUES ('e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-0000000000c1',
          'e11a0000-0000-0000-0000-0000000000cb', 'e11a0000-0000-0000-0000-00000000000a')
$$, 'untiered rows are not constrained by the priority index');

-- 6: org derivation overwrites a client-sent org_id on show_required_skills
INSERT INTO public.show_required_skills (show_id, skill_id, org_id)
VALUES ('e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-000000000541',
        'e11a0000-0000-0000-0000-00000000000b');
SELECT is(
  (SELECT org_id FROM public.show_required_skills
   WHERE show_id = 'e11a0000-0000-0000-0000-00000000005a'),
  'e11a0000-0000-0000-0000-00000000000a'::uuid,
  'org_id is derived from the show, not taken from the client');

-- 7: cross-org skill is rejected by the same-org guard
SELECT throws_ok($$
  INSERT INTO public.show_date_required_skills (show_date_id, skill_id, org_id)
  VALUES ('e11a0000-0000-0000-0000-0000000000d1', 'e11a0000-0000-0000-0000-000000000542',
          'e11a0000-0000-0000-0000-00000000000a')
$$, NULL, 'required skill must belong to the same organization',
   'cross-org skill insert raises');

-- 8: RLS is enabled on both new tables
SELECT is(
  (SELECT count(*) FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename IN ('show_required_skills', 'show_date_required_skills')
     AND rowsecurity), 2::bigint, 'RLS enabled on both requirement tables');

SELECT * FROM finish();
ROLLBACK;
```

If the seed columns above do not match the actual NOT NULL columns of `organizations`/`cities`/`casts`/`shows`/`show_dates` in this database (check an existing test such as `supabase/tests/db/slots_on_shows.sql` for the canonical minimal seed), adjust the seed columns, never the assertions.

- [ ] **Step 3: Sanity-check ordering and syntax**

Run: `ls supabase/migrations/ | tail -3` and confirm `20260715130000_configurable_eligibility.sql` sorts last. Read both new files once for SQL typos (pgTAP runs in CI only).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260715130000_configurable_eligibility.sql supabase/tests/db/configurable_eligibility.sql
git commit -m "add show-scoped priorities and required-skills tables"
```

---

### Task 2: Skill-aware understudy promotion migration + pgTAP

**Files:**
- Create: `supabase/migrations/20260715130100_skill_aware_understudy_promotion.sql`
- Create: `supabase/tests/db/skill_aware_promotion.sql`

**Interfaces:**
- Consumes: the CURRENT `public.promote_understudy_on_cancellation()` definition, which lives in `supabase/migrations/20260714182625_booking_flow_review_hardening.sql` starting at line 147 (this is the latest of several redefinitions; do NOT copy from `20260519000000`).
- Produces: same function name and trigger binding; only the candidate ORDER BY changes.

- [ ] **Step 1: Write the migration**

Open `supabase/migrations/20260714182625_booking_flow_review_hardening.sql`, locate `CREATE OR REPLACE FUNCTION public.promote_understudy_on_cancellation()` (line 147) and copy the ENTIRE function definition verbatim (through its closing `$$;`), into the new migration file with this header comment:

```sql
-- Skill-aware understudy promotion (booking flow phase 4):
-- verbatim copy of promote_understudy_on_cancellation() from
-- 20260714182625_booking_flow_review_hardening.sql with ONE change, the
-- candidate ORDER BY: prefer the understudy whose skills best cover the
-- cancelled artist's skills (count of shared artist_skills rows, descending),
-- then the existing oldest-first tie-break. A cancelled artist with no skills
-- makes every candidate tie at zero, which reproduces the old ordering exactly.
-- Skills never block promotion, they only reorder preference.
```

Then replace exactly this fragment of the copied body:

```sql
  ORDER BY b.created_at ASC
```

with:

```sql
  ORDER BY
    (SELECT count(*)
       FROM public.artist_skills cand
      WHERE cand.artist_id = b.artist_id
        AND cand.skill_id IN (
          SELECT lost.skill_id FROM public.artist_skills lost
           WHERE lost.artist_id = NEW.artist_id
        )) DESC,
    b.created_at ASC
```

Everything else in the function body stays byte-identical (the show-date-cancellation guard, the booking_flow gates, the soft_booked-only candidacy, blocked_dates exclusion, `FOR UPDATE SKIP LOCKED`, GUC suppression, audit log, notifications). Do not re-create the trigger: `CREATE OR REPLACE FUNCTION` keeps the existing binding (same convention as `20260714182625` itself, which also only replaced the function).

- [ ] **Step 2: Verify the copy is faithful**

Run: `diff <(sed -n '/CREATE OR REPLACE FUNCTION public.promote_understudy_on_cancellation/,/^\$\$;/p' supabase/migrations/20260714182625_booking_flow_review_hardening.sql) <(sed -n '/CREATE OR REPLACE FUNCTION public.promote_understudy_on_cancellation/,/^\$\$;/p' supabase/migrations/20260715130100_skill_aware_understudy_promotion.sql)`

Expected: the ONLY hunk is the ORDER BY replacement above. Any other diff means the copy drifted; fix it.

- [ ] **Step 3: Write the pgTAP test**

`supabase/tests/db/skill_aware_promotion.sql`, `plan(3)`, hex UUIDs prefix `e11b`. Before writing, check how existing promotion coverage seeds bookings: `grep -rln "promote" supabase/tests/db/` and mirror that file's seed for orgs/shows/dates/artists/bookings (statuses, is_understudy, created_at staggering). The three assertions:

1. **Skill match wins over age.** Cancelled confirmed main artist has skill `judge`. Understudy U1 (older, soft_booked, no skills) and U2 (newer, soft_booked, has `judge`). After `UPDATE bookings SET status = 'cancelled' WHERE id = <main>`, assert U2's booking has `is_understudy = false AND status = 'confirmed'` and U1 is unchanged.
2. **No skills on the cancelled artist keeps oldest-first.** Cancelled artist has no `artist_skills` rows; U1 older, U2 newer, neither skilled. Assert U1 is promoted (regression guard for pre-change behavior).
3. **Coverage ties break by age.** Cancelled artist has `judge`; U1 older with `judge`, U2 newer with `judge`. Assert U1 is promoted.

Stagger `created_at` by inserting explicit values (`now() - interval '2 days'` vs `now() - interval '1 day'`). Give all artists `user_id = NULL` so notification inserts are skipped (the function's notification INSERT selects only rows with a non-null user_id).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260715130100_skill_aware_understudy_promotion.sql supabase/tests/db/skill_aware_promotion.sql
git commit -m "make understudy promotion prefer skill coverage"
```

---

### Task 3: `_shared/eligibility.ts` (Deno resolution module)

**Files:**
- Create: `supabase/functions/_shared/eligibility.ts`
- Test: `supabase/functions/_shared/eligibility.test.ts`

**Interfaces:**
- Consumes: the admin Supabase client shape from `_shared/deps.ts` (`Deps["admin"]`); tables `show_cast_eligibility` (with new `priority`), `cast_city_priority`, `show_date_cast_eligibility`, `cast_members`, `show_required_skills`, `show_date_required_skills`, `artist_skills`.
- Produces (exact signatures, used verbatim by Tasks 4-5):

```ts
export interface TierLadder {
  source: "show" | "org";
  tiers: { tier: number; castId: string }[]; // sorted ascending by tier
}
export async function resolveTierLadder(admin: Admin, showId: string, cityId: string): Promise<TierLadder>
export function ladderCastIdsAtTier(ladder: TierLadder, tier: number): string[]
export function nextTierAfter(ladder: TierLadder, currentTier: number): number | null
export async function fetchGateArtistIds(
  admin: Admin, args: { showId: string; cityId: string | null; showDateId: string },
): Promise<Set<string> | null> // null = no gate rows at all = unrestricted
export async function fetchRequiredSkillIds(
  admin: Admin, args: { showId: string; showDateId: string },
): Promise<string[]> // union of show-level and date-level, deduped
export async function filterArtistIdsBySkills(
  admin: Admin, artistIds: string[], requiredSkillIds: string[],
): Promise<string[]> // subset holding ALL required skills; requiredSkillIds [] returns artistIds unchanged
```

- [ ] **Step 1: Write the failing tests**

Model the fake-client seeding on `supabase/functions/open-offer-tier/index.di.test.ts` (it uses `makeFakeDeps({ tables: ... })` from `_shared/testing.ts`; array seeds match on recorded `eq()` args via `when`). Cover:

```ts
import { assertEquals } from "jsr:@std/assert";
import { makeFakeDeps } from "./testing.ts";
import {
  resolveTierLadder, ladderCastIdsAtTier, nextTierAfter,
  fetchGateArtistIds, fetchRequiredSkillIds, filterArtistIdsBySkills,
} from "./eligibility.ts";

Deno.test("resolveTierLadder prefers show rows and reports source show", async () => {
  const deps = makeFakeDeps({
    tables: {
      show_cast_eligibility: { data: [{ cast_id: "cast-g", priority: 1 }, { cast_id: "cast-a", priority: 2 }] },
      cast_city_priority: { data: [{ cast_id: "cast-x", priority: 1 }] },
    },
  });
  const ladder = await resolveTierLadder(deps.admin, "show-1", "city-1");
  assertEquals(ladder.source, "show");
  assertEquals(ladder.tiers, [{ tier: 1, castId: "cast-g" }, { tier: 2, castId: "cast-a" }]);
});

Deno.test("resolveTierLadder falls back to the org city list", async () => {
  const deps = makeFakeDeps({
    tables: {
      show_cast_eligibility: { data: [] },
      cast_city_priority: { data: [{ cast_id: "cast-x", priority: 2 }, { cast_id: "cast-y", priority: 1 }] },
    },
  });
  const ladder = await resolveTierLadder(deps.admin, "show-1", "city-1");
  assertEquals(ladder.source, "org");
  assertEquals(ladder.tiers.map((t) => t.tier), [1, 2]);
});

Deno.test("nextTierAfter returns the smallest higher tier or null", () => {
  const ladder = { source: "org" as const, tiers: [{ tier: 1, castId: "a" }, { tier: 3, castId: "b" }] };
  assertEquals(nextTierAfter(ladder, 1), 3);
  assertEquals(nextTierAfter(ladder, 3), null);
});

Deno.test("ladderCastIdsAtTier returns the casts at exactly that tier", () => {
  const ladder = { source: "show" as const, tiers: [{ tier: 1, castId: "a" }, { tier: 2, castId: "b" }] };
  assertEquals(ladderCastIdsAtTier(ladder, 2), ["b"]);
  assertEquals(ladderCastIdsAtTier(ladder, 4), []);
});

Deno.test("fetchGateArtistIds returns null with no gate rows, else the member union", async () => {
  const noGate = makeFakeDeps({ tables: {
    show_cast_eligibility: { data: [] },
    show_date_cast_eligibility: { data: [] },
  } });
  assertEquals(await fetchGateArtistIds(noGate.admin, { showId: "s", cityId: "c", showDateId: "d" }), null);

  const gated = makeFakeDeps({ tables: {
    show_cast_eligibility: { data: [{ cast_id: "cast-a" }] },
    show_date_cast_eligibility: { data: [{ cast_id: "cast-b" }] },
    cast_members: { data: [{ artist_id: "ar-1" }, { artist_id: "ar-2" }] },
  } });
  const set = await fetchGateArtistIds(gated.admin, { showId: "s", cityId: "c", showDateId: "d" });
  assertEquals([...set!].sort(), ["ar-1", "ar-2"]);
});

Deno.test("fetchRequiredSkillIds unions show and date rows", async () => {
  const deps = makeFakeDeps({ tables: {
    show_required_skills: { data: [{ skill_id: "sk-1" }] },
    show_date_required_skills: { data: [{ skill_id: "sk-1" }, { skill_id: "sk-2" }] },
  } });
  assertEquals(await fetchRequiredSkillIds(deps.admin, { showId: "s", showDateId: "d" }), ["sk-1", "sk-2"]);
});

Deno.test("filterArtistIdsBySkills keeps only artists holding ALL required skills", async () => {
  const deps = makeFakeDeps({ tables: {
    artist_skills: { data: [
      { artist_id: "ar-1", skill_id: "sk-1" }, { artist_id: "ar-1", skill_id: "sk-2" },
      { artist_id: "ar-2", skill_id: "sk-1" },
    ] },
  } });
  assertEquals(await filterArtistIdsBySkills(deps.admin, ["ar-1", "ar-2", "ar-3"], ["sk-1", "sk-2"]), ["ar-1"]);
  assertEquals(await filterArtistIdsBySkills(deps.admin, ["ar-1", "ar-2"], []), ["ar-1", "ar-2"]);
});
```

If `makeFakeDeps`'s single-object seeds cannot distinguish the two `show_cast_eligibility` reads a test needs, use the array-seed `when` form matched on `eq()` args (see `ArraySeedEntry` in `_shared/testing.ts`).

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/eligibility.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// Shared eligibility resolution for the booking engine (phase 4).
// Single home for: the effective tier ladder (show override -> org city list),
// the show eligibility gate, required skills, and the skills filter.
// Consumed by open-offer-tier and expire-offers. NOT mirrored in src/lib:
// the frontend has its own pure helpers (src/lib/eligibility.ts) and
// data-access functions (src/data/eligibility.ts) with different concerns.
import type { Deps } from "./deps.ts";

type Admin = Deps["admin"];

export interface TierLadder {
  source: "show" | "org";
  tiers: { tier: number; castId: string }[];
}

/** Effective ladder for (show, city): show-scoped prioritized rows win outright;
 *  otherwise the org-wide cast_city_priority list for the city. */
export async function resolveTierLadder(admin: Admin, showId: string, cityId: string): Promise<TierLadder> {
  const { data: showRows } = await (admin as any)
    .from("show_cast_eligibility")
    .select("cast_id, priority")
    .eq("show_id", showId)
    .eq("city_id", cityId)
    .not("priority", "is", null);
  const show = (showRows ?? []) as Array<{ cast_id: string; priority: number }>;
  if (show.length > 0) {
    return {
      source: "show",
      tiers: show.map((r) => ({ tier: r.priority, castId: r.cast_id })).sort((a, b) => a.tier - b.tier),
    };
  }
  const { data: orgRows } = await (admin as any)
    .from("cast_city_priority")
    .select("cast_id, priority")
    .eq("city_id", cityId);
  const org = (orgRows ?? []) as Array<{ cast_id: string; priority: number }>;
  return {
    source: "org",
    tiers: org.map((r) => ({ tier: r.priority, castId: r.cast_id })).sort((a, b) => a.tier - b.tier),
  };
}

export function ladderCastIdsAtTier(ladder: TierLadder, tier: number): string[] {
  return ladder.tiers.filter((t) => t.tier === tier).map((t) => t.castId);
}

/** Smallest ladder tier strictly greater than currentTier, or null when exhausted. */
export function nextTierAfter(ladder: TierLadder, currentTier: number): number | null {
  const higher = ladder.tiers.map((t) => t.tier).filter((t) => t > currentTier);
  return higher.length > 0 ? Math.min(...higher) : null;
}

/** The show eligibility gate: union of show-level (show+city) and date-level cast rows,
 *  resolved to artist ids. Null = no gate rows at all = unrestricted
 *  (exactly useEligibleArtists semantics on the frontend). */
export async function fetchGateArtistIds(
  admin: Admin,
  args: { showId: string; cityId: string | null; showDateId: string },
): Promise<Set<string> | null> {
  const castIds: string[] = [];
  if (args.cityId) {
    const { data: showCasts } = await (admin as any)
      .from("show_cast_eligibility")
      .select("cast_id")
      .eq("show_id", args.showId)
      .eq("city_id", args.cityId);
    for (const r of (showCasts ?? []) as Array<{ cast_id: string }>) castIds.push(r.cast_id);
  }
  const { data: dateCasts } = await (admin as any)
    .from("show_date_cast_eligibility")
    .select("cast_id")
    .eq("show_date_id", args.showDateId);
  for (const r of (dateCasts ?? []) as Array<{ cast_id: string }>) castIds.push(r.cast_id);

  const uniq = [...new Set(castIds)];
  if (uniq.length === 0) return null;

  const { data: members } = await (admin as any)
    .from("cast_members")
    .select("artist_id")
    .in("cast_id", uniq);
  return new Set(((members ?? []) as Array<{ artist_id: string }>).map((m) => m.artist_id));
}

/** Union of show-level and date-level required skills, deduped, stable order. */
export async function fetchRequiredSkillIds(
  admin: Admin,
  args: { showId: string; showDateId: string },
): Promise<string[]> {
  const { data: showSkills } = await (admin as any)
    .from("show_required_skills")
    .select("skill_id")
    .eq("show_id", args.showId);
  const { data: dateSkills } = await (admin as any)
    .from("show_date_required_skills")
    .select("skill_id")
    .eq("show_date_id", args.showDateId);
  const all = [
    ...((showSkills ?? []) as Array<{ skill_id: string }>).map((r) => r.skill_id),
    ...((dateSkills ?? []) as Array<{ skill_id: string }>).map((r) => r.skill_id),
  ];
  return [...new Set(all)];
}

/** Artists (of artistIds) holding ALL of requiredSkillIds. Empty requirements pass everyone. */
export async function filterArtistIdsBySkills(
  admin: Admin,
  artistIds: string[],
  requiredSkillIds: string[],
): Promise<string[]> {
  if (requiredSkillIds.length === 0 || artistIds.length === 0) return artistIds;
  const { data: rows } = await (admin as any)
    .from("artist_skills")
    .select("artist_id, skill_id")
    .in("artist_id", artistIds)
    .in("skill_id", requiredSkillIds);
  const counts = new Map<string, number>();
  for (const r of (rows ?? []) as Array<{ artist_id: string; skill_id: string }>) {
    counts.set(r.artist_id, (counts.get(r.artist_id) ?? 0) + 1);
  }
  // (artist_id, skill_id) is the junction PK, so counting rows equals counting distinct skills.
  return artistIds.filter((id) => (counts.get(id) ?? 0) === requiredSkillIds.length);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/eligibility.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/eligibility.ts supabase/functions/_shared/eligibility.test.ts
git commit -m "add shared eligibility resolution module"
```

---

### Task 4: `open-offer-tier` pipeline rewrite

**Files:**
- Modify: `supabase/functions/open-offer-tier/index.ts`
- Test: `supabase/functions/open-offer-tier/index.di.test.ts` (extend, do not rewrite passing tests)

**Interfaces:**
- Consumes (Task 3, import from `../_shared/eligibility.ts`): `resolveTierLadder`, `ladderCastIdsAtTier`, `fetchGateArtistIds`, `fetchRequiredSkillIds`, `filterArtistIdsBySkills`.
- Produces: request body accepts optional `skill_filter_ids: string[]`; `ExcludedCounts` becomes `{ already_booked: number; blocked: number; inactive: number; not_eligible: number; missing_skills: number }`; dry-run responses carry the two new keys. Tasks 7 and 11 rely on the exact snake_case keys `not_eligible` and `missing_skills`.

- [ ] **Step 1: Write the failing tests (extend `index.di.test.ts`)**

Read the existing suite first to reuse its seed helpers and auth setup. Add these cases (adapt table seeding to the file's established style):

1. **Show ladder wins:** seed `show_cast_eligibility` with `{ cast_id: "cast-show", priority: 1 }` for the show+city AND `cast_city_priority` with `{ cast_id: "cast-org", priority: 1 }`. Request tier 1. Assert the inserted bookings belong to cast-show's members, not cast-org's.
2. **Org fallback:** seed `show_cast_eligibility` empty of priorities (or only NULL-priority rows); request tier 1 resolves via `cast_city_priority` (existing behavior, now through the ladder).
3. **Gate intersection:** org ladder tier 1 = cast-x (members ar-1, ar-2); gate rows exist naming only cast-g whose member is ar-1. Assert only ar-1 gets an offer and the dry-run counts `not_eligible: 1`.
4. **Required skills exclude:** show requires skill sk-1; ar-1 holds it, ar-2 does not. Assert ar-2 excluded, dry-run `missing_skills: 1`.
5. **Per-open filter unions:** no stored requirements; request `skill_filter_ids: ["sk-9"]`; only artists holding sk-9 receive offers; dry-run reflects it in `missing_skills`.
6. **Tier 99 dedups against the effective ladder:** show ladder contains cast-a; date-level eligibility lists cast-a and cast-b; tier 99 offers only cast-b members.
7. **Regression:** all existing tests still pass unchanged EXCEPT any that assert the old 3-key `excluded` shape; update those to expect `not_eligible: 0, missing_skills: 0` added.

- [ ] **Step 2: Run to verify the new cases fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/open-offer-tier/`
Expected: new cases FAIL, old ones PASS.

- [ ] **Step 3: Implement the pipeline changes**

In `supabase/functions/open-offer-tier/index.ts`:

a) Import the module:

```ts
import {
  resolveTierLadder, ladderCastIdsAtTier, fetchGateArtistIds,
  fetchRequiredSkillIds, filterArtistIdsBySkills,
} from "../_shared/eligibility.ts";
```

b) Extend the counts type and body parse (replace the existing `ExcludedCounts` and the body block):

```ts
type ExcludedCounts = {
  already_booked: number; blocked: number; inactive: number;
  not_eligible: number; missing_skills: number;
};
```

```ts
  let show_date_id: string
  let tier: number
  let dryRun = false
  let skillFilterIds: string[] = []
  try {
    const body = await req.json()
    show_date_id = body.show_date_id
    tier = Number(body.tier)
    dryRun = body.dry_run === true
    if (Array.isArray(body.skill_filter_ids)) {
      skillFilterIds = body.skill_filter_ids.filter((v: unknown): v is string => typeof v === "string")
    }
    if (!show_date_id || !tier || tier < 1) {
      return json({ error: 'show_date_id and tier (≥1) are required' }, 400)
    }
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
```

Update `benignExit`'s default counts object to the 5-key shape (`{ already_booked: 0, blocked: 0, inactive: 0, not_eligible: 0, missing_skills: 0 }`), and the one call site that passes explicit counts.

c) Replace the tier-resolution block (the whole `if (tier === 99) { ... } else { ... }` between the session check and the cast_members read). The ladder needs a city; keep the existing no-city messages:

```ts
  // Resolve the effective ladder once: show-scoped priorities win outright for
  // this (show, city); otherwise the org-wide city list (spec: effective ladder).
  let eligibleCastIds: string[]

  if (tier === 99) {
    // Tier 99: ad-hoc casts added via show_date_cast_eligibility that are not
    // already part of the EFFECTIVE ladder for this (show, city).
    const { data: dateCasts } = await admin
      .from('show_date_cast_eligibility')
      .select('cast_id')
      .eq('show_date_id', show_date_id)

    if (!dateCasts || dateCasts.length === 0) {
      return benignExit('No ad-hoc casts for this date')
    }

    const castIds = dateCasts.map((r: any) => r.cast_id)
    if (showDate.city_id) {
      const ladder = await resolveTierLadder(admin, showDate.show_id, showDate.city_id)
      const ladderCastIds = new Set(ladder.tiers.map((t) => t.castId))
      eligibleCastIds = castIds.filter((id: string) => !ladderCastIds.has(id))
    } else {
      eligibleCastIds = castIds
    }
  } else {
    if (!showDate.city_id) {
      return benignExit('Show date has no city, cannot resolve priority casts')
    }
    const ladder = await resolveTierLadder(admin, showDate.show_id, showDate.city_id)
    eligibleCastIds = ladderCastIdsAtTier(ladder, tier)
    if (eligibleCastIds.length === 0) {
      return benignExit(`No casts configured at tier ${tier} for this city`)
    }
  }
```

Note: the original file's no-city message used an em dash; the new string above uses a comma per the repo copy rule. Update any existing test that asserts the old exact string. Leave every other pre-existing message in the file byte-identical.

d) After the `blocked` filter and the existing `candidateIds` computation, insert the gate and skills stages (replace the current `excluded` object construction):

```ts
  // Gate (spec: candidates must pass the show eligibility gate when one exists;
  // union of show-level and date-level rows, none at all = unrestricted).
  const gate = await fetchGateArtistIds(admin, {
    showId: showDate.show_id, cityId: showDate.city_id, showDateId: show_date_id,
  })
  const afterBlocked = candidateIds
  const afterGate = gate == null ? afterBlocked : afterBlocked.filter((id: string) => gate.has(id))
  const notEligibleCount = afterBlocked.length - afterGate.length

  // Skills: stored requirements (show ∪ date) unioned with the per-open filter.
  const storedSkillIds = await fetchRequiredSkillIds(admin, {
    showId: showDate.show_id, showDateId: show_date_id,
  })
  const requiredSkillIds = [...new Set([...storedSkillIds, ...skillFilterIds])]
  const afterSkills = await filterArtistIdsBySkills(admin, afterGate, requiredSkillIds)
  const missingSkillsCount = afterGate.length - afterSkills.length

  const finalCandidateIds = afterSkills
  const excluded: ExcludedCounts = {
    already_booked: alreadyBookedCount,
    blocked: blockedCount,
    inactive: inactiveCount,
    not_eligible: notEligibleCount,
    missing_skills: missingSkillsCount,
  }

  if (finalCandidateIds.length === 0) {
    return benignExit('All eligible artists already have offers, are blocked, or do not qualify', excluded)
  }
```

Then rename every later use of `candidateIds` (dry-run name lookup, `toInsert` map, immediate-delivery artist fetch) to `finalCandidateIds`. The immediate-delivery block's `.in('id', candidateIds)` MUST become `.in('id', finalCandidateIds)`.

e) Do not change: insert shape, tier upsert, immediate delivery logic, response shape (other than `excluded`).

- [ ] **Step 4: Run the full open-offer-tier suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/open-offer-tier/`
Expected: PASS, all cases.

- [ ] **Step 5: Run the WHOLE functions suite (multi-file regression rule)**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS. Other suites (airtable-poll, expire-offers) invoke open-offer-tier contracts; fix any drift now.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/open-offer-tier/
git commit -m "route open-offer-tier through effective ladder, gate and skills"
```

---

### Task 5: `expire-offers` ladder-aware auto-escalation

**Files:**
- Modify: `supabase/functions/expire-offers/index.ts` (auto-escalate branch, around lines 290-350)
- Test: `supabase/functions/expire-offers/index.di.test.ts` (extend)

**Interfaces:**
- Consumes (Task 3): `resolveTierLadder`, `nextTierAfter`.
- Produces: no contract change; escalation now walks the same effective ladder that opened the tier. Automation NEVER sends `skill_filter_ids` (spec rule).

- [ ] **Step 1: Write the failing tests**

Extend the existing escalation cases in `index.di.test.ts`:

1. **Show ladder escalation:** seed a show ladder (`show_cast_eligibility` rows with priorities 1 and 3 for the show+city) and an org list containing priority 2 for the same city. Current tier 1 short and expired. Assert `invokeFunction` was called with `{ show_date_id, tier: 3 }` (the show ladder's next tier, NOT the org list's 2).
2. **Org fallback unchanged:** no show priorities; org list has 1 and 2; tier 1 escalates to 2 (existing behavior, keep any existing test green).
3. **Ladder exhausted:** show ladder has only tier 1; assert no invoke and the manual `cast_escalation_requested` notification is inserted.
4. **No skill filter is ever passed:** in case 1, assert the invoke body has no `skill_filter_ids` key.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/expire-offers/`
Expected: new cases FAIL.

- [ ] **Step 3: Implement**

a) Import: `import { resolveTierLadder, nextTierAfter } from "../_shared/eligibility.ts";`

b) Add `show_id` to the show-date select in the escalation scan:

```ts
      .select('id, show_id, date, city_id, org_id, show:shows(program, sub_program, main_cast_slots, understudy_slots)')
```

c) Replace the next-tier lookup inside the `if (flow.auto_escalate && activeOrgIds.has(orgId) && row.tier !== 99)` branch. The old code queries `cast_city_priority` directly with `.gt('priority', row.tier)`. New code (city guard preserved: no city means no ladder, fall through to the manual path):

```ts
      let nextTier: number | undefined
      if ((sd as any).city_id) {
        // Next tier comes from the SAME effective ladder that opened this tier
        // (show override if present, else the org city list). Spec: escalation
        // walks the effective ladder; automation never applies a skill filter.
        const ladder = await resolveTierLadder(admin, (sd as any).show_id, (sd as any).city_id)
        nextTier = nextTierAfter(ladder, row.tier) ?? undefined
      }
```

Keep everything after `if (nextTier !== undefined)` byte-identical (close+stamp, invoke, notification, fall-through semantics).

- [ ] **Step 4: Run the expire-offers suite, then the whole functions suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/expire-offers/` then `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/expire-offers/
git commit -m "walk the effective ladder in auto-escalation"
```

---

### Task 6: Frontend eligibility lib + data layer

**Files:**
- Create: `src/lib/eligibility.ts`
- Create: `src/lib/eligibility.test.ts`
- Create: `src/data/eligibility.ts`
- Create: `src/data/eligibility.test.ts`

**Interfaces:**
- Consumes: `createFakeSupabase` from `src/test/supabaseFake.ts` (seed map keyed by table name / `fn:<name>`, `.calls` records `{ table, method, args }`).
- Produces (exact, relied on by Tasks 9-13):

```ts
// src/lib/eligibility.ts (pure)
export function unionSkillIds(a: string[], b: string[]): string[]           // dedup, sorted (stable query keys)
export function artistHasAllSkills(artistSkillIds: Set<string>, requiredSkillIds: string[]): boolean

// src/data/eligibility.ts
export interface RequiredSkillIds { showSkillIds: string[]; dateSkillIds: string[]; all: string[] }
export async function fetchRequiredSkillIds(client, args: { showId: string; showDateId: string }): Promise<RequiredSkillIds>
export async function fetchSkillEligibleArtistIds(client, args: { requiredSkillIds: string[] }): Promise<Set<string> | null>
export interface ShowPriorityRow { id: string; cityId: string; castId: string; priority: number }
export async function fetchShowPriorityRows(client, showId: string): Promise<ShowPriorityRow[]>
export async function setShowCastPriority(client, args: { showId: string; cityId: string; castId: string; priority: number; orgId: string }): Promise<void>
export async function clearShowCastPriority(client, rowId: string): Promise<void>
export async function addShowRequiredSkill(client, args: { showId: string; skillId: string; orgId: string }): Promise<void>
export async function removeShowRequiredSkill(client, args: { showId: string; skillId: string }): Promise<void>
export async function addShowDateRequiredSkill(client, args: { showDateId: string; skillId: string; orgId: string }): Promise<void>
export async function removeShowDateRequiredSkill(client, args: { showDateId: string; skillId: string }): Promise<void>
```

- [ ] **Step 1: Write the failing lib tests** (`src/lib/eligibility.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { unionSkillIds, artistHasAllSkills } from "./eligibility";

describe("unionSkillIds", () => {
  it("dedups and sorts for stable query keys", () => {
    expect(unionSkillIds(["b", "a"], ["a", "c"])).toEqual(["a", "b", "c"]);
  });
  it("handles empty inputs", () => {
    expect(unionSkillIds([], [])).toEqual([]);
  });
});

describe("artistHasAllSkills", () => {
  it("requires every required skill", () => {
    expect(artistHasAllSkills(new Set(["s1", "s2"]), ["s1"])).toBe(true);
    expect(artistHasAllSkills(new Set(["s1"]), ["s1", "s2"])).toBe(false);
  });
  it("passes everyone when nothing is required", () => {
    expect(artistHasAllSkills(new Set(), [])).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure, implement the lib**

Run: `npx vitest run src/lib/eligibility.test.ts` (FAIL: module not found), then:

```ts
// Pure eligibility helpers shared by hooks and components. Data access lives in
// src/data/eligibility.ts; the booking engine's server-side resolution lives in
// supabase/functions/_shared/eligibility.ts (deliberately not a mirror of this file).

/** Dedup + sort so the result is stable for use inside React Query keys. */
export function unionSkillIds(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

/** Uniform-requirement test: the artist must hold every required skill. */
export function artistHasAllSkills(artistSkillIds: Set<string>, requiredSkillIds: string[]): boolean {
  return requiredSkillIds.every((id) => artistSkillIds.has(id));
}
```

Run again: PASS.

- [ ] **Step 3: Write the failing data tests** (`src/data/eligibility.test.ts`, style of `src/data/bookings.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  fetchRequiredSkillIds, fetchSkillEligibleArtistIds, fetchShowPriorityRows,
  setShowCastPriority, clearShowCastPriority,
  addShowRequiredSkill, removeShowRequiredSkill,
  addShowDateRequiredSkill, removeShowDateRequiredSkill,
} from "./eligibility";

describe("fetchRequiredSkillIds", () => {
  it("returns show and date lists plus their union", async () => {
    const fake = createFakeSupabase({
      show_required_skills: { data: [{ skill_id: "s1" }], error: null },
      show_date_required_skills: { data: [{ skill_id: "s1" }, { skill_id: "s2" }], error: null },
    });
    const res = await fetchRequiredSkillIds(fake as never, { showId: "sh1", showDateId: "d1" });
    expect(res).toEqual({ showSkillIds: ["s1"], dateSkillIds: ["s1", "s2"], all: ["s1", "s2"] });
  });
});

describe("fetchSkillEligibleArtistIds", () => {
  it("returns null when nothing is required (unrestricted)", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchSkillEligibleArtistIds(fake as never, { requiredSkillIds: [] })).toBeNull();
  });
  it("returns only artists holding ALL required skills", async () => {
    const fake = createFakeSupabase({
      artist_skills: { data: [
        { artist_id: "a1", skill_id: "s1" }, { artist_id: "a1", skill_id: "s2" },
        { artist_id: "a2", skill_id: "s1" },
      ], error: null },
    });
    const res = await fetchSkillEligibleArtistIds(fake as never, { requiredSkillIds: ["s1", "s2"] });
    expect([...res!]).toEqual(["a1"]);
  });
});

describe("show priority mutations", () => {
  it("updates the existing row when one exists for (show, city, cast)", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [{ id: "row1" }], error: null },
    });
    await setShowCastPriority(fake as never, { showId: "sh1", cityId: "c1", castId: "ca1", priority: 2, orgId: "o1" });
    expect(fake.calls.some((c) => c.table === "show_cast_eligibility" && c.method === "update")).toBe(true);
  });
  it("inserts a new prioritized row when none exists", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [], error: null },
    });
    await setShowCastPriority(fake as never, { showId: "sh1", cityId: "c1", castId: "ca1", priority: 1, orgId: "o1" });
    const ins = fake.calls.find((c) => c.table === "show_cast_eligibility" && c.method === "insert");
    expect(ins?.args[0]).toEqual({ show_id: "sh1", city_id: "c1", cast_id: "ca1", org_id: "o1", priority: 1 });
  });
  it("clearShowCastPriority nulls priority and keeps the row", async () => {
    const fake = createFakeSupabase({ show_cast_eligibility: { data: null, error: null } });
    await clearShowCastPriority(fake as never, "row1");
    const upd = fake.calls.find((c) => c.table === "show_cast_eligibility" && c.method === "update");
    expect(upd?.args[0]).toEqual({ priority: null });
  });
});

describe("required-skill mutations", () => {
  it("addShowRequiredSkill inserts the pair", async () => {
    const fake = createFakeSupabase({ show_required_skills: { data: null, error: null } });
    await addShowRequiredSkill(fake as never, { showId: "sh1", skillId: "s1", orgId: "o1" });
    const ins = fake.calls.find((c) => c.table === "show_required_skills" && c.method === "insert");
    expect(ins?.args[0]).toEqual({ show_id: "sh1", skill_id: "s1", org_id: "o1" });
  });
  it("removeShowDateRequiredSkill deletes by pair", async () => {
    const fake = createFakeSupabase({ show_date_required_skills: { data: null, error: null } });
    await removeShowDateRequiredSkill(fake as never, { showDateId: "d1", skillId: "s1" });
    expect(fake.calls.some((c) => c.table === "show_date_required_skills" && c.method === "delete")).toBe(true);
  });
});
```

Add the mirror-image cases for `removeShowRequiredSkill` and `addShowDateRequiredSkill` in the same style. Adjust assertion details only if `createFakeSupabase`'s recorded-call shape differs (read `src/test/supabaseFake.ts` first).

- [ ] **Step 4: Run to verify failure, implement `src/data/eligibility.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { unionSkillIds } from "@/lib/eligibility";

// The requirement tables and show_cast_eligibility.priority are not yet in the
// generated types; casts to any are confined to this module (boundary rule).

export interface RequiredSkillIds { showSkillIds: string[]; dateSkillIds: string[]; all: string[] }

/** Show-level and date-level required skills for a date, plus their union. */
export async function fetchRequiredSkillIds(
  client: SupabaseClient<Database>,
  args: { showId: string; showDateId: string },
): Promise<RequiredSkillIds> {
  const { data: showRows, error: e1 } = await (client as any)
    .from("show_required_skills").select("skill_id").eq("show_id", args.showId);
  if (e1) throw e1;
  const { data: dateRows, error: e2 } = await (client as any)
    .from("show_date_required_skills").select("skill_id").eq("show_date_id", args.showDateId);
  if (e2) throw e2;
  const showSkillIds = ((showRows ?? []) as { skill_id: string }[]).map((r) => r.skill_id);
  const dateSkillIds = ((dateRows ?? []) as { skill_id: string }[]).map((r) => r.skill_id);
  return { showSkillIds, dateSkillIds, all: unionSkillIds(showSkillIds, dateSkillIds) };
}

/** Artist ids holding ALL of requiredSkillIds; null when nothing is required (unrestricted).
 *  RLS scopes artist_skills to the caller's org. */
export async function fetchSkillEligibleArtistIds(
  client: SupabaseClient<Database>,
  args: { requiredSkillIds: string[] },
): Promise<Set<string> | null> {
  if (args.requiredSkillIds.length === 0) return null;
  const { data, error } = await (client as any)
    .from("artist_skills").select("artist_id, skill_id").in("skill_id", args.requiredSkillIds);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { artist_id: string; skill_id: string }[]) {
    counts.set(r.artist_id, (counts.get(r.artist_id) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [artistId, n] of counts) if (n === args.requiredSkillIds.length) out.add(artistId);
  return out;
}

export interface ShowPriorityRow { id: string; cityId: string; castId: string; priority: number }

/** A show's prioritized ladder rows (priority set), all cities. */
export async function fetchShowPriorityRows(
  client: SupabaseClient<Database>,
  showId: string,
): Promise<ShowPriorityRow[]> {
  const { data, error } = await (client as any)
    .from("show_cast_eligibility")
    .select("id, city_id, cast_id, priority")
    .eq("show_id", showId)
    .not("priority", "is", null)
    .order("priority", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { id: string; city_id: string; cast_id: string; priority: number }[])
    .map((r) => ({ id: r.id, cityId: r.city_id, castId: r.cast_id, priority: r.priority }));
}

/** Assign a tier: update the existing (show, city, cast) row, else insert one.
 *  A prioritized cast is by definition eligible, so inserting the row IS the gate row. */
export async function setShowCastPriority(
  client: SupabaseClient<Database>,
  args: { showId: string; cityId: string; castId: string; priority: number; orgId: string },
): Promise<void> {
  const { data: existing, error: selErr } = await (client as any)
    .from("show_cast_eligibility")
    .select("id")
    .eq("show_id", args.showId).eq("city_id", args.cityId).eq("cast_id", args.castId);
  if (selErr) throw selErr;
  const row = ((existing ?? []) as { id: string }[])[0];
  if (row) {
    const { error } = await (client as any)
      .from("show_cast_eligibility").update({ priority: args.priority }).eq("id", row.id);
    if (error) throw error;
  } else {
    const { error } = await (client as any).from("show_cast_eligibility").insert({
      show_id: args.showId, city_id: args.cityId, cast_id: args.castId,
      org_id: args.orgId, priority: args.priority,
    });
    if (error) throw error;
  }
}

/** Clear a tier but keep the eligibility row (the cast stays directly bookable). */
export async function clearShowCastPriority(client: SupabaseClient<Database>, rowId: string): Promise<void> {
  const { error } = await (client as any)
    .from("show_cast_eligibility").update({ priority: null }).eq("id", rowId);
  if (error) throw error;
}

export async function addShowRequiredSkill(
  client: SupabaseClient<Database>,
  args: { showId: string; skillId: string; orgId: string },
): Promise<void> {
  const { error } = await (client as any).from("show_required_skills")
    .insert({ show_id: args.showId, skill_id: args.skillId, org_id: args.orgId });
  if (error) throw error;
}

export async function removeShowRequiredSkill(
  client: SupabaseClient<Database>,
  args: { showId: string; skillId: string },
): Promise<void> {
  const { error } = await (client as any).from("show_required_skills")
    .delete().eq("show_id", args.showId).eq("skill_id", args.skillId);
  if (error) throw error;
}

export async function addShowDateRequiredSkill(
  client: SupabaseClient<Database>,
  args: { showDateId: string; skillId: string; orgId: string },
): Promise<void> {
  const { error } = await (client as any).from("show_date_required_skills")
    .insert({ show_date_id: args.showDateId, skill_id: args.skillId, org_id: args.orgId });
  if (error) throw error;
}

export async function removeShowDateRequiredSkill(
  client: SupabaseClient<Database>,
  args: { showDateId: string; skillId: string },
): Promise<void> {
  const { error } = await (client as any).from("show_date_required_skills")
    .delete().eq("show_date_id", args.showDateId).eq("skill_id", args.skillId);
  if (error) throw error;
}
```

- [ ] **Step 5: Run, typecheck, commit**

Run: `npx vitest run src/lib/eligibility.test.ts src/data/eligibility.test.ts` (PASS), `npx tsc -p tsconfig.app.json --noEmit` (clean).

```bash
git add src/lib/eligibility.ts src/lib/eligibility.test.ts src/data/eligibility.ts src/data/eligibility.test.ts
git commit -m "add frontend eligibility lib and data access"
```

---

### Task 7: Bookings lib/data updates (direct-book skills input, show-layer tiers, filtered opens)

**Files:**
- Modify: `src/lib/bookings.ts` (`deriveDirectBookList`, line ~208)
- Modify: `src/data/bookings.ts` (`fetchOfferTiers`, `openOfferTier`, `dryRunOfferTier`, `DryRunResult`)
- Modify: `src/components/shows/ShowDateDetailSheet.tsx` (call sites only, keep compiling)
- Test: `src/lib/bookings.test.ts`, `src/data/bookings.test.ts` (extend)

**Interfaces:**
- Produces (exact, relied on by Tasks 10-11):

```ts
export function deriveDirectBookList(
  orgArtists: { id: string; name: string }[] | undefined,
  eligibility: { artistIds: Set<string> | null } | undefined,
  blockedIds: Set<string> | undefined,
  skillEligibleIds: Set<string> | null | undefined,   // NEW: undefined = unresolved (fail closed), null = unrestricted
): { id: string; name: string }[]

export async function fetchOfferTiers(client, args: { showId: string; cityId: string | null; showDateId: string })
  : Promise<{ priorities: number[]; hasAdHoc: boolean; source: "show" | "org" }>

export async function openOfferTier(client, args: { showDateId: string; tier: number; skillFilterIds?: string[] }): Promise<OpenOfferTierResult>
export async function dryRunOfferTier(client, args: { showDateId: string; tier: number; skillFilterIds?: string[] }): Promise<DryRunResult>
export interface DryRunResult {
  candidates: { id: string; name: string }[];
  excluded: { alreadyBooked: number; blocked: number; inactive: number; notEligible: number; missingSkills: number };
  message?: string;
}
```

- [ ] **Step 1: Write the failing tests**

In `src/lib/bookings.test.ts` (extend the existing `deriveDirectBookList` describe):

```ts
it("fails closed while the skill-eligibility set is unresolved", () => {
  expect(deriveDirectBookList(
    [{ id: "a1", name: "A" }], { artistIds: null }, new Set(), undefined,
  )).toEqual([]);
});
it("null skill set means no skill restriction", () => {
  expect(deriveDirectBookList(
    [{ id: "a1", name: "A" }], { artistIds: null }, new Set(), null,
  )).toEqual([{ id: "a1", name: "A" }]);
});
it("filters to artists in the skill-eligible set", () => {
  expect(deriveDirectBookList(
    [{ id: "a1", name: "A" }, { id: "a2", name: "B" }],
    { artistIds: null }, new Set(), new Set(["a2"]),
  )).toEqual([{ id: "a2", name: "B" }]);
});
```

In `src/data/bookings.test.ts`:

```ts
it("prefers show-scoped priorities and reports source", async () => {
  const fake = createFakeSupabase({
    show_cast_eligibility: { data: [{ priority: 1 }, { priority: 2 }], error: null },
    show_date_cast_eligibility: { data: [], error: null },
  });
  const res = await fetchOfferTiers(fake as never, { showId: "sh1", cityId: "c1", showDateId: "d1" });
  expect(res).toEqual({ priorities: [1, 2], hasAdHoc: false, source: "show" });
});
it("falls back to the org city list with source org", async () => {
  const fake = createFakeSupabase({
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [{ priority: 1 }], error: null },
    show_date_cast_eligibility: { data: [], error: null },
  });
  const res = await fetchOfferTiers(fake as never, { showId: "sh1", cityId: "c1", showDateId: "d1" });
  expect(res).toEqual({ priorities: [1], hasAdHoc: false, source: "org" });
});
it("openOfferTier passes skill_filter_ids only when non-empty", async () => {
  const fake = createFakeSupabase({ "fn:open-offer-tier": { data: { offers_created: 1 }, error: null } });
  await openOfferTier(fake as never, { showDateId: "d1", tier: 1, skillFilterIds: ["s1"] });
  expect(fake.calls).toContainEqual({
    table: "fn:open-offer-tier", method: "invoke",
    args: [{ show_date_id: "d1", tier: 1, skill_filter_ids: ["s1"] }],
  });
});
it("dryRunOfferTier maps the two new exclusion counts", async () => {
  const fake = createFakeSupabase({ "fn:open-offer-tier": { data: {
    dry_run: true, candidates: [],
    excluded: { already_booked: 1, blocked: 0, inactive: 0, not_eligible: 2, missing_skills: 3 },
  }, error: null } });
  const res = await dryRunOfferTier(fake as never, { showDateId: "d1", tier: 1 });
  expect(res.excluded).toEqual({ alreadyBooked: 1, blocked: 0, inactive: 0, notEligible: 2, missingSkills: 3 });
});
```

Also UPDATE the existing `fetchOfferTiers` tests to pass `showId` and expect the added `source` key.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/bookings.test.ts src/data/bookings.test.ts`
Expected: new cases FAIL (arity/shape).

- [ ] **Step 3: Implement**

`src/lib/bookings.ts`: extend `deriveDirectBookList` (keep the existing doc comment, append one line: "The skill-eligibility set follows the same fail-closed contract: undefined = unresolved = nobody bookable; null = no skill requirements."):

```ts
export function deriveDirectBookList(
  orgArtists: { id: string; name: string }[] | undefined,
  eligibility: { artistIds: Set<string> | null } | undefined,
  blockedIds: Set<string> | undefined,
  skillEligibleIds: Set<string> | null | undefined,
): { id: string; name: string }[] {
  if (eligibility === undefined || blockedIds === undefined || skillEligibleIds === undefined) return [];
  const all = orgArtists ?? [];
  const base = eligibility.artistIds == null ? all : all.filter((a) => eligibility.artistIds!.has(a.id));
  const skilled = skillEligibleIds == null ? base : base.filter((a) => skillEligibleIds.has(a.id));
  return skilled.filter((a) => !blockedIds.has(a.id));
}
```

`src/data/bookings.ts` `fetchOfferTiers`: add `showId: string` to args; before the existing `cast_city_priority` read, query the show layer; return `source`:

```ts
export async function fetchOfferTiers(
  client: SupabaseClient<Database>,
  args: { showId: string; cityId: string | null; showDateId: string },
): Promise<{ priorities: number[]; hasAdHoc: boolean; source: "show" | "org" }> {
  let priorities: number[] = [];
  let source: "show" | "org" = "org";
  if (args.cityId) {
    // Show-scoped ladder wins outright for this (show, city); org list is the fallback.
    // priority is not yet in the generated types.
    const { data: showRows, error: showErr } = await (client as any)
      .from("show_cast_eligibility")
      .select("priority")
      .eq("show_id", args.showId)
      .eq("city_id", args.cityId)
      .not("priority", "is", null);
    if (showErr) throw showErr;
    const showPriorities = ((showRows ?? []) as { priority: number }[]).map((r) => r.priority);
    if (showPriorities.length > 0) {
      priorities = showPriorities;
      source = "show";
    } else {
      const { data, error } = await client
        .from("cast_city_priority")
        .select("priority")
        .eq("city_id", args.cityId);
      if (error) throw error;
      priorities = (data ?? []).map((r) => r.priority as number);
    }
  }
  const { data: adHoc, error: adErr } = await client
    .from("show_date_cast_eligibility")
    .select("id")
    .eq("show_date_id", args.showDateId)
    .limit(1);
  if (adErr) throw adErr;
  return { priorities, hasAdHoc: (adHoc ?? []).length > 0, source };
}
```

`openOfferTier` / `dryRunOfferTier`: add `skillFilterIds?: string[]` to args and build the body conditionally:

```ts
  const body: Record<string, unknown> = { show_date_id: args.showDateId, tier: args.tier };
  if (args.skillFilterIds && args.skillFilterIds.length > 0) body.skill_filter_ids = args.skillFilterIds;
```

(dry-run additionally sets `body.dry_run = true`). Extend `DryRunResult.excluded` with `notEligible` / `missingSkills` mapped from `not_eligible` / `missing_skills` (default 0).

`src/components/shows/ShowDateDetailSheet.tsx` call sites, minimal compile-keeping changes only (the real skill wiring lands with the chips and picker tasks):
- the `fetchOfferTiers` query passes `showId` (the sheet already has the date's `show_id`; follow the existing variable) and its consumers destructure `source` but may ignore it for now;
- `deriveDirectBookList(orgArtists, eligibility, blockedQ.data, null)` with comment `// skill filtering wired by the direct-book chips change`.

- [ ] **Step 4: Run the full frontend suite + typecheck**

Run: `npx vitest run` and `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS / clean. (Full suite, not just the two files: ShowDateDetailSheet tests exercise these paths.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookings.ts src/data/bookings.ts src/lib/bookings.test.ts src/data/bookings.test.ts src/components/shows/ShowDateDetailSheet.tsx
git commit -m "extend booking data layer for ladders and skill filters"
```

---

### Task 8: Artist calendar honors required skills

**Files:**
- Modify: `src/hooks/useArtistEligibleDates.ts`
- Test: `src/hooks/useArtistEligibleDates.test.ts` (extend)

**Interfaces:**
- Consumes: `artistHasAllSkills` from `@/lib/eligibility` (Task 6).
- Produces: same hook signature and `EligibleDate` type; dates whose required skills the artist does not fully hold are absent from the result (hard-requirement semantics).

- [ ] **Step 1: Write the failing test**

Read `src/hooks/useArtistEligibleDates.test.ts` first and extend it in its own style (it renders the hook with `renderWithProviders` against `createFakeSupabase` seeds). Add:

1. **Date filtered out by a show-level requirement:** seed `show_required_skills` with `{ show_id: "sh1", skill_id: "s-judge" }` and `artist_skills` (for the artist) WITHOUT `s-judge`. The previously-eligible date for sh1 disappears.
2. **Date kept when the artist holds the union:** artist holds `s-judge`; date remains.
3. **Date-level requirement adds:** show requires nothing; `show_date_required_skills` requires `s-judge` for date d2 only; artist without the skill sees d1 but not d2.
4. **No requirements anywhere: unchanged results** (regression).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/hooks/useArtistEligibleDates.test.ts`
Expected: new cases FAIL.

- [ ] **Step 3: Implement**

In the hook's `queryFn`, after the existing eligibility filter produced `eligible` (step 4 in the current file), append:

```ts
      // 5. Hard skill requirements: the artist only sees dates whose required
      // skills (show-level ∪ date-level) they fully hold (phase 4 spec).
      if (eligible.length === 0) return [];

      const { data: mySkills } = await supabase
        .from('artist_skills')
        .select('skill_id')
        .eq('artist_id', artist!.id);
      const mySkillIds = new Set((mySkills ?? []).map((r) => r.skill_id));

      const showIds = Array.from(new Set(eligible.map((d: any) => d.show_id)));
      const dateIds = eligible.map((d: any) => d.id);
      // Requirement tables are not yet in the generated types.
      const { data: showReq } = await (supabase as any)
        .from('show_required_skills')
        .select('show_id, skill_id')
        .in('show_id', showIds);
      const { data: dateReq } = await (supabase as any)
        .from('show_date_required_skills')
        .select('show_date_id, skill_id')
        .in('show_date_id', dateIds);

      const requiredByShow = new Map<string, string[]>();
      for (const r of (showReq ?? []) as { show_id: string; skill_id: string }[]) {
        requiredByShow.set(r.show_id, [...(requiredByShow.get(r.show_id) ?? []), r.skill_id]);
      }
      const requiredByDate = new Map<string, string[]>();
      for (const r of (dateReq ?? []) as { show_date_id: string; skill_id: string }[]) {
        requiredByDate.set(r.show_date_id, [...(requiredByDate.get(r.show_date_id) ?? []), r.skill_id]);
      }

      const qualified = eligible.filter((d: any) => {
        const required = [
          ...(requiredByShow.get(d.show_id) ?? []),
          ...(requiredByDate.get(d.id) ?? []),
        ];
        return artistHasAllSkills(mySkillIds, required);
      });

      return qualified as unknown as EligibleDate[];
```

Import `artistHasAllSkills` from `@/lib/eligibility` and delete the old `return eligible ...` line.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/hooks/useArtistEligibleDates.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useArtistEligibleDates.ts src/hooks/useArtistEligibleDates.test.ts
git commit -m "filter artist eligible dates by required skills"
```

---

### Task 9: SkillPicker + per-date RequiredSkillsSection

**Files:**
- Create: `src/components/skills/SkillPicker.tsx`
- Create: `src/components/skills/SkillPicker.test.tsx`
- Create: `src/components/shows/date/RequiredSkillsSection.tsx`
- Create: `src/components/shows/date/RequiredSkillsSection.test.tsx`
- Modify: `src/components/shows/ShowDateDetailSheet.tsx` (mount the section + queries/mutations)

**Interfaces:**
- Consumes: `useSkills` (`src/hooks/useSkills.ts`), `Skill` type from `src/data/skills.ts`; Task 6 data functions `fetchRequiredSkillIds`, `addShowDateRequiredSkill`, `removeShowDateRequiredSkill`.
- Produces (reused verbatim by Tasks 10-12):

```tsx
export function SkillPicker(props: {
  skills: { id: string; name: string }[];
  selectedIds: string[];
  onToggle: (skillId: string) => void;
  disabled?: boolean;
  emptyHint?: string;      // shown when skills list is empty
}): JSX.Element
```

- [ ] **Step 1: Write the failing SkillPicker test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SkillPicker } from "./SkillPicker";

const SKILLS = [{ id: "s1", name: "judge" }, { id: "s2", name: "juggling" }];

describe("SkillPicker", () => {
  it("renders one toggle per skill and marks selected ones", () => {
    render(<SkillPicker skills={SKILLS} selectedIds={["s1"]} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "judge" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "juggling" })).toHaveAttribute("aria-pressed", "false");
  });
  it("fires onToggle with the skill id", () => {
    const onToggle = vi.fn();
    render(<SkillPicker skills={SKILLS} selectedIds={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "judge" }));
    expect(onToggle).toHaveBeenCalledWith("s1");
  });
  it("shows the empty hint when there are no skills", () => {
    render(<SkillPicker skills={[]} selectedIds={[]} onToggle={() => {}} emptyHint="No skills yet." />);
    expect(screen.getByText("No skills yet.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement SkillPicker**

```tsx
import { cn } from "@/lib/utils";

/** Controlled multi-select of skills rendered as toggle chips. Used by the
 *  required-skills editors, the direct-book filter, and the tier-open picker. */
export function SkillPicker({ skills, selectedIds, onToggle, disabled = false, emptyHint }: {
  skills: { id: string; name: string }[];
  selectedIds: string[];
  onToggle: (skillId: string) => void;
  disabled?: boolean;
  emptyHint?: string;
}) {
  if (skills.length === 0) {
    return emptyHint ? <p className="text-xs text-muted-foreground">{emptyHint}</p> : null;
  }
  const selected = new Set(selectedIds);
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((s) => {
        const on = selected.has(s.id);
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(s.id)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              on
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
              disabled && "opacity-50 pointer-events-none",
            )}
          >
            {s.name}
          </button>
        );
      })}
    </div>
  );
}
```

Run: `npx vitest run src/components/skills/SkillPicker.test.tsx` (PASS).

- [ ] **Step 3: Write the failing RequiredSkillsSection test**

The section is presentational: inherited (show-level) skills as read-only chips labeled "From show", date-level ones as removable chips, plus a SkillPicker restricted to not-yet-required skills for adding.

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RequiredSkillsSection } from "./RequiredSkillsSection";

const SKILLS = [
  { id: "s1", name: "judge" }, { id: "s2", name: "juggling" }, { id: "s3", name: "singing" },
];

describe("RequiredSkillsSection", () => {
  it("shows inherited skills read-only with the From show label", () => {
    render(<RequiredSkillsSection skills={SKILLS} showSkillIds={["s1"]} dateSkillIds={[]}
      onAdd={() => {}} onRemove={() => {}} pending={false} />);
    expect(screen.getByText("judge")).toBeInTheDocument();
    expect(screen.getByText("From show")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove judge/i })).not.toBeInTheDocument();
  });
  it("date-level skills are removable", () => {
    const onRemove = vi.fn();
    render(<RequiredSkillsSection skills={SKILLS} showSkillIds={[]} dateSkillIds={["s2"]}
      onAdd={() => {}} onRemove={onRemove} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /remove juggling/i }));
    expect(onRemove).toHaveBeenCalledWith("s2");
  });
  it("the add picker offers only skills not already required", () => {
    const onAdd = vi.fn();
    render(<RequiredSkillsSection skills={SKILLS} showSkillIds={["s1"]} dateSkillIds={["s2"]}
      onAdd={onAdd} onRemove={() => {}} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: "singing" }));
    expect(onAdd).toHaveBeenCalledWith("s3");
    expect(screen.queryByRole("button", { name: "judge" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Implement RequiredSkillsSection**

```tsx
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SkillPicker } from "@/components/skills/SkillPicker";

/** Per-date required skills: inherited show-level chips (read-only, labeled
 *  "From show") plus removable date-level additions and an add picker.
 *  Union semantics: a date adds requirements, it never removes show-level ones. */
export function RequiredSkillsSection({ skills, showSkillIds, dateSkillIds, onAdd, onRemove, pending }: {
  skills: { id: string; name: string }[];
  showSkillIds: string[];
  dateSkillIds: string[];
  onAdd: (skillId: string) => void;
  onRemove: (skillId: string) => void;
  pending: boolean;
}) {
  const byId = new Map(skills.map((s) => [s.id, s.name]));
  const required = new Set([...showSkillIds, ...dateSkillIds]);
  const addable = skills.filter((s) => !required.has(s.id));
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Required skills</p>
      <p className="text-xs text-muted-foreground">
        Artists must have all of these skills to receive offers or be booked.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {showSkillIds.map((id) => (
          <Badge key={id} variant="secondary" className="gap-1">
            {byId.get(id) ?? id}
            <span className="text-[10px] uppercase text-muted-foreground">From show</span>
          </Badge>
        ))}
        {dateSkillIds.filter((id) => !showSkillIds.includes(id)).map((id) => (
          <Badge key={id} variant="outline" className="gap-1">
            {byId.get(id) ?? id}
            <button
              type="button"
              aria-label={`Remove ${byId.get(id) ?? id}`}
              disabled={pending}
              onClick={() => onRemove(id)}
              className="ml-0.5 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {showSkillIds.length === 0 && dateSkillIds.length === 0 && (
          <p className="text-xs text-muted-foreground">No skills required.</p>
        )}
      </div>
      <SkillPicker
        skills={addable}
        selectedIds={[]}
        onToggle={onAdd}
        disabled={pending}
        emptyHint={skills.length === 0 ? "No skills yet. Add skills on artist profiles first." : undefined}
      />
    </div>
  );
}
```

Run: `npx vitest run src/components/shows/date/RequiredSkillsSection.test.tsx` (PASS).

- [ ] **Step 5: Mount in ShowDateDetailSheet**

In `src/components/shows/ShowDateDetailSheet.tsx`:

a) Imports: `RequiredSkillsSection`, `useSkills` (already exported from `src/hooks/useSkills.ts`), and from `@/data/eligibility`: `fetchRequiredSkillIds, addShowDateRequiredSkill, removeShowDateRequiredSkill`.

b) Queries/mutations next to the existing eligibility queries (the sheet already has `showDateId`, the date row with `show_id`, `currentOrg` via `useAuth`, and `qc`):

```tsx
  const { data: orgSkills } = useSkills();
  const requiredSkillsQ = useQuery({
    queryKey: ['eligibility', 'required-skills', showDate?.show_id, showDateId],
    enabled: !!showDate?.show_id && !!showDateId,
    queryFn: () => fetchRequiredSkillIds(supabase, { showId: showDate!.show_id, showDateId: showDateId! }),
  });
  const invalidateEligibility = () => {
    qc.invalidateQueries({ queryKey: ['eligibility'] });
    qc.invalidateQueries({ queryKey: ['eligible-artists'] });
    qc.invalidateQueries({ queryKey: ['artist-eligible-dates'] });
    qc.invalidateQueries({ queryKey: ['offer-tiers'] });
  };
  const addDateSkill = useMutation({
    mutationFn: (skillId: string) =>
      addShowDateRequiredSkill(supabase, { showDateId: showDateId!, skillId, orgId: currentOrg!.id }),
    onSuccess: () => { invalidateEligibility(); toast.success('Required skill added'); },
    onError: (e: Error) => toast.error('Failed to add required skill', { description: e.message }),
  });
  const removeDateSkill = useMutation({
    mutationFn: (skillId: string) =>
      removeShowDateRequiredSkill(supabase, { showDateId: showDateId!, skillId }),
    onSuccess: () => { invalidateEligibility(); toast.success('Required skill removed'); },
    onError: (e: Error) => toast.error('Failed to remove required skill', { description: e.message }),
  });
```

c) Render the section inside the same Card as the eligibility/cast controls (directly above the offer/direct booking area), visible in both offer and direct modes:

```tsx
  <RequiredSkillsSection
    skills={orgSkills ?? []}
    showSkillIds={requiredSkillsQ.data?.showSkillIds ?? []}
    dateSkillIds={requiredSkillsQ.data?.dateSkillIds ?? []}
    onAdd={(id) => addDateSkill.mutate(id)}
    onRemove={(id) => removeDateSkill.mutate(id)}
    pending={addDateSkill.isPending || removeDateSkill.isPending}
  />
```

Pick the exact JSX slot by reading the sheet's layout; it must appear once, in both flow modes, above the offer tier / direct book card content.

- [ ] **Step 6: Run the sheet's tests + full suite, commit**

Run: `npx vitest run` and `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS / clean.

```bash
git add src/components/skills/ src/components/shows/date/RequiredSkillsSection.tsx src/components/shows/date/RequiredSkillsSection.test.tsx src/components/shows/ShowDateDetailSheet.tsx
git commit -m "add per-date required skills editor"
```

---

### Task 10: Direct-book skill filter chips

**Files:**
- Modify: `src/components/shows/date/EligibilityBookList.tsx`
- Modify: `src/components/shows/date/EligibilityBookList.test.tsx` (extend)
- Modify: `src/components/shows/ShowDateDetailSheet.tsx` (skill-eligibility query + real 4th arg)

**Interfaces:**
- Consumes: `SkillPicker` (Task 9), `fetchSkillEligibleArtistIds` + `unionSkillIds` (Task 6), `deriveDirectBookList` 4-arg form (Task 7), `requiredSkillsQ` from Task 9's wiring.
- Produces: `EligibilityBookList` gains optional props `skills`, `selectedSkillIds`, `onSkillFilterChange`.

- [ ] **Step 1: Write the failing tests**

Extend `EligibilityBookList.test.tsx`:

1. Renders the chips row (SkillPicker buttons) when `skills` is non-empty and fires `onSkillFilterChange` with the toggled id.
2. Renders no chips when `skills` is empty or the props are omitted (backward compatible).

- [ ] **Step 2: Implement the chips**

Add to `EligibilityBookList`'s props:

```tsx
  skills?: { id: string; name: string }[];
  selectedSkillIds?: string[];
  onSkillFilterChange?: (skillId: string) => void;
```

Render above the artist rows (after the understudy checkbox label):

```tsx
      {skills && skills.length > 0 && onSkillFilterChange && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Only offer to artists with</p>
          <SkillPicker
            skills={skills}
            selectedIds={selectedSkillIds ?? []}
            onToggle={onSkillFilterChange}
          />
        </div>
      )}
```

(The label copy on the direct list reads "Only offer to artists with" for consistency with the tier picker; both filter who can be picked.)

- [ ] **Step 3: Wire the sheet**

In `ShowDateDetailSheet.tsx`:

```tsx
  const [directSkillFilterIds, setDirectSkillFilterIds] = useState<string[]>([]);
  // Hard requirements ∪ the producer's ad-hoc chips drive one skill-eligibility set.
  const directRequiredSkillIds = useMemo(
    () => unionSkillIds(requiredSkillsQ.data?.all ?? [], directSkillFilterIds),
    [requiredSkillsQ.data?.all, directSkillFilterIds],
  );
  const skillEligibleQ = useQuery({
    queryKey: ['eligibility', 'skill-eligible', showDateId, directRequiredSkillIds],
    enabled: !!showDateId && requiredSkillsQ.data !== undefined,
    queryFn: () => fetchSkillEligibleArtistIds(supabase, { requiredSkillIds: directRequiredSkillIds }),
  });
```

Replace the Task 7 stopgap: `deriveDirectBookList(orgArtists, eligibility, blockedQ.data, skillEligibleQ.data)`. IMPORTANT loading semantics: while `requiredSkillsQ` or `skillEligibleQ` is unresolved, `skillEligibleQ.data` is `undefined`, so the list fails closed; extend `directListLoading` with `|| skillEligibleQ.data === undefined` (mirroring the existing terms) and `directListError` with `|| requiredSkillsQ.isError || skillEligibleQ.isError`. Note: `fetchSkillEligibleArtistIds` resolves to `null` (not undefined) when nothing is required, so the unrestricted case does not hang in loading.

Pass to the component: `skills={orgSkills ?? []} selectedSkillIds={directSkillFilterIds} onSkillFilterChange={(id) => setDirectSkillFilterIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}`.

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run` and `npx tsc -p tsconfig.app.json --noEmit` (PASS/clean).

```bash
git add src/components/shows/date/EligibilityBookList.tsx src/components/shows/date/EligibilityBookList.test.tsx src/components/shows/ShowDateDetailSheet.tsx
git commit -m "add skill filter chips to the direct-book list"
```

---

### Task 11: Tier-open skill picker, ladder hint, dry-run counts

**Files:**
- Modify: `src/components/shows/date/TierTimeline.tsx`
- Modify: `src/components/shows/date/TierTimeline.test.tsx` (extend)
- Modify: `src/components/shows/date/DryRunDialog.tsx`
- Modify: `src/components/shows/date/DryRunDialog.test.tsx` (extend)
- Modify: `src/components/shows/ShowDateDetailSheet.tsx` (pass skills + source; thread skillFilterIds)

**Interfaces:**
- Consumes: `SkillPicker` (Task 9), `openOfferTier`/`dryRunOfferTier` with `skillFilterIds` and the 5-key `DryRunResult.excluded` (Task 7), `fetchOfferTiers`'s `source` (Task 7).
- Produces: `TierTimeline` props gain `skills: { id: string; name: string }[]`, `ladderSource: "show" | "org"`, and its `onOpenTier` / dry-run callbacks gain a `skillFilterIds: string[]` argument.

- [ ] **Step 1: Write the failing tests**

`TierTimeline.test.tsx` additions (follow the file's existing render helpers):

1. With `ladderSource="show"`, the hint "Using show-specific priorities" renders; with `"org"` it does not.
2. Selecting a tier, toggling a skill chip, then confirming the open calls `onOpenTier(tier, ["s1"])`.
3. With no chips toggled, `onOpenTier(tier, [])`.

`DryRunDialog.test.tsx` additions:

4. A result with `excluded: { alreadyBooked: 0, blocked: 0, inactive: 0, notEligible: 2, missingSkills: 1 }` renders "Not eligible for this show" with 2 and "Missing required skills" with 1, following the dialog's existing exclusion-row markup.

- [ ] **Step 2: Implement TierTimeline**

- Add props `skills`, `ladderSource`; change `onOpenTier: (tier: number, skillFilterIds: string[]) => void` and the dry-run trigger equivalently (read the file: the dry-run button lifts state to the sheet via a callback or setter prop; extend that path to carry the current `skillFilterIds`).
- Internal state: `const [skillFilterIds, setSkillFilterIds] = useState<string[]>([]);`
- Render under the tier Select, above the Open button:

```tsx
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Only offer to artists with</p>
          <SkillPicker
            skills={skills}
            selectedIds={skillFilterIds}
            onToggle={(id) => setSkillFilterIds((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
          />
        </div>
```

- Render the hint next to the section heading when the show ladder applies:

```tsx
        {ladderSource === "show" && (
          <p className="text-xs text-muted-foreground">Using show-specific priorities</p>
        )}
```

- Update the existing `onOpenTier(effectiveTier)` call to `onOpenTier(effectiveTier, skillFilterIds)`.

- [ ] **Step 3: Implement DryRunDialog + sheet threading**

`DryRunDialog.tsx`: add the two exclusion rows using the dialog's existing row markup, labels exactly "Not eligible for this show" and "Missing required skills", values `result.excluded.notEligible` / `result.excluded.missingSkills`.

`ShowDateDetailSheet.tsx`:
- `dryRun` state gains the filter: `useState<{ tier: number; skillFilterIds: string[] } | null>(null)`; the dry-run query key includes `dryRun?.skillFilterIds` and the queryFn passes `skillFilterIds: dryRun!.skillFilterIds`.
- `openOffers` mutation signature becomes `({ tier, skillFilterIds }: { tier: number; skillFilterIds: string[] })`, forwarding to `openOfferTier(supabase, { showDateId, tier, skillFilterIds })`; update the DryRunDialog `onConfirm` accordingly.
- Pass `skills={orgSkills ?? []}` and `ladderSource={offerTiersQ.data?.source ?? "org"}` to `TierTimeline` (use the actual offer-tiers query variable name in the file).

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run` and `npx tsc -p tsconfig.app.json --noEmit` (PASS/clean).

```bash
git add src/components/shows/date/TierTimeline.tsx src/components/shows/date/TierTimeline.test.tsx src/components/shows/date/DryRunDialog.tsx src/components/shows/date/DryRunDialog.test.tsx src/components/shows/ShowDateDetailSheet.tsx
git commit -m "add skill-scoped tier opens and ladder hint"
```

---

### Task 12: Show-level required skills in ShowFormDialog

**Files:**
- Modify: `src/data/eligibility.ts` + `src/data/eligibility.test.ts` (one added fetch)
- Modify: `src/components/catalog/ShowFormDialog.tsx`
- Test: extend the dialog's existing test file (check for `src/components/catalog/ShowFormDialog.test.tsx`; if absent, create it with renderWithProviders + createFakeSupabase following `src/components/settings/` test conventions)

**Interfaces:**
- Consumes: `SkillPicker` (Task 9), `useSkills`, `addShowRequiredSkill`/`removeShowRequiredSkill` (Task 6), `createShow` returning `{ id: string }` (`src/data/shows.ts:64`).
- Produces: `fetchShowRequiredSkillIds(client, showId): Promise<string[]>` in `src/data/eligibility.ts`.

- [ ] **Step 1: Add the data fetch (test first)**

Test in `src/data/eligibility.test.ts`:

```ts
it("fetchShowRequiredSkillIds returns the show's skill ids", async () => {
  const fake = createFakeSupabase({ show_required_skills: { data: [{ skill_id: "s1" }], error: null } });
  expect(await fetchShowRequiredSkillIds(fake as never, "sh1")).toEqual(["s1"]);
});
```

Implementation in `src/data/eligibility.ts`:

```ts
/** Show-level required skill ids (no date component). */
export async function fetchShowRequiredSkillIds(
  client: SupabaseClient<Database>,
  showId: string,
): Promise<string[]> {
  const { data, error } = await (client as any)
    .from("show_required_skills").select("skill_id").eq("show_id", showId);
  if (error) throw error;
  return ((data ?? []) as { skill_id: string }[]).map((r) => r.skill_id);
}
```

- [ ] **Step 2: Write the failing dialog test**

Cases:
1. Editing a show with required skill s1 renders the "Required skills" section with the s1 chip pressed.
2. Toggling s2 on and saving calls `addShowRequiredSkill` semantics (an insert on `show_required_skills` with `{ show_id, skill_id: "s2", org_id }` appears in `fake.calls`).
3. Toggling s1 off and saving deletes it.

- [ ] **Step 3: Implement**

In `ShowFormDialog.tsx` (react-hook-form based; skills are dialog state OUTSIDE the RHF schema):

```tsx
  const { data: orgSkills } = useSkills();
  const [requiredSkillIds, setRequiredSkillIds] = useState<string[]>([]);
  const initialSkillIdsRef = useRef<string[]>([]);
  // Load current requirements when editing (dialog opens with a show).
  const showReqQ = useQuery({
    queryKey: ['eligibility', 'show-required-skills', show?.id],
    enabled: open && !!show?.id,
    queryFn: () => fetchShowRequiredSkillIds(supabase, show!.id),
  });
  useEffect(() => {
    const ids = showReqQ.data ?? [];
    setRequiredSkillIds(ids);
    initialSkillIdsRef.current = ids;
  }, [showReqQ.data]);
```

Render inside the form, after the existing slot/description fields:

```tsx
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Required skills</p>
          <p className="text-xs text-muted-foreground">
            Artists must have all of these skills to receive offers or be booked.
          </p>
          <SkillPicker
            skills={orgSkills ?? []}
            selectedIds={requiredSkillIds}
            onToggle={(id) => setRequiredSkillIds((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
            emptyHint="No skills yet. Add skills on artist profiles first."
          />
        </div>
```

In `onSubmit`, after the create/update mutateAsync succeeds (createShow returns `{ id }`; use it for the create path), diff and apply:

```tsx
      const targetShowId = isEdit ? show!.id : created.id;
      const before = new Set(initialSkillIdsRef.current);
      const after = new Set(requiredSkillIds);
      for (const id of requiredSkillIds) {
        if (!before.has(id)) await addShowRequiredSkill(supabase, { showId: targetShowId, skillId: id, orgId: currentOrg!.id });
      }
      for (const id of initialSkillIdsRef.current) {
        if (!after.has(id)) await removeShowRequiredSkill(supabase, { showId: targetShowId, skillId: id });
      }
```

then run the Task 9 invalidation set (`['eligibility']`, `['eligible-artists']`, `['artist-eligible-dates']`, `['offer-tiers']`) alongside the dialog's existing invalidations. Adapt local variable names (`show`, `open`, `isEdit`, `created`) to the file's actual ones after reading it.

- [ ] **Step 4: Run, typecheck, commit**

Run: `npx vitest run` and `npx tsc -p tsconfig.app.json --noEmit` (PASS/clean).

```bash
git add src/data/eligibility.ts src/data/eligibility.test.ts src/components/catalog/
git commit -m "add show-level required skills editor"
```

---

### Task 13: Scoped priority editor in Settings

**Files:**
- Modify: `src/components/settings/CastsCitiesTab.tsx`
- Test: extend the tab's existing test file if present, else create `src/components/settings/CastsCitiesTab.priorities.test.tsx`

**Interfaces:**
- Consumes: `fetchShowPriorityRows`, `setShowCastPriority`, `clearShowCastPriority` (Task 6); `useShows` (`src/hooks/`) for the show picker.
- Produces: UI only.

- [ ] **Step 1: Write the failing test**

Render the tab (renderWithProviders + createFakeSupabase seeds for `cities`, `casts`, `cast_city_priority`, `shows`, `show_cast_eligibility`). Cases:

1. Default scope shows the existing org-wide editor (regression: the org priority list renders).
2. Choosing a show in the scope select renders the helper copy "Overrides the organization default for this show only. Cities without show priorities keep the organization default." and that show's ladder rows (from `show_cast_eligibility` seed with priorities).
3. Assigning City + Cast + Tier in show scope records an insert on `show_cast_eligibility` carrying `priority` (via `fake.calls`).
4. The "Clear tier" button records an update setting `priority: null`.

- [ ] **Step 2: Implement**

In the "Cast Priority by City" Card of `CastsCitiesTab.tsx`:

a) Scope state + queries:

```tsx
  const [priorityScope, setPriorityScope] = useState<string>('org'); // 'org' or a show id
  const { data: allShows } = useQuery({
    queryKey: ['shows', 'for-priority-scope'],
    queryFn: async () => {
      const { data, error } = await supabase.from('shows').select('id, program, sub_program').order('program');
      if (error) throw error;
      return data ?? [];
    },
  });
  const showPrioritiesQ = useQuery({
    queryKey: ['eligibility', 'show-priorities', priorityScope],
    enabled: priorityScope !== 'org',
    queryFn: () => fetchShowPriorityRows(supabase, priorityScope),
  });
```

b) Scope select at the top of the Card content:

```tsx
        <Select value={priorityScope} onValueChange={setPriorityScope}>
          <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="org">Organization default</SelectItem>
            {(allShows ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {[s.program, s.sub_program].filter(Boolean).join(' / ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {priorityScope !== 'org' && (
          <p className="text-xs text-muted-foreground">
            Overrides the organization default for this show only. Cities without show priorities keep the organization default.
          </p>
        )}
```

c) When `priorityScope === 'org'`: render the existing org editor UNCHANGED. When a show is selected: render the show ladder grouped by city (reuse the org list's row markup; resolve city/cast names from the already-loaded `cities`/`casts` queries) with a "Clear tier" ghost button per row calling `clearShowPriority.mutate(row.id)`, and the same three-select add form whose Assign button calls `assignShowPriority.mutate()`. Cast options in show scope exclude casts already prioritized for the selected (show, city). Mutations:

```tsx
  const assignShowPriority = useMutation({
    mutationFn: () => setShowCastPriority(supabase, {
      showId: priorityScope, cityId: newPriorityCityId, castId: newPriorityCastId,
      priority: newPriorityValue, orgId: currentOrg!.id,
    }),
    onSuccess: () => { invalidatePriorityConsumers(); toast.success('Priority assigned'); },
    onError: (e: Error) => toast.error('Failed to assign priority', { description: e.message }),
  });
  const clearShowPriority = useMutation({
    mutationFn: (rowId: string) => clearShowCastPriority(supabase, rowId),
    onSuccess: () => { invalidatePriorityConsumers(); toast.success('Priority cleared'); },
    onError: (e: Error) => toast.error('Failed to clear priority', { description: e.message }),
  });
```

with

```tsx
  const invalidatePriorityConsumers = () => {
    qc.invalidateQueries({ queryKey: ['eligibility'] });
    qc.invalidateQueries({ queryKey: ['eligible-artists'] });
    qc.invalidateQueries({ queryKey: ['artist-eligible-dates'] });
    qc.invalidateQueries({ queryKey: ['offer-tiers'] });
  };
```

Reuse the existing `newPriorityCityId` / `newPriorityCastId` / `newPriorityValue` states and the 1-5 tier dropdown; reset the cast selection when the scope changes. A unique-violation from the partial index (`23505`) surfaces through the mutation's onError toast; no special-casing.

- [ ] **Step 3: Run, typecheck, commit**

Run: `npx vitest run` and `npx tsc -p tsconfig.app.json --noEmit` (PASS/clean).

```bash
git add src/components/settings/CastsCitiesTab.tsx src/components/settings/CastsCitiesTab*.test.tsx
git commit -m "add show-scoped cast priority editor to settings"
```

---

### Task 14: Documentation (app-logic, system map, in-app canvas)

**Files:**
- Modify: `docs/app-logic.md` (Eligibility section ~line 112; escalation description ~lines 179-182; offer flow steps ~line 142)
- Modify: `docs/system-map.md`
- Modify: `src/data/systemMap.ts`

**Interfaces:**
- Consumes: final behavior from Tasks 1-5.
- Produces: docs only. `docs/system-map.md` and `src/data/systemMap.ts` MUST change in the same commit (standing same-PR rule); a drift test exists for the pair, `npx vitest run` covers it.

- [ ] **Step 1: Rewrite `docs/app-logic.md` eligibility + escalation**

In the `## Eligibility` section, after the existing resolution-order list, add (adjusting heading levels to the file):

```markdown
### Cast priorities and the effective ladder

Offer tiers come from an "effective ladder" resolved per (show, city):

1. If the show has `show_cast_eligibility` rows with a `priority` for the date's city,
   those rows ARE the ladder: tier N = the cast with priority N. The org-wide list is
   ignored for that pair.
2. Otherwise the ladder is the org-wide `cast_city_priority` list for the city.

A `show_cast_eligibility` row without a priority keeps its plain meaning: eligible,
untiered: the cast stays reachable via direct booking. Ad-hoc tier 99 offers come
from the separate per-date cast list (`show_date_cast_eligibility`), not from these
rows; tier 99 offers the date's ad-hoc casts minus any cast already in the
effective ladder.

Priorities are edited in Settings > Casts & Cities (scope selector: organization
default, or a specific show).

### Required skills

A show can require skills (`show_required_skills`), and a date can add more
(`show_date_required_skills`); the requirement is the union. Requirements are
uniform: an artist qualifies only when holding ALL of them. They are enforced in
the offer engine, the direct-book list, and the artist availability calendar
(an artist missing a required skill does not see the date). Producers can also
scope a single tier open to extra skills ("Only offer to artists with"); that
filter is per-invocation and never applied by automation.

### Offer candidate pipeline

open-offer-tier filters, in order: effective-ladder casts for the tier ->
active artists -> not already booked -> not blocked -> passes the show
eligibility gate (union of show-level and date-level cast rows; none = 
unrestricted) -> holds all required skills. The dry-run preview reports each
exclusion count.
```

Fix the escalation paragraph (~lines 179-182): it predates auto-escalation. Replace it with:

```markdown
When a tier's window closes short of `main_cast_slots`, `expire-offers` (hourly)
either auto-escalates (booking_flow.auto_escalate: closes the tier and opens the
next tier of the SAME effective ladder that opened it) or, when auto-escalate is
off or the ladder is exhausted, notifies producers to act (`cast_escalation_requested`).
Understudy promotion prefers the accepted understudy whose skills best cover the
cancelled artist's skills, oldest first on ties; skills never block a promotion.
```

- [ ] **Step 2: Update `docs/system-map.md` and `src/data/systemMap.ts` together**

Read both files first; they mirror each other and a drift test pins them. Update, keeping each mirror's phrasing conventions:

- `open-offer-tier` entry: data reads now include `show_cast_eligibility (priority ladder + gate)`, `show_required_skills`, `show_date_required_skills`, `artist_skills`; note the optional per-request `skill_filter_ids`.
- `expire-offers` entry: escalation resolves the next tier via the effective ladder (show override, else org city list).
- `promote_understudy_on_cancellation` trigger row: ordering is skill coverage of the cancelled artist's skills desc, then oldest first.

- [ ] **Step 3: Run the drift test + full unit suite**

Run: `npx vitest run`
Expected: PASS (the systemMap drift test in particular).

- [ ] **Step 4: Commit**

```bash
git add docs/app-logic.md docs/system-map.md src/data/systemMap.ts
git commit -m "document configurable eligibility and skill-aware promotion"
```

---

### Task 15: e2e scenario + final sweep

**Files:**
- Modify: `e2e/helpers/booking.ts` (two seed helpers)
- Create: `e2e/configurable-eligibility.spec.ts`

**Interfaces:**
- Consumes: the existing e2e harness: `seedBookingFixture`, `cleanupBookingFixture`, `openOfferTier(showDateId, tier)`, `setBookingFlow`, `getLatestBooking` in `e2e/helpers/booking.ts`, and the login/navigation patterns of `e2e/booking-flow-presets.spec.ts` (read both files first; mirror their `test.describe.configure({ mode: "serial" })` / beforeAll seeding / cleanup style exactly).
- Produces: helpers `setShowLadderPriority` and `addShowRequiredSkillE2E`.

- [ ] **Step 1: Add the seed helpers**

In `e2e/helpers/booking.ts`, using the module's existing admin (service-role) client variable (reuse whatever `seedBookingFixture` uses):

```ts
/** Give a cast a show-scoped priority for (show, city): the show ladder overrides
 *  the org-wide city list for that pair. Creates the eligibility row if missing. */
export async function setShowLadderPriority(args: {
  showId: string; cityId: string; castId: string; orgId: string; priority: number;
}): Promise<void> {
  const { data: existing } = await admin
    .from("show_cast_eligibility").select("id")
    .eq("show_id", args.showId).eq("city_id", args.cityId).eq("cast_id", args.castId);
  if (existing && existing.length > 0) {
    const { error } = await admin.from("show_cast_eligibility")
      .update({ priority: args.priority }).eq("id", existing[0].id);
    if (error) throw error;
  } else {
    const { error } = await admin.from("show_cast_eligibility").insert({
      show_id: args.showId, city_id: args.cityId, cast_id: args.castId,
      org_id: args.orgId, priority: args.priority,
    });
    if (error) throw error;
  }
}

/** Require a skill on a show, creating the skill in the org if needed. Returns the skill id. */
export async function addShowRequiredSkillE2E(args: {
  showId: string; orgId: string; skillName: string;
}): Promise<string> {
  const { data: skill, error: skillErr } = await admin
    .from("skills").insert({ org_id: args.orgId, name: args.skillName }).select("id").single();
  if (skillErr) throw skillErr;
  const { error } = await admin.from("show_required_skills")
    .insert({ show_id: args.showId, skill_id: skill.id, org_id: args.orgId });
  if (error) throw error;
  return skill.id;
}
```

(If the module's admin client is typed against the generated `Database`, add `as any` casts on the two new-table calls, same boundary rule as the frontend.)

- [ ] **Step 2: Write the spec**

`e2e/configurable-eligibility.spec.ts`, two serial tests, seeding once in `beforeAll` like the presets spec:

1. **Show ladder overrides the org list (API-level).** Fixture: org ladder tier 1 = fixture cast (fixture artist). Create a second cast + second artist (mirror how `seedBookingFixture` creates the first ones, or extend the fixture options if it supports it), put ONLY the second cast on the show ladder at priority 1 via `setShowLadderPriority`, then `openOfferTier(showDateId, 1)`. Assert via `getLatestBooking` (or a direct admin query on `bookings`) that the second artist got the suggested booking and the fixture artist did NOT.
2. **Required skill excludes from the direct-book list (UI-level).** `setBookingFlow` to the direct preset, `addShowRequiredSkillE2E` with a skill the fixture artist does not hold. Log in as the producer, open the date sheet (mirror the presets spec's "direct" test navigation), and assert the fixture artist's Book row is absent and the empty-state line "No eligible artists for this date. Check casts and city in Settings." renders.

- [ ] **Step 3: Verify collection + full local suites**

Run: `npx playwright test --config=e2e/playwright.config.ts --list` (the new spec's 2 tests are collected; browsers run in CI only).
Run: `npx vitest run` and `deno test --allow-all --node-modules-dir=none supabase/functions/` and `npm run lint` and `npx tsc -p tsconfig.app.json --noEmit`
Expected: all PASS/clean.

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/booking.ts e2e/configurable-eligibility.spec.ts
git commit -m "add configurable eligibility e2e coverage"
```

---

## After the last task (controller, not a subagent)

1. Final whole-branch review (superpowers:requesting-code-review), PR against main, CI + review-bot rounds, merge on green (never `--auto`).
2. Prod migration apply: ONLY with explicit user approval naming project `epweartpzwvcasrzyueh`, via Supabase MCP `apply_migration` (both migrations, in order), then align recorded versions to the filenames (`UPDATE supabase_migrations.schema_migrations SET version = '<filename-ts>' WHERE name = '<name>'`) and verify the trigger/tables live.
3. Changelog: USER DECISION (2026-07-15): fold Phase 4 into the existing 1.9.0 entry per the same-day-releases convention. No version bump, no new tag (v1.9.0 stays where it is); extend the 1.9.0 block's bullets and regenerate JSON via `deno run --allow-read --allow-write scripts/changelog-to-json.ts`.
4. Update the handoff doc `docs/superpowers/plans/2026-07-14-booking-flow-followups.md` (Phase 4 shipped) and persistent memory.
