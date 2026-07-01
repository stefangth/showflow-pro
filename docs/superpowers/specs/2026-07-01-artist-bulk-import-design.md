# Bulk artist import from a spreadsheet — design

**Date:** 2026-07-01
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Initiative:** Artist onboarding — spec **B of 2** (builds on
`2026-07-01-artist-account-linking-design.md`)

## Context

Producers keep artist rosters in spreadsheets (often Google Sheets) and want to load them into
Showflow Pro in bulk instead of adding artists one at a time. Today the only entry point is the
admin-only "Add Artist" dialog (single record) on `src/pages/ArtistsPage.tsx`. There is no import.

This spec adds an **import wizard** — ingest a sheet → map columns → review/select rows → bulk
create — modeled on best-in-class CSV import UX (Flatfile / OneSchema / Stripe / Airtable). It is
gated to **producer + admin** (deliberately one role wider than single "Add Artist", which is
admin-only). It **builds on spec A**: an optional "send login invites to imported artists" step
reuses spec A's `create-invitation({ artist_id })`; spec B can ship without that step if A hasn't
merged.

### Current state (verified)

- **Artists page** `src/pages/ArtistsPage.tsx`: "Add Artist" dialog is admin-only (`hasRole(
  'admin')`); `createArtist` inserts `name` (required), `email`, `phone`, `bio`, `org_id`
  (`user_id` null). This is the surface the "Import from sheet" button sits beside.
- **`artists` schema** (`src/integrations/supabase/types.ts` ~212–261): `name` required; `email`,
  `phone`, `bio` nullable; `status` defaults to `active`; `org_id` required. Email is **not**
  unique — dedup must be explicit. Skills/casts are separate junction tables.
- **Data-access pattern:** `src/data/*.ts` `fetchX(client,args)` / RPC wrappers; tested with
  `src/test/supabaseFake.ts`. Edge functions use `handle(req, deps)` + `_shared/http.ts` /
  `_shared/auth.ts` (`requireOrgRole`) + `makeFakeDeps`.
- **Artists insert RLS** is effectively admin (single add is admin-only). Granting producers
  bulk-insert therefore goes through a `SECURITY DEFINER` RPC that checks `has_org_role(…,
  ['producer','admin'])` itself, rather than loosening the table policy.
- **No spreadsheet parser** in the dependency tree; no Google integration. There is an existing
  **Airtable sync** engine (live external source → `show_dates`) — the philosophical parallel for
  *live* sync, but out of scope here (this is a one-time bulk load).
- **New edge functions** need a `[functions.<name>]` block in `supabase/config.toml`.

## Goals

1. A **producer+admin** "Import from sheet" wizard on the Artists page.
2. **Ingest** via file upload (`.csv`/`.xlsx`) **or** a pasted public Google Sheets link.
3. **Map** detected columns → artist fields with auto-match, searchable pickers, and live sample
   values; **review** rows with validation, dedup (skip existing by email), search, and
   multi-select; **bulk create** atomically.
4. Optionally **send login invites** to imported artists (reuses spec A).

## Non-goals (explicitly out of scope)

- Skills/casts column mapping (junction match-or-create) — future.
- Live Google OAuth / Picker / repeatable sync — a separate initiative paralleling Airtable sync.
- A batched bulk-invite endpoint — v1 sends invites sequentially post-import.
- Re-import / update-history / audit of imports.
- Updating existing artists from the sheet (dedup is **skip**, not upsert).

## Decisions (made during brainstorm)

- **Ingestion:** file upload (`papaparse` for CSV; SheetJS `xlsx` **lazy-loaded** on demand) **plus**
  a paste-public-link option fetched through a new **`fetch-remote-sheet`** edge proxy
  (host-allowlisted to Google Sheets, SSRF-guarded).
- **Dedup = skip existing**, matched on `lower(email)` within the org; flagged in the preview; rows
  without an email are always "new".
- **Commit** via a `SECURITY DEFINER` **`bulk_import_artists`** RPC that re-checks dedup server-side
  and inserts set-based in one transaction, returning per-row status.
- **UI** is a Flatfile-grade 4-step wizard (Source · Map · Review · Done) built from existing
  shadcn primitives + semantic tokens.

## Design

### A. Entry point & gating

- An **"Import from sheet"** button beside "Add Artist" on `ArtistsPage.tsx`, opening a wide
  `Dialog` (`ArtistImportDialog`) with internal step state — no new route.
- Gated **producer + admin** in the UI **and** server-side in `bulk_import_artists` /
  `fetch-remote-sheet` (`requireOrgRole` / `has_org_role`). Never trust the client gate.

### B. Ingestion (Source step)

- **File upload:** drag-and-drop + browse. `.csv` parsed with `papaparse`; `.xlsx` with SheetJS
  `xlsx`, **dynamically `import()`-ed only when an xlsx is dropped** (it's heavy — keeps the main
  bundle lean). Parsing is client-side; nothing is uploaded to storage.
- **Paste link:** a Google Sheets URL fetched via `fetch-remote-sheet` (browser CORS to Google's
  export endpoint is unreliable; server-side is robust). A **"Download template"** action provides a
  correctly-headed sample CSV so columns line up.
- **Caps + confirmation:** reject files/sheets over ~5,000 rows or an oversized byte limit with a
  clear message; after parse show filename + detected row count before proceeding.

### C. `fetch-remote-sheet` edge function (new) — SSRF-guarded proxy

- `handle(req, deps)`; `requireOrgRole(org_id, ['producer','admin'])`.
- **Host allowlist:** only `docs.google.com` published-CSV URLs (validate host + path shape);
  reject anything else (`400`). **No redirect-following** to non-allowlisted/internal hosts;
  enforce response-size + timeout caps. Returns CSV text `{ csv }` (never proxies arbitrary bodies).
- `[functions.fetch-remote-sheet]` block in `supabase/config.toml` with `verify_jwt = true`
  (producer+admin via user JWT).

### D. Wizard flow (pure state machine)

`Source → Map columns → Review & select → Commit(Done)`, with back/next and cancel/restart at any
time. Parsed rows + mapping held in component state; **no side effects until commit** (local parse),
so cancelling is always safe.

### E. Map-columns step

- Show detected headers. For each target field — **Name\*** (required), Email, Phone, Bio — a
  **searchable** `Command`-based select of source columns (search matters for wide sheets), plus an
  **"Ignore this column"** option.
- **Auto-match** by header name (`name`→name; `e-mail`/`email`→email; `tel`/`mobile`/`phone`→phone;
  `bio`/`notes`→bio), shown with a "matched" cue; user can override.
- Beside each mapping, show **live sample values** from that column (first few rows) so the user
  verifies without guessing. Cannot advance until **Name** is mapped.

### F. Review & select step

- Normalized rows with per-row status: **new** / **exists — skipped** (email matches an existing org
  artist, case-insensitive) / **needs attention** (invalid, e.g. missing name or malformed email →
  auto-excluded). Rows without email are always "new" (can't dedup).
- **Summary metric cards** (to import / duplicate / needs attention) + **filter chips** (All / New /
  Skipped / Errors), a **search** box, and **multi-select** checkboxes with select-all/none.
  Skipped/invalid rows are unchecked by default and visually de-emphasized with the reason
  (cell-level for validation errors, on hover).
- **Partial import:** invalid rows never block the valid ones.
- Optional **"Also send login invites"** checkbox (spec A) — enabled only for selected rows that
  carry an email.

### G. Commit — `bulk_import_artists(p_org uuid, p_rows jsonb) returns jsonb` (new RPC)

- `SECURITY DEFINER`; internally checks `has_org_role(auth.uid(), p_org, ['producer','admin'])`
  (rejects otherwise). `revoke all from public, anon; grant execute to authenticated`.
- One transaction: for each row, **re-derive dedup server-side** (`lower(email)` vs existing org
  artists — the client preview can be stale), skip matches, insert new artists with `org_id`,
  `status = 'active'`, and the mapped fields. Returns a jsonb array of
  `{ index, status: 'created'|'skipped_existing'|'error', artist_id?, error? }`.
- Set-based + atomic; grants producers bulk-insert without loosening the admin-only single-insert
  table RLS. Frontend shows a **result summary** (Done step) + next actions ("View artists", "Send
  invites"), optional **error-report CSV** of failed rows, and invalidates `['artists']` (+ the
  spec-A `['artists','pending-invites', orgId]` key if invites were sent).

### H. Optional invite-on-import (depends on spec A)

If the checkbox is on, after the RPC returns created `artist_id`s with emails, loop
`inviteArtistToApp({ orgId, artistId, email })` (spec A) with a progress toast. A batched
bulk-invite endpoint is future; sequential is fine for v1 volumes.

### I. Module decomposition (isolated, each unit-tested)

- `src/lib/artistImport/parseSheet.ts` — file/text + type → `{ headers, rows }` (pure; `xlsx` lazy).
- `src/lib/artistImport/guessMapping.ts` — headers → suggested field map (pure).
- `src/lib/artistImport/buildImportRows.ts` — rows + mapping + existing emails → normalized
  candidates + validation + dedup flags (pure).
- `src/data/artistImport.ts` — `bulkImportArtists(client, { orgId, rows })` → the RPC.
- `src/data/remoteSheet.ts` — `fetchPublicSheetCsv(client, url)` → the edge proxy.
- `supabase/functions/fetch-remote-sheet/index.ts` — the proxy.
- `supabase/migrations/<ts>_bulk_import_artists.sql` — the RPC.
- `src/components/artists/ArtistImportDialog.tsx` — a **thin** wizard shell over the pure modules +
  data hooks (parsing/mapping/dedup logic stays out of the component).

### J. Testing (test-first; the five layers)

- **Unit (vitest):** `parseSheet` (CSV + XLSX fixtures, quoted/edge headers), `guessMapping`
  (fuzzy header matches + no-match), `buildImportRows` (name-required, email format, dedup marking
  against existing emails, no-email → new); `bulkImportArtists` + `fetchPublicSheetCsv` emit the
  right RPC/function via `supabaseFake`; wizard step transitions + Name-required gate +
  preview search/select via `renderWithProviders`.
- **pgTAP (CI):** `bulk_import_artists` — producer allowed / artist denied / cross-org rejected;
  dedup skip; `status='active'` + `org_id` set; correct per-row jsonb.
- **Edge (Deno DI, `--node-modules-dir=none`):** `fetch-remote-sheet` — host allowlist, non-Google
  URL rejected, role gate, redirect/size guards. Run the whole `supabase/functions/` suite after.

## Files touched

**New**
- `src/components/artists/ArtistImportDialog.tsx` (+ test)
- `src/lib/artistImport/parseSheet.ts`, `guessMapping.ts`, `buildImportRows.ts` (+ tests)
- `src/data/artistImport.ts`, `src/data/remoteSheet.ts` (+ tests)
- `supabase/functions/fetch-remote-sheet/index.ts` (+ Deno test)
- `supabase/migrations/<ts>_bulk_import_artists.sql`
- `supabase/tests/*` pgTAP for `bulk_import_artists`

**Modified**
- `src/pages/ArtistsPage.tsx` (Import button, producer+admin, opens the dialog)
- `supabase/config.toml` (`[functions.fetch-remote-sheet]`, `verify_jwt = true`)
- `package.json` (add `papaparse` + `@types/papaparse`, `xlsx`)
- `CLAUDE.md` (edge-fn list: add `fetch-remote-sheet`; new RPC `bulk_import_artists`)
- `public/changelog.md` + version bump (below)

## Edge cases & error handling

- **Producer vs admin:** bulk import is producer+admin; single "Add Artist" stays admin-only —
  intentional and enforced server-side.
- **No-email rows:** importable, never dedup'd (always "new").
- **Duplicate within the same file:** two identical emails in one sheet — the RPC dedups against
  existing artists; intra-file duplicates both insert unless one already exists. (Flag in preview
  as a follow-up if it proves noisy; not blocking for v1.)
- **Malformed/oversized sheet, wrong delimiter, private Google link:** clear per-case error at the
  Source step; the proxy returns a typed error for non-public/non-Google URLs.
- **Stale preview at commit:** server-side dedup is authoritative; a row shown "new" that was
  created meanwhile comes back `skipped_existing`.
- **Invite send failures during invite-on-import:** per-row toast/summary; imported artists are
  unaffected.

## Risks & mitigations

- *SSRF via the paste-link proxy:* strict host+path allowlist, no redirect-following, size/timeout
  caps, role gate — covered by Deno tests before shipping.
- *`xlsx` bundle weight:* dynamic-import only on xlsx drop; CSV path never loads it.
- *Granting producers insert:* done only through the guarded definer RPC; the table policy is
  untouched, so single-add stays admin-only.
- *Spec-A coupling:* the invite step is feature-flagged/optional; B builds and ships even if A isn't
  merged (the checkbox is simply hidden until A lands).

## Versioning

User-facing feature → **MINOR** bump (coordinate with spec A if they land together — one combined
`vX.Y.0`). Update `package.json` + `APP_META.VERSION`, add a newest-first `public/changelog.md`
block (end-user voice), and regenerate `public/changelog.json` via the `changelog-to-json.ts` script.
