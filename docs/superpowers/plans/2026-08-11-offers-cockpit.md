# Offers Cockpit (design 1e) + Direct-book refresh (1h) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the show-date cockpit **Offers** tab so it names the cast an offer targets (with a live headcount and named exclusions), shows a computed required-skills card with per-slot provenance, and renders a show-specific tier ladder with per-tier match counts; add a per-date "drop a show skill" capability; and refresh the direct-book list copy (1h).

**Architecture:** Additive, RELABEL-first (owner decision): the offer unit stays a **tier number** and the existing `open-offer-tier`/`close-offer-tier` engine is unchanged. Everything new is either (a) a new **read** the frontend computes from already-readable tables (tier→cast map, per-tier headcounts), (b) an additive field on the `open-offer-tier` dry-run response (named exclusions), (c) one genuinely new model capability — **per-date skill drops** — behind the same `booking_flow` entitlement, or (d) UI/copy. Per-slot provenance is read from Plan B's `show_slots`/`show_slot_required_skills`.

**Tech Stack:** React 18 + Vite + TS, Tailwind + shadcn, react-query v5, react-hook-form + zod, Supabase (Postgres + RLS + triggers + Deno edge functions).

## Dependencies & parallelizability

- **Plan A** (skills catalog, PR #262) and **Plan B** (named production slots, `claude/production-slots-1g`) should both be merged to `main` before Plan C **executes**; rebase this branch on the merged `main` first.
- **Phase gating (important for scheduling):**
  - **C0 (per-date skill drops), C1 (tier→cast + counts), C2 (named exclusions edge), C4 (1h refresh)** depend on NEITHER Plan A nor Plan B — they build on existing tables. They can be built in parallel with Plan B (on this branch or their own), and each is independently testable.
  - **C3 (Offers-tab UI assembly)** is the only phase that consumes Plan B (per-slot provenance via `useShowSlots`/`fetchShowSlots`) and folds in C0/C1/C2. It must land after Plan B and after C0-C2.
- **Do NOT** dispatch two implementation subagents against the same branch in parallel (SDD rule). Parallelism across phases means separate branches/worktrees that merge cleanly, not concurrent writers on one branch.

## Global Constraints

- **Copy:** no em/en dashes anywhere (use period, comma, colon, middot `·`); arrows are fine. All new user-facing strings match the design's exact wording (see each task).
- **Styling:** semantic tokens only (`bg-surface`, `text-muted-foreground`, `border-line`, `text-accent-700`, `text-amber-600`, `text-green-600`, etc.); the accent numbered stops (`accent-50`..`900`) do NOT take Tailwind opacity modifiers.
- **TypeScript:** `any` is a lint error (CI `--max-warnings 0`). For joined Supabase rows, define a local row `interface` and cast once at the query boundary (`as unknown as Row[]`), confined to `src/data/**` / hook `queryFn`s / `supabase/functions/**`.
- **Data access:** every Supabase read/write is a `fetchX(client, args)` / `mutateX(client, args)` in `src/data/<domain>.ts`; hooks are thin wrappers over the `supabase` singleton; test with `createFakeSupabase` from `src/test/supabaseFake.ts` (never `vi.mock` the client). Pure derivations live in `src/lib/**` and are unit-tested with no Supabase/React.
- **Query keys:** hierarchical `['domain', 'sub', ...params]`; mutations invalidate the whole domain prefix (`['bookings']`, `['offer-tiers', ...]`, `['eligibility', ...]`). Never list individual sub-keys in a mutation.
- **New tenant tables:** RLS enabled; SELECT `is_org_member(auth.uid(), org_id)`, writes `has_org_role(auth.uid(), org_id, ...)`; RESTRICTIVE `org_isolation` policy in the **plain `is_org_member(auth.uid(), org_id)` form on USING + WITH CHECK — NO active-org write conjunct** (the #216 regression); a `derive_org_id_*` BEFORE-INSERT trigger; a `check_..._same_org` guard; mirror `20260715130000_configurable_eligibility.sql` (the `show_date_required_skills` migration) exactly.
- **Booking engine gating:** the Offers cockpit and this whole plan live behind the `booking_flow` entitlement (already true for the Offers tab). New edge behavior re-checks `requireFeature(org, 'booking_flow')`; new RLS follows the module's existing pattern.
- **Eligibility twins:** the required-skills union is computed in TWO places — `src/data/eligibility.ts` (`fetchRequiredSkillIds`, frontend) and `supabase/functions/_shared/eligibility.ts` (`fetchRequiredSkillIds`, edge). They are NOT in the mirror manifest (different runtimes/clients), so any change to the union math MUST be made in BOTH by hand in the same PR, with matching tests on each side.
- **Migrations** apply on merge to `main`; never hand-apply. `SECURITY DEFINER` functions pin `search_path` and are `REVOKE`d from `public, anon, authenticated` when they mutate.

---

## File Structure

**New files:**
- `supabase/migrations/<ts>_show_date_skill_drops.sql` — the per-date skill-drop table (C0).
- `supabase/tests/show_date_skill_drops_rls.test.sql` — RLS/guard pgTAP (C0).
- `src/data/tierLadder.ts` — `fetchTierCastMap`, `fetchTierLadderCounts` (C1).
- `src/data/tierLadder.test.ts` — supabaseFake tests (C1).
- `src/hooks/useTierLadder.ts` — `useTierCastMap`, `useTierLadderCounts` (C1).
- `src/lib/offerTarget.ts` — `resolveNextOfferTarget`, `castAwareOfferConfirmCopy`, `nextOfferButtonLabel` (C1/C2/C3).
- `src/lib/offerTarget.test.ts` — unit tests (C1/C2/C3).
- `src/components/shows/date/RequiredSkillsCard.tsx` — the Offers-tab "SKILLS REQUIRED ON THIS DATE" card (C3).
- `src/components/shows/date/NextOfferHero.tsx` — the named next-offer hero (C3).
- `src/components/shows/date/TierLadder.tsx` — the show-specific ladder with counts (C3).
- Co-located `*.test.tsx` for each new component.

**Modified files:**
- `src/data/eligibility.ts` + `supabase/functions/_shared/eligibility.ts` — union becomes `(show ∪ dateAdded) \ dateDropped` (C0).
- `src/components/shows/date/RequiredSkillsSection.tsx` — add "drop this show skill on this date" control + strikethrough render (C0).
- `supabase/functions/open-offer-tier/index.ts` + its Deno test — add `excludedDetail: {id,name,reason}[]` to the response (C2).
- `src/data/bookings.ts` — `DryRunResult` gains `excludedDetail`; `offerConfirmCopy` gains a cast-aware path (C2/C3).
- `src/lib/bookingCockpit.ts` — `computeHeaderCta` names the cast when the next tier is a single cast (C3).
- `src/components/shows/date/TierTimeline.tsx` — host `NextOfferHero` + `TierLadder`; keep the AlertDialog open/close mechanics (C3).
- `src/components/shows/ShowDateDetailSheet.tsx` — mount `RequiredSkillsCard` on the Offers tab; wire the new queries/props (C3).
- `src/components/shows/date/EligibilityBookList.tsx` — 1h copy + skill-narrowing chips with counts (C4).

---

## Phase C0 — Per-date skill drops (model capability)

*Deviation note: the design shows "German · dropped on this date". The current model is additive-only (a date can add but never remove a show-level skill). This phase adds the missing capability. Owner approved building it (2026-08-11). It is independent of Plans A and B.*

### Task C0.1: `show_date_skill_drops` table

**Files:**
- Create: `supabase/migrations/<ts>_show_date_skill_drops.sql`
- Test: `supabase/tests/show_date_skill_drops_rls.test.sql`

**Interfaces:**
- Produces table `public.show_date_skill_drops(id uuid pk default gen_random_uuid(), org_id uuid not null, show_date_id uuid not null references show_dates(id) on delete cascade, skill_id uuid not null references skills(id) on delete cascade, created_at timestamptz not null default now(), unique(show_date_id, skill_id))`.
- Semantics consumed by C0.2: a row means "this show_date does NOT require `skill_id`, even if the parent show does." It only has effect when the skill is a show-level requirement; a drop of a non-required skill is inert.

- [ ] **Step 1:** Write the migration, mirroring `20260715130000_configurable_eligibility.sql`'s `show_date_required_skills` block exactly: table DDL; `alter table ... enable row level security`; SELECT policy `is_org_member(auth.uid(), org_id)`; INSERT/DELETE policies `has_org_role(auth.uid(), org_id, array['admin','producer'])`; RESTRICTIVE `org_isolation` policy with `USING (is_org_member(auth.uid(), org_id))` and `WITH CHECK (is_org_member(auth.uid(), org_id))` (NO active-org conjunct); a `derive_org_id_for_show_date_skill_drop()` BEFORE-INSERT trigger that sets `org_id` from `show_dates.org_id`; a `check_show_date_skill_drop_same_org()` BEFORE INSERT OR UPDATE guard; add the table to `supabase_realtime`.
- [ ] **Step 2:** pgTAP `show_date_skill_drops_rls.test.sql` (mirror `show_slots_rls.test.sql`): assert RLS is enabled; a member of org A can INSERT a drop for a show_date in org A and cannot for org B; org_id is auto-derived (insert without org_id, assert it equals the show_date's org); the same-org guard rejects a cross-org `skill_id`; the `unique(show_date_id, skill_id)` holds.
- [ ] **Step 3:** Run pgTAP (RED first — table missing), then GREEN. **Step 4:** Commit.

### Task C0.2: union becomes `(show ∪ dateAdded) \ dateDropped` (both twins)

**Files:**
- Modify: `src/data/eligibility.ts` (`fetchRequiredSkillIds`) + `src/data/eligibility.test.ts`
- Modify: `supabase/functions/_shared/eligibility.ts` (`fetchRequiredSkillIds`) + its Deno test.

**Interfaces:**
- `fetchRequiredSkillIds(client, {showId, showDateId})` unchanged signature, new behavior: returns `showSkillIds ∪ dateAddedSkillIds` **minus** the `skill_id`s in `show_date_skill_drops` for `showDateId`. Consumed unchanged by every current caller (the gate, the edge waterfall).

- [ ] **Step 1 (frontend, test-first):** In `src/data/eligibility.test.ts` add a case: show requires {Vocals, German}, date adds {Stage combat}, date drops {German} → required = {Vocals, Stage combat}. Use `createFakeSupabase` returning rows for `show_required_skills`, `show_date_required_skills`, `show_date_skill_drops`.
- [ ] **Step 2:** Run it (FAIL — drops not read).
- [ ] **Step 3:** Implement: add a `show_date_skill_drops` read keyed on `showDateId`, subtract its `skill_id`s from the union. Keep the `Set` return contract. Only subtract when `showDateId` is provided (show-only callers pass no date → no drops).
- [ ] **Step 4:** Run FE test (PASS).
- [ ] **Step 5 (edge twin, test-first):** Mirror the same case in the edge `_shared/eligibility.ts` Deno test using `makeFakeDeps`/the fake admin client; then implement the identical subtraction in the edge `fetchRequiredSkillIds`. Run `deno test` (PASS). The two implementations differ only in client mechanics; the set math is identical — state that in a comment on both.
- [ ] **Step 6:** Commit both twins + both tests together.

### Task C0.3: data-access + hook for drops

**Files:**
- Modify: `src/data/eligibility.ts` — add `addShowDateSkillDrop(client, {showDateId, skillId})` and `removeShowDateSkillDrop(client, {showDateId, skillId})` (mirror `addShowDateRequiredSkill`/`removeShowDateRequiredSkill` at `eligibility.ts:123-139`); add `fetchShowDateSkillDrops(client, showDateId): Promise<string[]>`.
- Modify: `src/hooks/` — extend the existing required-skills hook (or add `useShowDateSkillDrops`) with the drop mutations; query key `['eligibility', 'date-skill-drops', showDateId]`; mutations invalidate `['eligibility']` (whole domain) so the gate, the required-skills card, and headcounts all refresh.
- Test: `src/data/eligibility.test.ts` additions.

- [ ] **Step 1:** Test-first for `addShowDateSkillDrop` (asserts an insert to `show_date_skill_drops` with `{show_date_id, skill_id}`) and `removeShowDateSkillDrop` (delete with both eqs) and `fetchShowDateSkillDrops`.
- [ ] **Step 2:** Run (FAIL). **Step 3:** Implement. **Step 4:** Run (PASS). **Step 5:** Commit.

### Task C0.4: RequiredSkillsSection — drop a show skill on this date

**Files:**
- Modify: `src/components/shows/date/RequiredSkillsSection.tsx` (+ `.test.tsx`).

**Behavior:** inherited (show-level) chips (`RequiredSkillsSection.tsx:26-32`) get a small "drop on this date" control (an `X` / minus, admin/producer only). A dropped show-level skill renders in the design's dashed strikethrough style (`border-dashed border-line-strong text-text-faint line-through`, with a non-struck `added on this date`-style sublabel reading `dropped on this date`). Dropping calls `addShowDateSkillDrop`; un-dropping calls `removeShowDateSkillDrop`. Date-added chips keep their existing remove behavior (they are removed via `removeShowDateRequiredSkill`, not dropped).

- [ ] **Step 1:** Test-first (`.test.tsx`, bare RTL per house style for this component): render with an inherited skill + a drops set including it → assert the strikethrough chip + `dropped on this date`; clicking "drop" on an un-dropped inherited chip calls the drop mutation with that `skillId`; clicking on a dropped chip restores it.
- [ ] **Step 2:** Run (FAIL). **Step 3:** Implement (thread `droppedSkillIds` + `onDrop`/`onRestore` props from `ShowDateDetailSheet`, which owns the query/mutations). **Step 4:** Run (PASS). **Step 5:** Commit.

---

## Phase C1 — Tier→cast resolver + per-tier headcounts (frontend)

*Independent of Plans A/B. Builds the data the named hero + ladder need. Mirrors the Deno-only `resolveTierLadder`/`ladderCastIdsAtTier` (`_shared/eligibility.ts:19-46`) on the client from already-readable tables.*

### Task C1.1: `fetchTierCastMap`

**Files:**
- Create: `src/data/tierLadder.ts` + `src/data/tierLadder.test.ts`.

**Interfaces:**
- Produces `fetchTierCastMap(client, {showId, cityId}): Promise<TierCast[]>` where `TierCast = { tier: number; casts: { id: string; name: string }[] }`, sorted by `tier` ascending. Resolution mirrors the server: rows from `show_cast_eligibility` for `showId` (select `tier/priority, cast_id`) win outright; else `cast_city_priority` for `cityId`; join `casts` for names (reuse `fetchCasts`, `casts.ts:26-35`). A tier with multiple `cast_id`s at the same priority yields multiple `casts` (the multi-cast case).
- Consumed by C1.2 (`resolveNextOfferTarget`) and C1.3 (`fetchTierLadderCounts`).

- [ ] **Step 1:** Test-first with `createFakeSupabase`: (a) show-scoped rows present → returns those, ignoring city defaults; (b) no show rows → falls back to `cast_city_priority` for the city; (c) two casts sharing priority 2 → `tier:2` has both casts. Assert names are joined.
- [ ] **Step 2:** Run (FAIL). **Step 3:** Implement (extend the `show_cast_eligibility`/`cast_city_priority` reads already patterned in `fetchOfferTiers`, `bookings.ts:40-77`, to also select `cast_id`; define local row interfaces + single cast at the boundary). **Step 4:** Run (PASS). **Step 5:** Commit.

### Task C1.2: `resolveNextOfferTarget` (pure)

**Files:**
- Create: `src/lib/offerTarget.ts` + `src/lib/offerTarget.test.ts`.

**Interfaces:**
- Produces `resolveNextOfferTarget(tierMap: TierCast[], nextTier: number): { kind: 'cast'; tier: number; cast: {id:string;name:string} } | { kind: 'tier'; tier: number }`. Single-cast tier → `kind:'cast'`; multi-cast (or tier 99 ad-hoc, or unknown) → `kind:'tier'`. This is the owner's "name it only when the next tier maps to a single cast, else fall back to the tier label" rule.
- Produces `nextOfferButtonLabel(target, headcount?: number): string` → `Open offers to {cast.name}` + ` (${headcount} artists)` when a headcount is given, else `Open ${target.tier === 99 ? 'ad-hoc casts' : \`tier ${target.tier}\`}` for the tier fallback. No em dashes.

- [ ] **Step 1:** Test-first: single-cast → `kind:'cast'` with the name; two casts at that tier → `kind:'tier'`; tier 99 → `kind:'tier'` with `ad-hoc casts` label; `nextOfferButtonLabel` renders `Open offers to Cast B (7 artists)` and the tier fallback. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

### Task C1.3: `fetchTierLadderCounts` (batch, one read pass)

*Decision (gap 5): compute all tiers' counts in ONE client-side pass from already-readable tables rather than N per-tier dry-run edge calls.*

**Files:**
- Modify: `src/data/tierLadder.ts` (+ tests). Add `src/hooks/useTierLadder.ts`.

**Interfaces:**
- Produces `fetchTierLadderCounts(client, {showId, showDateId, cityId, orgId}): Promise<TierLadderRow[]>` where `TierLadderRow = { tier: number; casts: {id;name}[]; castTotal: number; matchCount: number; missingSkillCount: number; blockedCount: number; alreadyOfferedCount: number }`. Computed by combining: `fetchTierCastMap` (C1.1), `fetchCastMemberCounts` (`casts.ts:38-51`, the `of M` denominator), `cast_members` rows for the tiers' casts, `artists.status='active'`, `fetchRequiredSkillIds` + `fetchSkillEligibleArtistIds` (`eligibility.ts:26-41`, hold-ALL), `fetchBlockedArtistIds` for the date, and existing non-cancelled `bookings` for the date. `matchCount` = active cast members holding all required skills, not blocked, not already booked/offered.
- `useTierCastMap(showId, cityId)` key `['tier-ladder', 'casts', showId, cityId]`; `useTierLadderCounts(...)` key `['tier-ladder', 'counts', showDateId, cityId]`, invalidated by `['bookings']`/`['eligibility']` writes (add `['tier-ladder']` to `REALTIME_INVALIDATIONS` for `bookings`, `blocked_dates`, `show_date_required_skills`, `show_date_skill_drops`).

- [ ] **Step 1:** Test-first with `createFakeSupabase`: a show with Cast A (tier 1, 9 members, 7 match), Cast B (tier 2), Cast C (tier 3, 4 of 11 match, 7 miss a skill) → assert the per-tier `matchCount`/`castTotal`/`missingSkillCount` numbers match the design's example figures. **Step 2:** FAIL. **Step 3:** Implement (fold the individual eligibility pieces; keep it one function so the counts are internally consistent). **Step 4:** PASS. **Step 5:** Commit.

---

## Phase C2 — Named exclusions on the dry-run (edge change)

*Independent of A/B. Additive field; keeps the existing aggregate `excluded` counts so `DryRunDialog` is unaffected.*

### Task C2.1: `open-offer-tier` returns `excludedDetail`

**Files:**
- Modify: `supabase/functions/open-offer-tier/index.ts` (+ its `*.di.test.ts`).

**Interfaces:**
- The dry-run response (`index.ts:249-258`) gains `excludedDetail: { id: string; name: string; reason: 'missing_skills' | 'blocked' | 'already_booked' | 'inactive' | 'not_eligible' }[]`, populated as the elimination waterfall (steps 3-7 in the inventory) drops each artist. The FIRST reason that eliminates an artist wins (waterfall order). Existing aggregate `excluded` counts stay. Cap the array at a sane size (e.g. 50) and include a `excludedDetailTruncated: boolean` — `log()`/return the flag rather than silently truncating.

- [ ] **Step 1:** Test-first (Deno, `makeFakeDeps`): a tier with 2 artists missing a skill + 1 blocked → assert `excludedDetail` contains those 3 with correct `{name, reason}` and the aggregate counts are unchanged. **Step 2:** FAIL. **Step 3:** Implement (collect `{id,name,reason}` at each waterfall step instead of only counting). **Step 4:** `deno test` PASS. **Step 5:** `deno check` the function. **Step 6:** Commit.

### Task C2.2: frontend `DryRunResult.excludedDetail`

**Files:**
- Modify: `src/data/bookings.ts` (`DryRunResult` type + `dryRunOfferTier` mapping, `bookings.ts:95-129`) + `src/data/bookings.test.ts`.

- [ ] **Step 1:** Test-first: the fake `fn:open-offer-tier` returns `excludedDetail`; assert `dryRunOfferTier` surfaces it typed. **Step 2:** FAIL. **Step 3:** Implement (add the field; keep `excluded` counts). **Step 4:** PASS. **Step 5:** Commit.

---

## Phase C3 — Offers-tab cockpit UI (depends on Plan B + C0-C2)

*Rebase on merged `main` (Plans A+B) first. Consumes Plan B's `useShowSlots(showId)` / `fetchShowSlots` (`SlotDraft = {id?, name, count, kind, skillIds}`) for provenance.*

### Task C3.1: `RequiredSkillsCard` (computed skills on the Offers tab)

**Files:**
- Create: `src/components/shows/date/RequiredSkillsCard.tsx` + `.test.tsx`.

**Behavior (design 1e, main column card):** header `SKILLS REQUIRED ON THIS DATE` + subtitle `Computed from the N slots on {show}. Only artists holding all of them can be offered or booked.` One chip per required skill:
- **show-level (inherited) skill:** accent chip, provenance sublabel naming the slots that require it (from Plan B: join the skill to `show_slot_required_skills` → `show_slots.name`, e.g. `Ophelia, Chorus ×2`). Group repeats as `×N`.
- **date-added skill:** amber chip, sublabel `added on this date` (no per-slot provenance — none exists; see the deviation note).
- **dropped show skill (C0):** dashed strikethrough chip, sublabel `dropped on this date`.
Footer: `N changes from the production default` (count date-adds + drops) + a `Reset to computed` button (removes all date-adds and drops for the date) + an `Edit` affordance routing to the Setup tab's date configuration. Provenance and counts are derived, not hard-coded.

- [ ] **Step 1:** Test-first (`renderWithProviders`): given show slots {Main: [Vocals, Stage combat], Chorus×2: [Vocals]}, a show requirement {Vocals}, a date-add {Stage combat}, a date-drop {German} → assert the Vocals chip shows the slot provenance, Stage combat shows `added on this date`, German shows `dropped on this date` struck, and the footer reads `2 changes from the production default`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (a pure `computeRequiredSkillCard(slots, showSkills, dateAdds, dateDrops)` helper in `src/lib/offerTarget.ts` or a new `src/lib/requiredSkills.ts`, unit-tested separately; the component renders it). **Step 4:** PASS. **Step 5:** Commit.

### Task C3.2: `NextOfferHero`

**Files:**
- Create: `src/components/shows/date/NextOfferHero.tsx` + `.test.tsx`.

**Behavior (design 1e, hero card):** eyebrow `NEXT OFFER · TIER {n}`; title = the cast name (or the tier label when `resolveNextOfferTarget` returns `kind:'tier'`); body `{match} of {castTotal} artists in {cast} have {skill list}. {blocked} blocked, {alreadyOffered} already hold a tier {n-1} offer.`; a big right-aligned headcount `{match}` + `GET OFFERS`; an avatar row of up to 4 candidate initials + `Marta Feld, Jonas Trier, …` + `and N more`; an exclusion line `{missingSkill} miss a required skill · {blocked} blocked on this date`; primary button `nextOfferButtonLabel(target, match)`; `See the {match} artists` (opens the existing candidate list / DryRunDialog); `Narrow this offer` toggling the per-offer extra-requirement skill chips (the existing `skillFilterIds` mechanism, `TierTimeline.tsx:187` → `onOpenTier(tier, skillFilterIds)`). All numbers come from `useTierLadderCounts` for the next tier + `dryRunOfferTier` candidates; nothing hard-coded.

- [ ] **Step 1:** Test-first (`renderWithProviders`, `MemoryRouter`): given a single-cast next tier with match 7 / total 9, 1 blocked, 1 already-offered → assert the title is the cast name, the headcount `7`, the body sentence, and the primary button label `Open offers to Cast B (7 artists)`; a multi-cast next tier → title falls back to `Tier {n}` and the button to `Open tier {n}`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (props: `target`, `counts`, `candidates`, `requiredSkillNames`, `onOpen`, `onNarrow`, `narrowSkillIds`). **Step 4:** PASS. **Step 5:** Commit.

### Task C3.3: `TierLadder`

**Files:**
- Create: `src/components/shows/date/TierLadder.tsx` + `.test.tsx`.

**Behavior (design 1e, ladder card):** header `TIER LADDER · SHOW-SPECIFIC` + `Casts in priority order for {city}`. One timeline row per `TierLadderRow` from `useTierLadderCounts`: opened tiers show `{sent} offers sent · {accepted} accepted · {pending} pending · {declined} declined` (from `fetchOpenedTiers` + booking rows) with a `Close tier` control (existing `closeOfferTier`); the next/unopened tiers show `{match} of {castTotal} artists match` (and `— {missingSkill} miss {skill}` when informative) + a mono count badge. Node styling: opened = filled green, next = accent ring, later = muted. No new engine behavior — `Close tier` and open flow reuse existing mutations.

- [ ] **Step 1:** Test-first: three tiers (opened tier 1 with counts, next tier 2 `7 of 9`, tier 3 `4 of 11`) → assert each row's label + count badge + that only opened tiers render `Close tier`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

### Task C3.4: cast-aware confirm copy + header CTA

**Files:**
- Modify: `src/data/bookings.ts` (`offerConfirmCopy`, `bookings.ts:136-161`) + `src/lib/bookingCockpit.ts` (`computeHeaderCta`, `:240`) + their tests (`src/lib/bookings.test.ts`, `bookingCockpit.headerCta.test.ts`).

**Behavior:** when the tier resolves to a single cast, `offerConfirmCopy` title becomes `Open offers to {cast}?` and the body `{match} of the {castTotal} artists in {cast} get an offer for {dateLabel}. All {match} have {skill list} — the skills this date requires. Offers are emailed the moment the tier opens, and you can cancel any offer afterward.` plus a `Not offered: {name} ({reason}) · …` line built from `excludedDetail` (C2). Multi-cast/ad-hoc falls back to today's `tier {n}`/`ad-hoc casts` noun copy. `computeHeaderCta` renders `Open offers to {cast}` (single cast) else the current `Open tier {n}`. Replace the em dash in the body with a period/colon per the copy rule (the design's dash is illustrative only).

- [ ] **Step 1:** Test-first for both pure functions (single-cast vs multi-cast vs ad-hoc; with and without `excludedDetail`). **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

### Task C3.5: assemble on the Offers tab

**Files:**
- Modify: `src/components/shows/date/TierTimeline.tsx` and `src/components/shows/ShowDateDetailSheet.tsx` (+ update `TierTimeline.test.tsx`, `ShowDateDetailSheet.test.tsx`).

**Behavior:** on the Offers tab (tiered mode, `flow.artist_acceptance`), render `RequiredSkillsCard` + `NextOfferHero` + `TierLadder` in place of the current flat `TierTimeline` body, keeping `TierTimeline`'s AlertDialog open/close mechanics and `DryRunDialog`. Wire the new queries (`useTierCastMap`, `useTierLadderCounts`, `useShowSlots`, drops) in `ShowDateDetailSheet` and pass derived props down. The header CTA uses the cast-aware label. Direct mode (`!flow.artist_acceptance`) is untouched here (see C4).

- [ ] **Step 1:** Update the integration tests for the new Offers-tab structure (assert the three cards mount in tiered mode and the hero's primary button triggers `openOffers.mutate` with the next tier). **Step 2:** FAIL. **Step 3:** Implement the wiring. **Step 4:** Run the sheet tests + `verify:fast`. **Step 5:** Commit.

---

## Phase C4 — Direct-book list refresh (1h)

*Independent of A/B. Small copy + chips change.*

### Task C4.1: `EligibilityBookList` requirement-as-fact + narrowing chips

**Files:**
- Modify: `src/components/shows/date/EligibilityBookList.tsx` (+ `.test.tsx`).

**Behavior (design 1h):** replace the stale `Only offer to artists with` label (`EligibilityBookList.tsx:67` — wrong in direct mode, nothing is offered) with a stated fact `This date requires {skill list} · {qualifying} of {total} artists qualify and are not blocked.` Add a `Narrow the list further` row of skill chips with per-skill counts (reuse the existing skill-filter chips pattern; the count is how many currently-listed artists also hold that skill). The book list + `Book`/`Book and confirm` flow is unchanged. Do NOT touch the `TierTimeline.tsx:187` occurrence of the same string (there it is correct).

- [ ] **Step 1:** Test-first: given required {Vocals, Stage combat} and 7 of 24 qualifying → assert the fact sentence; a narrowing chip shows its count and filters the list on click; assert the string `Only offer to artists with` is absent. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

---

## Phase C5 — Changelog & version (held for owner)

- [ ] Bump `package.json` + `APP_META.VERSION`; add a `public/changelog.md` block (New: named offer targets, computed required-skills card, per-date skill drops, refreshed direct-book list) written for end users; regenerate `changelog.json`. **Do not run until the owner releases the hold** (same policy as Plans A and B).

---

## Self-Review (author checklist — run before handing off)

1. **Spec coverage vs. design 1e/1h:** named cast + headcount (C1/C3.2 ✅), computed skills card + provenance (C3.1 ✅), tier ladder counts (C1.3/C3.3 ✅), named exclusions (C2/C3.4 ✅), "dropped on this date" (C0 ✅), confirm copy (C3.4 ✅), header relabel (C3.4 ✅), 1h refresh (C4 ✅).
2. **Deviations flagged in-plan:** date-added skills never get slot provenance (C3.1 note); per-date drops are a new capability (C0 note); multi-cast tiers fall back to the tier label (C1.2).
3. **Twin-sync:** the eligibility union change is written in BOTH `src/data/eligibility.ts` and `_shared/eligibility.ts` (C0.2) with matching tests.
4. **Type consistency:** `TierCast`/`TierLadderRow`/`DryRunResult.excludedDetail`/`resolveNextOfferTarget` return shape are used identically across C1/C2/C3.
5. **No new engine behavior:** offers still open by tier number; `open-offer-tier`/`close-offer-tier` logic unchanged except the additive `excludedDetail` field.

## Execution handoff

Recommended: subagent-driven-development. Suggested order once Plans A+B are merged: **C0 → C1 → C2 → C4** (all Plan-B-independent, can even run on parallel branches) then **C3** (rebased on merged `main`, folds in C0-C2 + Plan B slots). Hold C5.
