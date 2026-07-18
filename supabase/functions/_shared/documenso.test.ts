import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createAndSendEnvelope, type DocumensoConfig } from "./documenso.ts";

const CFG: DocumensoConfig = { baseUrl: "https://documenso.test", token: "tok-abc" };
const ARGS = {
  title: "HO-2026-0142",
  pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  recipientName: "Ann Artist",
  recipientEmail: "ann@x.de",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface RecordedCall { url: string; init?: RequestInit }

/** A fake fetch that dispatches on the URL suffix, so call order in the client
 *  doesn't have to match test-array indices exactly. Records every call. */
function fakeFetch(handlers: Record<string, (init?: RequestInit) => Response>): { fetchFn: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchFn = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    for (const [suffix, handler] of Object.entries(handlers)) {
      if (u.endsWith(suffix)) return Promise.resolve(handler(init));
    }
    throw new Error(`fakeFetch: no handler for ${u}`);
  }) as typeof fetch;
  return { fetchFn, calls };
}

Deno.test("createAndSendEnvelope issues create -> add recipient -> distribute, each carrying the raw API token", async () => {
  const { fetchFn, calls } = fakeFetch({
    "/api/v2/envelope/create": () => jsonRes({ id: "envelope_123" }),
    "/api/v2/envelope/recipient/create-many": () => jsonRes({ data: [{ id: 1, token: "sign-tok-xyz" }] }),
    "/api/v2/envelope/envelope_123/distribute": () => jsonRes({ id: "envelope_123", status: "PENDING" }),
  });

  const result = await createAndSendEnvelope(fetchFn, CFG, ARGS);

  assertEquals(calls.length, 3, "expected exactly three requests: create, recipient, distribute");
  assertEquals(calls[0].url, "https://documenso.test/api/v2/envelope/create");
  assertEquals(calls[1].url, "https://documenso.test/api/v2/envelope/recipient/create-many");
  assertEquals(calls[2].url, "https://documenso.test/api/v2/envelope/envelope_123/distribute");

  for (const c of calls) {
    const headers = new Headers(c.init?.headers);
    // Documenso API v1 uses the raw api_... token with no "Bearer " scheme.
    assertEquals(headers.get("Authorization"), "tok-abc", `missing/incorrect Authorization header on ${c.url}`);
  }

  assertEquals(result.envelopeId, "envelope_123");
  assertEquals(result.signingUrl, "https://documenso.test/sign/sign-tok-xyz");
});

Deno.test("createAndSendEnvelope uploads the PDF bytes and adds the recipient as role SIGNER", async () => {
  const { fetchFn, calls } = fakeFetch({
    "/api/v2/envelope/create": () => jsonRes({ id: "env-1" }),
    "/api/v2/envelope/recipient/create-many": () => jsonRes({ data: [{ token: "tok-1" }] }),
    "/api/v2/envelope/env-1/distribute": () => jsonRes({}),
  });

  await createAndSendEnvelope(fetchFn, CFG, ARGS);

  // The create call carries a multipart body with the PDF bytes attached (not JSON) —
  // the client must not set a Content-Type itself (fetch derives the multipart
  // boundary from the FormData body).
  const createCall = calls.find((c) => c.url.endsWith("/envelope/create"));
  assert(createCall, "expected a create request");
  assert(createCall!.init?.body instanceof FormData, "expected the create request body to be FormData");
  const createHeaders = new Headers(createCall!.init?.headers);
  assertEquals(createHeaders.get("Content-Type"), null, "must not hand-set Content-Type on a multipart FormData body");

  const recipientCall = calls.find((c) => c.url.endsWith("/recipient/create-many"));
  assert(recipientCall, "expected a recipient-add request");
  const recipientBody = JSON.parse(recipientCall!.init!.body as string) as {
    envelopeId: string;
    data: Array<{ email: string; name: string; role: string }>;
  };
  assertEquals(recipientBody.envelopeId, "env-1");
  assertEquals(recipientBody.data.length, 1);
  assertEquals(recipientBody.data[0].role, "SIGNER");
  assertEquals(recipientBody.data[0].email, "ann@x.de");
  assertEquals(recipientBody.data[0].name, "Ann Artist");
});

Deno.test("createAndSendEnvelope returns a null signingUrl when the API returns no token", async () => {
  const { fetchFn } = fakeFetch({
    "/api/v2/envelope/create": () => jsonRes({ id: "env-2" }),
    "/api/v2/envelope/recipient/create-many": () => jsonRes({ data: [{ id: 1 }] }),
    "/api/v2/envelope/env-2/distribute": () => jsonRes({}),
  });

  const result = await createAndSendEnvelope(fetchFn, CFG, ARGS);
  assertEquals(result.envelopeId, "env-2");
  assertEquals(result.signingUrl, null);
});

Deno.test("createAndSendEnvelope throws documenso_error:<status> on a non-2xx create response", async () => {
  const fetchFn = (() => Promise.resolve(new Response("unauthorized", { status: 401 }))) as typeof fetch;
  await assertRejects(
    () => createAndSendEnvelope(fetchFn, CFG, ARGS),
    Error,
    "documenso_error:401",
  );
});

Deno.test("createAndSendEnvelope throws documenso_error:<status> on a non-2xx recipient-add response", async () => {
  const { fetchFn } = fakeFetch({
    "/api/v2/envelope/create": () => jsonRes({ id: "env-3" }),
    "/api/v2/envelope/recipient/create-many": () => new Response("bad", { status: 422 }),
  });
  await assertRejects(
    () => createAndSendEnvelope(fetchFn, CFG, ARGS),
    Error,
    "documenso_error:422",
  );
});

Deno.test("createAndSendEnvelope throws documenso_error:<status> on a non-2xx distribute response", async () => {
  const { fetchFn } = fakeFetch({
    "/api/v2/envelope/create": () => jsonRes({ id: "env-4" }),
    "/api/v2/envelope/recipient/create-many": () => jsonRes({ data: [{ token: "t" }] }),
    "/api/v2/envelope/env-4/distribute": () => new Response("fail", { status: 500 }),
  });
  await assertRejects(
    () => createAndSendEnvelope(fetchFn, CFG, ARGS),
    Error,
    "documenso_error:500",
  );
});
