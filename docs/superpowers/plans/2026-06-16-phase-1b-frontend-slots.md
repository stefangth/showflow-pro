# Phase 1b-frontend — Read Slots from `shows` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or :executing-plans. **Environment:** no local Node — `vitest`/`tsc`/`lint` run in **CI only**; verify there. Apply DB/type changes via the Supabase MCP.

**Goal:** Switch the frontend off the retired `app_settings.sub_program_slots_defaults` JSON and onto `shows.main_cast_slots` / `understudy_slots` (added in Phase 1b-DB): read slots from the joined show row, rewrite the scheduling warnings, and replace the JSON slot-editor with a per-show slot editor.

**Architecture:** A pure `showSlots(show)` helper (returns `{main_cast, understudies} | null`, null when either column is `NULL`) replaces `effectiveSlots(defaults, program, subProgram)`. Consumers add the two columns to their `show:shows(...)` select and call `showSlots(row.show)`. `useSubProgramSlots`/`fetchSlotDefaults` and the nested-JSON editor are removed; warnings flag shows with `NULL` slots; the Settings → Scheduling editor becomes a per-show table writing `shows` directly.

**Tech Stack:** React 18 + TS, @tanstack/react-query, Supabase. Tests: vitest (CI) using `src/test/supabaseFake.ts` + `renderWithProviders`.

> Current code for every touch-point is mapped verbatim in the research notes (this session). Where this plan says "replace call X", X is quoted there with file:line.

---

## File Structure

- `src/integrations/supabase/types.ts` — **regenerate** (MCP `generate_typescript_types`) so `shows` includes `main_cast_slots`/`understudy_slots`. Never hand-edit.
- `src/lib/settings.ts` — **add** `showSlots(show)` + reuse `SubProgramSlotConfig`; **rewrite** `computeSchedulingWarnings(shows)`; remove `ProgramPair`/`dedupeProgramPairs` if unused.
- `src/data/settings.ts` — **add** `fetchShowsWithSlots(client, orgId)` + `updateShowSlots(client, showId, main, us)`; **remove** `fetchSlotDefaults`, `fetchProgramSubProgramPairs` (after consumers drop them).
- `src/hooks/useSubProgramSlots.ts` — **delete** (`useSubProgramSlots`, `effectiveSlots`, `NestedSlotDefaults` all dead). Keep `SubProgramSlotConfig` by moving it to `src/lib/settings.ts`.
- `src/hooks/useSettingsWarnings.ts` — **rewrite** to fetch shows-with-slots and call the new `computeSchedulingWarnings`.
- `src/components/shows/ShowDateDetailSheet.tsx` — select + `showSlots(showDate.show)`.
- `src/pages/ShowsBookingsPage.tsx` — select + `displayStatus`/`_computed.slots` use `showSlots(sd.show)`; `ShowDateRow.show` gains the two columns.
- `src/pages/DashboardPage.tsx` — select + `computeRange` uses `showSlots(d.show)`.
- `src/pages/SettingsPage.tsx` — replace `SubProgramSlotsEditor` with `ShowSlotsEditor` (per-show table); drop the `sub_program_slots_defaults` draft key + its `upsertOrgSetting` save.
- Tests: rewrite `src/lib/settings.test.ts` (showSlots + warnings), `src/data/settings.test.ts` (new fns); delete `src/hooks/useSubProgramSlots.test.ts`.
- `CLAUDE.md` — drop `useSubProgramSlots`/`effectiveSlots` from the hooks list; finalize the slot bullet's frontend note.

---

## New units (exact signatures)

```ts
// src/lib/settings.ts
export interface SubProgramSlotConfig { main_cast: number; understudies: number; }   // moved from useSubProgramSlots.ts
export function showSlots(
  show: { main_cast_slots: number | null; understudy_slots: number | null } | null | undefined,
): SubProgramSlotConfig | null {
  if (!show || show.main_cast_slots == null || show.understudy_slots == null) return null;
  return { main_cast: show.main_cast_slots, understudies: show.understudy_slots };
}
export function computeSchedulingWarnings(
  shows: { main_cast_slots: number | null; understudy_slots: number | null }[] | null | undefined,
): SettingsWarnings {
  const n = (shows ?? []).filter(s => s.main_cast_slots == null || s.understudy_slots == null).length;
  return { schedulingWarnings: n, hasAnyWarning: n > 0 };
}
```

```ts
// src/data/settings.ts
export interface ShowWithSlots { id: string; program: string | null; sub_program: string | null; main_cast_slots: number | null; understudy_slots: number | null; }
export async function fetchShowsWithSlots(client, orgId: string | null): Promise<ShowWithSlots[]> {
  const { data, error } = await client.from('shows')
    .select('id, program, sub_program, main_cast_slots, understudy_slots')
    .eq('org_id', orgId).order('program').order('sub_program');
  if (error) throw error; return (data ?? []) as ShowWithSlots[];
}
export async function updateShowSlots(client, showId: string, mainCast: number | null, understudies: number | null): Promise<void> {
  const { error } = await client.from('shows').update({ main_cast_slots: mainCast, understudy_slots: understudies }).eq('id', showId);
  if (error) throw error;
}
```

**`showSlots` semantics:** `NULL` (either column) → `null` → "Unconfigured". An explicit `0/0` is now a *configured* value (no more `0/0→unconfigured` heuristic), matching the DB.

---

## Tasks (commit per task; CI is the gate)

1. **Types + helper + data-access.** Regenerate `types.ts`; add `showSlots`/`SubProgramSlotConfig` + rewrite `computeSchedulingWarnings` in `lib/settings.ts`; add `fetchShowsWithSlots`/`updateShowSlots` in `data/settings.ts`; write `lib/settings.test.ts` (showSlots: null when a col is null, counts when set; warnings: counts null-slot shows) and `data/settings.test.ts` (records the right table/columns/filter/update via the fake client).
2. **Swap the read-path consumers.** `ShowDateDetailSheet`, `ShowsBookingsPage`, `DashboardPage`: add `main_cast_slots, understudy_slots` to each `show:shows(...)` select; replace every `effectiveSlots(slotDefaults, …)` with `showSlots(<row>.show)`; remove the `useSubProgramSlots()` calls; extend the local `show` row types.
3. **Warnings.** Rewrite `useSettingsWarnings` to `fetchShowsWithSlots` + the new `computeSchedulingWarnings` (one query; drop the pairs + slotsSetting queries).
4. **Editor.** Replace `SubProgramSlotsEditor` with `ShowSlotsEditor` in `SettingsPage`: `useQuery(fetchShowsWithSlots)` → a table (program, sub_program, two number inputs) → `useMutation(updateShowSlots)` invalidating its query; empty state when no shows. Remove the `sub_program_slots_defaults` draft key + its save in `saveMutation`.
5. **Cleanup + docs.** Delete `useSubProgramSlots.ts` + its test + `fetchSlotDefaults`/`fetchProgramSubProgramPairs` (now unused); grep `effectiveSlots|useSubProgramSlots|sub_program_slots_defaults|NestedSlotDefaults` → 0 hits in `src/`; update `CLAUDE.md`.

## Verification
No local Node — push and verify in CI: `vitest` (the new lib/data tests), `tsc` typecheck (the type swaps), `lint`, `vite build`. Read failures via `gh run view` / the GitHub checks on PR #98 and fix. Spot-check `react-query` invalidation keys.
