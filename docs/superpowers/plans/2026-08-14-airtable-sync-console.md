# Airtable Sync Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stacked-form Settings → Airtable Sync tab with a status-first console (header + KPIs + Overview/Mapping/Catalog/Activity tabs + setup wizard), faithful to the approved design, wired to existing data, plus a poll change so unlinked cities hold their records.

**Architecture:** The `.dc.html` design is a standalone mock; this repo already carries every token it uses (`src/index.css`) and the shadcn primitives. We rebuild the tab's UI with shadcn + semantic Tailwind tokens (never the mock's raw hex), split into focused components under `src/components/settings/airtable/`, orchestrated by a slimmed `AirtableSyncTab.tsx`. Pure view-model helpers derive mode/KPIs/causes from existing React Query data so the logic is unit-testable without rendering. One backend behavior change (poll holds unlinked cities) lands test-first.

**Tech Stack:** React 18 + TS, @tanstack/react-query v5, shadcn/ui (Radix), Tailwind v3 semantic tokens, lucide-react, sonner; Supabase edge (Deno) for the poll; vitest (jsdom) + Deno test.

**Spec:** `docs/superpowers/specs/2026-08-14-airtable-sync-console-design.md`
**Design source of truth (pixel spec):** claude.ai/design `airtable-sync-a-console.dc.html` (variant A). Read its `<x-dc>` template + `renderVals()` for exact copy, order, and per-mode values.

## Global Constraints

- Faithful to `airtable-sync-a-console.dc.html`: layout, hierarchy, copy, the 5 modes (setup/live/healthy/error/readonly), KPI values, tab structure, grouped-cause panel.
- Semantic tokens ONLY (`bg-card` `bg-muted` `text-foreground` `text-muted-foreground` `border-border` + accent/amber/green/red scales). Never hardcode hex in components. Accent numbered stops (`accent-50`–`900`) do NOT support Tailwind opacity modifiers.
- npm only; no new deps. Week starts Monday (n/a here). No em/en dashes in copy (`copyLint`).
- Capability gating exact: `readOnly = !configure_airtable`, `canTriggerSync = trigger_sync`; admins bypass. No RLS/entitlement/capability/Vault changes.
- Data access in `src/data/*` as `fn(client, args)`; hooks are thin wrappers; test with `src/test/supabaseFake.ts` (never `vi.mock` the client). No `any` (lint `--max-warnings 0`).
- Query-key/invalidation contract unchanged: bust whole domains `['bookings']`, `['cities']`, `['shows']`, `['airtable']`, `['custom-field-definitions']`.
- Poll change: test-first (Deno), run the WHOLE `supabase/functions/` suite, update the `airtable-sync-held` email + `docs/system-map.md` + `src/data/systemMap.ts` same PR.
- CI: `npm run lint`, `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, `npm run test:coverage`, `deno check --node-modules-dir=none supabase/functions/airtable-poll/index.ts`.

## Design → app token map (use everywhere; no raw hex in components)

| Design hex | Meaning | App token / class |
|---|---|---|
| `#F6F4EF` | page bg | `bg-background` |
| `#FFFFFF` | card/surface | `bg-card` (`--surface`) |
| `#FAF8F4` | recessed well / input / header strip | `bg-muted` (`--surface-2`) |
| `#EFEDE7` | segmented track / neutral badge | `bg-muted` / `--surface-3` |
| `#E6E3E0` / `--line` | hairline | `border-border` |
| `#15131C` | text | `text-foreground` |
| `#5D5A56` | muted text | `text-muted-foreground` |
| `#8B8A85` | faint text | `text-muted-foreground/70` (neutral, opacity ok on HSL) |
| `#6E5CF6` accent-500 | primary/link/active | `bg-primary text-primary-foreground` / `text-primary` / `bg-accent-500` |
| `#5848D8` accent-600 | eyebrow/hover | `text-accent-600` |
| `#4738B0` accent-700 | accent text/active-nav | `text-accent-700` |
| `#E5DEFF` accent-100 | active tint / accent chip bg | `bg-accent-100` |
| `#CABBFF` accent-200 | accent border | `border-accent-200` |
| `#F4F1FF` accent-50 | accent chip bg (light) | `bg-accent-50` |
| `#16A34A`/`#157F3D`/`#E7F5EC` | green 500/600/100 | `text-green-600` / `bg-green-100` (tokens exist) |
| `#D97706`/`#9A6314`/`#FCF1DA` | amber 500/600/100 | `text-amber-600` / `bg-amber-100` |
| `#DC2626`/`#A02323`/`#FCEAEA` | red 500/600/100 | `text-destructive` / `bg-destructive/10` or `--red-*` |
| `var(--shadow-2)` | card elevation | existing `shadow-sm`/`.shadow-card` (check `index.css`) |
| `var(--font-mono)` tabular | KPI/mono | `font-mono tabular-nums` |

> Note: amber/green use hex-stop tokens (`--amber-600`), so `/opacity` modifiers are inert on them — use the `-100` tint stop, not `-500/10`. Verify the exact utility names exist in `tailwind.config.ts` before use; if `bg-amber-100`/`text-amber-600` aren't exposed as utilities, use inline `style={{ color: 'var(--amber-600)' }}` sparingly for the semantic status tints only (this is the one sanctioned raw-var use, mirroring how the current tab's Badges get their tone).

---

### Task 1: Poll holds records with an unlinked city

**Files:**
- Test: `supabase/functions/airtable-poll/index.cityhold.test.ts` (create)
- Modify: `supabase/functions/airtable-poll/index.ts` (city branch ~479-483, `insert`/`update` outcome `reason` at ~516 & ~538; `HeldReasonCategory`/`categorizeHeldReason`/`topHeldReason` ~151-173)
- Modify: `supabase/functions/_shared/transactional-email-templates/airtable-sync-held.tsx` (type ~12, `topReasonLabel` ~68-72, registry default sample ~140)
- Modify: `supabase/functions/_shared/transactional-email-templates/airtable-sync-held.test.ts` (add unlinked_city case)
- Check for a copy map: `grep -rn "topReasonUnlinkedProgram\|topReasonMissingDate" supabase/functions/_shared` — add a parallel `topReasonUnlinkedCity` key wherever those two live (EMAIL_COPY_DEFAULTS) + its DE twin if present.
- Modify: `docs/system-map.md` + `src/data/systemMap.ts` (airtable-poll node: held causes now include unlinked city)

**Interfaces:**
- Produces (consumed by Task 3's view-model): held record `reason` string `` `city '${name}' not linked` ``; `HeldReasonCategory` gains `"unlinked_city"`.

- [ ] **Step 1: Write the failing edge test**

Create `index.cityhold.test.ts`, mirroring `index.test.ts`'s `seededDeps` (ORG, FIELD_MAP with `city:"City"`, cities map `[{id:"city-berlin", airtable_city_key:"berlin"}]`, the `show_dates` insert spy from lines 80-94). Records:

```ts
const records = [
  // program linked, city "Berlin" resolves -> imported_new
  { id: "rec-ok", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin" } },
  // program linked, city "Paris" present but NOT in the link map -> HELD (new behavior)
  { id: "rec-city", fields: { Date: "2026-06-02", SubProgram: "Magic", City: "Paris" } },
  // program linked, no city value -> still imports (city optional when blank/absent)
  { id: "rec-nocity", fields: { Date: "2026-06-03", SubProgram: "Magic" } },
];
```

Assertions: `insertedPayloads.length === 2` (rec-ok, rec-nocity); `body.held === 1`; fetch the `airtable_sync_record_log` bulk-insert payload (spy the `airtable_sync_record_log` insert like the show_dates spy) and assert one row `{ action:"held_unresolved", airtable_record_id:"rec-city", reason:"city 'Paris' not linked" }`.

- [ ] **Step 2: Run it, verify it fails**

Run: `deno test --allow-all supabase/functions/airtable-poll/index.cityhold.test.ts`
Expected: FAIL (rec-city currently imports; `insertedPayloads.length === 3`, `held === 0`).

- [ ] **Step 3: Implement the hold branch**

In `index.ts`, replace the city-note block (currently ~479-483):

```ts
      const cityNames = fieldMap.city ? resolveNames(fields[fieldMap.city], linkMaps.city) : [];
      const cityRawName = cityNames[0] ?? null;
      const cityKey = buildCityKey(cityRawName);
      const cityId = cityKey ? cityByKey.get(cityKey) ?? null : null;
      // A mapped, non-empty city that doesn't resolve to a linked catalog city holds the
      // record (like an unlinked program) instead of importing it city-less. Blank/absent
      // city, or an unmapped city field, still imports with city_id null.
      if (fieldMap.city && cityRawName && !cityId) {
        held += 1;
        outcomes.push({ airtable_record_id: id, action: "held_unresolved", show_date_id: null, reason: `city '${cityRawName}' not linked`, raw_fields: fields });
        continue;
      }
```

Then at the two success outcomes (update ~516, insert ~538) change `reason: cityNote` → `reason: null` (cityNote no longer exists). Verify no other `cityNote` references remain: `grep -n cityNote supabase/functions/airtable-poll/index.ts` returns nothing.

- [ ] **Step 4: Add the held-reason category**

```ts
type HeldReasonCategory = "missing_date" | "unlinked_program" | "unlinked_city";
function categorizeHeldReason(reason: string | null): HeldReasonCategory | null {
  if (reason === "missing date") return "missing_date";
  if (reason && reason.startsWith("program '") && reason.endsWith("' not linked")) return "unlinked_program";
  if (reason && reason.startsWith("city '") && reason.endsWith("' not linked")) return "unlinked_city";
  return null;
}
```

Rewrite `topHeldReason` to tally all three deterministically (keep missing_date-first tie-break, then unlinked_program, then unlinked_city):

```ts
function topHeldReason(reasons: Array<string | null>): { category: HeldReasonCategory; count: number } | null {
  const counts: Record<HeldReasonCategory, number> = { missing_date: 0, unlinked_program: 0, unlinked_city: 0 };
  for (const r of reasons) { const c = categorizeHeldReason(r); if (c) counts[c] += 1; }
  const order: HeldReasonCategory[] = ["missing_date", "unlinked_program", "unlinked_city"];
  let best: HeldReasonCategory | null = null;
  for (const cat of order) { if (counts[cat] > 0 && (best === null || counts[cat] > counts[best])) best = cat; }
  return best ? { category: best, count: counts[best] } : null;
}
```

Update the doc comment at ~147-151 to list three causes.

- [ ] **Step 5: Run edge test, verify pass**

Run: `deno test --allow-all supabase/functions/airtable-poll/index.cityhold.test.ts`
Expected: PASS.

- [ ] **Step 6: Update the held email template + its test**

In `airtable-sync-held.tsx`: extend the local type to `"missing_date" | "unlinked_program" | "unlinked_city"`; add a branch to `topReasonLabel`:

```tsx
    : isHeld && topReasonCategory === "unlinked_city"
    ? copy["airtable-sync-held.topReasonUnlinkedCity"]
```

Add the `topReasonUnlinkedCity` copy key alongside `topReasonUnlinkedProgram` in EMAIL_COPY_DEFAULTS (grep found the file), e.g. EN `"a city that isn't linked to a ShowFlow city"` (+ DE twin if the map has one; no dashes). Update the registry preview sample if needed. Add a Deno test case in `airtable-sync-held.test.ts` asserting the unlinked_city label renders on the held branch.

- [ ] **Step 7: Update system map**

In `docs/system-map.md` and `src/data/systemMap.ts` find the airtable-poll entry (`systemMap.ts` ~213/794) and amend the held-cause description to include "unlinked city". Keep both in sync (guarded by convention).

- [ ] **Step 8: Run the whole edge suite + type check**

Run: `deno test --allow-all supabase/functions/` then `deno check --node-modules-dir=none supabase/functions/airtable-poll/index.ts supabase/functions/_shared/transactional-email-templates/airtable-sync-held.tsx`
Expected: all PASS (per repo lesson, never trust a single-file run).

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/airtable-poll docs/system-map.md src/data/systemMap.ts supabase/functions/_shared/transactional-email-templates/airtable-sync-held.tsx supabase/functions/_shared/transactional-email-templates/airtable-sync-held.test.ts
git commit -m "feat: hold airtable records whose city isn't linked to a catalog city"
```

---

### Task 2: `fetchRecentSyncLogs` data function

**Files:**
- Modify: `src/data/airtableSync.ts`
- Test: `src/data/airtableSync.test.ts` (add cases)

**Interfaces:**
- Produces: `fetchRecentSyncLogs(client: SupabaseClient<Database>, orgId: string | null, limit?: number): Promise<SyncLogSummary[]>` — org+`sync_type='airtable_poll'` scoped, `synced_at` desc, default limit 10. Returns `[]` when `orgId` null.

- [ ] **Step 1: Write the failing test**

Add to `airtableSync.test.ts` (mirror the existing `fetchLatestSyncLog` cases; `createFakeSupabase({ airtable_sync_log: { data: rows, error: null } })`, `asClient`):

```ts
it("fetchRecentSyncLogs returns [] with no org", async () => {
  const fake = createFakeSupabase({});
  expect(await fetchRecentSyncLogs(asClient(fake), null)).toEqual([]);
});
it("fetchRecentSyncLogs orders by synced_at desc and limits", async () => {
  const rows = [{ id: "a", status: "success", imported_count: 1, new_count: 1, updated_count: 0, held_count: 0, error_details: null, synced_at: "2026-08-14T09:12:00Z" }];
  const fake = createFakeSupabase({ airtable_sync_log: { data: rows, error: null } });
  const out = await fetchRecentSyncLogs(asClient(fake), "org-1", 5);
  expect(out).toHaveLength(1);
  expect(fake.calls).toContainEqual({ table: "airtable_sync_log", method: "order", args: ["synced_at", { ascending: false }] });
  expect(fake.calls).toContainEqual({ table: "airtable_sync_log", method: "limit", args: [5] });
});
```
(Confirm the fake's `calls` recording shape from the existing `admin.test.ts` assertions before finalizing arg matchers.)

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/data/airtableSync.test.ts`
Expected: FAIL (`fetchRecentSyncLogs is not a function`).

- [ ] **Step 3: Implement**

```ts
/** The org's recent airtable_sync_log rows, newest first (Last-N-runs + Activity table). */
export async function fetchRecentSyncLogs(
  client: SupabaseClient<Database>,
  orgId: string | null,
  limit = 10,
): Promise<SyncLogSummary[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("airtable_sync_log")
    .select("id, status, imported_count, new_count, updated_count, held_count, error_details, synced_at")
    .eq("org_id", orgId).eq("sync_type", "airtable_poll")
    .order("synced_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as SyncLogSummary[];
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/data/airtableSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/airtableSync.ts src/data/airtableSync.test.ts
git commit -m "feat: add fetchRecentSyncLogs for the sync console"
```

---

### Task 3: Console view-model (`console.ts` pure helpers)

**Files:**
- Create: `src/components/settings/airtable/console.ts`
- Test: `src/components/settings/airtable/console.test.ts`

**Interfaces:**
- Consumes: `SyncLogSummary` (Task 2), `UnresolvedRecord`, `AirtableSettings`, `AirtableKeyStatus`, `nextSyncAt`/`formatInterval` from `src/lib/airtablePoll.ts`.
- Produces (consumed by Task 5-9 components):
  - `type ConsoleMode = "setup" | "healthy" | "live" | "error" | "readonly"`
  - `deriveMode(args: { keyPresent: boolean; hasBaseTable: boolean; latest: SyncLogSummary | null; readOnly: boolean }): ConsoleMode`
  - `type StatusTone = "green" | "amber" | "red"`
  - `deriveStatus(latest, mode): { tone: StatusTone; headline: string; line: string }`
  - `type Kpi = { label: string; value: string; sub: string; tone: "default" | "green" | "amber" | "red" }`
  - `deriveKpis(latest, settings): Kpi[]` (4 cells: Last run / Next run / Dates in / Held)
  - `type HeldCause = { category: "missing_date"|"unlinked_program"|"unlinked_city"; icon: string; title: string; count: number; records: UnresolvedRecord[] }`
  - `groupHeldCauses(held: UnresolvedRecord[]): HeldCause[]`
  - `requiredMappedCount(fieldMap): { mapped: number; total: number }` (required = date, program, sub_program, city, venue, session_1, session_2; total 9 counts session_3 + one cancellation as in design "8/9" — match the design's denominator; see design `mapRows` = 9 rows incl. "Cancelled when").

- [ ] **Step 1: Write failing tests** — `console.test.ts` covering: `deriveMode` (no key → setup; key but no base/table → setup; readOnly prop → readonly; latest.status "error" → error; held_count 0 + success → healthy; held_count>0 → live); `deriveStatus` headlines match the design strings verbatim (error "Sync is failing", healthy "Syncing normally", live "Syncing, N records held"); `deriveKpis` for a live latest returns 4 cells with mono values and amber Held tone when held>0; `groupHeldCauses` buckets by reason prefix into the 3 categories with counts; `requiredMappedCount` returns `{mapped, total:9}`.

Use exact copy from the design's `renderVals()` (statusHeadline/statusLine/kpis blocks). Reproduce the three-mode `statusLine` strings verbatim.

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/components/settings/airtable/console.test.ts` → FAIL.

- [ ] **Step 3: Implement `console.ts`** — pure functions, no React. Headlines/lines/KPI sub-labels copied verbatim from the design (see design `renderVals`: `statusHeadline`, `statusLine`, `kpis` arrays for error/healthy/live). Map `latest.status` → tone: `error`→red, `success`+held0→green, else amber. `deriveKpis`: Last run = time of `synced_at`; Next run = `nextSyncAt(synced_at, interval)` + `every {formatInterval}`; Dates in = `imported_count` with sub `${new_count} new · ${updated_count} updated`; Held = `held_count` with sub derived from cause count (amber tone when >0, green "all resolved" when 0). No duration (not stored). `groupHeldCauses` icons: missing_date→`calendar`, unlinked_program→`theater`, unlinked_city→`map-pin` (match design `causes`).

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/components/settings/airtable/console.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/airtable/console.ts src/components/settings/airtable/console.test.ts
git commit -m "feat: airtable console view-model (mode/status/kpi/causes)"
```

---

### Task 4: Console shell — StatusHeader + ConsoleTabs + orchestrator routing

**Files:**
- Create: `src/components/settings/airtable/StatusHeader.tsx`, `ConsoleTabs.tsx`
- Modify: `src/components/settings/AirtableSyncTab.tsx` (introduce mode routing + sub-tab state; keep all existing queries/mutations — do NOT delete them yet; render new shell around a temporary passthrough so the app still builds)

**Interfaces:**
- Consumes: Task 3 view-model; existing queries in `AirtableSyncTab` (`keyStatusQ`, `settingsQ`, `syncLogQ`, `syncNow`, `saveState`).
- Produces: `type ConsoleTab = "overview" | "mapping" | "catalog" | "activity"`; `<StatusHeader status kpis saved canWrite onSyncNow syncing />`; `<ConsoleTabs value onChange tabs syncEnabled onToggleSync canWrite />` where `tabs` carries the catalog count badge (held count).

- [ ] **Step 1:** Write `AirtableSyncTab.test.tsx` cases (extend existing file): in live mode the header renders the status headline + a "Sync now" button; the four tab triggers render; clicking a tab switches panel. (Write against the new structure; they fail now.)
- [ ] **Step 2:** Run `npx vitest run src/components/settings/AirtableSyncTab.test.tsx` → FAIL.
- [ ] **Step 3:** Build `StatusHeader.tsx` — Card with eyebrow ("Airtable · <base> › <table>"), status dot (tone→`bg-green-500/bg-amber-500/bg-destructive`), h2 headline, muted summary line; right side "Saved" (reuse the existing `AutosaveStatus` pattern) + primary "Sync now" (`RefreshCw`, gated on `canWrite && canTriggerSync && syncEnabled && keyPresent`); a 4-col KPI grid (border-top, `divide-x`), each cell eyebrow label + mono value + muted sub, tone-colored value. Render structure per design lines (status card + KPI `sc-for`).
- [ ] **Step 4:** Build `ConsoleTabs.tsx` — segmented control (`inline-flex gap-0.5 p-0.5 rounded-md bg-muted`), 4 buttons; active = `bg-card shadow-sm text-foreground`, inactive = `text-muted-foreground`; catalog tab shows an accent count badge when held>0; right side "Sync" label + shadcn `Switch` bound to `airtable_sync_enabled` (disabled when `!canWrite`). Match design tab bar + switch row.
- [ ] **Step 5:** In `AirtableSyncTab.tsx` add `const [tab, setTab] = useState<ConsoleTab>("overview")`, compute `mode` via `deriveMode`, render: readonly banner (if readonly) → setup wizard (if setup) → else `<StatusHeader/>` + `<ConsoleTabs/>` + the active panel (temporarily the OLD card bodies gated by tab, to be replaced in Tasks 6-9). App builds and renders.
- [ ] **Step 6:** Run tests → the Step 1 cases PASS; `npx tsc -p tsconfig.app.json --noEmit` clean.
- [ ] **Step 7:** Commit `feat: airtable console shell (status header + sub-tabs)`.

---

### Task 5: Read-only banner + Setup wizard

**Files:**
- Create: `src/components/settings/airtable/SetupWizard.tsx`, `ReadOnlyBanner.tsx`
- Modify: `AirtableSyncTab.tsx` (wire both)

**Interfaces:**
- Consumes: existing `saveKey` mutation + `airtableKey` state + `keyPresent`; Task 3 mode.
- Produces: `<SetupWizard step={1..4} keyValue onKeyChange onSaveKey saving canWrite />`; `<ReadOnlyBanner />`.

- [ ] **Step 1:** Test: in readonly mode the "View only" banner text renders and no "Sync now"/"Save key" buttons are enabled; in setup mode (no key) the 4-step rail + "Personal access token" pane render. FAIL first.
- [ ] **Step 2:** `ReadOnlyBanner.tsx` — muted bordered row, `Eye` icon, copy from design (mentions `configure_airtable` in a `font-mono` span). 
- [ ] **Step 3:** `SetupWizard.tsx` — card: eyebrow "Airtable · setup", h2 "Connect a base in four steps", intro; two-col grid: left rail `steps` (1 Connect current, 2 Base and table, 3 Map fields, 4 Link catalog) with numbered dots (current = `bg-primary text-primary-foreground`, todo = `bg-card border`), right pane = the token step (password input + "Save and continue" → `saveKey.mutate`) + the airtable.com/create/tokens helper line. Copy verbatim from design. Step 1 is the only interactive step; saving a key advances the org out of setup (mode recomputes to live/healthy on next render).
- [ ] **Step 4:** Wire in `AirtableSyncTab.tsx`. Tests PASS.
- [ ] **Step 5:** Commit `feat: airtable setup wizard + read-only banner`.

---

### Task 6: Overview tab (attention panel + connection + last-5-runs)

**Files:**
- Create: `src/components/settings/airtable/OverviewTab.tsx`, `AttentionPanel.tsx`
- Modify: `AirtableSyncTab.tsx` (render for `tab==="overview"`; add `recentQ = useQuery(['airtable','recent-logs',orgId] , fetchRecentSyncLogs)`)

**Interfaces:**
- Consumes: `groupHeldCauses` (Task 3), `unresolvedQ`, `recentQ`, connection facts (keyStatus.updatedAt, base name from `bases`, table, view, interval), existing `createOneProgram`/`createOneCity`/`linkShow`/`linkCity` mutations, `syncLogQ`.
- Produces: `<OverviewTab .../>` self-contained.

- [ ] **Step 1:** Test: with held records present, "Needs your attention" heading + a "N held" badge render, and each cause title renders; with `mode==="healthy"` (0 held) the all-clear card renders instead. Error banner renders when `mode==="error"`. FAIL first.
- [ ] **Step 2:** Build `AttentionPanel.tsx` — card, header ("Needs your attention" + count + explainer), a row per `HeldCause` (amber icon, title, sub, an optional fix button `Create both shows`/`Create Köln` reusing create mutations when `canWrite`, and a Review/Hide toggle revealing the cause's record rows with per-row Link/Create controls reusing the combobox pattern). Footer line + "Open the full run log" → switches to Activity tab. Copy + icons from design `causes`.
- [ ] **Step 3:** Build `OverviewTab.tsx` — error banner (design `isError` block: red bordered, "The last three runs failed…", "Replace token" → opens Manage-connection key replace); AttentionPanel (when held>0) or all-clear card (green check, design `allClear`); then a 2-col grid: **Connection** card (rows: Token "Saved <date>", Base name, "Table · view", Frequency; "Manage connection" button → Task 10) and **Last 5 runs** card (`recentQ` first 5: dot by status, mono time, "N in · M held" summary). Copy/icons verbatim.
- [ ] **Step 4:** Wire; tests PASS; `tsc` clean.
- [ ] **Step 5:** Commit `feat: airtable overview tab (attention + connection + runs)`.

---

### Task 7: Field mapping tab

**Files:**
- Create: `src/components/settings/airtable/MappingTab.tsx`
- Modify: `AirtableSyncTab.tsx` (render for `tab==="mapping"`)

**Interfaces:**
- Consumes: `SHOWFLOW_FIELDS`, `fieldMap`, `setField`, `selectedTable.fields`, `requiredMappedCount`, `unboundFields`, `addCustom`.

- [ ] **Step 1:** Test: renders "Field mapping" card, the "N/9 required mapped" meter, one row per SHOWFLOW field with a Select bound to `setField`, the cancellation rows, and the "Add as custom fields" affordance listing `unboundFields`. Unmapped required rows show amber. FAIL first.
- [ ] **Step 2:** Build `MappingTab.tsx` — card header with h3 + subtitle + right-aligned `mono` "N / 9 required mapped"; two-column table (ShowFlow field | Airtable column) where each ShowFlow row is a `Select` (reuse the current tab's `NONE` sentinel + `setField`); required-but-unmapped label + trigger get amber tint; include the cancellation mapping rows (status_field / cancelled_value / cancellation_reason_field) exactly as today, presented as "Cancelled when" per design. Footer: "N columns in <table> aren't read by ShowFlow: …" + a single **"Add as custom fields"** button that adds ALL `unboundFields` as custom fields via `addCustom` (design's collapsed affordance; per spec, no per-field type/remove UI here). Guard duplicates like the current `addCustom` onValueChange does.
- [ ] **Step 3:** Wire; tests PASS.
- [ ] **Step 4:** Commit `feat: airtable field-mapping tab`.

---

### Task 8: Catalog links tab

**Files:**
- Create: `src/components/settings/airtable/CatalogTab.tsx`
- Modify: `AirtableSyncTab.tsx` (render for `tab==="catalog"`)

**Interfaces:**
- Consumes: `programRows`/`cityRows` (+`programExisting`/`cityExisting`), link/create/unlink/import mutations, `groupHeldCauses` counts for "holding N", `dupeGroups`+`mergeMut`, `heldByKey` (derive: map held records' program/city key → count, parsed from `reason`).

- [ ] **Step 1:** Test: renders the toolbar (search box, All/Blocking/Linked filter, bulk button), a "Programs · from …" section header, program rows with checkbox + link/create, a "Cities · from City" section, and the München merge suggestion when a dupe exists. Selecting rows enables the bulk "Create N shows" button. FAIL first.
- [ ] **Step 2:** Build `CatalogTab.tsx` — card; toolbar row (search input filtering both lists client-side; segmented All/Blocking/Linked filter; right side selection count + bulk "Create N" primary using `importPrograms`/per-row create over selected). Section header strip (`bg-muted` eyebrow) "Programs · from {programSource}"; rows grid `[20px 1fr 300px]`: checkbox (selected = `bg-primary`), display + optional "holding N" amber badge (from `heldByKey`), and either linked (`→ target` + Unlink) or unlinked (link/create combobox — reuse `CatalogLinkCombobox`). Same for "Cities · from {citySource}". Footer: inline merge suggestion (design's München row) shown when `dupeGroups` non-empty, wired to `mergeMut`. "Blocking" filter = rows with holding>0; "Linked" = linked rows. Keep bulk-select state local (`selected: Set<string>`).
- [ ] **Step 3:** Wire; tests PASS.
- [ ] **Step 4:** Commit `feat: airtable catalog-links tab (filter/search/bulk/merge)`.

---

### Task 9: Activity tab

**Files:**
- Create: `src/components/settings/airtable/ActivityTab.tsx`
- Modify: `AirtableSyncTab.tsx` (render for `tab==="activity"`)

**Interfaces:**
- Consumes: `recentQ` (Task 6 query; raise its limit to e.g. 30 for Activity), status→badge tone mapping.

- [ ] **Step 1:** Test: renders "Run history" card with column headers Started/Status/Read/New/Updated/Held and one row per recent log with mono cells and a status badge. FAIL first.
- [ ] **Step 2:** Build `ActivityTab.tsx` — card header (h3 "Run history" + subtitle); grid header `[180px 100px repeat(4,1fr) 40px]` (Started/Status/Read/New/Updated/Held/·); rows from `recentQ`: mono `synced_at`; status badge (`success`→green "ok", `partial`→amber "partial", `error`→red "failed") mapping `records_processed`→Read, `new_count`/`updated_count`/`held_count`; held cell amber when >0; trailing chevron (non-interactive for now — expansion is out of scope). Copy/format per design `history`.
- [ ] **Step 3:** Wire; tests PASS.
- [ ] **Step 4:** Commit `feat: airtable activity tab (run history)`.

---

### Task 10: Manage-connection editor + delete dead code

**Files:**
- Create: `src/components/settings/airtable/ManageConnection.tsx` (dialog or inline reveal)
- Modify: `AirtableSyncTab.tsx` (remove the old stacked-card bodies now fully replaced; keep every query/mutation still referenced)

**Interfaces:**
- Consumes: key save/replace/delete, base/table selects (schema-accessible + fallback manual inputs), view input, frequency select — all lifted from the current tab.

- [ ] **Step 1:** Test: opening "Manage connection" shows key replace/delete, base + table selects, view + frequency controls; all disabled when `readOnly`. FAIL first.
- [ ] **Step 2:** Build `ManageConnection.tsx` — a shadcn `Dialog` (or `Popover`) opened from the Overview Connection card; body = the existing Step-1 (key) + Step-2 (base/table/view) + frequency controls verbatim (move, don't rewrite), including the `schemaState` fallback Alert + manual base/table inputs and the sub-60min rate-limit warning Alert. Autosave via existing `saveSettings`/`saveKey`/`deleteKey`.
- [ ] **Step 3:** Delete from `AirtableSyncTab.tsx`: the standalone "Last sync report" card, the numbered stacked Connection/Field-mapping/Custom-fields/Catalog/Duplicate-cities card bodies (their logic now lives in the tabs/ManageConnection). Confirm no unused imports remain (`npm run lint`).
- [ ] **Step 4:** Wire; tests PASS; `tsc` app+tools clean.
- [ ] **Step 5:** Commit `feat: airtable manage-connection editor; remove legacy stacked cards`.

---

### Task 11: Full verify + browser proof + docs

**Files:**
- Modify: `public/changelog.md` (+ regenerate `changelog.json`), `src/config/app.config.ts` (`APP_META.VERSION`) + `package.json` version if cutting a version; `src/lib/help/items.ts` (EN+DE) if Airtable answers describe the old layout.

- [ ] **Step 1:** `npm run lint` → 0 warnings. Fix any.
- [ ] **Step 2:** `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.tools.json --noEmit` → clean.
- [ ] **Step 3:** `npm run test:coverage` → green (meets thresholds). Fix/expand tests as needed.
- [ ] **Step 4:** `deno test --allow-all supabase/functions/` + `deno check --node-modules-dir=none supabase/functions/airtable-poll/index.ts` → green.
- [ ] **Step 5:** Browser (LOCAL stack: `npm run local:up` then `npm run dev`): sign in (seeded admin), open `/settings?tab=airtable`. Verify + screenshot: setup (fresh org / no key), live (held>0), healthy, error, and readonly (a producer without `configure_airtable` — or temporarily force the prop). Use read-only interactions where mutating.
- [ ] **Step 6:** Help center: `grep -rn "Airtable" src/lib/help/items.ts` — update any answer that describes the old stacked layout to the console/tabs; keep EN+DE parity ("Du", no dashes). If none, note "No help center impact." in the PR.
- [ ] **Step 7:** Changelog: add a customer-facing entry under a new version (New/Improved/Fixed; no super-admin copy) covering the redesigned Airtable sync screen + "records with an unlinked city are now held (never dropped)". Bump `APP_META.VERSION` + `package.json`. Regenerate: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`.
- [ ] **Step 8:** Commit `docs: changelog + help for airtable console`; open PR.

---

## Self-Review

**Spec coverage:** header/KPIs (T3/T4) · Overview attention+connection+runs (T6) · Field mapping + add-custom (T7) · Catalog filter/search/bulk/merge (T8) · Activity (T9) · Setup wizard (T5) · readonly (T5) · Manage-connection for base/table/key (T10) · poll city-hold + email + system-map (T1) · fetchRecentSyncLogs (T2) · verify+docs+help+changelog (T11). Out-of-scope items (custom-field retype/remove, "first seen", duration) are intentionally absent. All spec sections covered.

**Placeholder scan:** logic/data/poll/tests carry literal code; UI tasks carry component contracts + explicit design-section references + the token map (the design file is the pixel source, cited per task). No "TBD"/"handle edge cases".

**Type consistency:** `ConsoleMode`/`ConsoleTab`/`Kpi`/`HeldCause`/`StatusTone` defined in Task 3/4 and consumed unchanged in Tasks 5-9; `fetchRecentSyncLogs` signature identical in Task 2 and its consumers (T6/T9); held reason strings (`city '<name>' not linked`) identical in T1 (poll) and T3 (`groupHeldCauses`)/T8 (`heldByKey`).
