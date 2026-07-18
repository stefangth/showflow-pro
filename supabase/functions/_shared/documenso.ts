// Thin Documenso REST API v1/v2 client for the hire-order countersignature flow
// (design spec §8). Injected `fetchFn` + `cfg` so the whole client is testable
// against a fake fetch — no network access in tests, no SDK dependency.
//
// API contract sourced from https://docs.documenso.com (developers > API,
// July 2026 revision): documents are called "envelopes" in the v2 API.
//   1. POST {baseUrl}/api/v2/envelope/create        -- multipart/form-data,
//      `payload` (JSON: {type:"DOCUMENT", title}) + `files` (the PDF binary).
//      Response: { id: "<envelope id>" }.
//   2. POST {baseUrl}/api/v2/envelope/recipient/create-many -- JSON body
//      { envelopeId, data: [{ email, name, role }] }. Response:
//      { data: [{ token, ... }] } -- `token` is the recipient's signing token.
//   3. POST {baseUrl}/api/v2/envelope/{envelopeId}/distribute -- sends the
//      envelope (empty body) so the recipient is emailed.
//
// NOTE on the signing URL: Documenso's own docs describe `token` as "unique
// token for signing URL" but do not spell out the URL shape in the pages this
// client was built against. `{baseUrl}/sign/{token}` matches Documenso's known
// public signing route; this is the one part of the contract not verified
// against a live instance (see task-7-report.md). It is used as a best-effort
// convenience link only -- issuing itself never depends on it.
export interface DocumensoConfig {
  baseUrl: string;
  token: string;
}

interface CreateAndSendEnvelopeArgs {
  title: string;
  pdf: Uint8Array;
  recipientName: string;
  recipientEmail: string;
}

interface CreateAndSendEnvelopeResult {
  envelopeId: string;
  signingUrl: string | null;
}

/** Throw a typed `documenso_error:<status>` error for any non-2xx response. */
function assertOk(res: Response): void {
  if (!res.ok) throw new Error(`documenso_error:${res.status}`);
}

/**
 * Create a Documenso envelope from an already-rendered PDF, add the artist as
 * a SIGNER recipient, and send it. Every request carries
 * `Authorization: Bearer <cfg.token>` against `cfg.baseUrl` as the origin.
 *
 * Failure: any non-2xx response at any of the three steps throws
 * `Error("documenso_error:<status>")` -- the caller (generate-hire-orders'
 * issue path) treats this as containment-worthy: the order stays issued and
 * falls back to manual countersign mode (never lose the issued document over
 * a Documenso hiccup).
 */
export async function createAndSendEnvelope(
  fetchFn: typeof fetch,
  cfg: DocumensoConfig,
  args: CreateAndSendEnvelopeArgs,
): Promise<CreateAndSendEnvelopeResult> {
  const authHeader = { Authorization: `Bearer ${cfg.token}` };

  // 1) Create the envelope/document from the rendered PDF bytes. Deliberately
  // no Content-Type header here: fetch derives the multipart boundary from the
  // FormData body itself, and hand-setting it would break that.
  const form = new FormData();
  form.append(
    "payload",
    new Blob([JSON.stringify({ type: "DOCUMENT", title: args.title })], { type: "application/json" }),
  );
  form.append("files", new Blob([args.pdf as BlobPart], { type: "application/pdf" }), `${args.title}.pdf`);
  const createRes = await fetchFn(`${cfg.baseUrl}/api/v2/envelope/create`, {
    method: "POST",
    headers: authHeader,
    body: form,
  });
  assertOk(createRes);
  const created = (await createRes.json()) as { id?: string };
  const envelopeId = created.id;
  if (!envelopeId) throw new Error("documenso_error:invalid_response");

  // 2) Add the artist as a SIGNER recipient; the response carries the signing token.
  const recipientRes = await fetchFn(`${cfg.baseUrl}/api/v2/envelope/recipient/create-many`, {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({
      envelopeId,
      data: [{ email: args.recipientEmail, name: args.recipientName, role: "SIGNER" }],
    }),
  });
  assertOk(recipientRes);
  const recipientBody = (await recipientRes.json()) as { data?: Array<{ token?: string }> };
  const token = recipientBody.data?.[0]?.token ?? null;

  // 3) Distribute (send) the envelope so the recipient is notified.
  const distributeRes = await fetchFn(`${cfg.baseUrl}/api/v2/envelope/${envelopeId}/distribute`, {
    method: "POST",
    headers: authHeader,
  });
  assertOk(distributeRes);

  return {
    envelopeId,
    signingUrl: token ? `${cfg.baseUrl}/sign/${token}` : null,
  };
}
