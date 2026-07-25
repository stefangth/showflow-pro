// Per-runtime shim for the shared renderer (Deno edge).
//
// NOT MIRRORED. render.tsx is byte-identical across runtimes; this file is the
// one place the two differ. The browser twin lives at
// src/lib/hireOrders/pdf/pdfDeps.ts.

export {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "npm:@react-pdf/renderer@^4";
export { renderToBuffer } from "npm:@react-pdf/renderer@^4";
export type { ReactElement } from "npm:react@18.3.1";

import { Font } from "npm:@react-pdf/renderer@^4";
import { GEIST_MEDIUM_B64, GEIST_MONO_REGULAR_B64, GEIST_REGULAR_B64, GEIST_SEMIBOLD_B64 } from "./fonts.ts";
import { type FontFamilyDef } from "./pdfTheme.ts";

const FONT_BUCKET_URL = `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/hire-order-fonts`;

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

/**
 * Fetch one font file and turn it into a self-contained `data:` URL, or
 * `null` on any failure (network error, non-2xx, provisioning not done yet).
 * A data URL never triggers a further fetch inside react-pdf's OWN lazy font
 * loader (`FontSource._load`, which runs during PDF layout, not during
 * `Font.register`) - registering a bare Storage URL instead would let a bad
 * response surface as an unhandled "Unknown font format" render-time throw
 * (confirmed against the browser build's identical code path during Task 4):
 * `Font.register`'s own try/catch does NOT catch that, since the fetch it
 * wraps is deferred.
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
 * Register the families a theme uses. Geist and Geist Mono are base64-embedded
 * so the DEFAULT theme never touches the network. Anything else is fetched
 * from the public font bucket and embedded as a data URL up front; a file
 * that fails to fetch falls back to the PDF-standard Helvetica for that
 * weight, so the family NAME is always backed by a working registration -
 * react-pdf throws "Font family not registered" for any name it has never
 * seen at all, so leaving a family unregistered on failure is not an option
 * either. This is how a Storage bucket that is not yet provisioned (or a
 * single missing file) degrades to a plain-looking document instead of a
 * failed issue.
 */
export async function registerFonts(families: FontFamilyDef[]): Promise<void> {
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
    // react-pdf hyphenates at line breaks by default, which would render an
    // org called "Buehnenproduktionsgesellschaft" as "Buehnenproduktions-".
    // Names, venues and emails are not dictionary words; break on whole words
    // instead. Set once per isolate, alongside the default fonts.
    Font.registerHyphenationCallback((word) => [word]);
    registered.add("Geist");
    registered.add("GeistMono");
  }

  for (const def of families) {
    if (def.embedded || registered.has(def.family)) continue;
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
