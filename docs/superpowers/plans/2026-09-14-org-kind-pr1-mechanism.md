# Workspace type (org_kind), PR 1: mechanism. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the per-org `org_kind` flag (production | staffing) end to end: column, RPC, registry with edge mirror, client hook, i18next vocabulary bridge, noun-scanner ratchet, and the four pickers. After this PR every string still reads exactly as today.

**Architecture:** `org_kind` is a column on `organizations` written through a `set_org_kind` RPC and by `provision_org`. A pure registry in `src/lib/orgKind.ts` (mirrored into the edge runtime by `sync:mirrors`) holds kinds, labels, and per-kind per-language vocabulary tables. `useOrgKind()` reads `currentOrg.org_kind`; `VocabularyBridge` feeds the active vocabulary to i18next as `interpolation.defaultVariables` so `{{noun}}` variables resolve with no component edits. A picker component `OrgKindSelect` is reused in Settings, Get running, and the two Platform dialogs.

**Tech Stack:** React 18, TypeScript, react-i18next 15 / i18next 23, @tanstack/react-query 5, Supabase (Postgres migrations, pgTAP, Deno edge functions), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-org-kind-workspace-type-design.md` (R1, R2, R3, R7, plus the noun scanner from R4 in ratchet form). PR 2 (copy audit) and PR 3 (presentation and server) get their own plans after this merges.

## Global Constraints

- Never hand-edit `supabase/migrations/*` of an existing file, `src/integrations/supabase/types.ts`, or any file/block stamped GENERATED. New migrations are new files. Types are regenerated from the local stack.
- Copy rules: no em or en dashes, no exclamation marks, no emoji; German is Du-form. `src/i18n/copyLint.test.ts` and `keyParity.test.ts` enforce. English and German keys land together.
- UI rules: `docs/ui-conventions.md`. Use `src/components/ui` primitives. No raw values. 13px controls (`text-control`). Uppercase text only via `<Eyebrow>`.
- `any` is banned. Cast Supabase rows once at the query boundary with an explicit row interface. Tests use `src/test/supabaseFake.ts`, `src/test/renderWithProviders.tsx`, `supabase/functions/_shared/testing.ts`.
- Commit messages: imperative, lowercase, at most 72 chars, ending with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.
- Branch: `claude/industry-use-case-flag-b9e00e` in this worktree. Do not push or open the PR until Task 15 says so.
- No changelog entry in this PR (nothing customer-visible changes). Changelog is PR 3.
- The `producer` role literal is never compared against a display label.

---

## Task 0: Visual approval of the two admin-facing pickers (gate)

The owner's standing rule: mock up user-facing changes and get explicit approval before implementing them. Two surfaces are new for org admins: the Workspace type field in Settings, Organization, and the Workspace type step in Get running.

**Files:**
- Create (scratch, not committed): `<scratchpad>/org-kind-mockup.html`

- [ ] **Step 1: Build a static HTML mockup** with two panels side by side. Panel A: the Settings Organization card as it exists (Organization name input, Slug input disabled, Save button) plus a new field under them: label "Workspace type", a select showing "Live production", helper text "Changes the words the app uses. Nothing about your data changes." Panel B: the Get running wizard shell with a new first step in the "Get dates in" phase titled "Choose your workspace type", hint "Live production or staffing agency. Sets the words the app uses.", body with two radio cards: "Live production" ("Shows, dates, artists and casts.") and "Staffing agency" ("Clients, shifts, staff and teams."), and a Continue button. Use the app's actual look: Geist font, 13px controls, muted helper text, rounded card borders.

- [ ] **Step 2: Publish it as an Artifact** (title "Workspace type pickers", favicon "🏷️") and send the link to the owner with the message: "Two pickers for approval before PR 1 starts: Settings field and Get running step. Yes, or changes?"

- [ ] **Step 3: STOP.** Do not start Task 1 until the owner has answered yes. Record any requested wording changes and apply them to the i18n strings in Tasks 9 and 12.

---

## Task 1: Migration: column, RPC, provision_org, platform_org_stats

**Files:**
- Create: `supabase/migrations/20260914120000_org_kind.sql`
- Create: `supabase/tests/rpc/set_org_kind.test.sql`

**Interfaces:**
- Produces: `organizations.org_kind text not null default 'production'`, `organizations.org_kind_set_at timestamptz null`; RPC `public.set_org_kind(p_org uuid, p_kind text) returns void`; `public.provision_org(p_name, p_slug, p_admin_email, p_role default 'admin', p_org_kind text default 'production')`; `platform_org_stats()` returns an extra `org_kind text` column.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/rpc/set_org_kind.test.sql
-- set_org_kind: admin sets; non-admin rejected; unknown kind rejected by CHECK; set_at stamped.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000006ad','authenticated','authenticated','kind-admin@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-0000000006b0','authenticated','authenticated','kind-bob@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000006c0','Kind Org','kind-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000006c0','00000000-0000-0000-0000-0000000006ad','admin'),
  ('00000000-0000-0000-0000-0000000006c0','00000000-0000-0000-0000-0000000006b0','producer');
SET session_replication_role = DEFAULT;

-- default state
SELECT is((SELECT org_kind FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000006c0'), 'production', 'defaults to production');
SELECT is((SELECT org_kind_set_at FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000006c0'), NULL, 'set_at is null until chosen');

-- CHECK constraint
SELECT throws_ok(
  $$ UPDATE public.organizations SET org_kind='circus' WHERE id='00000000-0000-0000-0000-0000000006c0' $$,
  '23514', NULL, 'unknown kind rejected by CHECK');

-- non-admin (bob) cannot set
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000006b0","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.set_org_kind('00000000-0000-0000-0000-0000000006c0','staffing') $$,
  '42501', NULL, 'non-admin cannot set org_kind');
RESET ROLE;

-- admin sets staffing
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000006ad","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.set_org_kind('00000000-0000-0000-0000-0000000006c0','staffing') $$,
  'admin can set org_kind');
RESET ROLE;
SELECT is((SELECT org_kind FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000006c0'), 'staffing', 'org_kind updated');
SELECT isnt((SELECT org_kind_set_at FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000006c0'), NULL, 'set_at stamped');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run local:up && supabase test db supabase/tests/rpc/set_org_kind.test.sql`
Expected: FAIL (column `org_kind` does not exist).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260914120000_org_kind.sql
-- Workspace type (org_kind): which vocabulary and presentation an org sees.
-- Spec: docs/superpowers/specs/2026-09-14-org-kind-workspace-type-design.md (R1).

-- 1. Column + CHECK. Existing orgs become 'production' with no data change.
alter table public.organizations
  add column if not exists org_kind text not null default 'production',
  add column if not exists org_kind_set_at timestamptz null;

alter table public.organizations
  drop constraint if exists organizations_org_kind_check,
  add constraint organizations_org_kind_check check (org_kind in ('production','staffing'));

comment on column public.organizations.org_kind is
  'Workspace type: production | staffing. Drives UI vocabulary and presentation only; never data or booking behaviour.';
comment on column public.organizations.org_kind_set_at is
  'When an admin or super-admin explicitly chose the kind. NULL means still on the default; the Get running step reads this.';

-- 2. set_org_kind: org admin (super-admins pass via has_org_role) sets the kind.
--    No admin UPDATE policy is opened on organizations; this RPC is the only admin write path.
create or replace function public.set_org_kind(p_org uuid, p_kind text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.has_org_role(v_caller, p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('production','staffing') then
    raise exception 'Unknown workspace type' using errcode = '22023';
  end if;
  update public.organizations
     set org_kind = p_kind, org_kind_set_at = now()
   where id = p_org;
end;
$$;
revoke all on function public.set_org_kind(uuid, text) from public, anon;
grant execute on function public.set_org_kind(uuid, text) to authenticated, service_role;

-- 3. provision_org gains p_org_kind. Adding a defaulted parameter creates a new overload,
--    so the old 4-arg signature is dropped first. Body identical to
--    20260604140000_phase4_platform_console.sql except the organizations insert.
drop function if exists public.provision_org(text, text, text, app_role);
```

Then paste the full body of `provision_org` from `supabase/migrations/20260604140000_phase4_platform_console.sql` (lines 6 to the closing `$$;` and its grants) with these three edits:

1. Signature: `p_name text, p_slug text, p_admin_email text, p_role app_role default 'admin', p_org_kind text default 'production'`.
2. Directly after the existing required-fields check add:
   ```sql
   if p_org_kind is null or p_org_kind not in ('production','staffing') then
     raise exception 'Unknown workspace type' using errcode = '22023';
   end if;
   ```
3. The `insert into public.organizations (...)` gains `org_kind, org_kind_set_at` columns with values `p_org_kind, now()`.
4. Re-issue the revoke/grant lines with the new 5-arg signature `(text, text, text, app_role, text)`.

Then append:

```sql
-- 4. platform_org_stats: append org_kind. RETURNS TABLE signature change requires drop.
--    Body identical to 20260816203826_demo_mode_foundation.sql plus `org_kind text` / `o.org_kind`.
drop function if exists public.platform_org_stats();
create or replace function public.platform_org_stats()
returns table (
  org_id uuid, name text, slug text, status text,
  member_count int, active_artist_count int, bookings_30d int, last_activity_at timestamptz,
  is_demo boolean, org_kind text
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
      ),
      o.is_demo,
      o.org_kind
    from public.organizations o
    order by o.created_at desc;
end;
$$;
revoke all on function public.platform_org_stats() from public, anon;
grant execute on function public.platform_org_stats() to authenticated;
```

- [ ] **Step 4: Apply and run the DB tests**

Run: `npm run local:reset && supabase test db`
Expected: the new file passes 7/7; `supabase/tests/db/platform_console.sql` still passes (the 4-arg call resolves through the default).

- [ ] **Step 5: Regenerate types and mirrors**

Run:
```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts && npm run sync:mirrors && npm run sync:mirrors:check && npx tsc -p tsconfig.app.json --noEmit
```
Expected: `organizations.Row` now has `org_kind: string` and `org_kind_set_at: string | null`; `Functions.set_org_kind` exists; `provision_org.Args` has `p_org_kind?: string`; `platform_org_stats.Returns` has `org_kind`. Typecheck may now fail in `src/test/fixtures.ts` (`anOrganization` missing the two fields): fix by adding `org_kind: "production", org_kind_set_at: null,` to its defaults.

- [ ] **Step 6: Run the migration checker and commit**

Run: `node scripts/check-migrations.mjs && npx vitest run scripts/generatedTypes.test.ts src/test`
Expected: PASS.

```bash
git add supabase/migrations/20260914120000_org_kind.sql supabase/tests/rpc/set_org_kind.test.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts src/test/fixtures.ts
git commit -m "add org_kind column, set_org_kind rpc and provision_org arg

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: Registry `src/lib/orgKind.ts` with edge mirror

**Files:**
- Create: `src/lib/orgKind.ts`
- Create: `src/lib/orgKind.test.ts`
- Create: `supabase/functions/_shared/orgKind.ts`
- Create: `supabase/functions/_shared/orgKind.test.ts`
- Modify: `scripts/mirrors.manifest.json` (add a block entry)

**Interfaces:**
- Produces: `type OrgKind = "production" | "staffing"`; `ORG_KINDS: readonly OrgKind[]`; `DEFAULT_ORG_KIND`; `isOrgKind(v: unknown): v is OrgKind`; `coerceOrgKind(v: unknown): OrgKind`; `ORG_KIND_LABELS: Record<OrgKind, Record<"en"|"de", { title: string; desc: string }>>`; `type Vocabulary = Record<VocabKey, string>`; `VOCABULARY: Record<OrgKind, Record<"en"|"de", Vocabulary>>`; edge-only `resolveOrgKind(admin, orgId | null): Promise<OrgKind>`.

- [ ] **Step 1: Write the failing unit test**

```ts
// src/lib/orgKind.test.ts
import { describe, it, expect } from "vitest";
import { ORG_KINDS, DEFAULT_ORG_KIND, isOrgKind, coerceOrgKind, ORG_KIND_LABELS, VOCABULARY } from "./orgKind";

const DASH = /[–—]/;

describe("orgKind registry", () => {
  it("lists production first and defaults to it", () => {
    expect(ORG_KINDS[0]).toBe("production");
    expect(DEFAULT_ORG_KIND).toBe("production");
    expect(ORG_KINDS).toEqual(["production", "staffing"]);
  });

  it("isOrgKind / coerceOrgKind narrow safely", () => {
    expect(isOrgKind("staffing")).toBe(true);
    expect(isOrgKind("Staffing")).toBe(false);
    expect(isOrgKind(null)).toBe(false);
    expect(coerceOrgKind("staffing")).toBe("staffing");
    expect(coerceOrgKind("circus")).toBe("production");
    expect(coerceOrgKind(undefined)).toBe("production");
  });

  it("every (kind, lang) vocabulary has the identical key set", () => {
    const ref = Object.keys(VOCABULARY.production.en).sort();
    expect(ref.length).toBeGreaterThan(0);
    for (const kind of ORG_KINDS) {
      for (const lang of ["en", "de"] as const) {
        expect(Object.keys(VOCABULARY[kind][lang]).sort()).toEqual(ref);
      }
    }
  });

  it("vocabulary and labels are copy-clean and non-empty", () => {
    for (const kind of ORG_KINDS) {
      for (const lang of ["en", "de"] as const) {
        for (const v of Object.values(VOCABULARY[kind][lang])) {
          expect(v.trim().length).toBeGreaterThan(0);
          expect(v).not.toMatch(DASH);
          expect(v).not.toContain("!");
        }
        expect(ORG_KIND_LABELS[kind][lang].title).not.toMatch(DASH);
        expect(ORG_KIND_LABELS[kind][lang].desc).not.toMatch(DASH);
      }
    }
  });

  it("capitalised forms are the capitalised singular/plural", () => {
    for (const kind of ORG_KINDS) {
      const v = VOCABULARY[kind].en;
      expect(v.Show.charAt(0)).toBe(v.Show.charAt(0).toUpperCase());
      expect(v.Shows.charAt(0)).toBe(v.Shows.charAt(0).toUpperCase());
      expect(v.show.charAt(0)).toBe(v.show.charAt(0).toLowerCase());
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/orgKind.test.ts`
Expected: FAIL, cannot resolve `./orgKind`.

- [ ] **Step 3: Write the registry**

```ts
// src/lib/orgKind.ts
// Workspace type ("org_kind"): which vocabulary and presentation an org sees.
// GENERATED MIRROR SOURCE: the block between the sentinels below is copied into
// supabase/functions/_shared/orgKind.ts by `npm run sync:mirrors` (the two runtimes
// cannot share an import). Edit here, then regenerate; never hand-edit the target.
// Spec: docs/superpowers/specs/2026-09-14-org-kind-workspace-type-design.md

// >>> ORG KIND REGISTRY MIRROR (keep byte-identical with the twin file) >>>
export type OrgKind = "production" | "staffing";
export type OrgKindLang = "en" | "de";

export const ORG_KINDS: readonly OrgKind[] = ["production", "staffing"];
export const DEFAULT_ORG_KIND: OrgKind = "production";

export function isOrgKind(v: unknown): v is OrgKind {
  return v === "production" || v === "staffing";
}

/** Narrow any stored value to an OrgKind; anything unknown is production. */
export function coerceOrgKind(v: unknown): OrgKind {
  return isOrgKind(v) ? v : DEFAULT_ORG_KIND;
}

/** Picker labels. Neutral, plain language; the noun tables below carry the vocabulary. */
export const ORG_KIND_LABELS: Record<OrgKind, Record<OrgKindLang, { title: string; desc: string }>> = {
  production: {
    en: { title: "Live production", desc: "Shows, dates, artists and casts." },
    de: { title: "Live-Produktion", desc: "Shows, Termine, Artists und Besetzungen." },
  },
  staffing: {
    en: { title: "Staffing agency", desc: "Clients, shifts, staff and teams." },
    de: { title: "Personalagentur", desc: "Kunden, Schichten, Teammitglieder und Teams." },
  },
};

/**
 * Vocabulary variables. Four forms per noun because i18next interpolation is plain
 * substitution and sentences start with capitals: lower singular, lower plural,
 * Capital singular, Capital plural. Every (kind, lang) table has the same keys
 * (orgKind.test.ts). PR 2 extends this list during the copy audit.
 */
export type VocabKey =
  | "show" | "shows" | "Show" | "Shows"
  | "showDate" | "showDates" | "ShowDate" | "ShowDates"
  | "artist" | "artists" | "Artist" | "Artists"
  | "production" | "productions" | "Production" | "Productions"
  | "cast" | "casts" | "Cast" | "Casts"
  | "understudy" | "understudies" | "Understudy" | "Understudies"
  | "skill" | "skills" | "Skill" | "Skills"
  | "hireOrder" | "hireOrders" | "HireOrder" | "HireOrders"
  | "roleProducer";

export type Vocabulary = Record<VocabKey, string>;

export const VOCABULARY: Record<OrgKind, Record<OrgKindLang, Vocabulary>> = {
  production: {
    en: {
      show: "show", shows: "shows", Show: "Show", Shows: "Shows",
      showDate: "date", showDates: "dates", ShowDate: "Date", ShowDates: "Dates",
      artist: "artist", artists: "artists", Artist: "Artist", Artists: "Artists",
      production: "production", productions: "productions", Production: "Production", Productions: "Productions",
      cast: "cast", casts: "casts", Cast: "Cast", Casts: "Casts",
      understudy: "understudy", understudies: "understudies", Understudy: "Understudy", Understudies: "Understudies",
      skill: "skill", skills: "skills", Skill: "Skill", Skills: "Skills",
      hireOrder: "contract", hireOrders: "contracts", HireOrder: "Contract", HireOrders: "Contracts",
      roleProducer: "Production Team",
    },
    de: {
      show: "Show", shows: "Shows", Show: "Show", Shows: "Shows",
      showDate: "Termin", showDates: "Termine", ShowDate: "Termin", ShowDates: "Termine",
      artist: "Artist", artists: "Artists", Artist: "Artist", Artists: "Artists",
      production: "Produktion", productions: "Produktionen", Production: "Produktion", Productions: "Produktionen",
      cast: "Besetzung", casts: "Besetzungen", Cast: "Besetzung", Casts: "Besetzungen",
      understudy: "Zweitbesetzung", understudies: "Zweitbesetzungen", Understudy: "Zweitbesetzung", Understudies: "Zweitbesetzungen",
      skill: "Skill", skills: "Skills", Skill: "Skill", Skills: "Skills",
      hireOrder: "Engagementvertrag", hireOrders: "Engagementverträge", HireOrder: "Engagementvertrag", HireOrders: "Engagementverträge",
      roleProducer: "Produktionsteam",
    },
  },
  staffing: {
    en: {
      show: "project", shows: "projects", Show: "Project", Shows: "Projects",
      showDate: "shift", showDates: "shifts", ShowDate: "Shift", ShowDates: "Shifts",
      artist: "staff member", artists: "people", Artist: "Staff member", Artists: "People",
      production: "client", productions: "clients", Production: "Client", Productions: "Clients",
      cast: "team", casts: "teams", Cast: "Team", Casts: "Teams",
      understudy: "standby", understudies: "standbys", Understudy: "Standby", Understudies: "Standbys",
      skill: "qualification", skills: "qualifications", Skill: "Qualification", Skills: "Qualifications",
      hireOrder: "work order", hireOrders: "work orders", HireOrder: "Work order", HireOrders: "Work orders",
      roleProducer: "Booking team",
    },
    de: {
      show: "Projekt", shows: "Projekte", Show: "Projekt", Shows: "Projekte",
      showDate: "Schicht", showDates: "Schichten", ShowDate: "Schicht", ShowDates: "Schichten",
      artist: "Teammitglied", artists: "Personen", Artist: "Teammitglied", Artists: "Personen",
      production: "Kunde", productions: "Kunden", Production: "Kunde", Productions: "Kunden",
      cast: "Team", casts: "Teams", Cast: "Team", Casts: "Teams",
      understudy: "Ersatz", understudies: "Ersatzkräfte", Understudy: "Ersatz", Understudies: "Ersatzkräfte",
      skill: "Qualifikation", skills: "Qualifikationen", Skill: "Qualifikation", Skills: "Qualifikationen",
      hireOrder: "Arbeitsauftrag", hireOrders: "Arbeitsaufträge", HireOrder: "Arbeitsauftrag", HireOrders: "Arbeitsaufträge",
      roleProducer: "Buchungsteam",
    },
  },
};
// <<< ORG KIND REGISTRY MIRROR <<<
```

Note: German nouns are capitalised in every form; that is correct German, and the lowercase form keys still exist so the key set stays identical.

- [ ] **Step 4: Run the unit test**

Run: `npx vitest run src/lib/orgKind.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing Deno test for the edge resolver**

```ts
// supabase/functions/_shared/orgKind.test.ts
import { assertEquals } from "./test-asserts.ts";
import { makeFakeDeps } from "./testing.ts";
import { resolveOrgKind, VOCABULARY, ORG_KINDS } from "./orgKind.ts";

function seed(kind: string | null) {
  return makeFakeDeps({
    tables: kind !== null
      ? { organizations: [{ when: { id: "org1" }, data: [{ org_kind: kind }] }] }
      : {},
  });
}

Deno.test("resolveOrgKind: staffing row => staffing", async () => {
  const { deps } = seed("staffing");
  assertEquals(await resolveOrgKind(deps.admin, "org1"), "staffing");
});

Deno.test("resolveOrgKind: unknown value => production", async () => {
  const { deps } = seed("circus");
  assertEquals(await resolveOrgKind(deps.admin, "org1"), "production");
});

Deno.test("resolveOrgKind: no row => production", async () => {
  const { deps } = seed(null);
  assertEquals(await resolveOrgKind(deps.admin, "org1"), "production");
});

Deno.test("resolveOrgKind: null org => production without a read", async () => {
  const { deps, calls } = seed("staffing");
  assertEquals(await resolveOrgKind(deps.admin, null), "production");
  assertEquals(calls.length, 0);
});

Deno.test("resolveOrgKind: read error => production", async () => {
  const { deps } = makeFakeDeps({
    tables: { organizations: [{ when: { id: "org1" }, error: { message: "boom" } }] },
  });
  assertEquals(await resolveOrgKind(deps.admin, "org1"), "production");
});

Deno.test("mirror block carries the vocabulary tables", () => {
  assertEquals(ORG_KINDS.length, 2);
  assertEquals(typeof VOCABULARY.staffing.en.Artists, "string");
});
```

If `makeFakeDeps` resolves `.maybeSingle()` on an array seed to the first row (see `createFakeClient` in `testing.ts` around line 264), the `data: [{ org_kind }]` shape above is right. If it needs a single object, change `data: [{ org_kind: kind }]` to `data: { org_kind: kind }` and keep `when`.

- [ ] **Step 6: Run it to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/orgKind.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 7: Create the edge target with sentinels, then regenerate the block**

```ts
// supabase/functions/_shared/orgKind.ts
// Workspace type (org_kind) for the edge runtime. The block between the sentinels is
// GENERATED from src/lib/orgKind.ts by `npm run sync:mirrors`; edit the source and
// regenerate, never hand-edit the block. `resolveOrgKind` below is edge-only.
import type { TypedClient } from "./deps.ts";

// >>> ORG KIND REGISTRY MIRROR (keep byte-identical with the twin file) >>>
// (regenerated by npm run sync:mirrors)
// <<< ORG KIND REGISTRY MIRROR <<<

interface OrgKindRow { org_kind: string | null }

/**
 * The org's workspace type, read from organizations.org_kind. A null org (auth or
 * platform emails with no org context), a missing row, an unknown value, or any read
 * error all resolve to production, so a broken read can never leak the wrong words.
 */
export async function resolveOrgKind(admin: TypedClient, orgId: string | null): Promise<OrgKind> {
  if (!orgId) return DEFAULT_ORG_KIND;
  try {
    const { data, error } = await admin
      .from("organizations")
      .select("org_kind")
      .eq("id", orgId)
      .maybeSingle();
    if (error) return DEFAULT_ORG_KIND;
    return coerceOrgKind((data as OrgKindRow | null)?.org_kind);
  } catch {
    return DEFAULT_ORG_KIND;
  }
}
```

Add to `scripts/mirrors.manifest.json` inside the `entries` array, after the ROLE LABELS entry:

```json
{
  "mode": "block",
  "source": "src/lib/orgKind.ts",
  "target": "supabase/functions/_shared/orgKind.ts",
  "start": "// >>> ORG KIND REGISTRY MIRROR (keep byte-identical with the twin file) >>>",
  "end": "// <<< ORG KIND REGISTRY MIRROR <<<",
  "why": "Workspace-type registry + vocabulary tables. Emails and PDFs substitute {{noun}} variables from the same tables the app UI uses; the edge file adds the DB-backed resolveOrgKind below the block."
}
```

Run: `npm run sync:mirrors && npm run sync:mirrors:check`
Expected: the block is filled; check passes.

- [ ] **Step 8: Run the Deno test and typecheck**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/orgKind.test.ts && deno check --node-modules-dir=none supabase/functions/_shared/orgKind.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/orgKind.ts src/lib/orgKind.test.ts supabase/functions/_shared/orgKind.ts supabase/functions/_shared/orgKind.test.ts scripts/mirrors.manifest.json
git commit -m "add org_kind registry with vocabulary tables and edge mirror

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: Data layer: org rows carry `org_kind`, `setOrgKind`, `provisionOrg` arg

**Files:**
- Modify: `src/data/orgs.ts:6-31` and append `setOrgKind`
- Create: `src/data/orgs.orgKind.test.ts`
- Modify: `src/data/platform.ts:13-22` (`OrgStat`), `:204-208` (`fetchAllOrgs`), `:220-235` (`provisionOrg`)
- Modify: `src/data/platform.test.ts` (if it exists; else create `src/data/platform.orgKind.test.ts`)

**Interfaces:**
- Produces: `Organization.org_kind: OrgKind`, `Organization.org_kind_set_at: string | null`; `setOrgKind(client, orgId, kind): Promise<void>`; `OrgStat.org_kind: OrgKind`; `provisionOrg(client, { ..., orgKind?: OrgKind })`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/data/orgs.orgKind.test.ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchMyMemberships, setOrgKind } from "./orgs";

describe("orgs data: org_kind", () => {
  it("fetchMyMemberships selects org_kind and org_kind_set_at with the org", async () => {
    const { client, calls } = createFakeSupabase({
      org_memberships: { data: [{ org_id: "o1", role: "admin", organizations: { id: "o1", name: "A", slug: "a", status: "active", is_demo: false, org_kind: "staffing", org_kind_set_at: null } }], error: null },
    });
    const rows = await fetchMyMemberships(asSupabase(client), "u1");
    expect(rows[0].organizations?.org_kind).toBe("staffing");
    const select = calls.find((c) => c.table === "org_memberships" && c.method === "select");
    expect(String(select?.args[0])).toContain("org_kind");
    expect(String(select?.args[0])).toContain("org_kind_set_at");
  });

  it("setOrgKind calls the set_org_kind rpc", async () => {
    const { client, calls } = createFakeSupabase({ "rpc:set_org_kind": { data: null, error: null } });
    await setOrgKind(asSupabase(client), "o1", "staffing");
    expect(calls).toContainEqual({ table: "rpc:set_org_kind", method: "rpc", args: [{ p_org: "o1", p_kind: "staffing" }] });
  });

  it("setOrgKind throws on rpc error", async () => {
    const { client } = createFakeSupabase({ "rpc:set_org_kind": { data: null, error: { message: "Forbidden" } } });
    await expect(setOrgKind(asSupabase(client), "o1", "staffing")).rejects.toMatchObject({ message: "Forbidden" });
  });
});
```

```ts
// src/data/platform.orgKind.test.ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchAllOrgs, provisionOrg } from "./platform";

describe("platform data: org_kind", () => {
  it("fetchAllOrgs selects org_kind", async () => {
    const { client, calls } = createFakeSupabase({ organizations: { data: [], error: null } });
    await fetchAllOrgs(asSupabase(client));
    const select = calls.find((c) => c.table === "organizations" && c.method === "select");
    expect(String(select?.args[0])).toContain("org_kind");
  });

  it("provisionOrg forwards org_kind when given and omits it otherwise", async () => {
    const invoked: unknown[] = [];
    const client = {
      functions: { invoke: (_n: string, opts: { body: unknown }) => { invoked.push(opts.body); return Promise.resolve({ data: { org_id: "o9" }, error: null }); } },
    };
    await provisionOrg(asSupabase(client), { name: "A", slug: "a", adminEmail: "a@x.com", appOrigin: "https://app", orgKind: "staffing" });
    expect(invoked[0]).toMatchObject({ org_kind: "staffing" });
    await provisionOrg(asSupabase(client), { name: "A", slug: "a", adminEmail: "a@x.com", appOrigin: "https://app" });
    expect(invoked[1]).not.toHaveProperty("org_kind");
  });
});
```

If `createFakeSupabase`'s `calls` entries use a different shape than `{ table, method, args }`, read `src/test/supabaseFake.ts` lines 100 to 170 and match its recorded shape; the assertion intent is unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/data/orgs.orgKind.test.ts src/data/platform.orgKind.test.ts`
Expected: FAIL (`setOrgKind` not exported; select strings lack `org_kind`; body lacks `org_kind`).

- [ ] **Step 3: Implement**

In `src/data/orgs.ts`:

```ts
import { coerceOrgKind, type OrgKind } from "@/lib/orgKind";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  is_demo: boolean;
  /** Workspace type. Drives vocabulary and presentation only (src/lib/orgKind.ts). */
  org_kind: OrgKind;
  /** When the kind was explicitly chosen; null while still on the default. */
  org_kind_set_at: string | null;
}
```

Change the select to `"org_id, role, organizations ( id, name, slug, status, is_demo, org_kind, org_kind_set_at )"` and normalise the kind at the boundary:

```ts
  const rows = (data ?? []) as unknown as Membership[];
  return rows.map((m) => (m.organizations
    ? { ...m, organizations: { ...m.organizations, org_kind: coerceOrgKind(m.organizations.org_kind) } }
    : m));
```

Append:

```ts
/** Set the org's workspace type (admin-only RPC; super-admins pass). Stamps org_kind_set_at. */
export async function setOrgKind(
  client: SupabaseClient<Database>,
  orgId: string,
  kind: OrgKind,
): Promise<void> {
  const { error } = await client.rpc("set_org_kind", { p_org: orgId, p_kind: kind });
  if (error) throw error;
}
```

In `src/data/platform.ts`: add `org_kind: OrgKind;` to `OrgStat` (import `type OrgKind`, `coerceOrgKind` from `@/lib/orgKind`); in `fetchPlatformOrgStats` map `org_kind: coerceOrgKind(row.org_kind)` at the boundary cast; in `fetchAllOrgs` select `"id, name, slug, status, is_demo, org_kind, org_kind_set_at"` and map `org_kind` through `coerceOrgKind`; in `provisionOrg` add `orgKind?: OrgKind` to args and `...(args.orgKind ? { org_kind: args.orgKind } : {})` to the body.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/data && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS. Fix any test in `src/` that builds an `Organization` literal without the two new fields (grep `is_demo: false` under `src/` and add `org_kind: "production", org_kind_set_at: null`).

- [ ] **Step 5: Commit**

```bash
git add src/data src/test
git commit -m "carry org_kind on org rows and add setOrgKind data access

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: `useOrgKind` hook

**Files:**
- Create: `src/hooks/useOrgKind.ts`
- Create: `src/hooks/useOrgKind.test.tsx`

**Interfaces:**
- Produces: `useOrgKind(): OrgKind` (production while `currentOrg` is null).

- [ ] **Step 1: Write the failing test**

```tsx
// src/hooks/useOrgKind.test.tsx
import { describe, it, expect } from "vitest";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { useOrgKind } from "./useOrgKind";

const org = { id: "o1", name: "A", slug: "a", status: "active", is_demo: false, org_kind: "staffing" as const, org_kind_set_at: null };

describe("useOrgKind", () => {
  it("returns the current org's kind", () => {
    const { result } = renderHookWithProviders(() => useOrgKind(), { authOverrides: { currentOrg: org } });
    expect(result.current).toBe("staffing");
  });
  it("falls back to production with no org", () => {
    const { result } = renderHookWithProviders(() => useOrgKind(), { authOverrides: { currentOrg: null } });
    expect(result.current).toBe("production");
  });
});
```

If `renderWithProviders.tsx` exports the hook renderer under a different name, use that name (it re-exports `renderHook`; check its bottom 20 lines).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/hooks/useOrgKind.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/hooks/useOrgKind.ts
import { useAuth } from "@/features/auth/AuthContext";
import { DEFAULT_ORG_KIND, type OrgKind } from "@/lib/orgKind";

/** The active org's workspace type. Production while no org is resolved (cold load,
 *  public pages), mirroring useFeature's registry-default fallback. Presentation
 *  decisions branch on this; vocabulary flows through VocabularyBridge instead. */
export function useOrgKind(): OrgKind {
  const { currentOrg } = useAuth();
  return currentOrg?.org_kind ?? DEFAULT_ORG_KIND;
}
```

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/hooks/useOrgKind.test.tsx`
Expected: PASS.

```bash
git add src/hooks/useOrgKind.ts src/hooks/useOrgKind.test.tsx
git commit -m "add useOrgKind hook

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: `VocabularyBridge` and i18next default variables

**Files:**
- Create: `src/features/i18n/vocabulary.ts` (pure: `applyVocabulary(i18n, kind, lang)`)
- Create: `src/features/i18n/vocabulary.test.ts`
- Create: `src/features/i18n/VocabularyBridge.tsx`
- Create: `src/features/i18n/VocabularyBridge.test.tsx`
- Modify: `src/i18n/index.ts:106` (seed `defaultVariables` at init)
- Modify: `src/components/layout/AppLayout.tsx` (mount the bridge)

**Interfaces:**
- Produces: `applyVocabulary(i18n: i18n, kind: OrgKind, lang: Lang): boolean` (returns whether the table changed); `<VocabularyBridge />` (renders null).

Facts this relies on (verified in `node_modules/i18next@23.16.8/dist/esm/i18next.js`): the Translator reads `this.options.interpolation.defaultVariables` on every `t()` call (lines 689, 711, 841) and `options` is the same object as `i18n.options`, so mutating it at runtime takes effect on the next render. `changeLanguage` always emits `languageChanged` (line 2155), and react-i18next's `useTranslation` re-renders on that event, even when the language is unchanged.

- [ ] **Step 1: Write the failing pure test**

```ts
// src/features/i18n/vocabulary.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import i18n from "@/i18n";
import { applyVocabulary } from "./vocabulary";
import { VOCABULARY } from "@/lib/orgKind";

describe("applyVocabulary", () => {
  beforeEach(() => {
    i18n.addResourceBundle("en", "vocabTest", { line: "Add your first {{show}} for {{Artists}}" }, true, true);
    i18n.addResourceBundle("de", "vocabTest", { line: "Lege dein erstes {{show}} für {{Artists}} an" }, true, true);
    applyVocabulary(i18n, "production", "en");
  });

  it("resolves variables from the production table by default", () => {
    expect(i18n.t("vocabTest:line")).toBe("Add your first show for Artists");
  });

  it("swaps to the staffing table", () => {
    expect(applyVocabulary(i18n, "staffing", "en")).toBe(true);
    expect(i18n.t("vocabTest:line")).toBe("Add your first project for People");
  });

  it("reports no change when the same table is applied twice", () => {
    applyVocabulary(i18n, "staffing", "en");
    expect(applyVocabulary(i18n, "staffing", "en")).toBe(false);
  });

  it("explicit t() variables win over the defaults", () => {
    applyVocabulary(i18n, "staffing", "en");
    expect(i18n.t("vocabTest:line", { show: "gig" })).toBe("Add your first gig for People");
  });

  it("installs the table for the given language", () => {
    applyVocabulary(i18n, "staffing", "de");
    expect(i18n.options.interpolation?.defaultVariables).toEqual(VOCABULARY.staffing.de);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/i18n/vocabulary.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the pure helper and seed init**

```ts
// src/features/i18n/vocabulary.ts
import type { i18n as I18n } from "i18next";
import type { Lang } from "@/i18n/config";
import { VOCABULARY, type OrgKind } from "@/lib/orgKind";

/**
 * Install the (kind, lang) vocabulary as i18next's interpolation.defaultVariables.
 * The Translator reads that object on every t() call, so mutating it is enough for
 * the next render; VocabularyBridge triggers that render. Returns true when the
 * installed table actually changed, so callers can skip the re-render nudge.
 */
export function applyVocabulary(i18n: I18n, kind: OrgKind, lang: Lang): boolean {
  const next = VOCABULARY[kind][lang];
  const interpolation = (i18n.options.interpolation ??= {});
  if (interpolation.defaultVariables === next) return false;
  interpolation.defaultVariables = next;
  return true;
}
```

In `src/i18n/index.ts`, import `VOCABULARY` and `DEFAULT_ORG_KIND` from `@/lib/orgKind` and `detectInitialLang` is already imported; change the init line to:

```ts
  interpolation: { escapeValue: false, defaultVariables: VOCABULARY[DEFAULT_ORG_KIND][detectInitialLang()] },
```

(Compute `const initialLang = detectInitialLang();` once above `init` and use it for both `lng` and the table.)

- [ ] **Step 4: Run the pure test**

Run: `npx vitest run src/features/i18n/vocabulary.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing bridge test**

```tsx
// src/features/i18n/VocabularyBridge.test.tsx
import { describe, it, expect, beforeAll } from "vitest";
import { useTranslation } from "react-i18next";
import { screen, act } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { VocabularyBridge } from "./VocabularyBridge";
import type { Organization } from "@/data/orgs";

function Probe() {
  const { t } = useTranslation("vocabTest");
  return <p data-testid="probe">{t("line")}</p>;
}

const org = (kind: Organization["org_kind"]): Organization =>
  ({ id: "o1", name: "A", slug: "a", status: "active", is_demo: false, org_kind: kind, org_kind_set_at: null });

describe("VocabularyBridge", () => {
  beforeAll(() => {
    i18n.addResourceBundle("en", "vocabTest", { line: "Your {{Artists}}" }, true, true);
    i18n.addResourceBundle("de", "vocabTest", { line: "Deine {{Artists}}" }, true, true);
  });

  it("renders staffing words for a staffing org and re-renders consumers on change", async () => {
    const { rerender } = renderWithProviders(
      <><VocabularyBridge /><Probe /></>,
      { authOverrides: { currentOrg: org("production") } },
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("Your Artists");

    await act(async () => {
      rerender(<><VocabularyBridge /><Probe /></>, { authOverrides: { currentOrg: org("staffing") } });
    });
    expect(await screen.findByText("Your People")).toBeInTheDocument();
  });

  it("follows the active language", async () => {
    renderWithProviders(<><VocabularyBridge /><Probe /></>, { authOverrides: { currentOrg: org("staffing") } });
    await act(async () => { await i18n.changeLanguage("de"); });
    expect(await screen.findByText("Deine Personen")).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage("en"); });
  });
});
```

If `renderWithProviders`'s `rerender` does not accept new options, wrap the probe in a small stateful harness component that toggles `currentOrg` through an `AuthContext.Provider` from `@/features/auth/AuthContext` (the test-only provider `renderWithProviders` uses is the real context object).

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/features/i18n/VocabularyBridge.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 7: Implement the bridge and mount it**

```tsx
// src/features/i18n/VocabularyBridge.tsx
import { useLayoutEffect } from "react";
import i18n from "@/i18n";
import { isLang } from "@/i18n/config";
import { useLanguage } from "@/features/i18n/LanguageContext";
import { useOrgKind } from "@/hooks/useOrgKind";
import { applyVocabulary } from "./vocabulary";

/**
 * Keeps i18next's default interpolation variables in step with the active org's
 * workspace type and the active language, so every `{{noun}}` in the locale files
 * reads in that org's vocabulary with no per-component wiring. When the table
 * changes, re-announcing the current language makes react-i18next re-render every
 * useTranslation consumer (i18next emits languageChanged unconditionally).
 */
export function VocabularyBridge(): null {
  const kind = useOrgKind();
  const { lang } = useLanguage();
  useLayoutEffect(() => {
    const effective = isLang(i18n.language) ? i18n.language : lang;
    if (applyVocabulary(i18n, kind, effective)) void i18n.changeLanguage(effective);
  }, [kind, lang]);
  return null;
}
```

Check `LanguageContext.tsx` for the exact field name of the current language in `LanguageState` (`lang` per the research; adjust if different).

In `src/components/layout/AppLayout.tsx`, import `{ VocabularyBridge } from '@/features/i18n/VocabularyBridge'` and render `<VocabularyBridge />` as the first child inside the component's returned root element (next to where the force-English `useLayoutEffect` lives, so both language concerns sit together).

- [ ] **Step 8: Run the bridge test, the whole i18n folder, and AppLayout tests**

Run: `npx vitest run src/features/i18n src/i18n src/components/layout`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/i18n src/i18n/index.ts src/components/layout/AppLayout.tsx
git commit -m "add vocabulary bridge feeding org_kind nouns to i18next

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: Noun-scanner ratchet test

**Files:**
- Create: `src/i18n/vocabularyLint.test.ts`

**Interfaces:**
- Produces: a CI test that counts bare domain nouns in the English locale files and fails if the count grows above a pinned baseline. PR 2 drives the baseline to 0 and turns it into an allowlist.

- [ ] **Step 1: Write the test with a placeholder baseline of 0**

```ts
// src/i18n/vocabularyLint.test.ts
import { describe, it, expect } from "vitest";
import { resources } from "@/i18n";

/**
 * Ratchet: the number of bare domain nouns in English copy may never grow. PR 2 (copy
 * audit) drives BASELINE to 0 by replacing nouns with {{vocabulary}} variables, then this
 * file switches to an explicit allowlist. Until then, any new hardcoded "show", "artist",
 * "production", "cast", "understudy" or "hire order" fails CI.
 */
const BASELINE = 0; // set to the measured count in Step 2, never raise it afterwards

const NOUN = /\b(shows?|artists?|productions?|casts?|understud(?:y|ies)|hire orders?)\b/gi;
// Proper nouns and phrases that are not vocabulary.
const IGNORE = [/ShowFlow/g];

function strings(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === "string") out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) strings(v, path ? `${path}.${k}` : k, out);
}

describe("vocabulary ratchet", () => {
  it("bare domain nouns in English copy do not exceed the baseline", () => {
    const out: Array<[string, string]> = [];
    for (const [ns, tree] of Object.entries(resources.en)) strings(tree, ns, out);
    const hits: string[] = [];
    for (const [path, text] of out) {
      let cleaned = text;
      for (const re of IGNORE) cleaned = cleaned.replace(re, "");
      const n = (cleaned.match(NOUN) ?? []).length;
      if (n > 0) hits.push(`${path} (${n})`);
    }
    const total = hits.reduce((s, h) => s + Number(h.match(/\((\d+)\)$/)?.[1] ?? 0), 0);
    expect(total, `bare nouns grew past the baseline. Offenders:\n${hits.join("\n")}`).toBeLessThanOrEqual(BASELINE);
  });
});
```

- [ ] **Step 2: Run it, read the measured total, pin the baseline**

Run: `npx vitest run src/i18n/vocabularyLint.test.ts`
Expected: FAIL with `expected N to be less than or equal to 0`. Set `BASELINE = N` (the number from the failure message).

- [ ] **Step 3: Run again**

Run: `npx vitest run src/i18n/vocabularyLint.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/vocabularyLint.test.ts
git commit -m "add bare-noun ratchet test for locale copy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: `provision-org` edge function accepts `org_kind`

**Files:**
- Modify: `supabase/functions/provision-org/index.ts:11-45`
- Modify: `supabase/functions/provision-org/index.di.test.ts` (append tests)

**Interfaces:**
- Consumes: `isOrgKind` from `../_shared/orgKind.ts`.
- Produces: request body `org_kind?: "production" | "staffing"`; forwarded as `p_org_kind` to the `provision_org` RPC; `400 { error: "Invalid workspace type" }` on an unknown value.

- [ ] **Step 1: Write the failing tests** (append to `index.di.test.ts`, reusing its `body` const and the super-admin `tables` seed from the existing "net-new admin" test)

```ts
Deno.test("provision-org: forwards org_kind to the rpc", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { ...body, org_kind: "staffing" } }), deps);
  assertEquals(res.status, 200);
  const rpc = calls.find((c) => c.table === "rpc:provision_org");
  assertEquals((rpc?.args?.[0] as { p_org_kind?: string })?.p_org_kind, "staffing");
});

Deno.test("provision-org: defaults org_kind to production when omitted", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  const rpc = calls.find((c) => c.table === "rpc:provision_org");
  assertEquals((rpc?.args?.[0] as { p_org_kind?: string })?.p_org_kind, "production");
});

Deno.test("provision-org: 400 on unknown org_kind", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { ...body, org_kind: "circus" } }), deps);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Invalid workspace type");
});
```

Check how `calls` records RPC invocations in `testing.ts` (`createFakeClient`, grep `rpc`); if the recorded key differs from `"rpc:provision_org"`, match it.

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/provision-org/`
Expected: the three new tests FAIL.

- [ ] **Step 3: Implement**

In `index.ts`: add `org_kind?: string;` to `Body`; import `{ isOrgKind, DEFAULT_ORG_KIND } from "../_shared/orgKind.ts"`; after the role check add:

```ts
    const orgKind = body?.org_kind ?? DEFAULT_ORG_KIND;
    if (!isOrgKind(orgKind)) return json({ error: "Invalid workspace type" }, 400);
```

and pass `p_org_kind: orgKind` in the `.rpc("provision_org", { ... })` call. If the generated `provision_org.Args` type in `_shared/database.types.ts` does not accept `p_org_kind`, re-run Task 1 Step 5 (types were regenerated before the migration was applied).

- [ ] **Step 4: Run the whole edge suite for this function and typecheck**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/provision-org/ && deno check --node-modules-dir=none supabase/functions/provision-org/index.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/provision-org
git commit -m "accept org_kind in provision-org

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: i18n keys for the pickers (EN + DE)

**Files:**
- Modify: `src/i18n/locales/en/settings.json` (`organization` block)
- Modify: `src/i18n/locales/de/settings.json`
- Modify: `src/i18n/locales/en/getRunningV3.json` (`steps`, `body`, `guide`)
- Modify: `src/i18n/locales/de/getRunningV3.json`

**Interfaces:**
- Produces keys: `settings:organization.kind.label`, `.help`, `.saved`; `getRunningV3:steps.workspace.title`, `.hint`; `getRunningV3:body.workspace.heading`, `.sub`, `.continue`, `.readOnly`; `getRunningV3:guide.workspace.title`, `.body`, `.points[3]`, `.article`.

Apply any wording the owner changed in Task 0.

- [ ] **Step 1: Add the English keys**

`settings.json`, inside `organization` after `language`:

```json
"kind": {
  "label": "Workspace type",
  "help": "Changes the words the app uses. Nothing about your data changes.",
  "saved": "Workspace type updated"
}
```

`getRunningV3.json`: in `steps`, before `source`:

```json
"workspace": {
  "title": "Choose your workspace type",
  "hint": "Live production or staffing agency. Sets the words the app uses."
}
```

In `body`, before `source`:

```json
"workspace": {
  "heading": "What kind of workspace is this",
  "sub": "Pick one. You can change it later in Settings.",
  "continue": "Continue",
  "readOnly": "Ask an admin to choose the workspace type."
}
```

In `guide`, before `source`:

```json
"workspace": {
  "title": "Choose your workspace type",
  "body": "The type decides the words you see everywhere: shows and artists for a live production, projects and people for a staffing agency. It never changes your data.",
  "points": [
    "Live production: shows, dates, artists and casts.",
    "Staffing agency: clients, shifts, staff and teams.",
    "Switch any time in Settings, Organization."
  ],
  "article": "Read more about workspace types"
}
```

- [ ] **Step 2: Add the German keys** (same positions)

`settings.json`:

```json
"kind": {
  "label": "Arbeitsbereich-Typ",
  "help": "Ändert die Wörter, die die App verwendet. An deinen Daten ändert sich nichts.",
  "saved": "Arbeitsbereich-Typ aktualisiert"
}
```

`getRunningV3.json` steps:

```json
"workspace": {
  "title": "Wähle deinen Arbeitsbereich-Typ",
  "hint": "Live-Produktion oder Personalagentur. Legt die Wörter fest, die die App verwendet."
}
```

body:

```json
"workspace": {
  "heading": "Was für ein Arbeitsbereich ist das",
  "sub": "Wähle einen. Du kannst ihn später in den Einstellungen ändern.",
  "continue": "Weiter",
  "readOnly": "Bitte einen Admin, den Arbeitsbereich-Typ zu wählen."
}
```

guide:

```json
"workspace": {
  "title": "Wähle deinen Arbeitsbereich-Typ",
  "body": "Der Typ bestimmt die Wörter, die du überall siehst: Shows und Artists für eine Live-Produktion, Projekte und Personen für eine Personalagentur. Deine Daten ändern sich dadurch nie.",
  "points": [
    "Live-Produktion: Shows, Termine, Artists und Besetzungen.",
    "Personalagentur: Kunden, Schichten, Teammitglieder und Teams.",
    "Du kannst jederzeit unter Einstellungen, Organisation wechseln."
  ],
  "article": "Mehr über Arbeitsbereich-Typen lesen"
}
```

- [ ] **Step 3: Run the copy gates**

Run: `npx vitest run src/i18n`
Expected: PASS (key parity, copy lint, translation completeness, vocabulary ratchet). If `translationCompleteness.test.ts` flags a DE string identical to EN (for example `"Team"`), that is not the case here; if it flags anything else, reword the German rather than allowlisting.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales
git commit -m "add workspace type picker copy in en and de

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: `OrgKindSelect` component

**Files:**
- Create: `src/components/settings/OrgKindSelect.tsx`
- Create: `src/components/settings/OrgKindSelect.test.tsx`

**Interfaces:**
- Produces: `<OrgKindSelect id value onChange disabled? />` where `value: OrgKind`, `onChange(kind: OrgKind)`. Labels from `ORG_KIND_LABELS[kind][lang]`, language from `useLanguage()`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/settings/OrgKindSelect.test.tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { OrgKindSelect } from "./OrgKindSelect";

describe("OrgKindSelect", () => {
  it("shows the current kind's title and lists both kinds with descriptions", async () => {
    const onChange = vi.fn();
    renderWithProviders(<OrgKindSelect id="k" value="production" onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Live production");
    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("option", { name: /staffing agency/i })).toBeInTheDocument();
    expect(screen.getByText(/clients, shifts, staff and teams/i)).toBeInTheDocument();
  });

  it("calls onChange with the picked kind", async () => {
    const onChange = vi.fn();
    renderWithProviders(<OrgKindSelect id="k" value="production" onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: /staffing agency/i }));
    expect(onChange).toHaveBeenCalledWith("staffing");
  });

  it("is disabled when told so", () => {
    renderWithProviders(<OrgKindSelect id="k" value="production" onChange={() => {}} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
```

Radix Select in jsdom: if `fireEvent.click` does not open the listbox, use `fireEvent.keyDown(trigger, { key: "ArrowDown" })` or `userEvent` as other Select tests in `src/components/settings` do (grep `role("option"` for the established pattern).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/OrgKindSelect.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```tsx
// src/components/settings/OrgKindSelect.tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/features/i18n/LanguageContext";
import { ORG_KINDS, ORG_KIND_LABELS, coerceOrgKind, type OrgKind } from "@/lib/orgKind";

interface Props {
  id: string;
  value: OrgKind;
  onChange: (kind: OrgKind) => void;
  disabled?: boolean;
}

/** The one Workspace type picker, reused by Settings, Get running and the Platform dialogs.
 *  Titles and descriptions come from the registry (ORG_KIND_LABELS), not from a locale file,
 *  so the edge mirror and the app can never disagree about what a kind is called. */
export function OrgKindSelect({ id, value, onChange, disabled }: Props): JSX.Element {
  const { lang } = useLanguage();
  return (
    <Select value={value} onValueChange={(v) => onChange(coerceOrgKind(v))} disabled={disabled}>
      <SelectTrigger id={id}><SelectValue /></SelectTrigger>
      <SelectContent>
        {ORG_KINDS.map((kind) => (
          <SelectItem key={kind} value={kind}>
            <span className="flex flex-col">
              <span>{ORG_KIND_LABELS[kind][lang].title}</span>
              <span className="text-xs text-muted-foreground">{ORG_KIND_LABELS[kind][lang].desc}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: Run, lint, commit**

Run: `npx vitest run src/components/settings/OrgKindSelect.test.tsx && npx eslint src/components/settings/OrgKindSelect.tsx --max-warnings 0`
Expected: PASS.

```bash
git add src/components/settings/OrgKindSelect.tsx src/components/settings/OrgKindSelect.test.tsx
git commit -m "add OrgKindSelect picker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: Settings, Organization: Workspace type field

**Files:**
- Modify: `src/components/settings/OrganizationTab.tsx`
- Modify: `src/components/settings/OrganizationTab.test.tsx`

**Interfaces:**
- Consumes: `setOrgKind` (Task 3), `OrgKindSelect` (Task 9), `refreshOrgs` from `useAuth`.

- [ ] **Step 1: Write the failing tests** (append; extend the existing `useAuth` mock's `currentOrg` with `is_demo: false, org_kind: "production", org_kind_set_at: null`, and mock `setOrgKind` beside `renameOrg` in the `@/data/orgs` mock)

```tsx
  it("shows the workspace type and saves a change through setOrgKind, then refreshes orgs", async () => {
    renderWithProviders(<OrganizationTab />);
    const select = screen.getByLabelText(/workspace type/i);
    expect(select).toHaveTextContent(/live production/i);
    fireEvent.click(select);
    fireEvent.click(await screen.findByRole("option", { name: /staffing agency/i }));
    await waitFor(() => expect(setOrgKind).toHaveBeenCalledWith(expect.anything(), "org-1", "staffing"));
    await waitFor(() => expect(refreshOrgs).toHaveBeenCalled());
  });

  it("disables the workspace type picker when readOnly", () => {
    renderWithProviders(<OrganizationTab readOnly />);
    expect(screen.getByLabelText(/workspace type/i)).toBeDisabled();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/settings/OrganizationTab.test.tsx`
Expected: the two new tests FAIL.

- [ ] **Step 3: Implement**

In `OrganizationTab.tsx`: import `{ renameOrg, setOrgKind } from "@/data/orgs"`, `{ OrgKindSelect } from "./OrgKindSelect"`, `type { OrgKind } from "@/lib/orgKind"`. Add after `langMutation`:

```tsx
  const kindMutation = useMutation({
    mutationFn: (kind: OrgKind) => setOrgKind(supabase, currentOrg!.id, kind),
    onSuccess: async () => {
      await refreshOrgs(); // currentOrg.org_kind feeds VocabularyBridge; refresh so words swap at once
      toast.success(t("organization.kind.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
```

Render, after the `</form>` and before the language block (so the field is always visible, not entitlement-gated):

```tsx
        <div className="space-y-1.5 max-w-md mt-8">
          <Label htmlFor="org-kind">{t("organization.kind.label")}</Label>
          <OrgKindSelect
            id="org-kind"
            value={currentOrg.org_kind}
            onChange={(k) => kindMutation.mutate(k)}
            disabled={readOnly || kindMutation.isPending}
          />
          <p className="text-xs text-muted-foreground">{t("organization.kind.help")}</p>
        </div>
```

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/components/settings/OrganizationTab.test.tsx && npx eslint src/components/settings/OrganizationTab.tsx --max-warnings 0`
Expected: PASS.

```bash
git add src/components/settings/OrganizationTab.tsx src/components/settings/OrganizationTab.test.tsx
git commit -m "add workspace type field to settings organization tab

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 11: Platform console: new-org and edit-org dialogs, org table

**Files:**
- Modify: `src/components/platform/NewOrgDialog.tsx`
- Modify: `src/components/platform/EditOrgDialog.tsx`
- Modify: `src/components/platform/OrganizationsTab.tsx:80-100`
- Modify or create tests: `src/components/platform/NewOrgDialog.test.tsx`, `src/components/platform/EditOrgDialog.test.tsx` (extend if they exist, else create with the same mocking pattern as `OrganizationTab.test.tsx`)

**Interfaces:**
- Consumes: `provisionOrg(..., { orgKind })`, `setOrgKind`, `OrgStat.org_kind`, `OrgKindSelect`.

- [ ] **Step 1: Write the failing tests**

NewOrgDialog: mock `@/data/platform`'s `provisionOrg` as a `vi.fn`; render, open the dialog, fill name/slug/email, pick "Staffing agency" in the picker labelled "Workspace type", submit, and assert `provisionOrg` was called with `expect.objectContaining({ orgKind: "staffing" })`. Also assert that with no pick, the call has `orgKind: "production"`.

EditOrgDialog: mock `@/data/orgs`'s `setOrgKind`; render with `org={{ org_id: "o1", name: "A", slug: "a", status: "active", member_count: 0, active_artist_count: 0, bookings_30d: 0, last_activity_at: null, is_demo: false, org_kind: "production" }}`; pick "Staffing agency"; assert `setOrgKind` called with `("o1", "staffing")` and that the `["platform"]` query was invalidated (spy on `queryClient.invalidateQueries` via the `queryClient` option of `renderWithProviders`).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/platform`
Expected: new tests FAIL.

- [ ] **Step 3: Implement NewOrgDialog**

Add `orgKind: z.enum(["production", "staffing"])` to `schema`, `orgKind: "production"` to `defaultValues`, `orgKind: v.orgKind` to the `provisionOrg` call, and this field after the Role select:

```tsx
          <div className="space-y-1.5">
            <Label htmlFor="new-org-kind">Workspace type</Label>
            <OrgKindSelect id="new-org-kind" value={form.watch("orgKind")} onChange={(k) => form.setValue("orgKind", k)} />
          </div>
```

(Platform console copy is English-only by design, matching the rest of the dialog.)

- [ ] **Step 4: Implement EditOrgDialog**

Import `setOrgKind` from `@/data/orgs` and `OrgKindSelect`. Add:

```tsx
  const kindMutation = useMutation({
    mutationFn: (kind: OrgKind) => setOrgKind(supabase, org!.org_id, kind),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform"] }); toast.success("Workspace type updated"); },
    onError: (e: Error) => toast.error(e.message),
  });
```

Render after the Slug field, inside the form but as a standalone control (it saves on change, not on Save):

```tsx
          <div className="space-y-1.5">
            <Label htmlFor="e-kind">Workspace type</Label>
            <OrgKindSelect id="e-kind" value={org?.org_kind ?? "production"} onChange={(k) => kindMutation.mutate(k)} disabled={kindMutation.isPending} />
            <p className="text-xs text-muted-foreground">Saves immediately. Changes the words the org sees, never its data.</p>
          </div>
```

- [ ] **Step 5: Show the kind in the Organizations table**

In `OrganizationsTab.tsx`, add a `<TableHead>Type</TableHead>` after Status and a cell rendering `ORG_KIND_LABELS[o.org_kind].en.title` (import from `@/lib/orgKind`). Keep the existing DEMO badge where it is.

- [ ] **Step 6: Run, lint, commit**

Run: `npx vitest run src/components/platform && npx eslint src/components/platform --max-warnings 0 && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

```bash
git add src/components/platform
git commit -m "add workspace type to platform org dialogs and table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 12: Get running: `workspace` step

**Files:**
- Modify: `src/lib/getRunning/steps.ts` (`GetRunningStepKey`, `GetRunningInputV3`, `composeGetRunningV3`)
- Modify: `src/lib/getRunning/steps.test.ts` (counts 16 to 17, 11 to 12, hidden-steps 3 to 4; add a workspace test)
- Modify: `src/hooks/useGetRunningV3.ts` (feed `orgKindChosen`)
- Create: `src/components/getRunning/v3/steps/WorkspaceStep.tsx`
- Create: `src/components/getRunning/v3/steps/WorkspaceStep.test.tsx`
- Modify: `src/components/getRunning/v3/stepRegistryV3.tsx` (case `"workspace"`)
- Modify: `src/components/getRunning/v3/stepRegistryV3.test.tsx` (one case)
- Modify: any board test asserting "of 16" or the step list (grep `"source"` in `src/components/getRunning/v3/*.test.tsx` and `src/hooks/useGetRunningV3.test.tsx`)

**Interfaces:**
- Produces: step key `"workspace"`, first step of the `get_dates` phase, `done: input.orgKindChosen`, never hidden, `adminOnly: true` (only admins may change the kind; producers see it read-only). New input field `orgKindChosen: boolean` (from `currentOrg.org_kind_set_at != null`).

- [ ] **Step 1: Update the composer tests first**

In `steps.test.ts`: add `orgKindChosen: true` to `base`. Change `toBe(16)` to `toBe(17)` and `toHaveLength(16)` to `17`; `toBe(11)` to `12`; the hidden-steps assertion `toBe(3)` to `4`. Add:

```ts
  it("puts the workspace step first in get_dates, done only once the kind was chosen, admin-only", () => {
    const m = composeGetRunningV3({ ...base, orgKindChosen: false });
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    expect(dates.steps[0].key).toBe("workspace");
    expect(dates.steps[0].done).toBe(false);
    expect(dates.steps[0].adminOnly).toBe(true);
    expect(m.nextStep).toEqual({ phase: "get_dates", key: "workspace" });
    const chosen = composeGetRunningV3({ ...base, orgKindChosen: true });
    expect(chosen.phases[0].steps[0].done).toBe(true);
  });

  it("the workspace step does not block the first offer", () => {
    const m = composeGetRunningV3({ ...base, orgKindChosen: false });
    expect(m.canFirstOffer).toBe(true);
  });
```

Run: `npx vitest run src/lib/getRunning/steps.test.ts`
Expected: FAIL (type error on `orgKindChosen`, counts off by one).

- [ ] **Step 2: Implement in the composer**

Add `| "workspace"` as the first member of `GetRunningStepKey`. Add to `GetRunningInputV3`:

```ts
  /** organizations.org_kind_set_at is non-null: an admin or super-admin explicitly chose the
   *  workspace type. The default is a kind too, so this is a "was it decided" signal, like
   *  feeDone for an inherited platform default. */
  orgKindChosen: boolean;
```

In `composeGetRunningV3`, first entry of `getDatesConfigs`:

```ts
      { key: "workspace", done: input.orgKindChosen, block: null, adminOnly: true, placeholder: false, capability: false },
```

Verify `canFirstOffer` is computed from `block`-bearing steps only (read the function body below the phases); with `block: null` the step is advisory. If `canFirstOffer` instead reads every `get_dates` step's `done`, exclude `"workspace"` there explicitly with a comment.

Run: `npx vitest run src/lib/getRunning/steps.test.ts`
Expected: PASS.

- [ ] **Step 3: Feed the input from the hook**

In `useGetRunningV3.ts` add `orgKindChosen: currentOrg?.org_kind_set_at != null,` to the `input` literal. Update `src/hooks/useGetRunningV3.test.tsx` if it asserts the step list or counts.

- [ ] **Step 4: Write the failing step-body test**

```tsx
// src/components/getRunning/v3/steps/WorkspaceStep.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const setOrgKind = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/data/orgs", async (orig) => ({ ...(await orig<typeof import("@/data/orgs")>()), setOrgKind: (...a: unknown[]) => setOrgKind(...a) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const h = vi.hoisted(() => ({ admin: true }));
vi.mock("@/features/auth/AuthContext", async (orig) => ({
  ...(await orig<typeof import("@/features/auth/AuthContext")>()),
  useAuth: () => ({
    currentOrg: { id: "org-1", name: "A", slug: "a", status: "active", is_demo: false, org_kind: "production", org_kind_set_at: null },
    refreshOrgs: () => Promise.resolve(),
    hasRole: (r: string) => (h.admin ? true : r === "producer"),
  }),
}));

import { WorkspaceStep } from "./WorkspaceStep";

describe("WorkspaceStep", () => {
  beforeEach(() => { vi.clearAllMocks(); h.admin = true; });

  it("preselects the org's kind, saves the pick and calls onDone", async () => {
    const onDone = vi.fn();
    renderWithProviders(<WorkspaceStep orgId="org-1" onDone={onDone} />);
    expect(screen.getByRole("radio", { name: /live production/i })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /staffing agency/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(setOrgKind).toHaveBeenCalledWith(expect.anything(), "org-1", "staffing"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("saves the default too, so the step counts as decided", async () => {
    const onDone = vi.fn();
    renderWithProviders(<WorkspaceStep orgId="org-1" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(setOrgKind).toHaveBeenCalledWith(expect.anything(), "org-1", "production"));
  });

  it("is read-only for a producer", () => {
    h.admin = false;
    renderWithProviders(<WorkspaceStep orgId="org-1" onDone={() => {}} />);
    expect(screen.getByRole("radio", { name: /live production/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /continue/i })).not.toBeInTheDocument();
    expect(screen.getByText(/ask an admin/i)).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/components/getRunning/v3/steps/WorkspaceStep.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 5: Implement the step body** (mirrors `SourceStep.tsx`)

```tsx
// src/components/getRunning/v3/steps/WorkspaceStep.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useLanguage } from "@/features/i18n/LanguageContext";
import { setOrgKind } from "@/data/orgs";
import { ORG_KINDS, ORG_KIND_LABELS, DEFAULT_ORG_KIND, type OrgKind } from "@/lib/orgKind";
import { WizardFooterAction } from "@/components/getRunning/v3/WizardFooterAction";
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The `workspace` step body (first step of Get dates in): pick the workspace type.
 * Preselects the org's stored kind; Continue always saves (even the default) because the
 * step's done signal is "an admin decided", not "the value differs from the default".
 * Admin-only: producers see the choice read-only with a note, like SourceStep's readOnly.
 */
export function WorkspaceStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const { lang } = useLanguage();
  const { currentOrg, refreshOrgs, hasRole } = useAuth();
  const canChoose = hasRole("admin");
  const [selected, setSelected] = useState<OrgKind | null>(null);
  const active: OrgKind = selected ?? currentOrg?.org_kind ?? DEFAULT_ORG_KIND;

  const save = useMutation({
    mutationFn: (kind: OrgKind) => setOrgKind(supabase, orgId as string, kind),
    onSuccess: async () => { await refreshOrgs(); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const continueButton = (
    <Button type="button" size="sm" disabled={!orgId || save.isPending} onClick={() => save.mutate(active)}>
      {t("body.workspace.continue")}
    </Button>
  );

  return (
    <div data-testid="step-body-workspace" className="space-y-3">
      <RadioGroup
        value={active}
        onValueChange={(v) => setSelected(v as OrgKind)}
        aria-label={t("body.workspace.heading")}
        className="gap-2"
      >
        {ORG_KINDS.map((kind) => (
          <Card key={kind} className={cn("px-3 py-2.5", active === kind && "border-primary ring-1 ring-primary", !canChoose && "opacity-60")}>
            <label htmlFor={`workspace-${kind}`} className={cn("flex items-start gap-2.5", canChoose ? "cursor-pointer" : "cursor-not-allowed")}>
              <RadioGroupItem id={`workspace-${kind}`} value={kind} disabled={!canChoose} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="text-control font-medium text-foreground">{ORG_KIND_LABELS[kind][lang].title}</span>
                <span className="text-xs text-muted-foreground">{ORG_KIND_LABELS[kind][lang].desc}</span>
              </span>
            </label>
          </Card>
        ))}
      </RadioGroup>
      {canChoose ? <WizardFooterAction>{continueButton}</WizardFooterAction> : <p className="text-xs text-muted-foreground">{t("body.workspace.readOnly")}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Register the step**

In `stepRegistryV3.tsx`: import `WorkspaceStep` and add before `case "source"`:

```tsx
    case "workspace":
      return <WorkspaceStep orgId={orgId} onDone={onDone} />;
```

In `stepRegistryV3.test.tsx` add:

```tsx
  it("renders WorkspaceStep for the workspace key", () => {
    renderStep(mk("workspace", false));
    expect(screen.getByTestId("step-body-workspace")).toBeInTheDocument();
  });
```

`stepHeadingKeys` needs no change: `workspace` is not source-aware, so the default `body.workspace.heading` / `guide.workspace.points` keys apply (added in Task 8).

- [ ] **Step 7: Run every Get running test**

Run: `npx vitest run src/lib/getRunning src/hooks/useGetRunningV3.test.tsx src/hooks/useGetRunning.test.tsx src/components/getRunning && npx eslint src/components/getRunning/v3/steps/WorkspaceStep.tsx --max-warnings 0`
Expected: PASS. Fix any board test whose expected step order or "Step x of y" count shifted by one; those are legitimate updates, not regressions.

- [ ] **Step 8: Commit**

```bash
git add src/lib/getRunning src/hooks/useGetRunningV3.ts src/hooks/useGetRunningV3.test.tsx src/components/getRunning
git commit -m "add workspace type step to get running

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 13: Playwright smoke: Settings picker round-trip

**Files:**
- Create: `e2e/org-kind.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
/**
 * Workspace type: an org admin changes the kind in Settings, Organization; the value
 * persists across a reload and is written to organizations.org_kind. Pins the bootstrap
 * org back to production afterwards so no other spec sees a staffing org.
 */
import { expect, test } from "@playwright/test";
import { adminClient } from "./helpers/supabase";
import { BOOTSTRAP_ORG_ID } from "./helpers/users";
import { loginAsAndAwaitDashboard, navViaSidebar } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from "./global-setup";

async function setKind(kind: "production" | "staffing"): Promise<void> {
  const { error } = await adminClient().from("organizations").update({ org_kind: kind, org_kind_set_at: null }).eq("id", BOOTSTRAP_ORG_ID);
  if (error) throw error;
}

test.describe.configure({ mode: "serial" });

test.describe("Workspace type", () => {
  test.beforeAll(async () => { await setKind("production"); });
  test.afterAll(async () => { await setKind("production"); });

  test("admin switches the org to staffing in Settings and it persists", async ({ page }) => {
    await seedConsent(page);
    await loginAsAndAwaitDashboard(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    await navViaSidebar(page, /^settings$/i);
    await page.getByRole("tab", { name: /^organization\b/i }).click();

    const picker = page.getByLabel(/workspace type/i);
    await expect(picker).toContainText(/live production/i);
    await picker.click();
    await page.getByRole("option", { name: /staffing agency/i }).click();
    await expect(page.getByText(/workspace type updated/i)).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: /^organization\b/i }).click();
    await expect(page.getByLabel(/workspace type/i)).toContainText(/staffing agency/i);

    const { data } = await adminClient().from("organizations").select("org_kind, org_kind_set_at").eq("id", BOOTSTRAP_ORG_ID).single();
    expect(data?.org_kind).toBe("staffing");
    expect(data?.org_kind_set_at).not.toBeNull();
  });
});
```

Check `seedConsent`'s signature in `e2e/helpers/consent.ts` and the exact Settings tab name (grep `role("tab"` in `src/pages/SettingsPage.tsx`); adjust the two locators if they differ.

- [ ] **Step 2: Run it against the local stack**

Run: `npm run local:up && npx playwright test --config=e2e/playwright.config.ts e2e/org-kind.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/org-kind.spec.ts
git commit -m "add e2e smoke for workspace type setting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 14: Docs

**Files:**
- Modify: `CLAUDE.md` (architecture tree: add `orgKind.ts` under `lib/`, `useOrgKind` under `hooks/`, `VocabularyBridge` under `features/i18n/`; Key files table: a row for `src/lib/orgKind.ts` beside the entitlements/capabilities rows; the Edge functions bullet for `provision-org` mentions `org_kind`)
- Modify: `docs/adr/README.md` "Key decisions" list: one bullet, "Workspace type (`org_kind`) is a column on `organizations`, vocabulary via i18next default variables, spec link"
- Modify: `docs/ui-conventions.md`: one rule under copy: "Domain nouns in locale files are `{{vocabulary}}` variables from `src/lib/orgKind.ts`, never bare words (ratchet in `vocabularyLint.test.ts`)"

- [ ] **Step 1: Make the edits** in the style of the surrounding text (no dashes).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md docs/adr/README.md docs/ui-conventions.md
git commit -m "document workspace type registry and vocabulary rule

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 15: Full verification, push, PR

- [ ] **Step 1: Run the fast gate**

Run: `npm run verify:fast`
Expected: lint, three typechecks, build, unit with coverage, Deno all PASS. Fix anything that fails in the task that owns it, then re-run.

- [ ] **Step 2: Run the full gate**

Run: `npm run verify:full`
Expected: pgTAP and Playwright PASS.

- [ ] **Step 3: Confirm nothing visible changed for a production org**

Run: `npm run dev`, open the app as the seeded admin, walk Today, Dates, Artists, Settings. Every label reads as before. The only new things are the Workspace type field in Settings, Organization, the Workspace type step at the top of Get running, and the Type column in Platform, Organizations.

- [ ] **Step 4: Push and open the PR**

Write the PR body to a file (never a heredoc) and open it:

```bash
git push -u origin claude/industry-use-case-flag-b9e00e
gh pr create --title "workspace type (org_kind): mechanism, pickers, vocabulary bridge" --body-file "<scratchpad>/pr-body.md"
```

PR body: link the spec, summarise the five pieces (column + RPC, registry + mirror, hook + bridge, ratchet test, four pickers), state "No customer-visible copy changes in this PR; changelog lands with PR 3", "Help center impact: none yet (PR 3)", "Page mini: none (no new route)", and note the migration adds two nullable-safe columns with defaults so it is safe on merge. End with the required `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line.

- [ ] **Step 5: Ask the owner for review.** The owner approves and merges; never self-approve.
