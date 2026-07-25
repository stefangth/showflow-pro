// Per-runtime shim for the shared renderer (Deno edge).
//
// NOT MIRRORED. render.tsx is byte-identical across runtimes; this file is the
// one place the two differ. The browser twin lives at
// src/lib/hireOrders/pdf/pdfDeps.ts.

export {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "npm:@react-pdf/renderer@^4";
export { renderToBuffer } from "npm:@react-pdf/renderer@^4";
export type { ReactElement } from "npm:react@18.3.1";

import { Font } from "npm:@react-pdf/renderer@^4";
import { inflateFontGzB64 } from "./fontInflate.ts";
import {
  GEIST_MEDIUM_GZ_B64,
  GEIST_MONO_REGULAR_GZ_B64,
  GEIST_REGULAR_GZ_B64,
  GEIST_SEMIBOLD_GZ_B64,
} from "./fonts.ts";
import { type FontFamilyDef, type FontFamilyKey } from "./pdfTheme.ts";

const FONT_BUCKET_URL = `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/hire-order-fonts`;

// A hanging Storage endpoint must not stall every themed render for the rest
// of the isolate's life: non-sticky retry (see `registered` below) means a
// slow/hung response is retried on every call, so an unbounded fetch would
// compound rather than just cost one render. 8s matches fetch-remote-sheet's
// TIMEOUT_MS for the same "small file over HTTP" shape.
const FONT_FETCH_TIMEOUT_MS = 8000;

// Names react-pdf has a REAL, working registration for. Geist/GeistMono are
// added unconditionally below (embedded, can't fail); everything else is
// added only once a family's fetch has genuinely, fully succeeded. Never
// removed - `Font.register` is append-only and first-match-wins internally
// (confirmed by reading @react-pdf/font's FontFamily.register/resolve), so a
// family already registered for real must never be registered again with
// different data: the OLD source would keep winning forever, silently. A
// family that is NOT in this set is safe to retry on the next call.
const registered = new Set<string>();

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
 *  A 200 response carrying the WRONG content (a proxy error page, an SPA
 *  fallback, a misconfigured redirect target) would otherwise still produce
 *  a `data:font/ttf;base64,...` URL that throws deep inside react-pdf's
 *  fontkit parser at PDF-layout time - exactly the unhandled, deferred
 *  failure this whole file exists to prevent. Cheap sanity check, not a
 *  full parse. */
function looksLikeFont(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return true; // sfnt 1.0 (TrueType)
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return sig === "OTTO" || sig === "true" || sig === "typ1" || sig === "ttcf";
}

/**
 * Fetch one font file and turn it into a self-contained `data:` URL, or
 * `null` on any failure (network error, non-2xx, wrong content, timeout,
 * provisioning not done yet). Bounded by `FONT_FETCH_TIMEOUT_MS` via
 * `AbortSignal.timeout` - failure here is non-sticky (see `registered`
 * below), so a hanging endpoint with no bound would stall every themed
 * render, not just the first. A data URL never triggers a further fetch
 * inside react-pdf's OWN lazy font loader (`FontSource._load`, which runs
 * during PDF layout, not during `Font.register`) - registering a bare
 * Storage URL instead would let a bad response surface as an unhandled
 * "Unknown font format" render-time throw, past the point this function's
 * own error handling can catch it. Every failure is logged here (not just
 * aggregated by the caller) so an operator can find the family, path and
 * cause in edge logs - this degrades a document's typography, silently to
 * the artist and producer, and needs to be visible somewhere.
 *
 * `fetchImpl` is injected (defaulted to the global `fetch` by the caller)
 * so tests can exercise every branch above against a fake network.
 */
async function loadFontDataUrl(path: string, family: string, fetchImpl: typeof fetch): Promise<string | null> {
  const url = `${FONT_BUCKET_URL}/${path}`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      console.error("hire-order-pdf: font fetch failed", { family, url, status: response.status });
      // Drain the body: an unconsumed response stream on a real fetch leaves
      // the underlying connection resource open. Found via a live smoke test
      // against the (currently empty) bucket, where every non-2xx here
      // tripped Deno's leak sanitizer.
      await response.body?.cancel();
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
 * Register the families a theme uses. Geist and Geist Mono are base64-embedded
 * so the DEFAULT theme never touches the network and can never fail. Anything
 * else is fetched from the public font bucket and embedded as a data URL;
 * ALL of a family's weight files must load for it to be registered at all -
 * a partial set (some weights real, some substituted) would render body text
 * and headings in visibly different typefaces, which reads as a bug rather
 * than a fallback. A family that fails (any weight) is left unregistered:
 * `renderHireOrderPdf` (render.tsx) uses the returned set to render that
 * family's text in a react-pdf standard font (Helvetica/Courier) for THIS
 * document only, via `safeReactPdfFamilyName` - it is never registered under
 * a fallback, so the next render into this same warm isolate retries the
 * real fetch rather than inheriting a transient failure for the isolate's
 * entire lifetime.
 *
 * `fetchImpl` defaults to the global `fetch` (production callers, and
 * render.tsx's own `registerFonts(familiesInUse(theme))` call, never pass
 * one); tests inject a fake so the failure paths run against no real
 * network.
 */
export async function registerFonts(
  families: FontFamilyDef[],
  fetchImpl: typeof fetch = fetch,
): Promise<Set<FontFamilyKey>> {
  const available = new Set<FontFamilyKey>();
  if (!registered.has("Geist")) {
    // fonts.ts stores these gzip-compressed; inflate once, here, behind this
    // same `registered` guard, so the cost lands on the isolate's first
    // render (cold start) rather than every render. See fontInflate.ts and
    // fonts.ts's header comment for why gzip and why a re-encode is still
    // required.
    const [regularB64, mediumB64, semiboldB64, monoRegularB64] = await Promise.all([
      inflateFontGzB64(GEIST_REGULAR_GZ_B64),
      inflateFontGzB64(GEIST_MEDIUM_GZ_B64),
      inflateFontGzB64(GEIST_SEMIBOLD_GZ_B64),
      inflateFontGzB64(GEIST_MONO_REGULAR_GZ_B64),
    ]);
    Font.register({
      family: "Geist",
      fonts: [
        { src: `data:font/ttf;base64,${regularB64}`, fontWeight: 400 },
        { src: `data:font/ttf;base64,${mediumB64}`, fontWeight: 500 },
        { src: `data:font/ttf;base64,${semiboldB64}`, fontWeight: 600 },
      ],
    });
    Font.register({
      family: "GeistMono",
      fonts: [{ src: `data:font/ttf;base64,${monoRegularB64}`, fontWeight: 400 }],
    });
    // react-pdf hyphenates at line breaks by default, which would render an
    // org called "Buehnenproduktionsgesellschaft" as "Buehnenproduktions-".
    // Names, venues and emails are not dictionary words; break on whole words
    // instead. Set once per isolate, alongside the default fonts.
    Font.registerHyphenationCallback((word) => [word]);
    registered.add("Geist");
    registered.add("GeistMono");
  }
  available.add("geist");
  available.add("geist-mono");

  for (const def of families) {
    if (def.embedded) {
      // geist/geist-mono are already Font.register'd and available'd above,
      // via base64 rather than a fetch. Marking `available` here too (not
      // just relying on the two hardcoded adds above) means a FUTURE third
      // embedded family that reaches this loop is correctly available
      // without a fetch, rather than silently falling through to the
      // Helvetica/Courier substitute despite registering fine.
      available.add(def.key);
      continue;
    }
    if (registered.has(def.family)) {
      available.add(def.key);
      continue;
    }
    const loaded = await Promise.all(def.files.map((f) => loadFontDataUrl(f.path, def.family, fetchImpl)));
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
