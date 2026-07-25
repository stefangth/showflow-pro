// Per-runtime shim for the shared renderer (browser).
//
// NOT MIRRORED. render.tsx is byte-identical across runtimes; this file is the
// one place the two differ. The Deno twin lives at
// supabase/functions/_shared/hire-order-pdf/pdfDeps.ts.
//
// Geist and Geist Mono are base64-embedded from ./fonts.ts, exactly as the
// edge shim does, so the DEFAULT theme renders with zero network I/O here
// too. Earlier this file fetched every family (Geist included) from the
// public `hire-order-fonts` Storage bucket, which is empty until an operator
// uploads to it: every fetch 400'd, `available` came back empty and the live
// preview silently fell back to Helvetica. That is not merely a different
// typeface - Helvetica and Geist have different metrics, so line breaks and
// pagination differ, and an org could size text to fit in a preview that the
// real PDF then reflows. The bytes are shared with the edge through the
// mirror (scripts/mirrors.manifest.json), never hand-duplicated. Everything
// else is still fetched from the bucket on demand.
//
// The extra weight is paid only on entering the editor: this module is
// reached solely through render.tsx -> TemplateDocumentPane ->
// TemplateEditorPage, which App.tsx `lazy()`-loads.

export { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
export type { ReactElement } from "react";

import { Font, pdf } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { GEIST_MEDIUM_B64, GEIST_MONO_REGULAR_B64, GEIST_REGULAR_B64, GEIST_SEMIBOLD_B64 } from "./fonts.ts";
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

// A hanging Storage endpoint must not stall every themed preview render for
// the rest of the page session: a failed family is retried once its
// FONT_FAILURE_TTL_MS lapses, so an unbounded fetch would compound rather
// than just cost one render. Matches the edge shim's FONT_FETCH_TIMEOUT_MS.
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

// How long a FAILED family fetch is remembered before it is retried.
//
// The edge deliberately has no such cache: a warm isolate lives for hours and
// a family that failed once should get a fresh attempt on the next document.
// A browser session is different - the preview re-renders on a debounce as
// the user types, so an org whose stored theme names a family the bucket has
// not been provisioned with (`resolveHireOrderTheme` accepts any registry key,
// including `pendingUpload` ones the picker hides) would fire three doomed
// requests and log three errors per keystroke batch. 30s is short enough that
// an operator who uploads the missing files sees them appear without a
// reload, and long enough that a burst of edits costs one attempt, not one
// per frame.
const FONT_FAILURE_TTL_MS = 30_000;
const failedAt = new Map<string, number>();

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
 * `null` on any failure (network error, non-2xx, wrong content, timeout,
 * provisioning not done yet). Bounded by `FONT_FETCH_TIMEOUT_MS` via
 * `AbortSignal.timeout` - failure here is non-sticky (see `registered`
 * below), so a hanging endpoint with no bound would stall every themed
 * preview render, not just the first. A data URL never triggers a further
 * fetch inside react-pdf's OWN lazy font loader (`FontSource._load`, which
 * runs during PDF layout, not during `Font.register`) - registering a bare
 * Storage URL instead would let a bad response surface as an unhandled
 * "Unknown font format"
 * render-time throw, past the point this function's own error handling can
 * catch it. Every failure is logged here (not just aggregated by the caller)
 * so it's visible in the console - a preview degrading to the wrong typeface
 * with no trace would look like this renderer is simply broken.
 *
 * `fetchImpl` is injected (defaulted to the global `fetch` by the caller) so
 * this mirrors the edge shim's shape and the failure paths are testable
 * against a fake network (see pdfDeps.test.ts beside this file).
 */
async function loadFontDataUrl(path: string, family: string, fetchImpl: typeof fetch): Promise<string | null> {
  const url = `${FONT_BUCKET_URL}/${path}`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      console.error("hire-order-pdf: font fetch failed", { family, url, status: response.status });
      // Drain the body: an unconsumed response stream on a real fetch leaves
      // the underlying connection resource open (see the edge shim's
      // matching comment; found via a live smoke test against the real
      // bucket in Task 5).
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
 * (./fonts.ts, shared with the edge through the mirror) so the DEFAULT theme
 * never touches the network and can never fail. Anything else is fetched from
 * the public font bucket and embedded as a data URL; ALL of a family's weight
 * files must load for it to be registered at all - a partial set (some weights
 * real, some substituted) would render body text and headings in visibly
 * different typefaces, which reads as a bug rather than a fallback. A family
 * that fails (any weight) is left unregistered: `renderHireOrderPdf`
 * (render.tsx) uses the returned set to render that family's text in a
 * react-pdf standard font (Helvetica/Courier) for THIS document only, via
 * `safeReactPdfFamilyName` - it is never registered under a fallback, so a
 * later call retries the real fetch (after FONT_FAILURE_TTL_MS) rather than
 * inheriting a transient failure for the rest of the page session.
 *
 * `fetchImpl` defaults to the global `fetch` (production callers, and
 * render.tsx's own `registerFonts(familiesInUse(theme))` call, never pass
 * one); tests inject a fake so the failure paths run against no real network.
 */
export async function registerFonts(
  families: FontFamilyDef[],
  fetchImpl: typeof fetch = fetch,
): Promise<Set<FontFamilyKey>> {
  const available = new Set<FontFamilyKey>();
  if (!registered.has("Geist")) {
    Font.register({
      family: "Geist",
      fonts: [
        { src: `data:font/ttf;base64,${GEIST_REGULAR_B64}`, fontWeight: 400 },
        { src: `data:font/ttf;base64,${GEIST_MEDIUM_B64}`, fontWeight: 500 },
        { src: `data:font/ttf;base64,${GEIST_SEMIBOLD_B64}`, fontWeight: 600 },
      ],
    });
    Font.register({
      family: "GeistMono",
      fonts: [{ src: `data:font/ttf;base64,${GEIST_MONO_REGULAR_B64}`, fontWeight: 400 }],
    });
    // See render.tsx's fonts comment: react-pdf's default hyphenation would
    // break names/venues/emails mid-word. Set once, alongside the default
    // fonts, exactly as the edge shim does.
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
    const lastFailure = failedAt.get(def.family);
    if (lastFailure !== undefined && Date.now() - lastFailure < FONT_FAILURE_TTL_MS) {
      continue; // recently failed: skip silently, retried once the TTL lapses
    }
    const loaded = await Promise.all(def.files.map((f) => loadFontDataUrl(f.path, def.family, fetchImpl)));
    if (loaded.some((src) => src === null)) {
      console.error("hire-order-pdf: font family incomplete, not registering", {
        family: def.family,
        key: def.key,
        failedPaths: def.files.filter((_, i) => loaded[i] === null).map((f) => f.path),
      });
      failedAt.set(def.family, Date.now());
      continue; // stays unregistered: retried after FONT_FAILURE_TTL_MS
    }
    Font.register({
      family: def.family,
      fonts: def.files.map((f, i) => ({ src: loaded[i] as string, fontWeight: f.weight })),
    });
    registered.add(def.family);
    failedAt.delete(def.family);
    available.add(def.key);
  }
  return available;
}
