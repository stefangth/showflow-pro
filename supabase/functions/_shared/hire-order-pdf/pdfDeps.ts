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

/**
 * Register the families a theme uses. Geist and Geist Mono are base64-embedded
 * so the DEFAULT theme never touches the network; anything else is fetched from
 * the public font bucket and memoised per isolate.
 *
 * Registration failures are swallowed on purpose: react-pdf falls back to an
 * already-registered family, so a bad font produces a plain-looking document
 * rather than a failed issue.
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
    try {
      Font.register({
        family: def.family,
        fonts: def.files.map((f) => ({
          src: `${FONT_BUCKET_URL}/${f.path}`,
          fontWeight: f.weight,
        })),
      });
      registered.add(def.family);
    } catch (_error) {
      // Leave it unregistered: react-pdf falls back rather than throwing.
    }
  }
}
