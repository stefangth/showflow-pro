// Browser font registration. The edge twin has its own suite
// (supabase/functions/_shared/hire-order-pdf/pdfDeps.test.ts); neither file is
// mirrored, so both need their own coverage.
//
// NOTE ON SHARED MODULE STATE: `registered` and `failedAt` inside pdfDeps.ts
// live for the module's lifetime, exactly as they do in a real page session,
// and `Font.register` is append-only by design. These tests therefore use a
// DIFFERENT non-embedded family per case so no case can be perturbed by an
// earlier one, and never re-use a family across cases.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerFonts } from "./pdfDeps";
import { FONT_FAMILIES, type FontFamilyDef } from "./pdfTheme";

function familyDef(key: string): FontFamilyDef {
  const def = FONT_FAMILIES.find((f) => f.key === key);
  if (!def) throw new Error(`no such family in the registry: ${key}`);
  return def;
}

const GEIST = familyDef("geist");
const GEIST_MONO = familyDef("geist-mono");

/** A fetch that never succeeds, so a family routed through it can never
 *  register. Counts calls so "did we hit the network at all" is assertable. */
function failingFetch() {
  return vi.fn(async () => new Response("nope", { status: 400 }));
}

describe("registerFonts (browser)", () => {
  beforeEach(() => {
    // The failure paths log deliberately (see loadFontDataUrl); keep the test
    // output readable without hiding a genuine unexpected throw.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("registers the embedded default families with zero network I/O", async () => {
    const fetchImpl = failingFetch();

    const available = await registerFonts([GEIST, GEIST_MONO], fetchImpl as unknown as typeof fetch);

    // This is the whole point of embedding the bytes: the default theme's two
    // families resolve even though every fetch this test offers would fail,
    // so the live preview lays out in Geist rather than degrading to
    // Helvetica (different metrics -> different line breaks and pagination
    // from the real PDF).
    expect(available.has("geist")).toBe(true);
    expect(available.has("geist-mono")).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports the embedded families even when asked for none of them", async () => {
    // render.tsx passes only `familiesInUse(theme)`. A theme that overrides
    // every role away from Geist must still leave geist/geist-mono resolvable,
    // because buildStyles falls back to them for anything unstyled.
    const available = await registerFonts([], failingFetch() as unknown as typeof fetch);

    expect([...available].sort()).toEqual(["geist", "geist-mono"]);
  });

  it("leaves a family whose files cannot be fetched out of the available set", async () => {
    const fetchImpl = failingFetch();

    const available = await registerFonts([familyDef("inter")], fetchImpl as unknown as typeof fetch);

    expect(available.has("inter")).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(familyDef("inter").files.length);
  });

  it("does not refetch a failed family until its failure ttl lapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T10:00:00.000Z"));
    const fetchImpl = failingFetch();
    const plexSans = familyDef("plex-sans");

    await registerFonts([plexSans], fetchImpl as unknown as typeof fetch);
    const afterFirst = fetchImpl.mock.calls.length;
    expect(afterFirst).toBe(plexSans.files.length);

    // A live preview re-renders on every debounced keystroke batch. Without
    // the negative cache each of those would refire the same doomed requests.
    await registerFonts([plexSans], fetchImpl as unknown as typeof fetch);
    await registerFonts([plexSans], fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls.length).toBe(afterFirst);

    // Once the ttl lapses the family is retried, so an operator who uploads
    // the missing files sees them without reloading the page.
    vi.setSystemTime(new Date("2026-07-25T10:00:31.000Z"));
    await registerFonts([plexSans], fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls.length).toBe(afterFirst + plexSans.files.length);
  });

  it("does not register a family when only some of its weights load", async () => {
    const serif = familyDef("source-serif");
    // Source Serif reuses one file for two weights, so key the fake network by
    // path and fail exactly the SemiBold one.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("SemiBold")) return new Response("nope", { status: 404 });
      // A real TTF header (sfnt 1.0) so looksLikeFont accepts the body.
      return new Response(new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x00, 0x00]));
    });

    const available = await registerFonts([serif], fetchImpl as unknown as typeof fetch);

    // A half-registered family would render headings and body text in visibly
    // different typefaces, which reads as a bug rather than a fallback.
    expect(available.has("source-serif")).toBe(false);
  });
});
