# Hire orders: variable terms templates + per-date sessions

**Date:** 2026-07-24
**Branch:** `claude/hire-order-issues-features-cbf995`
**Ships:** one combined PR. The two product features (A, B) sit behind the existing `hire_orders` entitlement (dark by default); the CI guard (C) is infrastructure.

Three deliverables the customer asked for:

1. **Variable terms templates** — replace the three fixed terms variants (Lean / Standard / Full) with an org-managed list of named templates the user can add, remove, and rename.
2. **Per-date sessions** — for linked (synced) dates, the new-order wizard and the generated document should carry each date's *own* session times, so a multi-date engagement can have different running orders per date.
3. **Migration-drift CI guard** (Option B) — a detect-only CI check so we never again silently ship code against an unapplied migration (the root cause of the two production bugs opened this session).

Items 1–2 are pure product features; item 3 is a CI safety net. No change to auth, tenancy, or the booking engine.

---

## Feature A — Variable terms templates

### Goal
Today an org has exactly three terms sets keyed `lean` / `standard` / `full`, each a `HireOrderClause[]`. The user wants to name them freely and have any number of them. Renaming must never mutate a document that already references a template.

### Data model

`hire_order_terms` app-setting changes from:

```jsonc
{ "lean": [clause...], "standard": [clause...], "full": [clause...] }
```

to:

```jsonc
{
  "templates": [
    { "id": "lean",     "name": "Lean",     "clauses": [ { "title": "...", "body": "..." } ] },
    { "id": "standard", "name": "Standard", "clauses": [ ... ] },
    { "id": "full",     "name": "Full",     "clauses": [ ... ] }
  ],
  "default_id": "standard"
}
```

- **`id`** is a stable, opaque key. On creation of a *new* template it is a generated UUID (`crypto.randomUUID()`). It never changes when the template is renamed or reordered.
- **`name`** is free-text display copy. The name is used only in the app UI (settings + pickers). It is **never printed on the PDF** — the renderer emits the clause title/body only — so renaming has zero effect on any document.
- **`clauses`** is the existing `HireOrderClause[]` (`{ title, body }`).
- **`default_id`** is the template used for auto-drafts and pre-selected in the pickers (decision: *mark one as default*).

An order still stores the chosen template's **`id`** in the existing `hire_orders.terms_variant` column (plain `text`, no enum, no schema change). Because the three seeded templates keep the ids `lean` / `standard` / `full`, **every existing order keeps resolving**.

### Back-compat (no data migration)

A single pure helper normalizes the setting on read, tolerating both shapes:

- **New shape** (`templates` present) → returned as-is.
- **Legacy shape** (`lean`/`standard`/`full` keys) → converted to
  `templates: [{id:'lean',name:'Lean',clauses},{id:'standard',name:'Standard',clauses},{id:'full',name:'Full',clauses}]`,
  `default_id: 'standard'`.
- **Missing / empty** → `{ templates: [], default_id: null }`.

The `resolveOrgSetting` fallback for an org that has *never* saved terms (`HIRE_ORDER_DEFAULT_TERMS`) becomes the new-shape three seeded **empty** templates — `Lean` / `Standard` / `Full` with `default_id: 'standard'` — preserving today's out-of-box experience (three named, clause-less variants).

The settings card always **writes the new shape**, so an org upgrades in place the first time it saves. This helper is **dual-homed** (the two runtimes cannot share an import), mirrored verbatim between `src/lib/hireOrders/terms.ts` and `supabase/functions/_shared/hireOrders.ts`, exactly like the existing `resolveFields` / entitlements mirrors. Both homes change in the same commit.

### Resolution semantics

At **draft** time, `terms_variant` is set to the org's `default_id` (replacing the hardcoded `"standard"` in `draftOrders` / `draftManual` / `draftBatch` and the auto-draft trigger path).

At **issue** time (and in preview), the edge function resolves clauses:

```
template = templates.find(t => t.id === order.terms_variant)
        ?? templates.find(t => t.id === default_id)   // decision: fall back to default
        ?? null                                        // → empty terms → "missing_terms" gate
clauses  = template?.clauses ?? []
```

Decision: **deleting a referenced template is allowed**; a draft that pointed at it falls back to the **default** template at issue. Issued/countersigned orders are unaffected — they already freeze the resolved clauses into `issue_snapshot` at issue time. The existing "missing_terms" readiness gate still blocks issuing when the resolved clause list is empty.

### UI

**Settings → Hire orders → Terms** (`TermsVariantsCard.tsx`): replace the three fixed `ClauseListEditor`s with a dynamic list:
- Per template: editable **name** field, "Set as default" control (radio/star; exactly one default), clause editor (unchanged `ClauseListEditor` internals), delete button.
- "Add template" button (creates a new template with a generated id, empty name placeholder, empty clauses).
- Deleting the current default promotes the first remaining template to default (or `default_id: null` if none remain).
- Keep the existing read-error guard (render the error instead of the empty form, so a failed load can't wipe authored clauses on save).

**Order pickers** — `GenerateHireOrderDialog.tsx`, `HireOrderEditPage.tsx`, and `HireOrderImportDialog.tsx` currently hardcode `[{key:'lean'},{key:'standard'},{key:'full'}]` radio buttons. Replace with the org's templates (fetched from the same setting), rendered by `name`, valued by `id`.
- If an order references an id no longer in the list (deleted template), show it as a disabled "(removed) — will use default" chip and let the user pick another; the persisted value is corrected on next save.

### Files touched (Feature A)
- `src/config/app.config.ts` — `HIRE_ORDER_DEFAULT_TERMS` shape + a `HireOrderTermsSetting` type.
- `src/lib/hireOrders/terms.ts` (new) + `supabase/functions/_shared/hireOrders.ts` — the normalize/resolve helpers (mirror).
- `src/components/settings/hireOrders/TermsVariantsCard.tsx` — dynamic editor.
- `src/components/shows/hireOrders/GenerateHireOrderDialog.tsx`, `src/pages/HireOrderEditPage.tsx`, `src/components/hireOrders/import/HireOrderImportDialog.tsx` — dynamic picker.
- `supabase/functions/generate-hire-orders/index.ts` — `default_id` for drafting; id-based clause resolution at issue/preview.

### Tests (Feature A)
- Unit: normalize helper (both shapes, missing, default fallback) in both `src/lib` and `_shared` (import the real module).
- Unit: resolve-clauses-by-id incl. deleted → default fallback.
- Component: settings card add/rename/delete/set-default; picker renders org templates and marks a removed reference.
- Edge (Deno): draft uses `default_id`; issue resolves by id and falls back to default when the referenced id is gone; `missing_terms` still fires on empty.

---

## Feature B — Per-date sessions for linked dates

### Goal
For an aggregate (multi-date) order created from linked/synced dates, each date should carry **its own** session times (pulled from that date's synced `session_1..3`), editable in the wizard, and printed as a per-date running order. Today `draftBatchArtist` copies only the **first** date's sessions into one shared `sessions` field, so every date on the document shows the same running order.

### Data model

Extend `EngagementDate` (dual-homed in `src/lib/hireOrders/types.ts` and `supabase/functions/_shared/hireOrders.ts`):

```ts
interface EngagementDate {
  show_date_id: string;
  date: string;
  venue: string | null;
  city: string | null;
  sessions: string[];          // NEW — this date's own running order
  duration_min: number | null; // NEW — this date's own duration
}
```

Stored in `data.engagement_dates` exactly as today, just richer. Single-date and manual orders are unchanged — they keep the top-level `sessions` / `duration_min` field and the existing single running-order render.

### Edge function (`draft-batch`)

`draftBatchArtist` already loads each date's `session_1..3` and `duration_minutes`. Change the `engagementDates` assembly so each entry carries its own resolved sessions/duration instead of only the first date's.

Decision: **prefill from sync, editable.** The wizard may send per-date overrides. Extend the `draft-batch` body with an optional map:

```jsonc
"date_overrides": { "<show_date_id>": { "sessions": ["19:00","21:00"], "duration_min": 90 } }
```

Per date: `sessions = override.sessions ?? syncedSessions`, `duration_min = override.duration_min ?? syncedDuration`. Validation: session strings trimmed/non-empty, max 3 per date (mirrors the show_date model); `duration_min` a finite non-negative number when present, else rejected (same posture as the existing `invalid_fee` guard).

The top-level `data.sessions` / `duration_min` continue to reflect the **first** date (keeps single-date rendering and any existing consumer intact); the per-date detail lives in `engagement_dates`.

### Wizard (`NewOrderWizard.tsx`)

Step 3 ("Running order") currently edits **one** shared `SessionRow[]` derived from a single `batchScheduleSourceDateId`. Replace with a **per-date** editor for linked mode:
- One collapsible/section per selected date, header = the date label.
- Each pre-filled from that date's synced `sessions` + `duration_min` (already available via `useShowDatesLite`).
- Same add/remove/label+time row controls as today, scoped per date (max 3).
- Manual mode is unchanged (single running order).
- On submit, only dates the user actually edited go into `date_overrides` (untouched dates resolve from sync server-side — avoids re-sending unchanged data and keeps sync as the source of truth).

Step-4 review lists each date with its resolved sessions.

### PDF renderer (`_shared/hire-order-pdf/render.tsx`)

Today: an "engagement dates" block (date / venue / city) followed by **one** running-order (Call/Time) table from top-level `sessions`. New rule, keyed off the number of engagement dates so the running order is never rendered twice:
- **2+ engagement dates** (true aggregate): render **each date's own running order** beneath its date/venue/city line from `EngagementDate.sessions`, and **suppress** the separate shared top-level running-order table.
- **0 or 1 engagement date** (manual, or a single linked date): render exactly as today — the single top-level running-order table, no per-date block duplication.

Reuse the existing session-row styling; no new fonts or components.

### Files touched (Feature B)
- `src/lib/hireOrders/types.ts` + `supabase/functions/_shared/hireOrders.ts` — `EngagementDate` extension (mirror).
- `supabase/functions/generate-hire-orders/index.ts` — per-date session/duration assembly + `date_overrides` handling/validation in `draft-batch`.
- `src/components/hireOrders/NewOrderWizard.tsx` — per-date running-order step.
- `supabase/functions/_shared/hire-order-pdf/render.tsx` — per-date running order in the aggregate layout.
- `src/data/hireOrders.ts` — `ShowDateLite` already carries `sessions`; add `duration_minutes` if not already surfaced for the per-date prefill.

### Tests (Feature B)
- Unit: `EngagementDate` type round-trip; per-date override merge (override wins, absent → synced).
- Edge (Deno): `draft-batch` builds distinct sessions per date; `date_overrides` merges/validates; rejects malformed sessions/duration.
- Renderer (Deno): aggregate PDF renders each date's own running order; single-date unchanged.
- Component: wizard shows one running-order section per selected date, pre-filled from sync, editable; only edited dates are sent.

---

## Feature C — Migration-drift CI guard (Option B, detect-only)

### Goal
Never again silently ship code against an unapplied migration — the exact root cause of the two bugs this session opened with (#191's edge function + frontend auto-deployed, but its two migrations were never applied). **Detect and alert only; never auto-apply** (the chosen lower-risk posture: migrations are far harder to roll back than functions, and safe auto-apply needs ordering + a DB-write credential).

### Approach — name-based, drift-tolerant, zero new secrets, zero prod writes
A CI job compares the repo's migration set to what production has actually applied, keyed by migration **name**:
- **Repo names:** each `supabase/migrations/*.sql` filename with its `<version>_` prefix and `.sql` suffix stripped.
- **Applied names:** `select name from supabase_migrations.schema_migrations`, fetched via the Supabase Management API query endpoint `POST https://api.supabase.com/v1/projects/{ref}/database/query`, authenticated with the **existing** `SUPABASE_ACCESS_TOKEN` secret (already used by `deploy-functions.yml`). No DB password, no service-role key, no new secret.
- **Fail** the job (non-zero exit, red X) if any repo name is absent from the applied set, printing the offending filenames.

**Why name, not version:** production's recorded *versions* have drifted from repo filenames by seconds (a pre-existing artifact of applying via timestamped tooling — e.g. repo `20260723213733_email_health_event_window` ↔ applied `20260723213921 / email_health_event_window`), so a version-based `supabase migration list` would false-positive on every drifted row. Migration *names* are preserved across that drift, and the repo's early Supabase-generated files carry the same UUID names as their remote rows. **Verified against production today: all 178 repo migration names are present remotely (empty diff) and every repo name is unique** — so the check is green on first run with no allowlist needed.

### Trigger & wiring
`.github/workflows/check-migrations.yml`, triggered `on: push: [main]` — a lightweight standalone job. It does not gate the function deploy; its job is to raise a red check *right after* a merge whose migration still needs applying, so the gap is caught in minutes instead of by a user hitting the break. The job checks out the repo and runs `scripts/check-migrations.mjs`, which performs the fetch + set-difference and exits non-zero (printing the missing filenames) on any gap.

### Files
- `.github/workflows/check-migrations.yml` (new).
- `scripts/check-migrations.mjs` (new) — a pure, unit-testable `diffMigrations(repoNames, appliedNames)` plus a thin network wrapper that reads `SUPABASE_ACCESS_TOKEN` / project ref and calls the pure function.

### Tests
- Unit (vitest, imports the real module): `diffMigrations` — missing migration → reported as a gap; drift (same name, different version) → not a gap; all-present → empty. The live fetch wrapper is exercised by the workflow itself on first run.

---

## Non-goals (YAGNI)
- No renaming of the internal template **ids**, and no per-order clause editing (templates are the unit).
- No DB schema change for either feature (`terms_variant` stays `text`; `engagement_dates` stays in `data` jsonb).
- No per-date **fee**, venue override, or per-date terms — sessions/duration only.
- No printing the template name on the PDF.
- No change to manual (non-linked) or single-date orders' running-order behavior.

## Rollout
Features A and B land behind the existing `hire_orders` entitlement (already dark by default); the customer's org already has it enabled. Feature C (the CI guard) is infrastructure, not entitlement-gated. Version bump + `public/changelog.md` entry per `CLAUDE.md` for the two user-facing features (customer-facing wording; no super-admin mentions; the CI guard is not a customer-facing changelog item). System map unchanged (no new automation).
