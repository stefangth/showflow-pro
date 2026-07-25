# Runbook — Hire-order PDF font library

> **When you need this:** provisioning the font library for the first time (this runbook's own
> Task 5 handoff), or adding/replacing a family in the hire-order PDF theme's font picker later.

## What this bucket is for

The hire-order PDF theme (`src/lib/hireOrders/pdf/pdfTheme.ts`, mirrored to
`supabase/functions/_shared/hire-order-pdf/pdfTheme.ts`) declares a curated `FONT_FAMILIES`
registry. Geist and Geist Mono are the defaults and ship base64-embedded directly in the edge
function (`fonts.ts`), so the default render path performs **zero** network I/O and can never fail.
Every other family (Inter, IBM Plex Sans, Source Serif, Libre Baskerville, IBM Plex Mono) is
fetched at render time from the `hire-order-fonts` Storage bucket.

**The editor's font picker only offers a family once its files are actually uploaded.** Each
`FONT_FAMILIES` entry carries a `pendingUpload?: true` flag; `selectableFontFamilies()` (also in
`pdfTheme.ts`) filters it out of the picker's choices. Today only Geist and Geist Mono are
selectable - the other five stay in the registry (the picker's job is to build the future library,
not to expose entries with no backing files) but are invisible to a user until an operator
completes **both** steps below: uploading the files to the bucket, **and** flipping that family's
`pendingUpload` flag off in `pdfTheme.ts`. Uploading alone does nothing for the picker - see
"Two-step activation" under "How to add (or replace) a family".

`pendingUpload` gates the *picker* only. A stored theme that already references a pending family
(or a role-level override that does) keeps resolving to it via `resolveHireOrderTheme` regardless
of the flag, and `familiesInUse`/`registerFonts` still attempt to load it at render time - so if
its files are already in the bucket even though the flag hasn't been flipped yet, that stored
reference renders correctly; it just can't be *newly chosen* from the picker. A family whose files
are genuinely still missing (the normal pre-upload state) fails to load and the renderer degrades
gracefully to a react-pdf standard font (see "Failure behaviour" below) - by design, not a bug.

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

## Regenerating the embedded Geist/Geist Mono bytes (`fonts.ts`)

`src/lib/hireOrders/pdf/fonts.ts` (mirrored to
`supabase/functions/_shared/hire-order-pdf/fonts.ts`) embeds the four Geist/Geist Mono TTFs
directly as source, gzip-compressed at level 9 then base64-encoded (`GEIST_REGULAR_GZ_B64`,
`GEIST_MEDIUM_GZ_B64`, `GEIST_SEMIBOLD_GZ_B64`, `GEIST_MONO_REGULAR_GZ_B64`). Gzipping matters
here specifically: base64-of-raw-TTF for all four files came to ~709KB and was roughly 60% of the
deployed `generate-hire-orders` edge function's payload, which pushed the Supabase Preview
function deploy over its request-size ceiling (`413 request entity too large`). Gzip shrinks that
by more than half with no loss of fidelity - see `fontInflate.test.ts` for the proof (below).

**To replace a Geist file** (a font update, a licence-required re-derivation, etc.):

1. Obtain the four new TTF files (`Geist-Regular.ttf`, `Geist-Medium.ttf`, `Geist-SemiBold.ttf`,
   `GeistMono-Regular.ttf`), verified with `file <path>` exactly as for any other family (see "TTF
   only, no exceptions" above).
2. Regenerate the source file:
   ```bash
   node scripts/compress-fonts.mjs \
     --regular <path/to/Geist-Regular.ttf> \
     --medium <path/to/Geist-Medium.ttf> \
     --semibold <path/to/Geist-SemiBold.ttf> \
     --mono-regular <path/to/GeistMono-Regular.ttf>
   ```
   This writes `src/lib/hireOrders/pdf/fonts.ts` directly - never hand-edit it or its generated
   edge twin.
3. `npm run sync:mirrors` to regenerate `supabase/functions/_shared/hire-order-pdf/fonts.ts`.
4. Run the golden-hash render tests
   (`deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/render.test.ts`).
   A genuine font change is expected to fail `countersigned aggregate renders exactly as the
   committed golden` / `single-date preview renders exactly as the committed golden` - see
   `render.test.ts`'s own `UPDATE_HIRE_ORDER_PDF_GOLDEN` instructions for how to move the pin once
   the change is reviewed and intended.

**At render/registration time**, both `pdfDeps.ts` shims inflate these bytes back to plain
base64 via `inflateFontGzB64` (`src/lib/hireOrders/pdf/fontInflate.ts`, mirrored to
`supabase/functions/_shared/hire-order-pdf/fontInflate.ts`) before building the
`data:font/ttf;base64,...` URI `Font.register` needs - `Font.register({ src: <Uint8Array> })`
still fails on the edge runtime exactly as described in `fonts.ts`'s own header comment, so the
gzip layer changes what's inside the base64 string, not the fact that a base64 data URI is
required. Inflation happens once per isolate/session, behind the same `registered` guard that
already deduplicates the `Font.register` calls, so the cost lands on cold start only.

## Licences

Every family below is SIL Open Font License 1.1 (OFL), confirmed against each project's own
`LICENSE`/`OFL.txt` at the exact release used:

| Family | Source | Licence |
|---|---|---|
| Geist / Geist Mono | github.com/vercel/geist-font | OFL 1.1 (already embedded, gzip-compressed then base64-encoded; re-derive with `inflateFontGzB64` if the raw files are ever needed again - see "Regenerating the embedded Geist/Geist Mono bytes" above and "Why this isn't checked into git" below) |
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

> **Two-step activation - do not skip step 7.** Uploading a family's TTFs to the bucket is *not*
> enough to make it choosable. `pendingUpload: true` in `FONT_FAMILIES` is what keeps a family out
> of `selectableFontFamilies()` (the editor's picker), and nothing about the upload itself clears
> that flag. A family uploaded but never flipped is **invisible in the picker forever** - the files
> sit in the bucket, fully fetchable, with no UI path for anyone to choose them. Steps 1-6 get the
> files onto the bucket; step 7 is the separate, easy-to-forget code change that actually turns the
> family on.

1. Confirm the licence is OFL (or another licence the org is comfortable redistributing under a
   public bucket - this registry's existing convention is OFL-only).
2. Download the static TTF files for the weights you need (400/500/600). If a weight doesn't
   exist upstream, reuse the nearest available file's path rather than inventing one (see the two
   corrections above for the precedent) - never invent a path with no backing file.
3. Verify every file with `file <path>` - must report "TrueType Font data" (see above).
4. Add (or edit) the entry in **`src/lib/hireOrders/pdf/pdfTheme.ts`**'s `FONT_FAMILIES` array,
   then run `npm run sync:mirrors` to regenerate the edge copy at
   `supabase/functions/_shared/hire-order-pdf/pdfTheme.ts`. **Never hand-edit the generated
   target** - CI's `sync:mirrors:check` will fail if the two drift. A brand-new family should be
   added with `pendingUpload: true` (it has no files yet); leave that flag on an existing entry
   until step 7.
5. Upload the files to the bucket, matching the `path` values exactly. Two options:
   - **Supabase dashboard** → Storage → `hire-order-fonts` → upload into the matching folder.
   - **`scripts/upload-hire-order-fonts.ts`** (this repo) - derives the exact required path set
     from `FONT_FAMILIES` itself, so it can never drift from the registry (this ignores
     `pendingUpload`; it uploads files for every family in the registry, activated or not):
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
7. **Activate the family.** In **`src/lib/hireOrders/pdf/pdfTheme.ts`**, remove that family's
   `pendingUpload: true` (or set it to `false`) now that every file it needs has been confirmed
   fetchable in step 6, then run `npm run sync:mirrors` again. Only after this step does
   `selectableFontFamilies()` include the family and the editor's picker offer it. Same
   mirror-sync rule as step 4: never hand-edit
   `supabase/functions/_shared/hire-order-pdf/pdfTheme.ts` directly - CI's `sync:mirrors:check`
   fails if the two drift.

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
      **A human with the service role key must (re-)acquire the 18 files, run
      `scripts/upload-hire-order-fonts.ts` (or use the dashboard), AND flip each uploaded family's
      `pendingUpload` flag off in `pdfTheme.ts`** (step 7 of "How to add [or replace] a family")
      before that family is either selectable in the editor's picker or renders with its intended
      typeface - until then every non-default family stays out of the picker and, if a stored theme
      somehow already referenced it, degrades to a standard font, which is safe (never broken
      output) but not the intended result.
- [x] Degradation logic (all-or-nothing registration, non-sticky retry, content sniffer, standard-
      font substitution) is fully covered by `pdfDeps.test.ts` against a fake fetch - this does not
      depend on the bucket being populated.
- [x] **Amendment (2026-07-25, same day):** the editor's font picker now sources its choices from
      `selectableFontFamilies()`, not `FONT_FAMILIES` directly. Every non-embedded family carries
      `pendingUpload: true` and is excluded from the picker until an operator completes the
      two-step activation above. This closes the gap where the picker would otherwise offer five
      families that silently degrade to a standard font on first use - now only Geist and Geist
      Mono (the two `embedded: true` design-system fonts, zero network I/O, cannot fail) are
      offered until real files exist. `resolveHireOrderTheme` is unaffected by this flag: it still
      accepts any registry key, so an already-stored or hand-edited override is never rejected.

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
   family" below for each of the seven families (Geist/Geist Mono can also be re-derived from
   `src/lib/hireOrders/pdf/fonts.ts`, which *is* committed, rather than re-fetched from Vercel -
   its `*_GZ_B64` constants are base64 of GZIPPED TTF bytes, so decoding needs a gunzip step on top
   of the base64 decode; `inflateFontGzB64` in `fontInflate.ts` does exactly that and is the
   easiest way to get plain bytes back out, e.g. via a short Node/Deno script that imports it).
