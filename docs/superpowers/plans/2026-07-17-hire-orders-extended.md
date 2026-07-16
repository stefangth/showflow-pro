# Hire Orders Extended Implementation Plan (initiative PRs ⑤⑥⑦)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Git safety:** never run `git reset --hard`, `git checkout -- .`, or any history-destroying command. Commit early and often on the current branch.

**Goal:** The remaining surfaces and integrations: V4 tracking dashboard with batch operations, V5 guided wizard, the spreadsheet import (Google Sheets / Excel with column and row selection, three-way field sourcing), Documenso e-sign countersigning, and the 1.10.0 release bookkeeping.

**Architecture:** V4/V5 are pure consumers of the Task-8 (core plan) edge-function contract. Import extends the artist-import stack: `parseSheet` (PapaParse/SheetJS) and `fetch-remote-sheet` are reused unchanged; new pure modules add range selection, hire-order field mapping, and entity resolution; a `bulk_import_hire_orders` RPC creates drafts set-based. Documenso is an API client behind `Deps` plus a secret-verified webhook function.

**Tech Stack:** as the core plan, plus PapaParse/SheetJS (existing deps), Documenso REST API v1 (Vault-held token).

**Spec:** `docs/superpowers/specs/2026-07-17-hire-orders-design.md` §§4-5, 8-9. **Prerequisites: the entitlements plan AND the core plan are merged.** This plan consumes: `invokeHireOrderAction`, `fetchHireOrdersForDate`, `HireOrderRow`, `resolveFields`, `FieldLayers`, `OrderFieldKey`, `orderReadyIssues`, `formatMoney` (core plan Tasks 3/11), `requireFeature`, `ROUTE_FEATURES`, nav `feature` gating (entitlements plan).

## Global Constraints

Identical to `2026-07-17-hire-orders-core.md` (TDD, real-module imports, deno-local/CI split, MCP migrations + types regen, RLS templates, data-access + supabaseFake pattern, `['hire-orders']` prefix invalidation, whole-suite Deno runs, config.toml blocks, system-map dual updates, no em/en-dashes in copy, ≤72-char commits). Additions:

- Import creates **drafts only**, never issues. Import is idempotent per run: rows resolving to a booking/artist+date that already has an active order are reported `skipped_existing`.
- Import row cap: reuse `MAX_IMPORT_ROWS = 5000` from `src/lib/artistImport/parseSheet.ts`.
- Documenso secrets live in Supabase Vault (`documenso_api_token`, `documenso_webhook_secret`); never in `app_settings`, never returned to the client (mirror the Airtable PAT pattern).

## File structure (what gets created/modified)

```
src/pages/HireOrdersPage.tsx + src/components/hireOrders/OrdersTable.tsx, OrdersKpis.tsx, OrderSlideOver.tsx (T1: V4)
src/components/layout/navItems.ts + src/hooks/useNavCounts.ts + src/data/hireOrders.ts (T1: nav + badge)
src/components/hireOrders/NewOrderWizard.tsx (T2: V5)
src/pages/HireOrderEditPage.tsx + src/components/hireOrders/edit/* (T2b: V2 split builder)
src/lib/hireOrderImport/rangeSelection.ts, guessOrderMapping.ts, buildOrderRows.ts (+tests) (T3)
supabase/migrations/<ts>_bulk_import_hire_orders.sql (T4: RPC) + pgTAP
src/components/hireOrders/import/HireOrderImportDialog.tsx (+ step components + tests) (T5)
e2e/hire-order-import.spec.ts (T6)
supabase/functions/_shared/documenso.ts (+test) (T7)
supabase/functions/generate-hire-orders/index.ts (T7: documenso issue path)
src/components/settings/hireOrders/CountersignCard.tsx (T7: connection UI)
supabase/functions/documenso-webhook/index.ts (+ config.toml block, tests) (T8)
public/changelog.md, package.json, src/config/app.config.ts (T9: release)
```

---

### Task 1: V4 tracking dashboard + nav + batch actions

**Files:**
- Create: `src/pages/HireOrdersPage.tsx`, `src/components/hireOrders/OrdersKpis.tsx`, `OrdersTable.tsx`, `OrderSlideOver.tsx` (+ `HireOrdersPage.test.tsx`)
- Modify: `src/config/app.config.ts` (`ROUTES.HIRE_ORDERS = "/hire-orders"`, `ROUTE_FEATURES["/hire-orders"] = "hire_orders"`), `src/App.tsx` (route, roles admin/producer)
- Modify: `src/components/layout/navItems.ts` (item: `{ to: ROUTES.HIRE_ORDERS, icon: FileSignature, label: "Hire orders", section: "workspace", roles: ["admin","producer"], feature: "hire_orders", badge: "awaitingCountersign" }`; extend the `NavBadge` union)
- Modify: `src/hooks/useNavCounts.ts` + `src/data/hireOrders.ts` (`fetchAwaitingCountersignCount(client, orgId)` → count of `status = 'issued'`; key `['hire-orders','awaiting-count',orgId]`)

**Interfaces:**
- Consumes: `fetchHireOrders(client, orgId, filters)` — ADD to `src/data/hireOrders.ts` in this task: `filters = { status?: HireOrderStatus[], search?: string }`, returns rows joined with `artists(name)` + `show_dates(date, venue)`; key `['hire-orders','list',orgId,filters]`.
- Produces: batch UI over the existing edge contract (`action: "issue", order_ids: [...]`).

- [ ] **Step 1: Failing tests** — data: `fetchAwaitingCountersignCount` counts only `issued`; `fetchHireOrders` applies status filter + ilike search on `order_no`/artist name. Page: renders 4 KPI tiles (Issued / Awaiting countersign / Countersigned / Value committed — value = `formatMoney(sum of fee_amount of non-void orders)`), the table (order number mono, artist + venue stacked cell, date mono, fee right-aligned tabular, status badge, chevron), row click opens the slide-over, header checkbox + row checkboxes enable the bulk bar ("Issue selected" disabled unless every selected row is draft/ready). Nav badge shows the awaiting count.
- [ ] **Step 2: Implement** — page head (eyebrow "Workspace", h1 "Hire orders", meta "<n> orders · <sum> committed"); filter chips (All/Draft/Ready/Awaiting/Countersigned) + search input (existing filter-control components in `src/components/filters/`); slide-over per design V4 (facts grid, status badge, actions: draft/ready → "Issue and send", issued → "Download" + "Mark countersigned", any → "Void" behind an AlertDialog); bulk bar calls `useHireOrderAction` with `order_ids`, per-result toast ("3 issued, 1 failed: missing fee"). Buttons "New order" (opens Task 2 wizard) and "Import from spreadsheet" (opens Task 5 dialog; hidden until that task lands — gate on a local `IMPORT_READY` const flipped in Task 5).
- [ ] **Step 3: Commit** — `git commit -m "add hire orders tracking page with batch issue"`

---

### Task 2: V5 guided wizard (single new order, incl. fully manual)

**Files:** Create `src/components/hireOrders/NewOrderWizard.tsx` (+ test). Modify `HireOrdersPage.tsx` (wire "New order").

**Interfaces:**
- Consumes: `useShows`/`useShowDates`/`useCities` hooks, `useEligibleArtists` (artist picker), `resolveFields`, `orderReadyIssues`, `invokeHireOrderAction`.
- Produces: drafts via a NEW edge action added here: `POST { action: "draft-manual", org_id, artist_id?, show_date_id?, manual: Partial<Record<OrderFieldKey, unknown>> }` → `{ created: [id] }`. Extend `generate-hire-orders/index.ts` + its DI tests in this task (manual layer feeds `resolveFields({ showflow?, manual, defaults })`; `artist_id`/`show_date_id` optional; snapshot `recipient_email` required by the ready gate before issue, not at draft).

- [ ] **Step 1: Failing tests** — edge DI: `draft-manual` with only `manual` fields creates an unlinked order (`booking_id`/`artist_id`/`show_date_id` all null) whose every field has `source: "manual"`; with `artist_id` + `show_date_id` it resolves showflow fields underneath manual overrides. Component: four steps render in order (Confirm engagement / Fees and deposit / Running order / Review and issue), stepper marks progress, "Back" disabled on step 1, final step shows the summary rows + "Issue and send to artist" plus "Save as draft"; picking "No linked date" switches step 1 to manual date/venue/city inputs.
- [ ] **Step 2: Implement** — stepper per design V5 (numbered dots, accent connectors); step 1: artist select (searchable, from `useEligibleArtists` without date filter) + date select (org show_dates by date desc) + "or enter engagement manually" toggle; step 2: fee input + currency (from defaults) + read-only balance line ("Payable on performance date: <fee>", fee-only v1); step 3: sessions read-only list from the linked date (or manual rows: label + time inputs, max 3) + duration input; step 4: review rows + doc thumbnail placeholder (preview action) + submit. Success screen: green check, "Hire order created", buttons "Open order" (V3 route) / "Issue now".
- [ ] **Step 3: Run whole Deno suite (edge change); commit** — `git commit -m "add guided new hire order wizard"`

---

### Task 2b: V2 split builder — draft editor with live preview and provenance chips

**Files:**
- Create: `src/pages/HireOrderEditPage.tsx`, `src/components/hireOrders/edit/FieldSection.tsx`, `ProvenanceChip.tsx` (+ page test)
- Modify: `src/config/app.config.ts` (`ROUTES.HIRE_ORDER_EDIT = "/hire-orders/:id/edit"`, `ROUTE_FEATURES` entry), `src/App.tsx` (route, roles admin/producer)
- Modify: `src/data/hireOrders.ts` (+ test): add `updateHireOrderDraft(client, id, patch: { data: OrderData; fee_amount?: string; fee_currency?: string; terms_variant?: string }): Promise<void>`
- Modify: V3 page header + V4 slide-over: "Edit" button visible for `draft`/`ready` orders, linking here

**Interfaces:**
- Consumes: `fetchHireOrder`, `resolveFields`, `orderReadyIssues`, `invokeHireOrderAction` (`preview` action), `formatMoney`.
- Produces: `updateHireOrderDraft` (also reused by the import Review step if inline edits are saved per-order later).

- [ ] **Step 1: Failing tests** — every field row renders a provenance chip (`SF` / `Sheet` / `Manual` / `Default`, mapped from `FieldValue.source`); editing an input flips that field's chip to `Manual` and stages the patch; "Refresh from ShowFlow" re-resolves every non-manual field (calls `resolveFields` with a fresh showflow layer and preserves manual entries); Save calls `updateHireOrderDraft` and invalidates `['hire-orders']`; the page renders read-only with a notice for `issued`/`countersigned`/`void` orders; the live preview pane re-requests the `preview` action debounced (800ms) after edits.
- [ ] **Step 2: Implement** — grid `428px 1fr` per design V2: left column = numbered sections (1 Parties, 2 Engagement, 3 Fees and payment, 4 Terms detail) built from `FieldSection` (label, input, `ProvenanceChip`); fee input styled mono with currency prefix; terms variant segmented control; header carries order number (mono) + status badge + Save draft / "Issue and send" (issue action; disabled while `orderReadyIssues` is non-empty, tooltip lists the readable issue copy). Right column = paper-tinted desk with the sticky "Live preview, updates as you edit" pill and an `<iframe>` of the preview PDF (base64 data URL).
- [ ] **Step 3: Commit**

```bash
git add src/pages/HireOrderEditPage.tsx src/components/hireOrders/edit/ src/data/hireOrders.ts src/config/app.config.ts src/App.tsx
git commit -m "add hire order split builder with provenance chips"
```

---

### Task 3: Import pure library — range selection, mapping, row building

**Files:** Create `src/lib/hireOrderImport/rangeSelection.ts`, `guessOrderMapping.ts`, `buildOrderRows.ts` + `.test.ts` each.

**Interfaces (produced; the dialog and RPC consume):**

```ts
// rangeSelection.ts
export interface SheetRange { sheetName?: string; headerRow: number; mode: "all" | "range" | "picked"; from?: number; to?: number; picked?: number[] }
export function applyRange(rows: string[][], range: SheetRange): { headers: string[]; dataRows: Array<{ rowIndex: number; cells: string[] }> };

// guessOrderMapping.ts
export type OrderColumnMapping = Partial<Record<OrderFieldKey, string>>;   // field -> header name
export function guessOrderMapping(headers: string[]): OrderColumnMapping;

// buildOrderRows.ts
export interface ImportRowInput { rowIndex: number; record: Record<string, string> }
export interface ResolvedImportRow {
  rowIndex: number;
  sheet: Partial<Record<OrderFieldKey, unknown>>;      // typed/parsed sheet layer
  matchedArtistId?: string; matchedShowDateId?: string;
  status: "ready" | "attention" | "skipped";
  issues: string[];                                    // e.g. ["unparseable_date","unknown_artist","missing_fee"]
}
export function buildOrderRows(
  rows: ImportRowInput[], mapping: OrderColumnMapping,
  catalog: { artists: Array<{ id: string; name: string; email: string | null }>;
             dates: Array<{ id: string; date: string; venue: string | null; city: string | null }> },
): ResolvedImportRow[];
```

- [ ] **Step 1: Failing tests** — `applyRange`: header row 2 shifts data start; `picked` mode returns exactly the picked indexes; out-of-range picks dropped. `guessOrderMapping`: headers `["Künstler","E-Mail","Datum","Venue","Stadt","Gage","Dauer"]` map to artist_name/recipient_email/date/venue/city/fee/duration_min (rules must cover EN+DE: `artist|name|künstler`, `mail`, `date|datum`, `venue|location|ort`, `city|stadt`, `fee|gage|honorar|betrag`, `duration|dauer|set`, `currency|währung`, `role|rolle`, `cast|besetzung`, `note|notiz`); each header claimed once (strong-pass/weak-pass like `guessMapping.ts`). `buildOrderRows`: parses `15.06.2026` AND `2026-06-15` to ISO; parses `4.500,00` AND `4,500.00` AND `4500` to `"4500.00"`; matches artist by lowercased email first, exact lowercased name second; matches date by ISO date + (venue OR city) when both mapped, date-only when unambiguous (single show_date that day), else `attention` with `ambiguous_date`; unmatched artist → `attention` + `unknown_artist`; row with no fee → `attention` + `missing_fee` (importable as draft, flagged); completely empty row → `skipped`.
- [ ] **Step 2: Implement** — date parsing: try `dd.mm.yyyy`, `yyyy-mm-dd`, `mm/dd/yyyy` in that order with explicit regexes (no `Date.parse` locale traps; keep timezone-safe by string manipulation only, per `src/lib/dates.ts` conventions). Money parsing: strip currency symbols/spaces, detect decimal comma vs point by last separator, normalize to `"1234.50"`.
- [ ] **Step 3: Commit** — `git commit -m "add hire order import mapping and row resolution lib"`

---

### Task 4: `bulk_import_hire_orders` RPC

**Files:** Create `supabase/migrations/<real-ts>_bulk_import_hire_orders.sql`; extend `supabase/tests/hire_orders.sql`.

**Interfaces:**
- Produces: `bulk_import_hire_orders(p_org uuid, p_import jsonb, p_rows jsonb) returns jsonb` — `p_import = { source, file_name, mapping, row_count }`; `p_rows = [{ row_index, artist_id?, show_date_id?, data, fee_amount?, fee_currency, terms_variant }]`; returns `[{ row_index, status: 'created'|'skipped_existing'|'error', order_id?, error? }]`. Order numbers are generated in-function via the same pattern settings (read `hire_order_numbering` via `get_org_setting`) with collision suffixing.

- [ ] **Step 1: pgTAP first** — non-producer caller raises; disabled entitlement raises (`is_feature_enabled` check); creates `hire_order_imports` row + N `hire_orders` drafts with `import_id` set; a row whose `booking/artist+date` already carries an active order returns `skipped_existing`; malformed row returns per-row `error` without aborting the transaction for the others (exception block per row, mirror `bulk_import_artists`' loop); all created orders have `status = 'draft'` and `data->'fee'->>'source' = 'sheet'` where fee came from the sheet.
- [ ] **Step 2: Migration** — SECURITY DEFINER plpgsql; role re-check `has_org_role(auth.uid(), p_org, 'producer') or has_org_role(auth.uid(), p_org, 'admin')`; entitlement check; insert import row; loop rows with `begin/exception` capture; duplicate detection: `exists (select 1 from hire_orders where org_id = p_org and status <> 'void' and (booking_id is not distinct from …booking lookup… ) and artist_id = row.artist_id and show_date_id = row.show_date_id)` — when both artist and date are linked; unlinked rows are never deduped. Apply via MCP; save file; regen types.
- [ ] **Step 3: Commit** — `git commit -m "add bulk_import_hire_orders rpc"`

---

### Task 5: Import wizard dialog (Source → Range → Map → Resolve → Review)

**Files:**
- Create: `src/components/hireOrders/import/HireOrderImportDialog.tsx`, `RangeStep.tsx`, `MapStep.tsx`, `ResolveStep.tsx`, `ReviewStep.tsx` (+ dialog test)
- Modify: `src/data/hireOrders.ts` (`bulkImportHireOrders(client, args)` RPC wrapper + test), `HireOrdersPage.tsx` (flip `IMPORT_READY`, wire button)

**Interfaces:**
- Consumes: `parseSheet` (`src/lib/artistImport/parseSheet.ts`, reused as-is — CSV/XLSX to `{headers, rows}`; for the Range step ALSO parse xlsx with `sheet_to_json({header:1})` raw mode via a new exported `parseSheetRaw(input, kind): Promise<{ sheets: Array<{ name: string; rows: string[][] }> }>` added to `parseSheet.ts` in this task with its own test); `fetch-remote-sheet` (unchanged, gsheet URL → csv); Task 3 lib; Task 4 RPC wrapper.

- [ ] **Step 1: Failing tests** — dialog: five steps advance/retreat correctly; Source accepts file or gsheet URL (URL path calls the edge fn via `supabase.functions.invoke("fetch-remote-sheet", …)` exactly like `ArtistImportDialog` does — copy its invocation); Range: changing header row re-derives headers live; Map: one Select per `OrderFieldKey` with "Ignore" sentinel, prefilled from `guessOrderMapping`; Resolve: unmatched-artist rows render the link/create combobox (reuse the `Command`-based linker pattern from `AirtableSyncTab.tsx:77-194`; "create" path calls the existing artist-creation data access with just name/email); Review: tiles Ready / Needs attention / Skipped, per-row checkbox (ready rows preselected), inline editable fee/date cells (edits update the manual layer and re-run `buildOrderRows` for that row), submit calls `bulkImportHireOrders` and shows the per-row result summary.
- [ ] **Step 2: Implement** — state machine `type Step = "source" | "range" | "map" | "resolve" | "review" | "done"`; keep ALL derivation in the Task-3 pure functions (the dialog only holds `{ raw, range, mapping, manualEdits, links }` and recomputes via `useMemo`); catalog data from `useEligibleArtists`-adjacent fetches (`fetchArtistsLite`, `fetchShowDatesLite` — add thin selects to `src/data/hireOrders.ts` if no existing light fetch fits). Done step: counts + "Open hire orders" button.
- [ ] **Step 3: Commit** — `git commit -m "add hire order spreadsheet import wizard"`

---

### Task 6: Import E2E

**Files:** Create `e2e/hire-order-import.spec.ts` + fixture `e2e/fixtures/hire-orders.xlsx` (3 rows: 1 clean match, 1 unknown artist, 1 bad date).

- [ ] **Step 1: Spec** — producer opens Import, uploads fixture, walks Range (defaults) → Map (auto-guessed, assert prefill) → Resolve (link the unknown artist to an existing catalog artist via the combobox) → Review (2 ready + 1 attention; fix the date inline; select all 3) → submit → V4 table shows 3 new drafts. Follow the serial-spec + fresh-process conventions used by existing e2e specs.
- [ ] **Step 2: CI green; commit** — `git commit -m "add hire order import e2e"`

---

### Task 7: Documenso client + issue-path integration + settings connection

**Files:**
- Create: `supabase/functions/_shared/documenso.ts` (+ `documenso.test.ts`)
- Modify: `supabase/functions/generate-hire-orders/index.ts` (+ DI tests): documenso branch on issue; new action `"countersign-test"` (admin-gated connection check)
- Modify: `src/components/settings/hireOrders/CountersignCard.tsx` (connection UI)

**Interfaces:**
- Produces:

```ts
// _shared/documenso.ts — thin fetch client, injected base URL + token
export interface DocumensoConfig { baseUrl: string; token: string }
export async function createAndSendEnvelope(
  fetchFn: typeof fetch, cfg: DocumensoConfig,
  args: { title: string; pdf: Uint8Array; recipientName: string; recipientEmail: string },
): Promise<{ envelopeId: string; signingUrl: string | null }>;
```

Vault secrets: `documenso_api_token` (and per-org override later if needed — v1 is org-shared via env/Vault, documented in the card). `hire_order_countersign` setting gains `{ mode, base_url? }` (base_url only; token never leaves the server).

- [ ] **Step 1: Failing Deno tests** — `createAndSendEnvelope` posts document create (multipart or the API's upload contract per https://docs.documenso.com developers docs: create document → add recipient with role SIGNER → send), carries `Authorization: Bearer <token>`, returns the envelope id; non-2xx → typed error `documenso_error:<status>`. generate-hire-orders: when the org's countersign mode is `documenso` and issue succeeds, the order row gets `countersign_mode = 'documenso'` + `documenso_envelope_id`, and the email templateData carries `signing_url`; when mode is `manual`, no Documenso call happens (fetch spy count 0). `countersign-test` action: admin-only, calls a cheap authenticated Documenso endpoint, returns `{ ok: boolean, detail }` without leaking the token.
- [ ] **Step 2: Implement** — client uses `deps.fetch` and `deps.env("DOCUMENSO_API_TOKEN")` (Vault-backed edge secret, same mechanism as `ANALYTICS`); base URL from the org setting with default `https://app.documenso.com`. Issue path: render → upload → Documenso envelope from the SAME bytes → store envelope id → email with signing link. Failure containment: a Documenso error after successful render/upload leaves the order `issued` with `countersign_mode = 'manual'` fallback + a warning in the response (`failed: [{order_id, issues:["documenso_failed"]}]` while still issued) — never lose the issued document. Settings card: mode radio (persisted), base URL input, "Test connection" button invoking the action, result inline (`CheckCircle2` or destructive text). Copy notes the token is configured server-side by the platform operator (Vault), not entered here.
- [ ] **Step 3: Whole Deno suite; commit** — `git commit -m "add documenso countersign integration"`

---

### Task 8: `documenso-webhook` edge function

**Files:** Create `supabase/functions/documenso-webhook/index.ts` + `deno.json` + `index.di.test.ts`; modify `supabase/config.toml` (`[functions.documenso-webhook]` `verify_jwt = false`); update `docs/system-map.md` + `src/data/systemMap.ts`.

**Interfaces:**
- Consumes: header `X-Documenso-Secret` compared constant-time against Vault `documenso_webhook_secret` (copy the constant-time compare from `isServiceRole` in `_shared/auth.ts`); payload event `document.completed` with the envelope/document id.

- [ ] **Step 1: Failing DI tests** — missing/wrong secret → 401 (and NO db reads); `document.completed` for a known `documenso_envelope_id` → order transitions `issued → countersigned`, `countersigned_at` stamped, `hire_order_countersigned` notification inserted for producers (resolved like `hire_orders_ready`); unknown envelope id → 200 `{ ignored: true }` (webhooks must not retry-storm); duplicate delivery → idempotent 200 (already countersigned = no-op); other event types → 200 ignored.
- [ ] **Step 2: Implement + system map** — add the webhook node (trigger: Documenso `document.completed` → function → `hire_orders.status` + notification, gate: webhook secret; cite migration/config). Run whole Deno suite.
- [ ] **Step 3: Commit** — `git commit -m "add documenso webhook for countersign completion"`

---

### Task 9: Release bookkeeping (1.10.0)

**Files:** Modify `package.json`, `src/config/app.config.ts` (`APP_META.VERSION`), `public/changelog.md`; regenerate `public/changelog.json`; update `docs/app-logic.md` if the earlier PRs left gaps.

- [ ] **Step 1: Changelog** — one 1.10.0 block (same-day changes fold into ONE version), theme line like `*Paperwork that writes itself*`, end-user bullets only (no refactors/CI), `- **Title** — description` form, no em/en-dashes INSIDE titles/descriptions (use the form's separator only). Cover: Hire orders (generate, issue, PDF, artist email + notification), Spreadsheet import, Batch issue + tracking page, Guided wizard, Documenso countersigning, Org modules (super-admin entitlements), Booking flow module gating.
- [ ] **Step 2: Regen JSON** — `deno run --allow-read --allow-write scripts/changelog-to-json.ts`. Bump both version fields to `1.10.0`.
- [ ] **Step 3: Tag reminder** — note in the PR body that `v1.10.0` should be tagged on the release commit (tags are behind since v1.4.0; do not skip going forward).
- [ ] **Step 4: Commit + PR** — `git commit -m "release 1.10.0: hire orders and org modules"`; open the final PR.

## Self-review checklist

- Spec coverage: V4 T1, V5 T2 (+`draft-manual` action), V2 T2b (provenance chips + live preview), import §5 T3-T6 (range/mapping/resolve/review, drafts-only, three-way sourcing preserved via sheet layer + manual edits), Documenso §8 T7-T8 (envelope, webhook, fallback-to-manual containment), release T9. Entitlement gating inherited via `ROUTE_FEATURES`/nav `feature`/RLS from earlier plans.
- Contract consistency: `draft-manual` and `countersign-test` extend the SAME `generate-hire-orders` action switch defined in the core plan Task 8; `ResolvedImportRow.sheet` feeds `FieldLayers.sheet` verbatim; RPC arg names match the wrapper.
- Failure containment rules present: import per-row exception capture; Documenso failure never blocks issuance; webhook idempotent + fail-closed on secret.
