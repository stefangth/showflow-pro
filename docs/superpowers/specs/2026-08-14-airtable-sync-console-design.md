# Airtable Sync — Console rework

Source design: claude.ai/design project "Airtable Sync Settings Rework",
screen `airtable-sync-a-console.dc.html` (variant A, "console"). Variant B
(`airtable-sync-b-pipeline.dc.html`) is not being built.

## Why

Today's Settings → Airtable Sync (`src/components/settings/AirtableSyncTab.tsx`, ~1100 lines)
is a long vertical stack of numbered form cards: connection, field mapping, custom fields,
catalog links, duplicate cities, last-sync report. It reads as a setup form even for an org
that has been syncing for months. An admin/producer landing there cannot answer the two
questions they actually have — *"is sync healthy right now?"* and *"what is it waiting on?"* —
without scrolling the whole form. Held records (the poll's core resilience feature: unresolved
records are held, never dropped) are buried in a report card at the very bottom.

The approved design reframes the screen as a **status-first console**: current health up top,
what-needs-attention next, and the configuration behind tabs. It targets admins and producers
with the `configure_airtable` / `trigger_sync` capabilities (and degrades to a read-only view
for those without).

## What

Replace the `AirtableSyncTab` body with a console composed of:

1. **Status header card** — status dot + headline + one-line summary, an autosave "Saved"
   indicator, and a `Sync now` action; below it a 4-cell KPI row: Last run · Next run ·
   Dates in · Held.
2. **Sub-tab bar** (segmented control) — Overview · Field mapping · Catalog links · Activity —
   with a global Sync on/off switch on the right.
3. **Overview tab** — an error banner (error mode only), a "Needs your attention" panel that
   groups held records by cause with inline fixes, a Connection summary card, and a Last-5-runs
   card. Healthy orgs get an all-clear state instead of the attention panel.
4. **Field mapping tab** — a two-column ShowFlow-field → Airtable-column table with a
   "N/9 required mapped" meter, unmapped-required rows highlighted, and an "Add as custom
   fields" affordance for Airtable columns ShowFlow doesn't read.
5. **Catalog links tab** — Programs and Cities sections: checkbox rows, All/Blocking/Linked
   filter, search, per-row link/create/unlink, bulk create, "holding N" badges, and an inline
   duplicate-city merge suggestion.
6. **Activity tab** — full run-history table: Started · Status · Read · New · Updated · Held.
7. **Setup wizard** — when the org isn't connected yet, a 4-step guided rail
   (Connect · Base & table · Map fields · Link catalog) starting on the token step.
8. **Read-only mode** — a "View only" banner and every write control disabled.

Plus one backend behavior change (see Approach): the poll holds a record whose **mapped,
non-empty city does not resolve** to a linked catalog city, so the design's "city option has
no catalog city — holding N" is literally true.

## Constraints

### Must
- Be visually and behaviorally faithful to `airtable-sync-a-console.dc.html`: layout,
  hierarchy, copy, the five modes (setup / live / healthy / error / readonly), KPI values,
  tab structure, and the grouped-cause attention panel.
- Reuse the app's shadcn primitives and **semantic Tailwind tokens** (`bg-card`,
  `text-muted-foreground`, `border-border`, accent/amber/green/red scales already in
  `src/index.css`). Never paste the mock's raw hex — the `.dc.html` hardcodes it only because
  it is a standalone artifact.
- Preserve every capability the current tab has: key save/replace/delete, base/table/view/
  interval settings, field mapping incl. cancellation mapping, catalog link/create/unlink/
  bulk-import, city merge, "Sync now", the enable switch, and adding custom fields.
- Keep capability gating exact: `readOnly = !configure_airtable`, `canTriggerSync =
  trigger_sync`; both admins bypass. Server-side enforcement is unchanged.
- Keep all data access in `src/data/*` (client-param functions) with thin React Query
  wrappers; test with `supabaseFake` — no `vi.mock` of the client.
- Poll change lands test-first (failing Deno test → implementation) and updates the
  `airtable-sync-held` email + `docs/system-map.md` + `src/data/systemMap.ts` in the same PR
  (automation change).
- CI green: `npm run lint` (max-warnings 0), `tsc` (app + tools), `vitest run --coverage`,
  `deno check` + Deno tests for the poll.

### Must Not
- Rebuild the app shell, sidebar, topbar, or Settings left-nav — the mock renders them only
  for context; they already exist and are unchanged.
- Change RLS, capability keys, entitlements, or the Vault key flow.
- Change any query-key domain or invalidation contract (`['bookings']`, `['cities']`,
  `['shows']`, `['airtable', ...]`).
- Drop custom-field type-change/remove *silently* — see Out of Scope (owner chose the design's
  minimal affordance; the loss is deliberate and recorded).
- Build variant B (pipeline).

### Out of Scope
- **Custom-field management (change type / remove) inside the tab.** Per owner decision, the
  Field-mapping tab matches the design exactly: only an "Add as custom fields" affordance.
  Removing/retyping a custom field is no longer done here. *(Deliberate regression; flagged.)*
- **"first seen <date>" / per-option hold age** in the attention panel — needs cross-run
  aggregation; the latest-run scope is used (matches the design's "held on the 09:12 run").
- **Run duration** ("3.1s") in the KPI sub-line — not stored on `airtable_sync_log`; omitted.
- Any change to the poll cron cadence, offer-tier opening, or the schema-read edge function.

## Current State

- **UI:** `AirtableSyncTab.tsx` — stacked cards; mounted in `SettingsPage.tsx` at
  `<TabsContent value="airtable">` with `readOnly`/`canTriggerSync` from `useCan`.
- **Data (all present):** `airtableKey`, `airtableSettings`, `airtableSchema`,
  `airtableMapping` (`SHOWFLOW_FIELDS`, planners, key helpers), `airtableSync`
  (`fetchLatestSyncLog`, `fetchUnresolvedRecords`, `triggerAirtableSyncNow`), `settings`,
  `cities`, `customFields`. `src/data/admin.ts` already lists `airtable_sync_log` (limit 20).
- **DB:** config in `app_settings` (6 keys) + Vault PAT; `airtable_sync_log`
  (status/records_processed/imported/new/updated/held_count/details/error_details/synced_at);
  `airtable_sync_record_log` (action ∈ imported_new/updated/held_unresolved/error, reason,
  raw_fields); `shows.airtable_program_key`, `cities.airtable_city_key`;
  `custom_field_definitions` + `show_dates.custom`.
- **Poll:** `airtable-poll` holds on missing date and unlinked program; **unlinked city is
  currently non-fatal** (imports with `city_id` null + a soft `cityNote`).
- **Gating:** capabilities `producer_can_configure_airtable`, `producer_can_trigger_sync`
  (both `defaultEnabled:false`; admins always pass). Airtable is NOT an entitlement/module.

## Approach

### Frontend (the bulk)
- New folder `src/components/settings/airtable/` with focused components, orchestrated by a
  slimmed `AirtableSyncTab.tsx`:
  `StatusHeader` (dot/headline/summary/KPIs/Sync-now), `ConsoleTabs` (segmented + sync switch),
  `OverviewTab` (attention panel + connection + last-5-runs + all-clear),
  `MappingTab` (field table + meter + add-custom), `CatalogTab` (programs/cities +
  filter/search/checkbox/bulk/merge), `ActivityTab` (history table), `SetupWizard` (4-step rail).
  Pure view-model helpers (`console.ts`) derive header/KPIs/mode/causes from the existing
  query data so they're unit-testable without rendering.
- **Mode derivation (view-model, from existing data):** `setup` when no key OR no base/table;
  else `error` when the latest run status is `error` (banner names token/401 when detectable
  from `error_details` + recent runs); `healthy` when latest run held_count 0 and status ok;
  else `live` (held > 0). `readOnly` from the prop.
- **KPIs:** Last run = `synced_at`; Next run = `nextSyncAt(last, interval)`; Dates in =
  `imported_count` (new · updated from new/updated counts); Held = `held_count`.
- **Attention causes:** group `fetchUnresolvedRecords(latestLogId)` held rows by
  `categorizeHeldReason` (missing_date / unlinked_program / **unlinked_city** — new) → inline
  fixes reuse `createOneProgram` / `createOneCity` / link mutations.
- **Base/table/view/interval/key management** in live mode lives behind a "Manage connection"
  control on the Connection card (the design shows base/table only during setup); it reveals
  the existing controls (key replace/delete, base/table selects with schema fallback, view,
  frequency).
- **New data fn (only added):** `fetchRecentSyncLogs(client, orgId, limit)` in
  `src/data/airtableSync.ts` (+unit test) — org+`sync_type`-scoped, `synced_at desc`, limit —
  backs Last-5-runs, the Activity table, and error-mode "last N runs failed".

### Backend (owner-approved behavior change)
- `airtable-poll/index.ts`: after resolving the city, if `fieldMap.city` is set AND the
  record's city value is non-empty AND it does not resolve to a linked catalog city →
  `held += 1` with reason `city '<name>' not linked` and `continue` (mirrors the unlinked-
  program branch). Blank/absent city or unmapped city field still imports with `city_id` null.
  Remove the now-dead `cityNote` soft-note on imported/updated outcomes.
- `categorizeHeldReason` / `topHeldReason` / `HeldReasonCategory`: add `unlinked_city`.
- `airtable-sync-held.tsx` email: add the `unlinked_city` label + registry default + tests.
- `docs/system-map.md` + `src/data/systemMap.ts`: note the city-hold cause.

## Testing Strategy

- **Unit (vitest):** `console.ts` view-model (mode/KPI/cause derivations) with fixtures;
  `fetchRecentSyncLogs` with `supabaseFake`; rewrite `AirtableSyncTab.test.tsx` to the new
  structure (renders header/tabs; setup vs live; read-only disables writes; catalog
  link/create; sync-now toast).
- **Edge (Deno):** new `index.cityhold.test.ts` — mapped non-empty unlinked city holds
  (`city '<name>' not linked`), blank/unmapped city still imports; run the WHOLE
  `supabase/functions/` suite (per repo lesson, single-file runs hide regressions).
  Update `airtable-sync-held` template test for the new category.
- **Manual (browser, LOCAL stack):** setup / live / error / readonly; tab switching; a
  link+create round-trip; screenshot each state.
- **Docs:** Help center impact — review `src/lib/help/items.ts` (EN+DE) for Airtable answers
  that describe the old layout; changelog entry (customer-facing, no super-admin copy).

## Tasks

_(populated in Phase 3 after sign-off)_
