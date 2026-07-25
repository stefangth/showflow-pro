// Per-runtime shim for the shared renderer (browser).
//
// NOT MIRRORED. render.tsx is byte-identical across runtimes; this file is the
// one place the two differ. The Deno twin lives at
// supabase/functions/_shared/hire-order-pdf/pdfDeps.ts.
//
// Fonts come from the same public Storage bucket the edge renderer uses,
// including Geist: the browser has no reason to carry 700KB of base64.

export { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
export type { ReactElement } from "react";

import { Font, pdf } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { type FontFamilyDef, type FontFamilyKey } from "./pdfTheme.ts";

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

// Names react-pdf has a REAL, working registration for. Added only once a
// family's fetch has genuinely, fully succeeded. Never removed -
// `Font.register` is append-only and first-match-wins internally (confirmed
// by reading @react-pdf/font's FontFamily.register/resolve), so a family
// already registered for real must never be registered again with different
// data: the OLD source would keep winning forever, silently. A family that
// is NOT in this set is safe to retry on the next call.
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

/** True when `bytes` starts with a signature real TTF/OTF font files use.
 *  A 200 response carrying the WRONG content (this repo's own Vite dev
 *  server returns 200 + index.html for any unmatched path via its SPA
 *  fallback - confirmed while diagnosing this exact failure) would otherwise
 *  still produce a `data:font/ttf;base64,...` URL that throws deep inside
 *  react-pdf's fontkit parser at PDF-layout time - exactly the unhandled,
 *  deferred failure this whole file exists to prevent. Cheap sanity check,
 *  not a full parse. */
function looksLikeFont(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return true; // sfnt 1.0 (TrueType)
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return sig === "OTTO" || sig === "true" || sig === "typ1" || sig === "ttcf";
}

/**
 * Fetch one font file and turn it into a self-contained `data:` URL, or
 * `null` on any failure (network error, non-2xx, wrong content, provisioning
 * not done yet). A data URL never triggers a further fetch inside react-pdf's
 * OWN lazy font loader (`FontSource._load`, which runs during PDF layout,
 * not during `Font.register`) - registering a bare Storage URL instead would
 * let a bad response surface as an unhandled "Unknown font format"
 * render-time throw, past the point this function's own error handling can
 * catch it. Every failure is logged here (not just aggregated by the caller)
 * so it's visible in the console - a preview degrading to the wrong typeface
 * with no trace would look like this renderer is simply broken.
 */
async function loadFontDataUrl(path: string, family: string): Promise<string | null> {
  const url = `${FONT_BUCKET_URL}/${path}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("hire-order-pdf: font fetch failed", { family, url, status: response.status });
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!looksLikeFont(bytes)) {
      console.error("hire-order-pdf: font response was not a font file", { family, url, byteLength: bytes.length });
      return null;
    }
    return `data:font/ttf;base64,${bytesToBase64(bytes)}`;
  } catch (error) {
    console.error("hire-order-pdf: font fetch threw", {
      family,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Register the families a theme uses, all from the public font bucket
 * (including Geist - the browser has no reason to carry 700KB of base64).
 * ALL of a family's weight files must load for it to be registered at all -
 * a partial set (some weights real, some substituted) would render body text
 * and headings in visibly different typefaces, which reads as a bug rather
 * than a fallback. A family that fails (any weight) is left unregistered:
 * `renderHireOrderPdf` (render.tsx) uses the returned set to render that
 * family's text in a react-pdf standard font (Helvetica/Courier) for THIS
 * document only, via `safeReactPdfFamilyName` - it is never registered under
 * a fallback, so the next call (e.g. the next live-preview render in the
 * same page session) retries the real fetch rather than inheriting a
 * transient failure for the rest of the session.
 */
export async function registerFonts(families: FontFamilyDef[]): Promise<Set<FontFamilyKey>> {
  if (!hyphenationSet) {
    // See render.tsx's fonts comment: react-pdf's default hyphenation would
    // break names/venues/emails mid-word.
    Font.registerHyphenationCallback((word) => [word]);
    hyphenationSet = true;
  }
  const available = new Set<FontFamilyKey>();
  for (const def of families) {
    if (registered.has(def.family)) {
      available.add(def.key);
      continue;
    }
    const loaded = await Promise.all(def.files.map((f) => loadFontDataUrl(f.path, def.family)));
    if (loaded.some((src) => src === null)) {
      console.error("hire-order-pdf: font family incomplete, not registering", {
        family: def.family,
        key: def.key,
        failedPaths: def.files.filter((_, i) => loaded[i] === null).map((f) => f.path),
      });
      continue; // stays unregistered: retried on the next registerFonts call
    }
    Font.register({
      family: def.family,
      fonts: def.files.map((f, i) => ({ src: loaded[i] as string, fontWeight: f.weight })),
    });
    registered.add(def.family);
    available.add(def.key);
  }
  return available;
}
