# Skills UX (design 1e–1j) — Master Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: implement each sub-plan with superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the "Skills UX" design (sections 1e–1j) — turn ad-hoc skill chips into a governed skills catalog, named production slots that compute a date's required skills, and an offers cockpit that speaks in casts and headcounts.

**Source of truth:** the imported Claude Design canvas `Skills UX.dc.html` (project `37d253d4-688e-4ac2-9756-d50c22d43cb9`). Section markup is mirrored locally under the session scratchpad (`section-1e.html` … `section-1j.html`) and a stacked render at `design/preview-1e-1j.html`.

**Owner scope decisions (2026-08-11):**
- **Named production slots — build the full model now** (real `show_slots` + per-slot skills; the production's required skills = union of slot skills; rework `compute_show_date_status`, auto-cancel, Airtable sync, and the booking-engine eligibility read). Delivered in staged PRs.
- **Offer targeting — relabel the tier button** (name the cast + a computed reachable headcount when the next tier resolves to a **single** cast; fall back to the tier label for multi-cast tiers). **No** new cast-first offer engine; the offer unit stays a tier number.
- **1i count visibility:** `ArtistProfileSheet` is admin/producer-only today, so the "N upcoming dates" per-skill metadata never reaches an artist. Build it; render it only on admin/producer surfaces; never surface it to an `artist` role. (If a future artist-facing skills editor is added, it must omit the count.)

## Global Constraints (apply to every task in every sub-plan)

- **No em/en dashes in any product/UI copy** (component strings, emails, toasts, changelog). Use period, comma, colon, or middot. Arrows are fine. (Chat/plan prose is exempt.)
- **Semantic tokens only** in components (`bg-background`, `text-primary`, `border-border`, …). Never hardcode `bg-white`/`text-black`. Accent numbered stops (`accent-50`–`900`) do **not** support Tailwind opacity modifiers.
- **Week starts Monday** anywhere a calendar/grid is rendered.
- **Never edit** `supabase/migrations/**` after apply, or `src/integrations/supabase/types.ts` by hand — regenerate types with `supabase gen types typescript` then `npm run sync:mirrors`.
- **Migrations apply on merge.** Do not hand-apply to prod. If applied out of band via MCP, `git mv` the file to the recorded version in the same commit (`scripts/check-migrations.mjs` gate).
- **Data-access pattern:** `fetchX(client, args)` / `mutateX(client, args)` in `src/data/<domain>.ts`; hooks are thin wrappers passing the `supabase` singleton. Test with `src/test/supabaseFake.ts` — never `vi.mock` the client.
- **Query keys:** hierarchical `['domain', 'sub', ...]`; mutations bust the whole domain prefix. Skills domain: `['skills', ...]`.
- **`any` is banned** (CI `--max-warnings 0`). Use an explicit row interface + a single `as unknown as Row[]` cast at the query boundary, confined to `src/data/**` / hook `queryFn`s / `supabase/functions/**`.
- **New tenant tables** need RLS enabled, `is_org_member`/`has_org_role` policies, the RESTRICTIVE `org_isolation` policy, a `derive_org_id_*` BEFORE-INSERT trigger, and `update_updated_at_column()` if they carry `updated_at`.
- **Capability registry** (`src/lib/capabilities.ts`) sentinel block is mirrored to the edge twin — edit the source block, then `npm run sync:mirrors`; keep the SQL twin `public.capability_default()` in sync by hand.
- **Type-checking is three projects:** `tsc -p tsconfig.app.json`, `tsc -p tsconfig.tools.json`, and `deno check` on any edge fn touched. Lint gate is zero-warning. CI runs `vitest run --coverage`.
- **Verify locally** with `npm run verify:fast` (lint/typecheck/build/unit/Deno) before every push; `npm run verify:full` adds pgTAP + Playwright.

---

## Sub-plans and sequencing

Build in this order. Each is a working, testable PR on its own.

### Plan A — Skills lifecycle (1f, 1i, 1j) → `2026-08-11-skills-lifecycle.md`
The skills **catalog** and its two consumers. Independent of slots; lowest risk; ship first.
- **1f** New "Skills" card in Settings → Casts & Cities: create / rename / **archive** / restore / delete-when-unused, with "Artists" and "Required by" usage counts. Adds `skills.archived_at`.
- **1i** `ArtistProfileSheet` skills editor: held skills as violet **rows** (with "N upcoming dates" metadata, admin/producer-only), remaining catalog skills as add-chips, free-text creation removed, "an admin adds it in Settings" helper.
- **1j** `ArtistsPage` roster card: labelled **SKILLS** (violet, cap 3 + "+N") and **CASTS** (hairline) rows.
- Archived skills disappear from every picker (`SkillPicker`, `TagInput`, required-skill editors).

### Plan B — Named production slots (1g) → `2026-08-11-production-slots.md` (authored before Plan B execution)
The foundational data-model change. Introduces `show_slots` (named role rows: name, count, kind main|understudy, sort) and `show_slot_required_skills`. The show's `main_cast_slots`/`understudy_slots` and its required-skill union become **derived from slots** (maintained cache + trigger, so `compute_show_date_status`, auto-cancel, and the booking engine keep reading the same columns/tables). `ShowFormDialog` is rewritten to the slot-row repeater; the flat "Required skills" picker and the two count inputs are removed. Airtable-synced shows keep locked identity fields; slots stay editable. Data backfill: one "Main cast" + one "Understudy" slot per existing show from its current counts, and existing `show_required_skills` seeded onto the main slot.

### Plan C — Offers cockpit (1e) + direct-book refresh (1h) → `2026-08-11-offers-cockpit.md` (authored before Plan C execution)
The `ShowDateDetailSheet` Offers-tab redesign on top of Plans A+B.
- **Skills-required-on-this-date card** with slot provenance ("Ophelia, Chorus ×2"), per-date **add + drop** overrides (new `show_date_removed_skills` mechanism so a date can drop a show-level skill), "N changes from the production default", "Reset to computed".
- **Next-offer hero** naming the next tier's cast + a **computed reachable headcount** (`cast_members ∩ eligibility gate ∩ required skills ∩ ¬blocked ∩ ¬active offer`), avatar preview, blocker breakdown, per-offer-only "narrow" chips (wired to the existing un-persisted `skill_filter_ids`), and a confirm dialog naming the excluded artists.
- **Tier ladder** with per-tier match counts.
- Left-rail "Who can be booked" block.
- **1h** direct-book (`EligibilityBookList`) copy/layout refresh: requirement-as-fact + "N of M qualify", narrow chips.

## Cross-cutting deviations flagged to the owner (recorded)
1. Skills were mint-on-typo; now catalog-governed (producers can no longer invent skills inline — design intent).
2. Per-date skills were additive-only; Plan C adds true drop overrides.
3. Offers target a tier (possibly multi-cast); we relabel with the single-cast name + headcount, engine unchanged.
4. `ArtistProfileSheet` is admin/producer-only; the artist-facing "hide the count" instruction is satisfied by construction.
