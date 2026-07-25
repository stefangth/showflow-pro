// Per-runtime shim for the shared renderer (browser).
//
// NOT MIRRORED. render.tsx is byte-identical across runtimes; this file is the
// one place the two differ. The Deno twin lives at
// supabase/functions/_shared/hire-order-pdf/pdfDeps.ts.
//
// Fonts come from the same public Storage bucket the edge renderer uses,
// including Geist: the browser has no reason to carry 700KB of base64.

export { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
export type { ReactElement } from "react";

import { Font, pdf } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { type FontFamilyDef } from "./pdfTheme.ts";

/**
 * `renderToBuffer` (@react-pdf/renderer's own export of that name) is Node-only:
 * the package's browser build stubs it to throw ("renderToBuffer is a Node
 * specific API"), confirmed by an in-browser smoke test during Task 4. `pdf()`
 * -> `toBlob()` is the documented browser-safe path (`@platform web` in
 * react-pdf's own types), so this wraps it to the same
 * `(element) => Promise<Uint8Array-like>` shape render.tsx calls on the edge
 * side.
 */
export async function renderToBuffer(document: ReactElement): Promise<Uint8Array> {
  const blob = await pdf(document).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

const FONT_BUCKET_URL =
  `${import.meta.env.VITE_SUPABASE_URL ?? ""}/storage/v1/object/public/hire-order-fonts`;

const registered = new Set<string>();
let hyphenationSet = false;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked, not a single `String.fromCharCode(...bytes)`: spreading a whole
  // font file (100-300KB) into one call argument list blows the call stack.
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Fetch one font file and turn it into a self-contained `data:` URL, or
 * `null` on any failure (network error, non-2xx, provisioning not done yet).
 * A data URL never triggers a further fetch inside react-pdf's OWN lazy font
 * loader (`FontSource._load`, which runs during PDF layout, not during
 * `Font.register`) - registering a bare Storage URL instead would let a bad
 * response surface as an unhandled "Unknown font format" render-time throw,
 * confirmed by an in-browser smoke test during Task 4: `Font.register`'s own
 * try/catch does NOT catch that, since the fetch it wraps is deferred.
 */
async function loadFontDataUrl(path: string): Promise<string | null> {
  try {
    const response = await fetch(`${FONT_BUCKET_URL}/${path}`);
    if (!response.ok) return null;
    return `data:font/ttf;base64,${bytesToBase64(new Uint8Array(await response.arrayBuffer()))}`;
  } catch (_error) {
    return null;
  }
}

/**
 * Register the families a theme uses, all from the public font bucket
 * (including Geist - the browser has no reason to carry 700KB of base64).
 * Every file is fetched and embedded as a data URL up front; one that fails
 * falls back to the PDF-standard Helvetica for that weight, so the family
 * NAME is always backed by a working registration - react-pdf throws
 * "Font family not registered" for any name it has never seen at all, so
 * leaving a family unregistered on failure is not an option either. This is
 * how a Storage bucket that is not yet provisioned (or a single missing
 * file) degrades to a plain-looking document instead of a failed preview.
 */
export async function registerFonts(families: FontFamilyDef[]): Promise<void> {
  if (!hyphenationSet) {
    // See render.tsx's fonts comment: react-pdf's default hyphenation would
    // break names/venues/emails mid-word.
    Font.registerHyphenationCallback((word) => [word]);
    hyphenationSet = true;
  }
  for (const def of families) {
    if (registered.has(def.family)) continue;
    const fonts = await Promise.all(
      def.files.map(async (f) => ({
        src: (await loadFontDataUrl(f.path)) ?? (f.weight >= 600 ? "Helvetica-Bold" : "Helvetica"),
        fontWeight: f.weight,
      })),
    );
    try {
      Font.register({ family: def.family, fonts });
      registered.add(def.family);
    } catch (_error) {
      // Leave it unregistered.
    }
  }
}
