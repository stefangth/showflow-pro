# Runbook — Hire-order PDF font library

> **When you need this:** provisioning the font library for the first time (this runbook's own
> Task 5 handoff), or adding/replacing a family in the hire-order PDF theme's font picker later.

## What this bucket is for

The hire-order PDF theme (`src/lib/hireOrders/pdf/pdfTheme.ts`, mirrored to
`supabase/functions/_shared/hire-order-pdf/pdfTheme.ts`) declares a curated `FONT_FAMILIES`
registry that a per-org theme can select from. Geist and Geist Mono are the defaults and ship
base64-embedded directly in the edge function (`fonts.ts`), so the default render path performs
**zero** network I/O and can never fail. Every other family (Inter, IBM Plex Sans, Source Serif,
Libre Baskerville, IBM Plex Mono) is fetched at render time from the `hire-order-fonts` Storage
bucket. Until that bucket is provisioned and populated, every non-default family fails to load and
the renderer degrades gracefully to a react-pdf standard font (see "Failure behaviour" below) -
this is by design, not a bug, but it means the font picker has no real effect until this runbook's
steps are complete.

## Bucket

- **Name:** `hire-order-fonts`
- **Access:** public read (`storage.buckets.public = true`), **no client writes**. Fonts are
  uploaded by an operator using the service role key; orgs never upload fonts themselves.
- **Migration:** `supabase/migrations/20260725083229_hire_order_fonts_storage.sql` creates the
  bucket and the public-read policy. Applied to prod 2026-07-25.
- **Known advisory:** the Supabase security linter flags this bucket `WARN: Public Bucket Allows
  Listing` (`public_bucket_allows_listing`) because the `select` RLS policy that makes public
  object URLs work also allows enumerating the bucket's file list via the Storage API. This is
  expected and accepted for this bucket: it holds a small, fixed set of openly-licensed (SIL OFL)
  font files, not user or org data, so listing exposes nothing sensitive. Do not "fix" this by
  removing the select policy - object URL fetches (`/storage/v1/object/public/hire-order-fonts/...`)
  stop working without it.

## Path convention

Every object lives at `<family-key>/<filename>.ttf`, matching the `path` field of each
`FONT_FAMILIES` entry exactly:

```
geist/Geist-Regular.ttf
geist/Geist-Medium.ttf
geist/Geist-SemiBold.ttf
geist-mono/GeistMono-Regular.ttf
inter/Inter-Regular.ttf
inter/Inter-Medium.ttf
inter/Inter-SemiBold.ttf
plex-sans/IBMPlexSans-Regular.ttf
plex-sans/IBMPlexSans-Medium.ttf
plex-sans/IBMPlexSans-SemiBold.ttf
plex-mono/IBMPlexMono-Regular.ttf
plex-mono/IBMPlexMono-Medium.ttf
plex-mono/IBMPlexMono-SemiBold.ttf
source-serif/SourceSerif4-Regular.ttf
source-serif/SourceSerif4-SemiBold.ttf
libre-baskerville/LibreBaskerville-Regular.ttf
libre-baskerville/LibreBaskerville-Medium.ttf
libre-baskerville/LibreBaskerville-SemiBold.ttf
```

18 distinct objects (Geist and Geist Mono are listed for completeness - see "Why Geist needs
uploading too" below). `source-serif`'s weight-500 role and `source-serif`'s weight-400 role point
at the **same** path (`SourceSerif4-Regular.ttf`), so only 18 unique files are needed even though
`FONT_FAMILIES` declares more `{weight, path}` entries than that.

**TTF only, no exceptions.** `registerFonts`'s content sniffer (`looksLikeFont` in both
`pdfDeps.ts` shims) only recognizes real sfnt/OTF signatures. A WOFF or WOFF2 file renamed to
`.ttf` uploads without error, passes the extension check, and then either fails the sniffer
outright (silently degrading to Helvetica/Courier/Times-Roman) or - if it happens to share a
signature - produces bytes react-pdf's fontkit cannot parse at PDF-layout time. **Always confirm
with `file <path>` before uploading:**

```bash
$ file Inter-Regular.ttf
Inter-Regular.ttf: TrueType Font data, ...
```

Reject anything that doesn't say "TrueType Font data" (or "OpenType" for a `.otf`, though this
registry uses `.ttf` exclusively).

### Why Geist needs uploading too

Geist and Geist Mono are `embedded: true` in the registry, so the **edge** renderer (PDF issuing)
never fetches them - it always uses the base64 baked into `fonts.ts`. But the **browser** shim
(`src/lib/hireOrders/pdf/pdfDeps.ts`, used by the in-app live theme preview, Task 9) deliberately
does *not* carry that 700KB of base64 - it fetches every family, including Geist, from this same
bucket. Skip uploading Geist and the live preview breaks for the default theme even though the
real, issued PDF is unaffected.

## Licences

Every family below is SIL Open Font License 1.1 (OFL), confirmed against each project's own
`LICENSE`/`OFL.txt` at the exact release used:

| Family | Source | Licence |
|---|---|---|
| Geist / Geist Mono | github.com/vercel/geist-font | OFL 1.1 (already embedded; re-derive from `fonts.ts`'s base64 if the files are ever needed again - see below) |
| Inter | github.com/rsms/inter, release v4.1 | OFL 1.1 |
| IBM Plex Sans | github.com/IBM/plex, release `@ibm/plex-sans@1.1.0` | OFL 1.1 |
| IBM Plex Mono | github.com/IBM/plex, release `@ibm/plex-mono@2.5.0` | OFL 1.1 |
| Source Serif 4 | github.com/adobe-fonts/source-serif, release `4.005R` | OFL 1.1 |
| Libre Baskerville | github.com/impallari/Libre-Baskerville, commit `9852edf7` (2025-10-16) - no GitHub releases or tags exist for this repo, so this pins to the exact commit the files in this task were fetched from rather than the moving `master` branch | OFL 1.1 |

### Registry corrections made alongside this runbook (Task 5)

Two `FONT_FAMILIES` entries pointed at files that turned out not to exist upstream, or not to be
the best available file. Both are now fixed in `pdfTheme.ts` (source of truth:
`src/lib/hireOrders/pdf/pdfTheme.ts`, then `npm run sync:mirrors`):

- **Source Serif 4**: Adobe's static release ships ExtraLight/Light/Regular/Semibold/Bold/Black -
  there is no discrete weight-500 ("Medium") cut. The registry's weight-500 file now reuses the
  Regular file (same convention as Libre Baskerville's pre-existing weight-sharing below), instead
  of pointing at a `SourceSerif4-Medium.ttf` that was never obtainable.
- **Libre Baskerville**: the original entry mapped *both* weight 500 and weight 600 to the same
  `LibreBaskerville-Bold.ttf`. The upstream repo actually ships discrete `Medium.ttf` and
  `SemiBold.ttf` files (`fonts/ttf/LibreBaskerville-Medium.ttf`,
  `fonts/ttf/LibreBaskerville-SemiBold.ttf`); the registry now points weight 500 and 600 at those
  real files instead of doubling up on Bold.

### Family dropped from the original seven-family proposal

None. All seven families in the original proposal (Geist, Geist Mono, Inter, IBM Plex Sans,
Source Serif 4, Libre Baskerville, IBM Plex Mono) had straightforwardly obtainable, genuinely OFL
TTF files once the two path corrections above were made, so the registry keeps its full seven
entries.

## How to add (or replace) a family

1. Confirm the licence is OFL (or another licence the org is comfortable redistributing under a
   public bucket - this registry's existing convention is OFL-only).
2. Download the static TTF files for the weights you need (400/500/600). If a weight doesn't
   exist upstream, reuse the nearest available file's path rather than inventing one (see the two
   corrections above for the precedent) - never invent a path with no backing file.
3. Verify every file with `file <path>` - must report "TrueType Font data" (see above).
4. Add (or edit) the entry in **`src/lib/hireOrders/pdf/pdfTheme.ts`**'s `FONT_FAMILIES` array,
   then run `npm run sync:mirrors` to regenerate the edge copy at
   `supabase/functions/_shared/hire-order-pdf/pdfTheme.ts`. **Never hand-edit the generated
   target** - CI's `sync:mirrors:check` will fail if the two drift.
5. Upload the files to the bucket, matching the `path` values exactly. Two options:
   - **Supabase dashboard** → Storage → `hire-order-fonts` → upload into the matching folder.
   - **`scripts/upload-hire-order-fonts.ts`** (this repo) - derives the exact required path set
     from `FONT_FAMILIES` itself, so it can never drift from the registry:
     ```bash
     SUPABASE_URL=https://epweartpzwvcasrzyueh.supabase.co \
     SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
     deno run --allow-read --allow-net --allow-env scripts/upload-hire-order-fonts.ts --dir <local-dir>
     ```
     `<local-dir>` must mirror the bucket's folder layout (e.g. `<local-dir>/inter/Inter-Regular.ttf`).
     Pass `--dry-run` (no credentials needed) to verify local files exist and are real TTFs
     without uploading anything.
6. Confirm each upload is fetchable:
   ```bash
   curl -sI "https://epweartpzwvcasrzyueh.supabase.co/storage/v1/object/public/hire-order-fonts/<path>" | head -3
   ```
   Expected: `HTTP/2 200` and `content-type: font/ttf` (or `application/octet-stream`).

### If an upload fails

`scripts/upload-hire-order-fonts.ts` prints one line per object and exits non-zero if anything
went wrong, so a failed run is never silent:

- `MISSING <path> (expected at <local-dir>/<path>)` - the local file isn't where `--dir` says it
  should be. Fix the path or re-download the file; nothing was uploaded for that entry.
- `NOT A TTF <path> (<n> bytes, failed the magic-byte check)` - the local file exists but isn't
  real TrueType data (see "TTF only, no exceptions" above). Re-download from the source in the
  licence table; do not rename a WOFF/WOFF2 to `.ttf` to force past this check.
- `FAILED <path> (HTTP <status>: <body>)` - the upload request itself failed (bad/expired service
  role key, wrong `SUPABASE_URL`, network issue, or a Storage-side error). Re-run the script after
  fixing the cause; it's safe to re-run (`x-upsert: true` overwrites rather than 409ing on objects
  that already uploaded successfully in a prior partial run).
- The script exits 1 if any object hit any of the three cases above, 0 only when every required
  object uploaded (or, under `--dry-run`, verified locally) cleanly. Check the exit code in
  scripted/CI usage rather than only skimming the console output.

## Failure behaviour (already covered by tests, informational)

`registerFonts` (both `pdfDeps.ts` shims) treats a family's weight files as all-or-nothing: if any
weight fails to load (network error, non-2xx, timeout, or a 200 that isn't really a font), the
*whole family* is left unregistered for that render, and every role using it falls back to a
react-pdf standard font instead - `Courier` for a mono role, `Times-Roman` for a serif family,
`Helvetica` otherwise. This never happens for the default theme (Geist/Geist Mono are embedded,
zero network I/O). A failure is **not** cached against future renders: the next call retries the
real fetch, so a transient Storage blip degrades one document, not every document for the rest of
the process's life. Every fetch is bounded by an 8s timeout so a hanging endpoint can't stall
every themed render. See `supabase/functions/_shared/hire-order-pdf/pdfDeps.test.ts` for the
automated coverage of every branch above (fake-fetch injected, no real network).

## Status as of 2026-07-25 (Task 5)

- [x] Bucket created, public-read policy applied (migration
      `20260725083229_hire_order_fonts_storage.sql`, applied to prod).
- [x] All 18 required TTF files were downloaded from their official sources (the licence table
      above) and verified as real TrueType data (`file` check) during Task 5.
- [ ] **Files are NOT yet uploaded to the bucket, and the verified copies are NOT in this repo or
      worktree.** No Storage write credential (service role key) was available in the environment
      that did this work, and the downloaded TTFs themselves were never committed (this bucket's
      whole point is that fonts are Storage objects, not repo assets - see "Why this isn't
      checked into git" below).
      **A human with the service role key must (re-)acquire the 18 files and run
      `scripts/upload-hire-order-fonts.ts` (or use the dashboard) before any non-default theme
      actually renders with its intended typeface** - until then every non-default family degrades
      to a standard font, which is safe (never broken output) but not the intended result.
- [x] Degradation logic (all-or-nothing registration, non-sticky retry, content sniffer, standard-
      font substitution) is fully covered by `pdfDeps.test.ts` against a fake fetch - this does not
      depend on the bucket being populated.

### Why this isn't checked into git, and how to get the files

Font binaries belong in the Storage bucket, not the app repo (this is exactly the "no client
writes, operator-uploaded" model the bucket's RLS policy encodes) - so Task 5 never intended to
commit them, and the copies verified during that task were session-local, not persisted anywhere
in this repository or its history. There are two ways to get the 18 files onto disk before
running the upload script:

1. **The Task 5 session sent a ready-to-upload zip as a chat attachment** (18 files, pre-arranged
   in the `<family-key>/<filename>.ttf` layout this runbook documents, already `file`-verified).
   If that attachment is still available to you, unzip it and point `--dir` at it - no
   re-downloading needed.
2. **If it is not available, re-derive the same set from scratch** using the Licences table above:
   every family pins an exact release, package version, or commit, so the set is fully
   reproducible without the original attachment. Re-run steps 2-3 of "How to add (or replace) a
   family" below for each of the seven families (Geist/Geist Mono can also be re-derived by
   base64-decoding the constants in `supabase/functions/_shared/hire-order-pdf/fonts.ts`, which
   *is* committed, rather than re-fetched from Vercel).
