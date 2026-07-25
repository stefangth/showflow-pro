import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { registerFonts } from "./pdfDeps.ts";
import { FONT_FAMILIES, resolveHireOrderTheme, themeRoleStyle, type FontFamilyDef } from "./pdfTheme.ts";

// The font bucket does not exist yet (Task 5 provisions it, but real TTFs are
// an infrastructure step a human completes separately - see
// docs/runbooks/hire-order-fonts.md), so every scenario here injects a fake
// `fetch` rather than hitting the network. This is the whole point of these
// tests: the degradation logic (safeReactPdfFamilyName, the all-or-nothing
// registration rule, the non-sticky retry, and the looksLikeFont sniffer)
// shipped in Task 4 with zero automated coverage, backed only by an
// unreproducible in-browser observation (plan 2 progress ledger, Task 4 C1).

function realDef(key: FontFamilyDef["key"]): FontFamilyDef {
  const def = FONT_FAMILIES.find((f) => f.key === key);
  if (!def) throw new Error(`no FONT_FAMILIES entry for ${key}`);
  return def;
}

/** sfnt 1.0 signature (0x00010000) plus padding - passes looksLikeFont
 *  without needing a real, parseable font (registerFonts never parses the
 *  bytes; only Font.register's own lazy loader would, at PDF-layout time,
 *  which these tests never reach). */
function fontBytes(): Uint8Array {
  return new Uint8Array([0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0]);
}

function fontResponse(): Response {
  return new Response(fontBytes().buffer as ArrayBuffer, { status: 200 });
}

function notFoundResponse(): Response {
  return new Response("not found", { status: 404 });
}

/** A 200 with a body that is not a font at all - the shape a misconfigured
 *  redirect, a proxy error page, or an SPA fallback would produce. */
function nonFontResponse(): Response {
  return new Response("<!doctype html><html><body>not a font</body></html>", { status: 200 });
}

interface FakeFetch {
  fetchFn: typeof fetch;
  calls: string[];
}

/** Dispatches on the URL's path suffix (the part after `.../hire-order-fonts/`)
 *  so callers can key handlers by the FontFamilyDef `path` values directly,
 *  same pattern as documenso.test.ts's fakeFetch. A path with no handler
 *  throws, so an unexpected fetch fails loudly rather than hanging. */
function fakeFetch(handlers: Record<string, () => Response>): FakeFetch {
  const calls: string[] = [];
  const fetchFn = ((url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    for (const [suffix, handler] of Object.entries(handlers)) {
      if (u.endsWith(suffix)) return Promise.resolve(handler());
    }
    throw new Error(`fakeFetch: no handler for ${u}`);
  }) as typeof fetch;
  return { fetchFn, calls };
}

/** A fetch that must never be called at all - used to prove a code path
 *  short-circuits before reaching the network (the C2 embedded-family fix). */
function neverCalledFetch(): FakeFetch {
  const calls: string[] = [];
  const fetchFn = (() => {
    calls.push("unexpected call");
    throw new Error("fetch should not have been called");
  }) as typeof fetch;
  return { fetchFn, calls };
}

Deno.test("a family whose fetch fails does not get registered, and a later call retries rather than inheriting the failure", async () => {
  const inter = realDef("inter");

  // First call: every weight 404s.
  const failing = fakeFetch({
    "Inter-Regular.ttf": notFoundResponse,
    "Inter-Medium.ttf": notFoundResponse,
    "Inter-SemiBold.ttf": notFoundResponse,
  });
  const afterFailure = await registerFonts([inter], failing.fetchFn);
  assertEquals(afterFailure.has("inter"), false, "a fully-failed family must not be marked available");
  assertEquals(failing.calls.length, 3, "every weight file is attempted");

  // Second call, same family: every weight now succeeds. This is the
  // isolate-poisoning regression - a naive "cache the failure" design would
  // leave `inter` permanently unavailable for the rest of this module's
  // lifetime regardless of what a later call's fetch does.
  const succeeding = fakeFetch({
    "Inter-Regular.ttf": fontResponse,
    "Inter-Medium.ttf": fontResponse,
    "Inter-SemiBold.ttf": fontResponse,
  });
  const afterRetry = await registerFonts([inter], succeeding.fetchFn);
  assertEquals(afterRetry.has("inter"), true, "a retried family that now fully succeeds must become available");

  // Third call: a real success IS sticky - once genuinely registered, a
  // later call must not re-fetch (Font.register is append-only and
  // first-match-wins, so re-registering the same family would be at best
  // wasted work and at worst silently ignored by react-pdf).
  const mustNotBeCalled = neverCalledFetch();
  const afterCache = await registerFonts([inter], mustNotBeCalled.fetchFn);
  assertEquals(afterCache.has("inter"), true);
  assertEquals(mustNotBeCalled.calls.length, 0, "a genuinely-registered family must not be re-fetched");
});

Deno.test("a family where one weight succeeds and another fails registers neither weight (all-or-nothing)", async () => {
  const plexSans = realDef("plex-sans");
  const { fetchFn, calls } = fakeFetch({
    "IBMPlexSans-Regular.ttf": fontResponse, // succeeds
    "IBMPlexSans-Medium.ttf": notFoundResponse, // fails
    "IBMPlexSans-SemiBold.ttf": fontResponse, // succeeds
  });

  const available = await registerFonts([plexSans], fetchFn);

  assertEquals(available.has("plex-sans"), false, "a partial family must not be registered at all");
  assertEquals(calls.length, 3, "every weight is fetched (Promise.all does not short-circuit on the first failure)");
});

Deno.test("a 200 response carrying non-font bytes is rejected by the content sniffer", async () => {
  const libreBaskerville = realDef("libre-baskerville");
  const { fetchFn } = fakeFetch({
    "LibreBaskerville-Regular.ttf": nonFontResponse,
    "LibreBaskerville-Medium.ttf": nonFontResponse,
    "LibreBaskerville-SemiBold.ttf": nonFontResponse,
  });

  const available = await registerFonts([libreBaskerville], fetchFn);

  assertEquals(
    available.has("libre-baskerville"),
    false,
    "a 200 that is not really a font (e.g. an SPA/proxy fallback page) must not register",
  );
});

Deno.test("a role on a failed family resolves to the standard substitute, and a mono role gets a mono substitute", async () => {
  const plexMono = realDef("plex-mono"); // kind: "mono"
  const plexSans = realDef("plex-sans"); // kind: "sans"
  const libreBaskerville = realDef("libre-baskerville"); // kind: "serif"
  const { fetchFn } = fakeFetch({
    "IBMPlexMono-Regular.ttf": notFoundResponse,
    "IBMPlexMono-Medium.ttf": notFoundResponse,
    "IBMPlexMono-SemiBold.ttf": notFoundResponse,
    "IBMPlexSans-Regular.ttf": notFoundResponse,
    "IBMPlexSans-Medium.ttf": notFoundResponse,
    "IBMPlexSans-SemiBold.ttf": notFoundResponse,
    "LibreBaskerville-Regular.ttf": notFoundResponse,
    "LibreBaskerville-Medium.ttf": notFoundResponse,
    "LibreBaskerville-SemiBold.ttf": notFoundResponse,
  });

  const available = await registerFonts([plexMono, plexSans, libreBaskerville], fetchFn);
  assertEquals(available.has("plex-mono"), false);
  assertEquals(available.has("plex-sans"), false);
  assertEquals(available.has("libre-baskerville"), false);

  // A mono-default role (orderNumber is in MONO_ROLE_KEYS) whose monoFamily
  // failed to load must fall back to Courier, not Helvetica: a proportional
  // substitute would misrender the exact thing a mono font is chosen for
  // (aligned order numbers, fee columns).
  const monoTheme = resolveHireOrderTheme({ base: { monoFamily: "plex-mono" } });
  assertEquals(themeRoleStyle(monoTheme, "orderNumber", available).fontFamily, "Courier");

  // A non-mono role whose base sans family failed must fall back to the
  // standard sans substitute, Helvetica.
  const sansTheme = resolveHireOrderTheme({ base: { fontFamily: "plex-sans" } });
  assertEquals(themeRoleStyle(sansTheme, "sectionHeading", available).fontFamily, "Helvetica");

  // A serif family that failed falls back to Times-Roman rather than
  // Helvetica (the C5 fix): both are equally pre-registered react-pdf
  // standard fonts, and Times-Roman is the visually closer substitute for a
  // serif choice.
  const serifTheme = resolveHireOrderTheme({ roles: { clauseBody: { family: "libre-baskerville" } } });
  assertEquals(themeRoleStyle(serifTheme, "clauseBody", available).fontFamily, "Times-Roman");
});

Deno.test("an embedded family definition becomes available without ever touching fetch", async () => {
  // Regression guard for the C2 fix: `available.add("geist")` /
  // `add("geist-mono")` used to be hardcoded literals rather than derived
  // from `def.embedded`, so a family marked `embedded: true` that reached the
  // `families` loop (any embedded family other than the two hardcoded ones)
  // would hit `continue` and never enter `available` - silently rendering in
  // Helvetica/Courier despite registering correctly. Uses a real def (so the
  // `kind`/`family` values are meaningful) with `embedded` forced true; a
  // fetch that throws if called at all proves the network is never touched.
  const embeddedSourceSerif: FontFamilyDef = { ...realDef("source-serif"), embedded: true };
  const mustNotBeCalled = neverCalledFetch();

  const available = await registerFonts([embeddedSourceSerif], mustNotBeCalled.fetchFn);

  assertEquals(available.has("source-serif"), true, "an embedded family must be available without a fetch");
  assertEquals(mustNotBeCalled.calls.length, 0, "an embedded family must never be fetched");
});

Deno.test("registerFonts always marks geist and geist-mono available with zero fetch calls, regardless of the families argument", async () => {
  // The default-theme path: familiesInUse(resolveHireOrderTheme()) is
  // [geist, geist-mono], but registerFonts registers/availables them
  // unconditionally even for an EMPTY families list, because they may be
  // needed (e.g. the page's inherited default) even when a theme's roles
  // don't reference them directly. This is the byte-identical gate's
  // real-world precondition: zero network I/O on the default path.
  const mustNotBeCalled = neverCalledFetch();
  const available = await registerFonts([], mustNotBeCalled.fetchFn);

  assert(available.has("geist"));
  assert(available.has("geist-mono"));
  assertEquals(mustNotBeCalled.calls.length, 0);
});
