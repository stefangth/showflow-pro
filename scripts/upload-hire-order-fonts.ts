#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env
/**
 * Upload the hire-order PDF theme's curated font library to the
 * `hire-order-fonts` Storage bucket (public read, no client writes -
 * see supabase/migrations/20260725083229_hire_order_fonts_storage.sql and
 * docs/runbooks/hire-order-fonts.md).
 *
 * This is an OPERATOR script: it needs the service role key, which is never
 * available to app code or CI, so it is run by hand, once per font-library
 * change. It is intentionally dependency-free (raw fetch against the Storage
 * REST API, same approach as supabase/functions/_shared/documenso.ts) rather
 * than pulling in @supabase/supabase-js for a script that runs a handful of
 * times a year.
 *
 * Usage:
 *   SUPABASE_URL=https://epweartpzwvcasrzyueh.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   deno run --allow-read --allow-net --allow-env scripts/upload-hire-order-fonts.ts --dir ./font-library
 *
 * `--dir` must mirror the bucket's own path layout, e.g.:
 *   <dir>/inter/Inter-Regular.ttf
 *   <dir>/plex-sans/IBMPlexSans-Medium.ttf
 *   ...
 * The exact required path set is derived from FONT_FAMILIES (pdfTheme.ts)
 * itself, so this script can never drift from the registry it serves - add a
 * family there and this script picks up its files automatically.
 *
 * Every file is verified as real TrueType/OpenType data (magic-byte sniff,
 * same check as `looksLikeFont` in pdfDeps.ts) before it is uploaded: a
 * WOFF/WOFF2 renamed to .ttf would upload without error and then fail to
 * render for every artist and producer who opens that document.
 */

import { FONT_FAMILIES } from "../src/lib/hireOrders/pdf/pdfTheme.ts";

interface Args {
  dir: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let dir = "./font-library";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" && argv[i + 1]) {
      dir = argv[i + 1];
      i++;
    } else if (argv[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { dir, dryRun };
}

/** Same sniff as pdfDeps.ts's looksLikeFont: real TTF/OTF signature, not a
 *  full parse. Catches a woff2 (or an HTML error page) renamed to .ttf. */
function looksLikeFont(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return true; // sfnt 1.0 (TrueType)
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return sig === "OTTO" || sig === "true" || sig === "typ1" || sig === "ttcf";
}

/** Every distinct Storage object path FONT_FAMILIES needs, deduplicated -
 *  some families point two weights at the same file (e.g. GeistMono's single
 *  file serves 400/500/600; Source Serif's 500 reuses its 400 file). */
function requiredPaths(): string[] {
  const paths = new Set<string>();
  for (const def of FONT_FAMILIES) {
    for (const file of def.files) paths.add(file.path);
  }
  return [...paths].sort();
}

async function main() {
  const { dir, dryRun } = parseArgs(Deno.args);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!dryRun && (!supabaseUrl || !serviceKey)) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or pass --dry-run to only verify local files).");
    Deno.exit(1);
  }

  const paths = requiredPaths();
  console.log(`${paths.length} font object(s) required by FONT_FAMILIES:`);

  let missing = 0;
  let invalid = 0;
  let uploaded = 0;
  let failed = 0;

  for (const path of paths) {
    const localPath = `${dir}/${path}`;
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(localPath);
    } catch {
      console.error(`  MISSING   ${path}  (expected at ${localPath})`);
      missing++;
      continue;
    }
    if (!looksLikeFont(bytes)) {
      console.error(`  NOT A TTF ${path}  (${bytes.length} bytes, failed the magic-byte check)`);
      invalid++;
      continue;
    }
    if (dryRun) {
      console.log(`  OK        ${path}  (${bytes.length} bytes, would upload)`);
      continue;
    }

    const uploadUrl = `${supabaseUrl}/storage/v1/object/hire-order-fonts/${path}`;
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey!,
        "Content-Type": "font/ttf",
        "x-upsert": "true", // re-running this script after a font update must overwrite, not 409
      },
      body: bytes as unknown as BodyInit,
    });
    if (!res.ok) {
      console.error(`  FAILED    ${path}  (HTTP ${res.status}: ${await res.text()})`);
      failed++;
      continue;
    }
    console.log(`  UPLOADED  ${path}  (${bytes.length} bytes)`);
    uploaded++;
  }

  console.log("");
  console.log(
    dryRun
      ? `${paths.length - missing - invalid} of ${paths.length} local files verified.`
      : `${uploaded} uploaded, ${failed} failed, ${missing} missing locally, ${invalid} rejected as non-TTF.`,
  );
  if (missing > 0 || invalid > 0 || failed > 0) Deno.exit(1);
}

if (import.meta.main) await main();
