# Hire Orders: PDF engagement sheets, spreadsheet import, and per-org module entitlements

Date: 2026-07-17 · Status: draft for review · Verified against `main` @ `a80769e` (v1.9.0)

Related: design project "Contract & hire orders" (claude.ai/design, five UI variants V1–V5 + `HireOrderDoc`), scoping artifact "Hire orders — build breakdown", booking-flow specs `2026-07-14-booking-flow-editor-design.md` / `2026-07-15-configurable-eligibility-design.md`.

## Summary

When a show date is filled, each engaged artist receives a **hire order**: a PDF sheet confirming that the production firm hires them at a set rate, with date, location, duration, fee, and terms, delivered by in-app notification and email. Producers can also create orders **manually (single or batch)** for dates filled outside ShowFlow, and **import** order data from a Google Sheet or Excel file with column/row selection. Every document field resolves through a three-way source chain: **ShowFlow data → spreadsheet value → manual entry**, with org defaults underneath.

The feature ships behind a new **per-org entitlement system** ("modules") that also retroactively gates the configurable booking flow, so the super-admin can enable exactly what an org has paid for, without breaking any live behavior.

Verified codebase facts this spec builds on (all confirmed on v1.9.0): no monetary field exists anywhere in the schema; Supabase Storage is entirely unused; `send-transactional-email` does not forward attachments (Resend supports base64 attachments); no hire/contract/document concept exists; `compute_show_date_status()` writes `fully_filled` silently with no observer. Strong reuse anchors: the artist-import wizard stack (`src/lib/artistImport/*`, `ArtistImportDialog`, `fetch-remote-sheet`, `bulk_import_artists`), the Airtable mapping/link UX (`AirtableSyncTab`), the booking-flow settings tab pattern (`bookingFlow/` editor + rail + `settings_audit_log`), and the dual-home policy-module pattern (`src/lib/bookingFlow.ts` ↔ `_shared/bookingFlow.ts`).

## Decisions locked with the user

1. **Fee lives on the booking** (`bookings.fee_amount`), prefilled from show/org defaults, **snapshotted onto the order** at generation; later edits never rewrite issued documents.
2. **Auto-create Draft on fully-filled + notify producer; issuing is always a human action.** Fully-filled is one entry point of four, not a gate: single, batch, and import generation work regardless of date status (dates filled externally are first-class).
3. **Fee-only v1.** Deposit/balance payment schedules are out of scope (fast follow).
4. **Running order from existing `session_1..3`; one new `show_dates.duration_minutes` column.**
5. **Renderer: `@react-pdf/renderer` behind a renderer port, spike-gated; `pdf-lib` is the committed fallback** (both MIT). **Countersignature is an org-choosable mode: `manual` (mark as countersigned) or `documenso` (real e-sign via API + webhook).**
6. **One order per artist × date** (per confirmed booking when one exists; imports/manual orders may link artist + date without a booking).
7. **All five design variants ship**: V1 banner+modal on the date sheet, V2 split builder, V3 document viewer, V4 tracking dashboard, V5 guided wizard.
8. **New requirement: per-org feature entitlements** gate `hire_orders` and `booking_flow` independently, toggled by super-admins from the Platform console, enforced without breaking existing orgs.

---

## 1. Feature entitlements (platform-gated modules)

### 1.1 Why not `app_settings`

Org-scoped `app_settings` rows are writable by **org admins** (permissive policy rewritten to `has_org_role(auth.uid(), org_id, 'admin')` in `20260603130200_org_scoped_role_gating.sql`), and platform-default rows are readable by every authenticated user (the documented `cron_secret` leak precedent). Entitlements are billing-derived and must be **super-admin-write-only**, so they get their own table.

### 1.2 Data model

```sql
create table public.org_entitlements (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  feature    text not null,                 -- registry key: 'booking_flow' | 'hire_orders'
  enabled    boolean not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, feature)
);
```

- RLS: SELECT for org members (`is_org_member(auth.uid(), org_id)`), ALL writes for super-admins only (`is_super_admin(auth.uid())`), plus the restrictive `org_isolation` template.
- **No row = registry default.** The feature registry is a dual-home pure module (`src/lib/entitlements.ts` ↔ `supabase/functions/_shared/entitlements.ts`, mirroring the `bookingFlow.ts` pattern):
  `booking_flow → default_enabled: true` (every existing org is grandfathered; nothing breaks on deploy), `hire_orders → default_enabled: false` (ships dark, enabled per paying org).
- SQL twin for trigger/RLS-time checks:
  `is_feature_enabled(_org uuid, _feature text) returns boolean` — SECURITY DEFINER; returns the row's `enabled` if present, else the default from a `CASE` mirroring the registry (kept in sync in the same PR, like `notificationCategories.ts` ↔ `category_of()`).
- Audit: an `AFTER INSERT OR UPDATE` trigger writes to the existing generic `settings_audit_log` with `key = 'entitlement:' || feature` — the Platform console and org settings can reuse `fetchSettingsAudit` for change history.

### 1.3 Enforcement layers (best-in-class: layered, fail-soft)

The suspended-org precedent is UI-plus-cron-only; entitlements get one stronger layer, but the guiding rule is **"disabling a module degrades to defaults, never to breakage."**

| Layer | Mechanism |
|---|---|
| Client data | `fetchEntitlements(client, orgId)` + `useEntitlements()` hook (query `['entitlements', orgId]`); convenience `useFeature('hire_orders')`. Rides alongside `currentOrg`, not inside AuthContext (no auth reload on toggle). |
| Nav | `NavItem.feature?: string`; `visibleNavItems` gains `if (item.feature && !ctx.enabledFeatures.has(item.feature)) return false` — same shape as the existing `superAdmin` check (`navItems.ts:48-60`). |
| Routes | Route→feature map consulted in `ProtectedRoute` after the suspended-org check; disabled → `FeatureDisabledScreen` (sibling of `NoOrgScreen`/`SuspendedOrgScreen`). Super-admins bypass (god-mode parity with the suspension check). |
| Surfaces | Feature-gated components (`V1` card, artist affordances, settings tabs) check `useFeature(...)` and render nothing or a locked state (1.5). |
| Edge functions | `requireFeature(deps, orgId, feature)` helper in `_shared/entitlements.ts`; interactive hire-order endpoints 403 with `{ error: "feature_disabled" }`. Cron passes skip unentitled orgs after `getActiveOrgs`. |
| DB | The fully-filled auto-draft trigger (4.1) and hire-order RLS **write** policies consult `is_feature_enabled(org_id, 'hire_orders')`. Reads stay role-based so an org whose module lapses keeps read access to already-issued documents (legal records are never locked away). |

### 1.4 Booking-flow gating semantics (non-breaking by construction)

`booking_flow` disabled ≠ booking stops. Both resolution funnels get one wrapper:

- Frontend: `fetchBookingFlow` (`src/data/settings.ts:61-66`) returns `normalizeBookingFlow(null)` (= classic defaults) without reading the org override when the feature is disabled.
- Edge: `resolveBookingFlow` (`_shared/bookingFlow.ts:100-105`) identically.
- SQL: new `get_effective_booking_flow(_org uuid) returns jsonb` = `CASE WHEN is_feature_enabled(_org,'booking_flow') THEN get_org_setting(_org,'booking_flow') ELSE NULL END`; the trigger call sites that currently read `get_org_setting(org_id,'booking_flow')` directly (`20260714105906`, `20260715130100`, `20260714182625` ×2) switch to it.

Effect: a disabled org runs the exact classic pipeline it ran before 1.9.0. Its stored `booking_flow` config is preserved untouched; re-enabling restores the custom flow instantly. Settings → Booking flow renders a **locked state** (preset chips disabled, current effective flow shown read-only, note: "This module is not enabled for your organization. Contact your ShowFlow administrator.") rather than disappearing, so orgs can see what they'd get.

### 1.5 Platform console UI

- `EditOrgDialog` gains a **Modules** section: one `Switch` per registry feature with description + since/updated-by line; writes via `setOrgEntitlement(client, orgId, feature, enabled)` in `src/data/platform.ts`, invalidating `['platform']` and `['entitlements']`.
- `OrganizationsTab` rows show compact module chips (e.g. `BF · HO`) so the fleet view reveals who has what.
- `PlatformDefaultsTab` gains a "Default modules for new orgs" card; `provision-org` seeds explicit rows from it at org creation.

---

## 2. Data model (hire orders)

### 2.1 `hire_orders`

```sql
create type hire_order_status as enum ('draft','ready','issued','countersigned','void');

create table public.hire_orders (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id),
  order_no               text not null,                    -- unique per org
  status                 hire_order_status not null default 'draft',
  booking_id             uuid references public.bookings(id) on delete set null,
  artist_id              uuid references public.artists(id) on delete set null,
  show_date_id           uuid references public.show_dates(id) on delete set null,
  data                   jsonb not null,                   -- document snapshot + provenance (2.2)
  fee_amount             numeric(10,2),
  fee_currency           text not null default 'EUR',
  terms_variant          text not null default 'standard', -- 'lean' | 'standard' | 'full'
  pdf_path               text,                             -- storage object path, set on render
  countersign_mode       text,                             -- 'manual' | 'documenso', frozen at issue
  documenso_envelope_id  text,
  import_id              uuid references public.hire_order_imports(id) on delete set null,
  created_by             uuid references auth.users(id),
  issued_at              timestamptz,
  countersigned_at       timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (org_id, order_no)
);
create unique index hire_orders_active_booking_uniq
  on public.hire_orders (booking_id) where booking_id is not null and status <> 'void';
```

- `trg_derive_org_id`-style guard: when `booking_id`/`show_date_id`/`artist_id` are set, org consistency is re-derived and checked (mirrors `derive_org_id_for_booking()`).
- Status transition guard `enforce_hire_order_transition()` (mirrors `enforce_booking_transition`): `draft → ready → issued → countersigned`; `void` reachable from any state; issued/countersigned rows are immutable except `status`, `countersigned_at`, `documenso_envelope_id` (reissue = void + new row with a `-R2` suffixed order number).
- `update_updated_at_column()` trigger as per convention.

### 2.2 Snapshot & provenance (`data` jsonb)

Every document field is stored as `{ value, source }` where `source ∈ 'showflow' | 'sheet' | 'manual' | 'default'`:

```jsonc
{
  "artist_name":   { "value": "Mara Mustermann", "source": "showflow" },
  "date":          { "value": "2026-06-15",      "source": "showflow" },
  "venue":         { "value": "Colosseum Berlin", "source": "sheet" },
  "city":          { "value": "Berlin",           "source": "showflow" },
  "duration_min":  { "value": 90,                 "source": "manual" },
  "fee":           { "value": "4500.00",          "source": "sheet" },
  "role":          { "value": "Lead vocalist",    "source": "showflow" },
  "cast":          { "value": "Berlin 1",         "source": "showflow" },
  "sessions":      { "value": ["19:00","21:00"],  "source": "showflow" },
  "recipient_email": { "value": "m@mail.de",      "source": "showflow" }
}
```

Resolution precedence when building/refreshing a draft: **manual > sheet > ShowFlow > org default**. The pure resolver (`src/lib/hireOrders/resolveFields.ts`, dual-homed to `_shared/hireOrders.ts` for the edge renderer) is the single implementation; the V2 builder shows a per-field provenance chip (SF / Sheet / Manual) and editing any field flips it to `manual`. Drafts may be re-synced from ShowFlow ("Refresh from ShowFlow" action re-resolves every non-manual field); issued orders never re-resolve.

### 2.3 Fee source

- `bookings.fee_amount numeric(10,2)` (nullable) + org defaults in `app_settings`: `hire_order_defaults = { default_fee: null, currency: 'EUR' }`.
- Producer sets/adjusts the fee in the V1 modal / V2 builder / V5 wizard; the value writes back to the booking (when one is linked) and snapshots into `data.fee`.

### 2.4 Duration

- `show_dates.duration_minutes integer` (nullable). Rendered as "90 min" in the facts grid; running-order rows come from `session_1..3` labelled Session 1..3 (org-relabelable later, out of scope).

### 2.5 `hire_order_imports`

```sql
create table public.hire_order_imports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  source      text not null,        -- 'xlsx' | 'csv' | 'gsheet'
  file_name   text,
  mapping     jsonb not null,       -- column→field map + row selection + header row
  row_count   integer not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
```

Audit + "re-run with same mapping" convenience; orders point back via `import_id`. Standard org RLS (producer/admin write).

### 2.6 Settings keys (all org-overridable via `resolveOrgSetting`)

| Key | Content |
|---|---|
| `hire_order_letterhead` | `{ legal_name, address_lines[], registration_line, agent_name?, agent_email? }` (letterhead + "Hiring party" block; logo upload out of scope) |
| `hire_order_terms` | `{ lean: Clause[], standard: Clause[], full: Clause[] }`, `Clause = { title, body }`; seeded with the design's 4/8 default clauses (DE/EN copy, no em-dashes) |
| `hire_order_numbering` | `{ prefix: 'HO', pattern: '{prefix}-{yyyy}-{mmdd}-{cast|seq}' }` — rendered by a pure `formatOrderNo()`; uniqueness enforced by the DB constraint with a `-2`, `-3` suffix on collision |
| `hire_order_defaults` | `{ default_fee, currency }` |
| `hire_order_countersign` | `{ mode: 'manual' | 'documenso' }` (Documenso credentials live in Vault, not here — see §8) |

All keys join `settings_audit_log` automatically (generic trigger) → free change history in the settings rail.

### 2.7 RLS

- Producers/admins: full CRUD on their org's rows (writes additionally require `is_feature_enabled(org_id,'hire_orders')`, §1.3).
- Artists: SELECT rows where `artist_id` maps to an org artist with `user_id = auth.uid()` and `status in ('issued','countersigned')` (drafts are producer-private).
- Restrictive `org_isolation` on both new tables.

## 3. Lifecycle

`draft` (data resolved, editable) → `ready` (validation passes: fee, recipient email, letterhead present) → `issued` (PDF rendered + stored, email + notification sent, optionally Documenso envelope created) → `countersigned` (manual mark or Documenso webhook). `void` from any state. Maps 1:1 to the design's badge tones (Draft / Ready to issue / Awaiting countersign / Countersigned).

## 4. Generation entry points

### 4.1 Auto-draft on fully-filled

`compute_show_date_status()` stays untouched. A new `AFTER UPDATE OF status ON show_dates` trigger fires `WHEN NEW.status = 'fully_filled' AND OLD.status IS DISTINCT FROM NEW.status`; it checks `is_feature_enabled(org,'hire_orders')`, then uses the existing pg_net dispatch machinery to invoke `generate-hire-orders` (service-role) with `{ show_date_id, action: 'draft' }`. The function creates one draft per confirmed booking (idempotent: skips bookings that already have an active order) and inserts a `hire_orders_ready` notification for producers (resolved via `resolve_show_assignments`, fallback org admins — same as `booking_ready_to_confirm`). Works in every booking-flow mode, including direct booking (a direct-booked date reaches `fully_filled` through the same status computation).

### 4.2 Manual single

- From the date sheet (V1): banner + "Generate hire order" per confirmed artist, no `fully_filled` requirement (button label switches between "Generate" and "Regenerate draft").
- From the tracking page (V4): "New order" → V5 wizard, free choice of artist × date (any org artist, any date, or no linked date with fully manual engagement facts).

### 4.3 Manual batch

- V4 table: row checkboxes → bulk actions "Create drafts" / "Issue selected" (only `ready` rows issue; per-row result toast summary, mirroring `bulkConfirmSoftBooked` semantics).
- Date sheet: "Generate for all confirmed artists" creates the full set for one date.

### 4.4 Spreadsheet import → §5.

## 5. Spreadsheet import (Google Sheets / Excel)

A five-step wizard (`HireOrderImportDialog`), structurally extending the proven `ArtistImportDialog` (Source → Map → Review → Done) with a range step and an entity-resolution step:

1. **Source** — upload `.xlsx`/`.csv` (parsed by the existing `parseSheet.ts`; SheetJS already a dependency) or paste a public Google Sheets link (existing `fetch-remote-sheet` edge fn, unchanged: SSRF-guarded published-CSV proxy). 5,000-row cap as today.
2. **Range** — new: worksheet picker (xlsx multi-sheet), header-row selector (default row 1, preview-driven), and row scope (all rows / range `from–to` / per-row checkboxes in a virtualized preview grid). Persisted into `hire_order_imports.mapping`.
3. **Map columns** — one `Select` per hire-order field (artist name, artist email, date, venue, city, duration, fee, currency, role, cast, notes), options = sheet headers + "Ignore"; prefilled by a `guessMapping`-style header matcher extended with money/date rules (`fee|gage|honorar|betrag`, `datum|date`, etc.). Unmapped fields fall back to ShowFlow/defaults per the §2.2 precedence.
4. **Resolve** — per distinct artist and date value, match against the catalog: artists by lowercased email then exact name (status pill Linked / Unlinked + per-row combobox to search-link or `Create artist`, the exact `AirtableSyncTab` catalog-linking pattern); dates by `date + city/venue` (link, or leave unlinked = standalone order). Unresolved rows can be skipped.
5. **Review & create** — count tiles (Ready / Needs attention / Skipped), inline cell editing (edits become `source: 'manual'`), then a single `bulk_import_hire_orders(p_org, p_rows)` SECURITY DEFINER RPC (mirrors `bulk_import_artists`: role re-check, per-row jsonb status result, single transaction) creates **drafts**. Issuing is a separate explicit step (batch-issue from V4), keeping import side-effect-free.

## 6. PDF rendering

- **Renderer port**: `renderHireOrderPdf(order: ResolvedOrder): Promise<Uint8Array>` defined in `supabase/functions/_shared/hireOrders.ts`; the edge function depends only on the port (injected via `Deps` for tests, `makeFakeDeps` returns a stub PDF).
- **Spike task (time-boxed, 1 day): `@react-pdf/renderer` on the Supabase Edge runtime** via npm specifier — layout is declarative flexbox, closest to the design JSX. Known risk: PDF libs with filesystem/font access are the documented trouble spot in edge functions (fonts must load from bundled `Uint8Array`s, never file paths). **Pass → react-pdf supersedes pdf-lib as the implementation. Fail → `pdf-lib` implementation of the same port** (proven in edge functions; hand-measured layout translated once from the design). Both MIT; decision recorded in the plan before implementation tasks start.
- Template = the `HireOrderDoc` design: letterhead (legal name, address, registration, order number, status), engagement title block, parties grid, 4-fact strip (date/venue/duration/fee with accent fee cell), running order table, fee block ("Total payable"), terms clauses (variant-dependent 4 or 8), signature block, footer with `Generated by ShowFlow Pro`. Geist + Geist Mono embedded as bundled font bytes.
- **Storage**: private bucket `hire-orders` (first Storage use; created in a migration via `storage.buckets` insert + storage RLS: org-scoped read for members whose org matches the object path prefix `org_id/…`, service-role write only). Path: `<org_id>/<order_no>.pdf`. Downloads always via short-lived signed URLs (60 min) minted by a `get-hire-order-url` action inside the edge function (never public URLs); the email additionally embeds the PDF as an attachment (§7).
- Render happens at **issue** time (and on preview: a `preview` action renders without persisting, for V1 "Preview PDF" and V2 live preview refreshes, debounced).

## 7. Delivery: email + notifications

- **Attachments**: `send-transactional-email` gains an optional `attachments: [{ filename, content_base64 }]` field on `EmailMessage` (`_shared/deps.ts`), validated (≤2 attachments, ≤5 MB decoded each), forwarded verbatim in the Resend POST body. Attachments are unsupported on Resend batch sends; hire-order emails are individual sends (as all current sends are).
- **Template** `hire-order-issued` registered in `registry.ts`: subject "Your hire order for {date} · {venue}", body = engagement summary card + CTA "View & download" (deep link via `_shared/app-url.ts`, never a hardcoded host) + PDF attached. Countersign-mode-aware paragraph: manual mode explains reply/return; documenso mode carries the signing-link CTA. Per-org copy overrides + preview come free via `EmailTemplatesCard` / `EMAIL_TEMPLATE_KEYS`.
- **Notification types** (new category `hire_orders` added to `NOTIFICATION_CATEGORIES`, `IN_APP_TYPE_CATEGORY`, `EMAIL_TEMPLATE_CATEGORY`, and the SQL `category_of()`/`should_notify()` in the same PR):
  - `hire_orders_ready` → producers, on auto-draft (4.1).
  - `hire_order_issued` → artist (in-app when a linked `artists.user_id` exists; email resolved login-first via `resolve_user_contacts`, falling back to the snapshot `recipient_email` for unlinked/imported artists — email-only in that case).
  - `hire_order_countersigned` → producers (both modes).
- All sends carry `idempotency_key = 'hire-order-issued:' + order.id` and respect the existing suppression/prefs gates.

## 8. Countersignature

Org setting `hire_order_countersign.mode`:

- **`manual`** (default): V3 shows "Mark countersigned" (producer action, timestamped, audit-logged). No external dependency.
- **`documenso`**: on issue, `generate-hire-orders` uploads the PDF via the Documenso REST API, adds the artist as recipient with a signature field on the signature block, and sends; `documenso_envelope_id` stored. A new `documenso-webhook` edge function (`verify_jwt = false` + `[functions.documenso-webhook]` block in `config.toml`) validates the `X-Documenso-Secret` header (secret in Vault, mirroring the Airtable PAT pattern) and on `document.completed` sets `countersigned` + notifies producers. Connection config (base URL for cloud or self-hosted instance, API token) lives in the settings tab with a "Test connection" action (mirrors `airtable-schema`'s admin-only proxy pattern; token never returned to the client). Manual mark stays available as a fallback while an envelope is pending.

## 9. UI surfaces (all five variants)

| Variant | Surface | Placement |
|---|---|---|
| V1 | "Ready for hire order" banner + generate/review modal (facts, fee input, terms variant picker, preview, "Issue and send") | `ShowDateDetailSheet`, new Card after Assigned Artists (post-L775), `canManage` + `useFeature` gated; banner shown when date is `fully_filled` OR any confirmed booking lacks an active order |
| V2 | Split builder: left = parties/engagement/fee/terms sections with per-field provenance chips + three-way source control, right = live document preview | `/hire-orders/:id/edit` (drafts and ready only) |
| V3 | Document viewer: full sheet + status timeline rail (Created → Issued → Awaiting countersign → Countersigned → Filed), recipient card, at-a-glance facts, primary action (Issue / Mark countersigned / Resend / Download) | `/hire-orders/:id` |
| V4 | Tracking dashboard: KPI tiles (Issued / Awaiting countersign / Countersigned / Value committed), filterable all-orders table, row slide-over with actions, bulk select → batch draft/issue, "Import from spreadsheet", "New order" | `/hire-orders` — new `ROUTES.HIRE_ORDERS`, `NavItem { section:'workspace', roles:['admin','producer'], feature:'hire_orders', badge:'awaitingCountersign' }` (badge count joins `useNavCounts`) |
| V5 | Guided wizard (Confirm engagement → Fee → Running order → Review & issue) for new single orders, incl. fully manual engagements | launched from V4 "New order" |

Artist side (`feature`-gated): "Hire order" chip on My Bookings rows with issued orders, a download/list card in the shared date sheet and ArtistDashboard, deep link target of `hire_order_issued`. Downloads via signed URL.

**Settings → Hire orders tab** (admin, feature-gated, mirrors the booking-flow tab composition): cards for Letterhead, Defaults (fee/currency), Numbering, Terms variants (clause list editor per variant), Countersign mode (+ Documenso connection & test); right rail = save/discard + `useSettingsAudit(HIRE_ORDER_AUDIT_KEYS)` change history. Email copy continues to live in the existing `EmailTemplatesCard`.

## 10. Testing

Per the five-layer convention, test-first:

- **Unit (vitest)**: `resolveFields` precedence matrix (manual > sheet > showflow > default), `formatOrderNo` + collision suffixing, import mapping guesser, range/row selection reducer, entitlement registry defaults, `visibleNavItems` feature filtering, lifecycle validation (`ready` gate).
- **Data-access (supabaseFake)**: `fetchEntitlements`, `setOrgEntitlement`, hire-order CRUD, `bulkImportHireOrders`, badge count query.
- **pgTAP**: `org_entitlements` RLS (member read / super-admin-only write), `is_feature_enabled` defaults, hire-order RLS incl. artist read-own and entitlement-gated writes, transition guard, fully-filled trigger fires exactly once per transition and respects entitlement, `bulk_import_hire_orders` role re-check + per-row statuses, org-consistency guard.
- **Edge (Deno, DI)**: `generate-hire-orders` draft/issue/preview branches with stub renderer (fake deps), attachment forwarding in `send-transactional-email`, `documenso-webhook` secret validation + status update, `requireFeature` 403s, cron skip of unentitled orgs. Run the whole `supabase/functions/` suite (multi-test-file rule).
- **E2E (Playwright)**: producer flow (confirm date → auto-draft banner → issue → artist downloads), import wizard happy path (fixture xlsx → mapped → drafts), entitlement toggle (super-admin disables → nav/route/edge all deny; booking flow falls back to classic).
- **Spike artifact**: deployed canary function proving react-pdf renders the template with embedded fonts on the real edge runtime (pass/fail gates the renderer choice).

## Out of scope (this initiative)

- Deposit/balance payment schedules, invoicing, VAT logic (fee-only v1; the terms clauses may reference payment in prose).
- Logo upload for letterheads (text letterhead + brand mark only; needs an org-assets bucket, later).
- E-sign providers beyond Documenso; artist-side in-app signing UI (Documenso hosts the signing page).
- Custom per-org PDF layouts (pdfme-style designer).
- Billing/plan integration for entitlements (Stripe etc.) — toggles are manual super-admin actions.
- Org-relabelable running-order rows (soundcheck/doors labels).
- Retroactive hire orders for historical dates (works technically, but no dedicated backfill tooling).

## Rollout and back-compat

- **Phased PRs** (each independently shippable, spec → plan → TDD per house rules): ① entitlements platform (registry, table, RLS, resolution wrappers, Platform console UI, booking-flow gating + locked settings state); ② hire-orders schema + settings tab + fee/duration columns; ③ renderer spike → renderer + storage + `generate-hire-orders` core; ④ delivery (attachments, template, notifications) + V1/V3 + artist surfaces; ⑤ V4/V5 + batch ops; ⑥ import wizard + RPC; ⑦ Documenso mode.
- Feature ships **dark** (`hire_orders` default-off); `booking_flow` defaults on, so deploy order is safe with zero behavior change for existing orgs. Enabling an org is a single Platform-console toggle.
- `docs/system-map.md` + `src/data/systemMap.ts` updated in the same PR as each automation change (fully-filled trigger, crons, webhook). `supabase/config.toml` blocks added for `generate-hire-orders` (`verify_jwt = false` — the fully-filled trigger invokes it with `X-Cron-Secret`, so the gateway must not force JWT; auth happens in-function via `requireCronOrRole` + `requireFeature`) and `documenso-webhook` (`verify_jwt = false`). Types regenerated after every DDL PR. Changelog + version bump on release (target 1.10.0).
