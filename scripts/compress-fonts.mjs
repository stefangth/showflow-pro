#!/usr/bin/env node
// Regenerates src/lib/hireOrders/pdf/fonts.ts (the source half of the
// fonts.ts mirror pair — see scripts/mirrors.manifest.json) from four raw
// Geist TTF files, gzip-compressed at level 9 then base64-encoded.
//
// WHY GZIPPED: the four TTFs base64-encoded as-is came to ~709KB, roughly
// 60% of the deployed hire-order edge function's payload, and pushed the
// Supabase Preview function deploy over its request-size ceiling (413
// "request entity too large"). Gzip shrinks the embedded bytes by ~55% with
// zero loss — react-pdf still needs a `data:font/ttf;base64,...` URI (see
// fonts.ts's own header comment for why a raw Uint8Array doesn't work on the
// edge runtime), so the gzip layer is inflated back out at font-registration
// time by fontInflate.ts (mirrored, shared by both pdfDeps.ts runtime
// shims), not skipped.
//
// USAGE:
//   node scripts/compress-fonts.mjs \
//     --regular <path/to/Geist-Regular.ttf> \
//     --medium <path/to/Geist-Medium.ttf> \
//     --semibold <path/to/Geist-SemiBold.ttf> \
//     --mono-regular <path/to/GeistMono-Regular.ttf>
//
// Writes src/lib/hireOrders/pdf/fonts.ts directly. Run `npm run sync:mirrors`
// afterwards to regenerate the edge twin
// (supabase/functions/_shared/hire-order-pdf/fonts.ts) — never hand-edit that
// file. See docs/runbooks/hire-order-fonts.md for the full replace-a-font
// walkthrough, including where to source licitly-licensed TTFs.
//
// Each input must be a real TrueType file (`file <path>` should report
// "TrueType Font data") — this script does not sniff the content, so feed it
// garbage and you get a garbage-in font that will fail at PDF-render time,
// not here.

import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = join(REPO_ROOT, "src/lib/hireOrders/pdf/fonts.ts");

const GZIP_LEVEL = 9;

/** Order here is the order the exports appear in the generated file. */
const FONTS = [
  { flag: "--regular", constant: "GEIST_REGULAR_GZ_B64", label: "Geist-Regular.ttf" },
  { flag: "--medium", constant: "GEIST_MEDIUM_GZ_B64", label: "Geist-Medium.ttf" },
  { flag: "--semibold", constant: "GEIST_SEMIBOLD_GZ_B64", label: "Geist-SemiBold.ttf" },
  { flag: "--mono-regular", constant: "GEIST_MONO_REGULAR_GZ_B64", label: "GeistMono-Regular.ttf" },
];

function parseArgs(argv) {
  const paths = {};
  for (const font of FONTS) {
    const idx = argv.indexOf(font.flag);
    if (idx === -1 || argv[idx + 1] === undefined) {
      throw new Error(
        `missing ${font.flag} <path-to-ttf>\n\nUsage:\n  node scripts/compress-fonts.mjs ` +
          FONTS.map((f) => `${f.flag} <${f.label}>`).join(" "),
      );
    }
    paths[font.constant] = argv[idx + 1];
  }
  return paths;
}

function compress(ttfPath, label) {
  const raw = readFileSync(ttfPath);
  const gz = gzipSync(raw, { level: GZIP_LEVEL });
  return { label, rawLength: raw.length, gzLength: gz.length, base64: gz.toString("base64") };
}

const HEADER = `// Geist + Geist Mono TTFs, gzip-compressed then base64-encoded.
//
// DUAL-HOME PAIR: src/lib/hireOrders/pdf/fonts.ts (edit here) generates
// supabase/functions/_shared/hire-order-pdf/fonts.ts (the edge renderer can't
// import from src/). Edit this file, then run \`npm run sync:mirrors\`; never
// hand-edit the generated target. BOTH runtimes embed these bytes so the
// DEFAULT theme renders with zero network I/O and can never degrade to a
// standard font: the edge because it has no reliable egress budget per
// render, the browser because the \`hire-order-fonts\` Storage bucket is empty
// until an operator uploads to it, and a preview in Helvetica would lay out
// (line breaks, pagination) differently from the real PDF in Geist.
//
// GZIPPED, NOT RAW: base64-of-raw-TTF for all four files came to ~709KB and
// was roughly 60% of the deployed hire-order edge function's payload,
// pushing the Supabase Preview function deploy over its request-size ceiling
// (413 "request entity too large"). Gzip level 9 shrinks this by more than
// half with zero loss. The \`_GZ_B64\` suffix is load-bearing, not decorative:
// these bytes are base64 of GZIPPED data, and feeding one straight into a
// \`data:font/ttf;base64,...\` URI produces a file react-pdf's fontkit cannot
// parse. Inflate with \`inflateFontGzB64\` (./fontInflate.ts, mirrored
// alongside this file) before building that URI — see pdfDeps.ts in either
// runtime shim for the call site. Inflation is memoised behind the same
// \`registered\` guard that already deduplicates \`Font.register\` calls, so the
// cost lands once per isolate/session, not once per render.
//
// WHY base64 (of the gzip, not of raw bytes): the Task 5 spike proved on the
// live edge runtime that \`Font.register({ src: <Uint8Array> })\` FAILS —
// react-pdf coerces the value to a string and treats it as a filesystem
// path, throwing \`NotFound: path not found: /var/tmp/sb-compile-edge-runtime/source\`.
// A \`data:font/ttf;base64,...\` URI is the working in-memory form. The edge
// runtime has no filesystem access to bundled assets, so this is the only
// way to ship the fonts — the gzip layer changes what is inside that base64
// string, not the fact that a base64 data URI is still required.
//
// Source: .superpowers/sdd/fonts (Geist, SIL Open Font License 1.1).
// Generated, not hand-written — regenerate with:
//   node scripts/compress-fonts.mjs --regular <f> --medium <f> --semibold <f> --mono-regular <f>
// See docs/runbooks/hire-order-fonts.md for the full walkthrough.
`;

function wrapExport(name, meta) {
  return (
    `/** ${meta.label}: ${meta.rawLength} raw bytes, gzip level ${GZIP_LEVEL} -> ${meta.gzLength} bytes, ` +
    `base64-of-gzip (${meta.base64.length} chars). */\n` +
    `export const ${name} =\n  "${meta.base64}";\n`
  );
}

function main() {
  const paths = parseArgs(process.argv.slice(2));
  const blocks = FONTS.map((font) => wrapExport(font.constant, compress(paths[font.constant], font.label)));
  writeFileSync(OUTPUT_PATH, `${HEADER}\n${blocks.join("\n")}`, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log("Run `npm run sync:mirrors` next to regenerate the edge twin.");
}

main();
