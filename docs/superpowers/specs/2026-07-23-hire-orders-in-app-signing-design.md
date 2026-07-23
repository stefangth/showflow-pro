# Hire orders: in-app electronic signing

- **Date:** 2026-07-23
- **Status:** Approved design, ready for implementation plan
- **Branch:** `claude/hire-orders-custom-integration-b80fe2`
- **Feature gate:** `hire_orders` entitlement (unchanged, ships dark)

## Context

Hire orders move through `draft -> ready -> issued -> countersigned -> void`. On
**issue**, `generate-hire-orders` renders the PDF (`@react-pdf/renderer` from the
order's frozen `data` snapshot), uploads it to the `hire-orders` bucket, stamps
`issued`, emails the artist the PDF, and notifies them.

Capturing the artist's signature (the `issued -> countersigned` step) has two
per-org modes stored in the `hire_order_countersign` app setting:

- **manual** — a producer clicks "Mark countersigned" once the artist has signed
  outside ShowFlow. A pure client-side status flip (`useMarkCountersigned`).
- **documenso** — on issue, the rendered PDF is pushed to Documenso as an
  "envelope" with the artist as SIGNER; Documenso emails the signing link,
  captures the signature, and fires a `DOCUMENT_COMPLETED` webhook that
  `documenso-webhook` turns into the `countersigned` transition.

**Problem:** the Documenso *hosted* API requires a major paid plan, so the
`documenso` mode is not viable. We are replacing it with an **in-app electronic
signature** built on top of the existing hire-order engine.

## Goal

Let the linked artist review an issued hire order and sign it **inside
ShowFlow** (typed or drawn), producing a signed PDF plus a legally meaningful
audit trail, and flipping the order to `countersigned`. Simple electronic
signature level (valid under EU eIDAS SES and US ESIGN): the signer is already
authenticated to their ShowFlow account; we capture consent, the signature, and
audit metadata (identity, timestamp, IP, user-agent, document hash).

### Non-goals

- Cryptographically-sealed / certificate-embedded PDFs (advanced/qualified
  e-signature). Explicitly out of scope per the design decision.
- Multi-recipient / multi-signer envelopes. The artist is the only signer; the
  producer's "issue" action is the org's authorization side.
- Signature reminders, expiry, or decline flows. An unsigned order simply stays
  `issued`; the manual mode remains available as a fallback.
- Removing or reworking the Documenso code (see "Documenso: leave dark").

## Decisions (agreed in brainstorming)

1. **Build in-app**, not self-host Documenso, not switch providers.
2. **Simple electronic signature** rigor level.
3. **Capture:** both typed and drawn (a pad with Type / Draw tabs).
4. **Keep both PDFs:** the original issued PDF stays untouched at `pdf_path`; the
   signed copy lands at a new `signed_pdf_path`, so "what was issued" and "what
   was signed" are both provable.
5. **Dedicated audit table** (`hire_order_signatures`), not a jsonb column —
   append-only, its own RLS.
6. **Keep `manual` mode** as a fallback alongside the new `electronic` mode.
7. **Leave the Documenso code in place, dark** (do not delete), with "not in
   use" comments. Only remove Documenso as a *selectable* settings option.

## Data model (one migration)

New migration (name to match the real applied timestamp). All additive.

### `hire_orders` column

```sql
alter table public.hire_orders add column signed_pdf_path text;
```

`pdf_path` (issued copy) is never overwritten by signing.

### `countersign_mode` check constraint

Extend the existing column check to allow `electronic`, keeping `documenso` in
the allowed set so the dormant branch and any historical rows stay valid. The
original check is inline, so Postgres auto-named it
`hire_orders_countersign_mode_check` (confirm with `\d public.hire_orders`
before dropping):

```sql
alter table public.hire_orders drop constraint hire_orders_countersign_mode_check;
alter table public.hire_orders add constraint hire_orders_countersign_mode_check
  check (countersign_mode in ('manual','documenso','electronic'));
```

### `hire_order_signatures` (new, append-only audit record)

```sql
create table public.hire_order_signatures (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  hire_order_id        uuid not null references public.hire_orders(id) on delete cascade,
  signer_user_id       uuid references auth.users(id),
  signer_name          text not null,
  signer_email         text,
  method               text not null check (method in ('typed','drawn')),
  typed_name           text,
  signature_image_path text,           -- drawn PNG in the hire-orders bucket
  signed_at            timestamptz not null,
  ip                   inet,
  user_agent           text,
  consent_text         text not null,  -- exact statement shown at signing
  document_sha256      text not null,  -- hash of the ISSUED pdf bytes at signing
  created_at           timestamptz not null default now(),
  unique (hire_order_id)               -- one signature per order
);
```

RLS:

- **Read:** org producers/admins (`has_org_role`), plus the linked artist
  (`hire_order_id -> hire_orders.artist_id -> artists.user_id = auth.uid()`).
- **No client insert/update/delete.** Rows are written only by the edge function
  via the service role. Add the RESTRICTIVE `org_isolation` policy (pooled
  multi-tenancy template). Because there is no permissive INSERT/UPDATE/DELETE
  policy, authenticated clients cannot mutate it, which is the intent (immutable
  audit).

### Transition guard relaxation

`enforce_hire_order_transition` currently freezes `pdf_path` (among others) once
`status in ('issued','countersigned')`. Relax it so the `issued -> countersigned`
transition may set `signed_pdf_path` (and `countersign_mode`), while `data`,
`fee_amount`, `fee_currency`, `terms_variant`, `order_no`, and `pdf_path` stay
frozen. Implement with `CREATE OR REPLACE FUNCTION` (never edit an applied
migration).

## Backend: new `sign` action in `generate-hire-orders`

Add `case "sign":` to the action switch. Like `download-url`, it must run its
**own per-order auth** and therefore sit *before* the admin/producer
`requireOrgRole` gate (an artist holds neither role):

```
if (body.action === "download-url") return downloadUrl(deps, req, body);
if (body.action === "sign")         return signOrder(deps, req, body);
```

`signOrder(deps, req, body)` steps:

1. **Auth (own):** require a `Bearer` JWT; `userClient.auth.getUser()`. Load the
   order (`id, org_id, artist_id, status, order_no, data, terms_variant,
   fee_currency, pdf_path, agent_name, agent_email`) scoped to `org_id`. Allow
   only when the caller is the **linked artist**
   (`artists.id = order.artist_id and artists.user_id = user.id`). Reject
   producers/admins here — signing is the artist's act (they use manual mode if
   they must self-serve). 401/403/404 as appropriate.
2. **Guards:** `status === 'issued'` (else 409 `already_signed` /
   `not_issued`); resolve `hire_order_countersign` and require `mode ===
   'electronic'` (else 409 `wrong_mode`); `requireFeature(org, 'hire_orders')`;
   `body.consent === true` (else 400 `consent_required`); validate the payload
   (`method 'typed'|'drawn'`; typed -> non-empty `typed_name`; drawn -> a
   `signature_png` data URL within a sane size cap).
3. **Document hash:** download the issued PDF from `pdf_path`, compute SHA-256
   (tamper anchor). If `pdf_path`/bytes are missing -> 409 `no_pdf`.
4. **Store drawn image:** for `drawn`, decode the PNG and upload to
   `${org}/signatures/${order_no}.png` in the bucket.
5. **Re-render signed PDF:** call `deps.renderHireOrderPdf` with the same frozen
   `data`/letterhead/terms/currency but a new optional `signature` input (see
   below) and `status: "countersigned"`. The renderer draws a **signature block**
   (typed name in a script-style face, or the embedded drawn image) and appends a
   **signature certificate page** (signer name/email, method, `signed_at`, IP,
   user-agent, `document_sha256`, and the consent statement).
6. **Upload** the signed PDF to `signed_pdf_path = ${org}/${order_no}-signed.pdf`.
7. **Insert** the `hire_order_signatures` row (all audit fields).
8. **Transition:** update `status -> 'countersigned'`, set `countersigned_at`,
   `signed_pdf_path`, `countersign_mode = 'electronic'`, guarded by
   `.eq('status','issued')` so a concurrent double-submit that loses the race is
   an idempotent no-op (mirror `documenso-webhook`'s guarded flip). If the update
   matched zero rows, return the idempotent success shape without re-notifying.
9. **Side effects (best-effort, never undo the signing):** reuse
   `notifyProducers` (already defined for the issue path) to notify producers,
   insert an artist-facing confirmation notification, and email the artist (and
   producers) the **signed** PDF as attachment via a new
   `hire-order-countersigned` template. Failures here are logged, not fatal.

Response: `{ countersigned: true, signed_pdf_path }` (or the idempotent variant).

### Render input extension

Extend `RenderHireOrderPdf`'s input type (`_shared/hireOrders.ts`) with an
optional field, consumed by `render.tsx`:

```ts
signature?: {
  method: "typed" | "drawn";
  typedName?: string;
  imageDataUrl?: string;      // data:image/png;base64,... for drawn
  signerName: string;
  signerEmail?: string;
  signedAtIso: string;
  ip?: string;
  userAgent?: string;
  documentSha256: string;
  consentText: string;
};
```

When absent, rendering is byte-for-byte the current behavior (issue/preview
unaffected). When present, render the signature block + certificate page.

### `Countersign` type

Widen the edge-function `Countersign.mode` union to
`"manual" | "documenso" | "electronic"` (keep `documenso` for the dormant
branch). `COUNTERSIGN_DEFAULT` stays `{ mode: "manual" }`.

## Frontend

### Signing screen (artist)

On `HireOrderDetailPage` (`/hire-orders/:id`), when `order.status === 'issued'`,
the resolved org mode is `electronic`, and the viewer is the linked artist, show
a prominent **"Review & sign"** button (in the artist action area of
`OrderSlideOver` / the page footer). It opens `SignHireOrderDialog`:

- The already-embedded PDF preview stays visible for review (dialog references
  "the document shown above").
- `SignaturePad` component: **Type** tab (text input rendered in a script face)
  and **Draw** tab (canvas -> PNG data URL; clearable). Reuse the MIT
  `signature_pad` library for the canvas, or a ~50-line self-contained canvas if
  we prefer no dependency (decide in the plan; either is fine).
- A **consent checkbox** with the exact consent statement (see below).
- **Sign** button -> `useSignHireOrder`, disabled until a signature is present
  and consent is checked.

On success: toast, invalidate `['hire-orders']`, the page re-renders as
`countersigned` (Download now serves the signed PDF).

### Data + hooks

- `signHireOrder(client, { orgId, orderId, method, typedName?, signaturePng?, consent })`
  in `src/data/hireOrders.ts` (wraps `invokeHireOrderAction` with `action:
  'sign'`).
- `useSignHireOrder()` in `src/hooks/useHireOrders.ts`.
- New components: `src/components/hireOrders/SignHireOrderDialog.tsx`,
  `src/components/hireOrders/SignaturePad.tsx`.

`useMarkCountersigned` (producer, manual mode) is unchanged.

### Download of the signed copy

`download-url` currently signs `pdf_path`. Update it (and/or add an optional
`variant: 'issued' | 'signed'`) so that once `signed_pdf_path` is set the artist
and producers can fetch the **signed** copy; default to the signed copy when
present, else the issued PDF. Keep the existing per-order authorization intact.

### Settings — CountersignCard

- Replace the **Documenso** radio with **Electronic signature (in-app)**; keep
  **Manual**. The stored setting becomes `manual | electronic`.
- Remove the Documenso-only "Test connection" button and its `countersign-test`
  call. (The `countersign-test` edge action stays in the code, dark — see below.)
- The `CountersignMode` UI type becomes `"manual" | "electronic"`.

## Email

- **Issued email** (`hire-order-issued`): in `electronic` mode set `signing_url`
  to the in-app order page (`${APP_URL}/hire-orders/${order.id}`) so the existing
  "Review and sign" CTA points at the signing screen. Manual mode unchanged.
- **New `hire-order-countersigned` template:** sent from the `sign` action to the
  artist (and producers) with the signed PDF attached. Register it in
  `_shared/transactional-email-templates/registry.ts`. Copy avoids em/en dashes
  (house style).

## Documenso: leave dark (do not delete)

Per the decision, nothing Documenso is removed. Add a one-line header comment to
each of the following noting it is retained for a possible future self-hosted
Documenso and is not currently reachable:

- `supabase/functions/_shared/documenso.ts`
- `supabase/functions/documenso-webhook/index.ts` (+ its test) — **stays
  deployed but inert**; nothing creates envelopes, and it already fail-closes on
  a missing/wrong `DOCUMENSO_WEBHOOK_SECRET`. No `functions delete`, no config
  change.
- `issueOne`'s `if (countersignModeUsed === 'documenso')` branch — unreachable
  once the settings UI offers only `manual | electronic`, but valid.
- the `countersign-test` action + `documensoAuthHeader` usage.
- the `documenso_envelope_id` column (kept; not worth a drop migration).

## Security & auth

- The `sign` action is JWT-only, artist-only, and self-scoped to the order's
  linked artist — it never trusts `body` for identity. It sits ahead of the
  admin/producer gate exactly like `download-url`.
- Service-role writes (`hire_order_signatures` insert, signed-PDF upload, status
  flip) bypass RLS intentionally; the caller identity is re-verified first.
- The drawn-signature PNG is size-capped and content-type-checked before upload.
- IP is derived from the request (`x-forwarded-for` first hop) and user-agent
  from the header; both are audit metadata only.

## Legal / audit content

**Consent statement** (shown at signing, stored verbatim in
`consent_text`; no em/en dashes):

> By signing, I agree that my electronic signature is the legal equivalent of my
> handwritten signature, and I accept the terms of this hire order.

**Certificate page** appended to the signed PDF lists: order number, signer name
and email, signing method, signed-at timestamp (with timezone), signer IP,
user-agent, the SHA-256 of the issued document, and the consent statement.

## Testing (test-first)

- **Vitest:** `SignaturePad` (typed value, drawn -> data URL, clear, disabled
  states); `signHireOrder` data-access (payload shape, error surfacing) against
  `supabaseFake`; `useSignHireOrder`; `SignHireOrderDialog` gating (only for
  linked artist + issued + electronic); CountersignCard new options.
- **Deno DI** (`generate-hire-orders/index.di.test.ts`): `sign` action —
  non-artist 403, wrong-artist 403, non-issued 409, wrong-mode 409, feature-off
  denied, consent-required 400; happy path (hashes issued PDF, stores drawn
  image, re-renders with `signature`, uploads `signed_pdf_path`, inserts audit
  row, flips to `countersigned`, notifies + emails); idempotent double-submit.
- **pgTAP:** the relaxed `enforce_hire_order_transition` (allows
  `signed_pdf_path`/`countersign_mode` on `issued -> countersigned`, still
  freezes `data`/`fee`/`order_no`/`pdf_path`); `hire_order_signatures` RLS
  (linked artist reads own, other artists denied, no client insert/update/delete,
  org isolation).

## Docs & rollout

- Update `docs/system-map.md` and `src/data/systemMap.ts` in the same PR (the
  signing trigger -> function -> data -> effect), plus `docs/app-logic.md`. The
  Documenso webhook entry is annotated as dormant rather than removed.
- Ships **dark** under the existing `hire_orders` entitlement; no default change.
- `public/changelog.md`: a customer-facing "Improved/New" note about signing
  hire orders online (no mention of Documenso, super-admin, or internals),
  regenerated to JSON via the deno script. Target version per the hire-orders
  initiative (tag after merge).

## Open questions

- **SignaturePad dependency:** `signature_pad` (MIT) vs a small self-contained
  canvas. Lean self-contained to avoid a new dependency; confirm in the plan.
- **Producer countersign copy email:** send the signed PDF to producers too, or
  in-app notification only? Default: in-app notification for producers, signed
  PDF email to the artist. Revisit if the owner wants producers emailed the copy.
