/**
 * DI tests for fetch-remote-sheet — an SSRF-guarded proxy that fetches a public
 * Google Sheets CSV for the bulk artist import.
 *
 * Contract:
 *  - OPTIONS → preflight
 *  - no Bearer → 401; artist-role caller → 403 (requireOrgRole producer+admin)
 *  - non-Google / non-CSV URL → 400 and deps.fetch is NOT called (SSRF guard)
 *  - producer + valid published-CSV URL → 200 { csv }
 *  - upstream redirect (3xx) → 400 (no redirect following)
 */

import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const GOOD_URL = "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=0";

function producerDeps(fetchImpl?: typeof fetch) {
  return makeFakeDeps({
    authUser: { id: "u1" },
    tables: { org_memberships: { data: { role: "producer" }, error: null } },
    fetchImpl,
  });
}

function sheetReq(body: Record<string, unknown>) {
  return makeRequest({ headers: { Authorization: "Bearer jwt" }, body });
}

Deno.test("fetch-remote-sheet DI: OPTIONS → preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("fetch-remote-sheet DI: no Bearer → 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ headers: {}, body: { org_id: "o1", url: GOOD_URL } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("fetch-remote-sheet DI: non-Google URL → 400 and fetch not called", async () => {
  let fetched = false;
  const { deps } = producerDeps((() => { fetched = true; return Promise.resolve(new Response("")); }) as typeof fetch);
  const res = await handle(sheetReq({ org_id: "o1", url: "https://evil.internal/x?format=csv" }), deps);
  assertEquals(res.status, 400);
  assertEquals(fetched, false);
});

Deno.test("fetch-remote-sheet DI: artist-role caller → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u2" },
    tables: { org_memberships: { data: { role: "artist" }, error: null } },
  });
  const res = await handle(sheetReq({ org_id: "o1", url: GOOD_URL }), deps);
  assertEquals(res.status, 403);
});

Deno.test("fetch-remote-sheet DI: producer + valid CSV URL → 200 { csv }", async () => {
  const csvText = "name,email\nAda,ada@x.com";
  const { deps } = producerDeps((() => Promise.resolve(new Response(csvText, { status: 200 }))) as typeof fetch);
  const res = await handle(sheetReq({ org_id: "o1", url: GOOD_URL }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { csv: string };
  assertEquals(body.csv, csvText);
});

Deno.test("fetch-remote-sheet DI: upstream redirect → 400", async () => {
  const { deps } = producerDeps((() => Promise.resolve(new Response("", { status: 302 }))) as typeof fetch);
  const res = await handle(sheetReq({ org_id: "o1", url: GOOD_URL }), deps);
  assertEquals(res.status, 400);
});

Deno.test("fetch-remote-sheet DI: oversized Content-Length → 502 (no body read)", async () => {
  let read = false;
  const fakeRes = {
    status: 200,
    ok: true,
    headers: new Headers({ "content-length": String(6 * 1024 * 1024) }),
    arrayBuffer: () => { read = true; return Promise.resolve(new ArrayBuffer(0)); },
  } as unknown as Response;
  const { deps } = producerDeps((() => Promise.resolve(fakeRes)) as typeof fetch);
  const res = await handle(sheetReq({ org_id: "o1", url: GOOD_URL }), deps);
  assertEquals(res.status, 502);
  assertEquals(read, false);
});
