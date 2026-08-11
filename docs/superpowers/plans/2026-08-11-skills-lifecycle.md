# Skills Lifecycle (design 1f, 1i, 1j) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the Global Constraints in `2026-08-11-skills-ux-index.md` first — they apply to every task here.

**Goal:** Give skills a governed catalog (create/rename/archive/restore/delete-when-unused with usage counts) in Settings, and update the two skill consumers — the artist profile editor and the roster card — to read from it.

**Architecture:** Additive. Add a nullable `skills.archived_at` column (soft-archive). Existing RLS already permits admin/producer `UPDATE` (rename/archive) and admin `DELETE`. All skill pickers switch to an archived-excluding read; a new catalog read includes archived rows plus usage counts. No changes to the eligibility model, casts, or the booking engine.

**Tech Stack:** React 18 + TS, Tailwind + shadcn, react-query v5, Supabase (Postgres + RLS), vitest + supabaseFake, pgTAP.

## Global Constraints

See `2026-08-11-skills-ux-index.md` → "Global Constraints". Most load-bearing here: no em/en dashes in copy; semantic tokens only; `any` banned; data-access `fetch/mutate(client, args)` + supabaseFake tests; regenerate `types.ts`, never hand-edit; bust the `['skills']` query domain on every skills mutation.

**Design source:** `section-1f.html`, `section-1i.html`, `section-1j.html` in the session scratchpad (exact inline-styled markup). Translate inline styles to the app's shadcn primitives + semantic tokens; match structure, copy, and the violet/hairline treatments.

---

### Task 1: Migration — `skills.archived_at`

**Files:**
- Create: `supabase/migrations/20260811120000_skills_archived_at.sql`
- Create (test): `supabase/tests/skills_archive.test.sql`
- Regenerate: `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts`

**Interfaces:**
- Produces: `skills.archived_at timestamptz null` (NULL = active, non-NULL = archived).

- [ ] **Step 1: Write the migration**

```sql
-- Soft-archive for skills. NULL = active, non-NULL = archived (hidden from pickers,
-- kept on the artists who hold it). Delete stays reserved for skills nothing requires.
ALTER TABLE public.skills
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_skills_org_active
  ON public.skills (org_id) WHERE archived_at IS NULL;

COMMENT ON COLUMN public.skills.archived_at IS
  'When set, the skill is archived: hidden from every picker but retained on artist_skills and required-skill rows.';
```

- [ ] **Step 2: Apply locally and regenerate types**

Run (execution-time; see index constraints for the prod rule):
```bash
supabase db reset            # or: apply via MCP against a dev branch, then git mv to the recorded version
supabase gen types typescript --local > src/integrations/supabase/types.ts
npm run sync:mirrors
npm run sync:mirrors:check
npx tsc -p tsconfig.app.json --noEmit
```
Expected: `skills` Row type now includes `archived_at: string | null`.

- [ ] **Step 3: Write the pgTAP test**

```sql
BEGIN;
SELECT plan(2);
SELECT has_column('public', 'skills', 'archived_at', 'skills has archived_at');
SELECT col_is_null('public', 'skills', 'archived_at', 'skills.archived_at is nullable');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Run it** — `supabase test db` (or the ROLLBACK-txn execute_sql path). Expected: 2/2 pass.
- [ ] **Step 5: Commit** — `git add supabase/migrations/20260811120000_skills_archived_at.sql supabase/tests/skills_archive.test.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts && git commit -m "feat: add skills.archived_at for soft-archive"`

---

### Task 2: Data layer — catalog read, usage counts, and mutations

**Files:**
- Modify: `src/data/skills.ts`
- Test: `src/data/skills.test.ts` (create)

**Interfaces:**
- Produces:
  - `type SkillCatalogRow = { id: string; name: string; archivedAt: string | null; artistCount: number; requiredByCount: number }`
  - `fetchSkillCatalog(client, orgId): Promise<SkillCatalogRow[]>` — all skills (incl. archived), alphabetical, with counts.
  - `renameSkill(client, id, name): Promise<Skill>`
  - `archiveSkill(client, id): Promise<void>` / `restoreSkill(client, id): Promise<void>`
  - `deleteSkill(client, id): Promise<void>`
  - `fetchUpcomingDateCountsBySkill(client, orgId, todayIso): Promise<Map<string, number>>` — per skill, count of upcoming non-cancelled dates whose required-skill union includes it.
- Consumes: existing `fetchSkills`, now archived-excluding.

- [ ] **Step 1: Write failing tests** (`src/data/skills.test.ts`) using `makeFakeClient` from `src/test/supabaseFake.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeFakeClient } from '@/test/supabaseFake';
import { fetchSkills, fetchSkillCatalog, renameSkill, archiveSkill, deleteSkill } from './skills';

describe('fetchSkills', () => {
  it('excludes archived skills', async () => {
    const client = makeFakeClient({
      skills: [
        { id: 's1', name: 'Vocals', org_id: 'o1', archived_at: null },
        { id: 's2', name: 'Puppetry', org_id: 'o1', archived_at: '2026-01-01T00:00:00Z' },
      ],
    });
    const rows = await fetchSkills(client, 'o1');
    expect(rows.map((r) => r.name)).toEqual(['Vocals']);
  });
});

describe('fetchSkillCatalog', () => {
  it('returns counts and includes archived', async () => {
    const client = makeFakeClient({
      skills: [{ id: 's1', name: 'Vocals', org_id: 'o1', archived_at: null }],
      artist_skills: [{ artist_id: 'a1', skill_id: 's1', org_id: 'o1' }, { artist_id: 'a2', skill_id: 's1', org_id: 'o1' }],
      show_required_skills: [{ show_id: 'sh1', skill_id: 's1', org_id: 'o1' }],
    });
    const rows = await fetchSkillCatalog(client, 'o1');
    expect(rows[0]).toMatchObject({ id: 's1', name: 'Vocals', artistCount: 2, requiredByCount: 1 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`fetchSkillCatalog` not exported): `npx vitest run src/data/skills.test.ts`

- [ ] **Step 3: Implement** in `src/data/skills.ts`:

```ts
// Add to Skill fetches: archived-excluding read for every picker.
export async function fetchSkills(client, orgId): Promise<Skill[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("skills").select("id, name").eq("org_id", orgId).is("archived_at", null).order("name");
  if (error) throw error;
  return data ?? [];
}

export type SkillCatalogRow = { id: string; name: string; archivedAt: string | null; artistCount: number; requiredByCount: number };

export async function fetchSkillCatalog(client, orgId): Promise<SkillCatalogRow[]> {
  if (!orgId) return [];
  const [skillsRes, artistRes, showReqRes] = await Promise.all([
    client.from("skills").select("id, name, archived_at").eq("org_id", orgId).order("name"),
    client.from("artist_skills").select("skill_id").eq("org_id", orgId),
    client.from("show_required_skills").select("skill_id, show_id").eq("org_id", orgId),
  ]);
  if (skillsRes.error) throw skillsRes.error;
  if (artistRes.error) throw artistRes.error;
  if (showReqRes.error) throw showReqRes.error;
  const artistCounts = new Map<string, number>();
  for (const r of (artistRes.data ?? []) as { skill_id: string }[])
    artistCounts.set(r.skill_id, (artistCounts.get(r.skill_id) ?? 0) + 1);
  const reqShows = new Map<string, Set<string>>();
  for (const r of (showReqRes.data ?? []) as { skill_id: string; show_id: string }[]) {
    const set = reqShows.get(r.skill_id) ?? new Set<string>();
    set.add(r.show_id); reqShows.set(r.skill_id, set);
  }
  return ((skillsRes.data ?? []) as { id: string; name: string; archived_at: string | null }[]).map((s) => ({
    id: s.id, name: s.name, archivedAt: s.archived_at,
    artistCount: artistCounts.get(s.id) ?? 0,
    requiredByCount: reqShows.get(s.id)?.size ?? 0,
  }));
}

export async function renameSkill(client, id, name): Promise<Skill> {
  const { data, error } = await client.from("skills").update({ name: name.trim() }).eq("id", id).select("id, name").single();
  if (error) throw error;
  return data as Skill;
}
export async function archiveSkill(client, id): Promise<void> {
  const { error } = await client.from("skills").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
export async function restoreSkill(client, id): Promise<void> {
  const { error } = await client.from("skills").update({ archived_at: null }).eq("id", id);
  if (error) throw error;
}
export async function deleteSkill(client, id): Promise<void> {
  const { error } = await client.from("skills").delete().eq("id", id);
  if (error) throw error;
}

// Per-skill count of upcoming, non-cancelled dates whose required-skill union includes it.
export async function fetchUpcomingDateCountsBySkill(client, orgId, todayIso): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!orgId) return out;
  const { data: dates, error: dErr } = await client
    .from("show_dates").select("id, show_id").eq("org_id", orgId).gte("date", todayIso).neq("status", "cancelled");
  if (dErr) throw dErr;
  const rows = (dates ?? []) as { id: string; show_id: string }[];
  const [showReq, dateReq] = await Promise.all([
    client.from("show_required_skills").select("show_id, skill_id").eq("org_id", orgId),
    client.from("show_date_required_skills").select("show_date_id, skill_id").eq("org_id", orgId),
  ]);
  if (showReq.error) throw showReq.error;
  if (dateReq.error) throw dateReq.error;
  const byShow = new Map<string, Set<string>>();
  for (const r of (showReq.data ?? []) as { show_id: string; skill_id: string }[]) {
    const s = byShow.get(r.show_id) ?? new Set<string>(); s.add(r.skill_id); byShow.set(r.show_id, s);
  }
  const byDate = new Map<string, Set<string>>();
  for (const r of (dateReq.data ?? []) as { show_date_id: string; skill_id: string }[]) {
    const s = byDate.get(r.show_date_id) ?? new Set<string>(); s.add(r.skill_id); byDate.set(r.show_date_id, s);
  }
  for (const d of rows) {
    const union = new Set<string>([...(byShow.get(d.show_id) ?? []), ...(byDate.get(d.id) ?? [])]);
    for (const sid of union) out.set(sid, (out.get(sid) ?? 0) + 1);
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**: `npx vitest run src/data/skills.test.ts`
- [ ] **Step 5: Commit** — `git commit -m "feat: skills catalog read + rename/archive/delete data layer"`

---

### Task 3: Hooks + `manage_skills` capability

**Files:**
- Modify: `src/hooks/useSkills.ts`
- Modify: `src/lib/capabilities.ts` (add one `CapabilityDef` inside the sentinel block), then `npm run sync:mirrors`
- Modify: the SQL twin `public.capability_default()` — new migration `supabase/migrations/20260811120100_manage_skills_capability.sql` mirroring the default
- Test: `src/hooks/useSkills.test.tsx` (create) + `src/lib/capabilities.test.ts` (extend if present)

**Interfaces:**
- Produces: `useSkillCatalog()`, `useRenameSkill()`, `useArchiveSkill()`, `useRestoreSkill()`, `useDeleteSkill()` (all bust `['skills']`); `useUpcomingDateCountsBySkill()`. New capability action `manage_skills` (role producer, default enabled), gating the catalog write controls; delete control additionally gated on `hasRole('admin')` (DELETE RLS is admin-only).

- [ ] **Step 1:** Add the capability def to `CAPABILITY_DEFS` (inside the generated sentinel block) next to `producer_can_manage_cities`:

```ts
{ key: "producer_can_manage_skills", action: "manage_skills", role: "producer", group: "Bookings & engine", label: "Manage the skills catalog", description: "Producers can create, rename, and archive skills.", risk: "standard", defaultEnabled: true },
```
Then `npm run sync:mirrors && npm run sync:mirrors:check`.

- [ ] **Step 2:** Add the SQL twin default. Read `public.capability_default()` (grep migrations for it) and add a `WHEN 'manage_skills' THEN true` arm in a new migration `20260811120100_manage_skills_capability.sql`; add a `capabilityDefaultsSql.test.ts` assertion if that guard test enumerates actions.

- [ ] **Step 3:** Add hooks to `src/hooks/useSkills.ts`:

```ts
export function useSkillCatalog() {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ['skills', 'catalog', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchSkillCatalog(supabase, currentOrg?.id ?? null),
  });
}
function useSkillMutation<T>(fn: (id: string) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }) });
}
export const useArchiveSkill = () => useSkillMutation((id) => archiveSkill(supabase, id));
export const useRestoreSkill = () => useSkillMutation((id) => restoreSkill(supabase, id));
export const useDeleteSkill = () => useSkillMutation((id) => deleteSkill(supabase, id));
export function useRenameSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameSkill(supabase, id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  });
}
export function useUpcomingDateCountsBySkill() {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ['skills', 'upcoming-date-counts', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchUpcomingDateCountsBySkill(supabase, currentOrg?.id ?? null, todayKey()),
  });
}
```
(`todayKey()` = local-date `toDateKey(new Date())` from `src/lib/dates.ts`.)

- [ ] **Step 4:** Test the invalidation with a `renderHook` + a QueryClient spy (pattern in existing hook tests). Run `npx vitest run src/hooks/useSkills.test.tsx`. Expect PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: skills catalog hooks + manage_skills capability"`

---

### Task 4: `SkillsCard` component (design 1f)

**Files:**
- Create: `src/components/settings/SkillsCard.tsx`
- Test: `src/components/settings/SkillsCard.test.tsx` (create)

**Interfaces:**
- Consumes: `useSkillCatalog`, `useCreateSkill`, `useRenameSkill`, `useArchiveSkill`, `useRestoreSkill`, `useDeleteSkill`, `useCan('manage_skills')`, `useAuth().hasRole`.
- Produces: `<SkillsCard canEnter />` default-exported? No — named `SkillsCard`, consumed by CastsCitiesTab.

Faithful to `section-1f.html`: a `Card` titled **"Skills"**, description *"Skills gate who can be offered or booked. Productions require them per slot; artists hold them on their profile."*; an add row (Input "New skill name" + primary "Add" with plus icon); a table with header columns **Skill / Artists / Required by / (actions)** and one row per catalog skill:
- name (inline-editable via Rename → text input + Cancel/Save name);
- `Artists` = `{artistCount} artists` (mono, muted);
- `Required by` = `{requiredByCount} productions` when >0, else "Not required yet"; archived rows show "Hidden from pickers";
- actions: `Rename`, `Archive` (or `Restore` for archived rows), and a trash button that is **disabled with tooltip "In use by N productions — archive it instead"** when `requiredByCount > 0`, else an enabled destructive delete (tooltip "Not required by any production — safe to delete"); delete additionally hidden/disabled unless `hasRole('admin')`.
- Archived rows render name + a muted "Archived" badge and only a `Restore` action.
- Footnote: *"Archiving hides a skill from every picker and keeps it on the artists who hold it. Deleting is only offered while no production requires it. New workspaces are seeded from the platform starter list."*
- Write controls disabled when `!canManage`.

- [ ] **Step 1:** Write a component test: renders catalog rows, disables delete when `requiredByCount>0`, calls `archiveSkill` on Archive click, calls `createSkill` on Add. Use `renderWithProviders` + a seeded query cache (per the seed-once memory: prime the cache, assert first render).
- [ ] **Step 2:** Run — expect FAIL (no component).
- [ ] **Step 3:** Implement `SkillsCard.tsx` with shadcn `Card`/`Input`/`Button`/`Badge`/`IconTooltip`, semantic tokens, violet accents via `text-primary`/`bg-primary/10` for the editing row, `text-destructive` for enabled delete. No em dashes.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: Skills catalog card (Settings)"`

---

### Task 5: Wire `SkillsCard` into Settings → Casts & Cities

**Files:**
- Modify: `src/components/settings/CastsCitiesTab.tsx` (render `<SkillsCard canEnter={canEnter} />` as the first `Card` in the returned `<div className="mt-4 space-y-6">`, above Cities — matching 1f where Skills sits above Cities).

- [ ] **Step 1:** Add import + render. Run `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 2:** Manual/preview check that the card appears above Cities. (Local dev targets a LOCAL stack per CLAUDE.md.)
- [ ] **Step 3: Commit** — `git commit -m "feat: mount Skills card in Casts & Cities settings"`

---

### Task 6: `ArtistsPage` roster card — labelled SKILLS / CASTS rows (design 1j)

**Files:**
- Modify: `src/pages/ArtistsPage.tsx` (the card body, current lines ~366-379).
- Test: `src/pages/ArtistsPage.test.tsx` (extend, or a focused card render test).

Faithful to `section-1j.html` proposed side: replace the two unlabelled badge rows with two labelled 52px-gutter rows:
- **SKILLS** (eyebrow, `text-[11px] font-semibold tracking-[1.6px] uppercase text-muted-foreground/faint`) with violet-tinted badges (`bg-accent-100 text-accent-700`, radius-xs), **capped at 3** with a `+N` mono overflow badge when more.
- **CASTS** (same eyebrow) with hairline-neutral badges (`border-[0.5px] border-line-strong text-muted-foreground`), separated by a top hairline.

- [ ] **Step 1:** Write a render test: an artist with 5 skills shows 3 badges + "+2"; casts row present with label.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement the two-row grid (`grid-cols-[52px_1fr]`), cap skills with `skills.slice(0,3)` + overflow, keep the existing `skillsByArtist` / `artistCasts` data.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: labelled skills/casts rows on artist roster card (1j)"`

---

### Task 7: `ArtistProfileSheet` skills editor — rows + add-chips (design 1i)

**Files:**
- Modify: `src/components/artists/ArtistProfileSheet.tsx` (skills block ~lines 280-298; remove `handleCreateSkill`/`useCreateSkill` usage there).
- Test: `src/components/artists/ArtistProfileSheet.test.tsx` (extend/create).

Faithful to `section-1i.html` proposed side:
- Header row: label **Skills** + right-aligned mono `"{held} of {catalogTotal} in the catalog"`.
- Helper: *"Skills decide which dates this artist can be offered. Removing one takes them out of any offer that requires it."* (Design says "which dates Marta can be offered" — use the artist's name if available, else "this artist".)
- **Held skills as rows** (violet, same control family as 1d): each row = check tile + name + trailing mono metadata **"N upcoming dates"** / "Not required yet" + remove (X) button. The metadata comes from `useUpcomingDateCountsBySkill()`; render it **only when the viewer is not an `artist` role** (this sheet is admin/producer-only today, so it always shows, but gate defensively via `useAuth().hasRole('artist')`).
- **Add-chips** below: the catalog skills not yet held, each a dashed/outline chip with a plus icon that adds it; plus a "Find a skill" search chip if the catalog is large (optional search popover over the same list).
- **Remove free-text creation**: delete the `onCreate`/`Create "x"` path. Replace with helper: *"Need a skill that does not exist? An admin adds it in Settings → Casts & Cities, so the catalog stays clean."* (link to `ROUTES.SETTINGS` Casts & Cities).
- Keep the existing save-diff against `artist_skills` unchanged. Read-only mode (no `edit_artists`) renders the rows without the add-chips/remove.

- [ ] **Step 1:** Write tests: (a) held skills render as rows with the upcoming-date count; (b) an unheld catalog skill appears as an add-chip and clicking it adds to the draft; (c) there is no "Create" affordance for a novel typed name; (d) the Settings helper link renders.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement. Draft state stays `selectedSkills: {id,name}[]`; add-chips = `catalog.filter(c => !held && !c.archivedAt)`. Remove `handleCreateSkill`, `useCreateSkill`, and the `TagInput` `onCreate`. (Leave `useCreateSkill`/`createSkill` in the codebase — they are now only used, if at all, by the catalog card's Add.)
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `npx tsc -p tsconfig.app.json --noEmit` + `npm run lint`.
- [ ] **Step 6: Commit** — `git commit -m "feat: artist profile skills as catalog rows, no inline creation (1i)"`

---

### Task 8: Regression — archived skills excluded from every picker

**Files:**
- Test: `src/data/skills.test.ts` (add cases) + a `SkillPicker`/required-skills consumer smoke test.

- [ ] **Step 1:** Add a test asserting `fetchSkills` (feeding `SkillPicker`, `ShowFormDialog`, `RequiredSkillsSection`, the direct-book filter, `TierTimeline`) omits archived rows. Confirm those consumers call `useSkills()`/`fetchSkills` (grep) — if any read `skills` directly, point them at `fetchSkills`.
- [ ] **Step 2:** Run full skills suite — expect PASS.
- [ ] **Step 3: Commit** — `git commit -m "test: archived skills stay out of pickers"`

---

### Task 9: Changelog + version (user-facing)

**Files:**
- Modify: `public/changelog.md` (newest-first block), then `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
- Modify: `package.json` `version` + `src/config/app.config.ts` `APP_META.VERSION` (owner confirms the bump)

- [ ] **Step 1:** Add a `### New` bullet (Skills catalog) + `### Improved` bullets (artist profile skills, roster card) written for end users, no em dashes, no admin-only framing.
- [ ] **Step 2:** Regenerate the JSON; do not hand-edit it.
- [ ] **Step 3: Commit** — `git commit -m "docs: changelog for skills catalog"` (hold the version bump until the owner confirms; per memory, some PRs intentionally skip the changelog — confirm.)

---

## Self-Review (run after writing; fix inline)

- **Spec coverage:** 1f → Tasks 1-5; 1j → Task 6; 1i → Task 7; archived-hidden-from-pickers → Tasks 2+8. ✔
- **Placeholder scan:** data-layer + hook code is concrete; UI tasks cite the exact section markup + copy + token treatments. ✔
- **Type consistency:** `SkillCatalogRow` fields (`archivedAt`, `artistCount`, `requiredByCount`) used consistently in Tasks 2/4; hook names (`useSkillCatalog`, `useArchiveSkill`, …) match Tasks 3/4/7. ✔
- **Open confirmation for the implementer:** delete gating uses `hasRole('admin')` because the `skills` DELETE RLS is admin-only (base migration `skills_delete_admin`); create/rename/archive use `manage_skills`. Keep both.
