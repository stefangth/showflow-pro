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
| Libre Baskerville | github.com/impallari/Libre-Baskerville (no GitHub releases; fetched from the repo's `fonts/ttf/` directly at `master`) | OFL 1.1 |

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
- [x] All 18 required TTF files downloaded from their official sources above, verified as real
      TrueType data (`file` check), and packaged for upload (delivered separately - see the task
      handoff).
- [ ] **Files are NOT yet uploaded to the bucket.** No Storage write credential (service role key)
      was available in the environment that did this work. **A human with the service role key
      must run `scripts/upload-hire-order-fonts.ts` (or use the dashboard) against the prepared
      files before any non-default theme actually renders with its intended typeface** - until
      then every non-default family degrades to a standard font, which is safe (never broken
      output) but not the intended result.
- [x] Degradation logic (all-or-nothing registration, non-sticky retry, content sniffer, standard-
      font substitution) is fully covered by `pdfDeps.test.ts` against a fake fetch - this does not
      depend on the bucket being populated.
