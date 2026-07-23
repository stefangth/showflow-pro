# Hire orders: in-app electronic signing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the linked artist review an issued hire order and sign it inside ShowFlow (typed or drawn), producing a signed PDF plus a legally meaningful audit trail and flipping the order to `countersigned` — replacing the paid-API Documenso countersign path with a self-contained flow.

**Architecture:** Reuse the existing hire-order engine end to end. A new artist-only, self-authed `sign` action in `generate-hire-orders` re-renders the frozen order snapshot with a signature block + certificate page (same `@react-pdf/renderer` path), stores the signed PDF, records an append-only `hire_order_signatures` audit row, transitions the order, and notifies/emails. The frontend adds a signing dialog on the existing `/hire-orders/:id` viewer. The Documenso code is left in place, dark, with "not in use" comments.

**Tech Stack:** React 18 + Vite + TS, TanStack Query, shadcn/ui, Tailwind; Supabase (Postgres, Edge Functions in Deno, Storage); `@react-pdf/renderer@^4` (Deno `npm:` import, edge-only); `signature_pad` (MIT, new frontend dep). Tests: Vitest (frontend), Deno test (edge, DI), pgTAP (DB).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-23-hire-orders-in-app-signing-design.md` (read it before starting).
- **Ships dark** under the existing `hire_orders` entitlement — no default change. Every `generate-hire-orders` action stays behind `requireFeature(org_id, 'hire_orders')`.
- **Simple electronic signature** rigor: authenticated signer + consent + captured signature + audit metadata (identity, timestamp, IP, user-agent, issued-document SHA-256). No cryptographic PDF sealing.
- **No em/en dashes** in any product/UI copy: emails, UI strings, PDF copy, consent text, changelog. Use period/comma/colon/middot.
- **No `any`** (lint `--max-warnings 0`). Untyped Supabase joined rows: one explicit row `interface` + a single `as unknown as Row` cast at the query boundary (confined to `src/data/**`, hook `queryFn`s, `supabase/functions/**`). Test stubs go through the typed helpers.
- **Semantic Tailwind tokens only** (`bg-background`, `text-foreground`, …). Never hardcode colors.
- **Migrations** go through the `apply_migration` MCP tool (records a real-timestamp version; name the file to match). Never hand-edit `supabase/migrations/**` or the generated type files by hand. After a migration, regenerate BOTH `src/integrations/supabase/types.ts` and `supabase/functions/_shared/database.types.ts` together (byte-equality sync test `src/integrations/supabase/typesMirror.test.ts`).
- **Local commands** (per env): `npm ci` then `npx vitest run`, `npm run lint`, `npx tsc --noEmit` run locally. The edge Deno suite runs with `--node-modules-dir=none`. pgTAP runs via the `execute_sql` MCP wrapped in `BEGIN; CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions; … SELECT * FROM finish(); ROLLBACK;`.
- **Countersign setting** key is `hire_order_countersign`; new shape `{ mode: 'manual' | 'electronic', email_producers_on_countersign?: boolean }`. The edge `Countersign` type additionally keeps `'documenso'` in its union for the dormant branch.
- **Consent statement (verbatim, reused everywhere):**
  `By signing, I agree that my electronic signature is the legal equivalent of my handwritten signature, and I accept the terms of this hire order.`
- **Documenso teardown is out of scope.** Do NOT delete `_shared/documenso.ts`, `documenso-webhook/`, the `issueOne` documenso branch, or the `countersign-test` action. Annotate them "not in use" (Task 12). Only remove Documenso as a *selectable* settings option (Task 10).

---

### Task 1: Migration — signing schema + audit table + regenerated types

**Files:**
- Create (via `apply_migration`): `supabase/migrations/<ts>_hire_orders_signing.sql`
- Modify (regenerate, do not hand-edit): `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts`
- Test: `supabase/tests/db/hire_order_signatures.sql` (new pgTAP file)

**Interfaces:**
- Produces: `hire_orders.signed_pdf_path text`, `hire_orders.issued_pdf_sha256 text`; `countersign_mode` check now allows `'electronic'`; table `public.hire_order_signatures` with columns `id, org_id, hire_order_id (unique), signer_user_id, signer_name, signer_email, method ('typed'|'drawn'), typed_name, signature_image_path, signed_at, ip (text), user_agent, consent_text, document_sha256, created_at`.
- Note: the existing `enforce_hire_order_transition` does NOT freeze `signed_pdf_path` / `issued_pdf_sha256` / `countersign_mode` / `countersigned_at`, so the sign action's `issued → countersigned` update needs NO trigger change. This migration is purely additive.

- [ ] **Step 1: Write the pgTAP test first** (`supabase/tests/db/hire_order_signatures.sql`)

```sql
-- hire_order_signatures + signing-column schema tests.
-- Run: execute_sql wrapped in BEGIN … ROLLBACK (see plan Global Constraints).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

-- act_as helper (mirrors supabase/tests/db/hire_orders.sql)
CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- New columns exist
SELECT has_column('public','hire_orders','signed_pdf_path','signed_pdf_path column added');
SELECT has_column('public','hire_orders','issued_pdf_sha256','issued_pdf_sha256 column added');

-- countersign_mode now accepts 'electronic'
SELECT lives_ok(
  $$INSERT INTO public.hire_orders (org_id, order_no, status, data, countersign_mode)
    VALUES ('00000000-0000-0000-0000-00000000f0a1','HO-SIGN-1','draft','{}'::jsonb,'electronic')$$,
  'countersign_mode electronic is accepted');

-- hire_order_signatures table + shape
SELECT has_table('public','hire_order_signatures','hire_order_signatures table exists');
SELECT col_is_pk('public','hire_order_signatures','id','id is the PK');
SELECT has_column('public','hire_order_signatures','document_sha256','document_sha256 column exists');

-- one signature per order (unique hire_order_id)
SELECT col_has_check('public','hire_order_signatures','method','method has a CHECK constraint');

-- RLS enabled + a permissive INSERT policy does NOT exist (writes are service-role only)
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.hire_order_signatures'::regclass),
  true, 'RLS is enabled on hire_order_signatures');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND tablename='hire_order_signatures' AND cmd IN ('INSERT','ALL')
      AND permissive='PERMISSIVE'),
  0, 'no permissive INSERT/ALL policy — authenticated clients cannot write the audit table');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run via `execute_sql` MCP (paste the file body inside the BEGIN…ROLLBACK). Expected: failures like `column "signed_pdf_path" does not exist` / `relation "public.hire_order_signatures" does not exist`.

- [ ] **Step 3: Write the migration and apply it**

Apply via the `apply_migration` MCP tool with name `hire_orders_signing` and this SQL:

```sql
-- In-app electronic signing: signed-PDF path, issued-document hash, and the
-- append-only signature audit table. Purely additive — enforce_hire_order_transition
-- does not freeze these columns, so the issued->countersigned sign update needs no
-- trigger change.

alter table public.hire_orders add column signed_pdf_path text;
alter table public.hire_orders add column issued_pdf_sha256 text;

-- Allow the new 'electronic' countersign mode. The inline check is auto-named
-- hire_orders_countersign_mode_check (confirm with \d public.hire_orders). 'documenso'
-- stays in the allowed set for the dormant branch + any historical rows.
alter table public.hire_orders drop constraint hire_orders_countersign_mode_check;
alter table public.hire_orders add constraint hire_orders_countersign_mode_check
  check (countersign_mode in ('manual','documenso','electronic'));

create table public.hire_order_signatures (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  hire_order_id        uuid not null references public.hire_orders(id) on delete cascade,
  signer_user_id       uuid references auth.users(id),
  signer_name          text not null,
  signer_email         text,
  method               text not null check (method in ('typed','drawn')),
  typed_name           text,
  signature_image_path text,
  signed_at            timestamptz not null,
  ip                   text,
  user_agent           text,
  consent_text         text not null,
  document_sha256      text,
  created_at           timestamptz not null default now(),
  unique (hire_order_id)
);

create index hire_order_signatures_org_idx on public.hire_order_signatures (org_id);

alter table public.hire_order_signatures enable row level security;

-- Read: org producers/admins, plus the linked artist of the order.
create policy "Producers read hire order signatures" on public.hire_order_signatures
  for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));

create policy "Artists read own hire order signatures" on public.hire_order_signatures
  for select to authenticated
  using (
    hire_order_id in (
      select ho.id from public.hire_orders ho
      join public.artists a on a.id = ho.artist_id
      where a.user_id = auth.uid()
    )
  );

-- Pooled multi-tenancy isolation (RESTRICTIVE). No permissive INSERT/UPDATE/DELETE
-- policy exists, so the table is service-role-write-only (the sign edge action).
create policy org_isolation on public.hire_order_signatures as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));
```

- [ ] **Step 4: Regenerate the mirrored types (both files, together)**

Run the `generate_typescript_types` MCP tool. Write its output verbatim to `src/integrations/supabase/types.ts`, then copy the same bytes to `supabase/functions/_shared/database.types.ts`.

- [ ] **Step 5: Run the pgTAP test + the type mirror test to verify they pass**

Run the pgTAP file (Step 2 mechanism) — expect `plan(9)` all pass. Then:
```bash
npx vitest run src/integrations/supabase/typesMirror.test.ts
```
Expected: PASS (the two type files are byte-equal).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests/db/hire_order_signatures.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "add hire-order signing schema + signature audit table"
```

---

### Task 2: Extend the PDF renderer with a signature block + certificate page

**Files:**
- Modify: `supabase/functions/_shared/hireOrders.ts` (the `RenderInput` type)
- Modify: `supabase/functions/_shared/hire-order-pdf/render.tsx`
- Test: `supabase/functions/_shared/hire-order-pdf/render.test.ts` (add cases; create the file if absent)

**Interfaces:**
- Consumes: `OrderData`, `HireOrderLetterhead`, `HireOrderTerm` (unchanged, from Task 0 baseline).
- Produces: `RenderInput.status` widened to `"issued" | "preview" | "countersigned"`; new optional `RenderInput.signature` object (shape below). `renderHireOrderPdf(input)` returns `Uint8Array` for all three statuses; when `signature` is present it draws the artist's mark on the signature line and appends a second "Signature certificate" page.

- [ ] **Step 1: Write the failing test** (`render.test.ts`, add these cases; keep any existing ones)

```typescript
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderHireOrderPdf } from "./render.tsx";
import type { RenderInput } from "../hireOrders.ts";

const BASE: RenderInput = {
  data: {
    artist_name: { value: "Ann Lee", source: "showflow" },
    recipient_email: { value: "ann@x.de", source: "showflow" },
    date: { value: "2026-08-15", source: "showflow" },
    venue: { value: "Tempodrom", source: "showflow" },
    fee: { value: 850, source: "showflow" },
  },
  orderNo: "HO-1",
  status: "issued",
  letterhead: { legal_name: "Nord GmbH", address_lines: ["Berlin"] },
  terms: [{ title: "Fees", body: "Payable within 30 days." }],
  currency: "EUR",
  generatedAtIso: "2026-08-01T10:00:00.000Z",
};

Deno.test("renders a typed-signature countersigned PDF", async () => {
  const bytes = await renderHireOrderPdf({
    ...BASE,
    status: "countersigned",
    signature: {
      method: "typed",
      typedName: "Ann Lee",
      signerName: "Ann Lee",
      signerEmail: "ann@x.de",
      signedAtIso: "2026-08-02T09:30:00.000Z",
      ip: "203.0.113.5",
      userAgent: "Mozilla/5.0",
      documentSha256: "a".repeat(64),
      consentText: "By signing, I agree ...",
    },
  });
  assert(bytes.length > 0, "produced PDF bytes");
  assert(bytes[0] === 0x25 && bytes[1] === 0x50, "starts with %P (PDF header)");
});

Deno.test("renders a drawn-signature countersigned PDF", async () => {
  // 1x1 transparent PNG data URL
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const bytes = await renderHireOrderPdf({
    ...BASE,
    status: "countersigned",
    signature: {
      method: "drawn",
      imageDataUrl: png,
      signerName: "Ann Lee",
      signedAtIso: "2026-08-02T09:30:00.000Z",
      documentSha256: "b".repeat(64),
      consentText: "By signing, I agree ...",
    },
  });
  assert(bytes.length > 0 && bytes[0] === 0x25, "produced a PDF");
});

Deno.test("issued render (no signature) is unchanged shape", async () => {
  const bytes = await renderHireOrderPdf(BASE);
  assert(bytes.length > 0 && bytes[0] === 0x25);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd supabase/functions && deno test --allow-all --node-modules-dir=none _shared/hire-order-pdf/render.test.ts
```
Expected: FAIL (type error: `signature` not on `RenderInput`; `status: "countersigned"` not assignable).

- [ ] **Step 3: Extend `RenderInput`** in `supabase/functions/_shared/hireOrders.ts`

Replace the `status` line and add the `signature` field inside `export interface RenderInput`:

```typescript
  orderNo: string;
  /** `preview` overlays a watermark; `issued` is the document of record;
   *  `countersigned` renders the artist's signature + a certificate page. */
  status: "issued" | "preview" | "countersigned";
  letterhead: HireOrderLetterhead;
```

Then add, just after `generatedAtIso`:

```typescript
  generatedAtIso: string;
  /** Present only for a countersigned render — draws the artist's mark on the
   *  signature line and appends the signature-certificate page. */
  signature?: RenderSignature;
}

/** Audit + mark data for a countersigned render. */
export interface RenderSignature {
  method: "typed" | "drawn";
  /** Typed full name (method 'typed'). */
  typedName?: string;
  /** `data:image/png;base64,...` (method 'drawn'). */
  imageDataUrl?: string;
  signerName: string;
  signerEmail?: string;
  signedAtIso: string;
  ip?: string;
  userAgent?: string;
  documentSha256: string;
  consentText: string;
}
```

(Delete the old standalone `generatedAtIso: string;` line that the closing brace replaced.)

- [ ] **Step 4: Render the signature block + certificate page** in `render.tsx`

Add `Image` to the react-pdf import:

```typescript
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "npm:@react-pdf/renderer@^4";
```

Add styles inside `StyleSheet.create({ ... })` (after the `// Signatures` block):

```typescript
  // Applied (countersigned) signature mark
  sigMarkTyped: { fontFamily: "Geist", fontSize: 22, fontWeight: 600, color: C.text, marginBottom: 2 },
  sigMarkImage: { height: 44, marginBottom: 2, objectFit: "contain" },
  // Certificate page
  certHeading: { fontSize: 16, fontWeight: 600, marginBottom: 4 },
  certLead: { fontSize: 11, color: C.muted, marginBottom: 18 },
  certRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 7 },
  certLabel: { width: "34%", fontSize: 10, color: C.faint },
  certValue: { flex: 1, fontSize: 10.5, color: C.text },
  certValueMono: { flex: 1, fontFamily: "GeistMono", fontSize: 9.5, color: C.text },
  certConsent: { marginTop: 16, fontSize: 10, color: C.muted, lineHeight: 1.4 },
```

Change the `HireOrderDoc` destructure to include `signature`:

```typescript
  const { data, orderNo, status, letterhead, terms, currency, generatedAtIso, signature } = input;
```

Replace the artist half of the `{/* Signatures */}` block so a present `signature` draws the mark above the line. Replace:

```typescript
          <View style={s.signature}>
            <Text style={s.signatureFor}>{`The Artist · ${artist}`}</Text>
            <View style={s.signatureLine} />
            <Text style={s.signatureHint}>Signature · Date</Text>
          </View>
```

with:

```typescript
          <View style={s.signature}>
            <Text style={s.signatureFor}>{`The Artist · ${artist}`}</Text>
            {signature
              ? (signature.method === "drawn" && signature.imageDataUrl
                ? <Image style={s.sigMarkImage} src={signature.imageDataUrl} />
                : <Text style={s.sigMarkTyped}>{signature.typedName ?? signature.signerName}</Text>)
              : null}
            <View style={s.signatureLine} />
            <Text style={s.signatureHint}>
              {signature ? `Signed electronically · ${formatIsoDMY(signature.signedAtIso)}` : "Signature · Date"}
            </Text>
          </View>
```

Change the status badge label + dot so `countersigned` reads correctly. Replace:

```typescript
              <View style={[s.badgeDot, { backgroundColor: status === "preview" ? C.faint : C.accent }]} />
              <Text style={s.badgeText}>{status === "preview" ? "Preview" : "Issued"}</Text>
```

with:

```typescript
              <View style={[s.badgeDot, { backgroundColor: status === "preview" ? C.faint : C.accent }]} />
              <Text style={s.badgeText}>
                {status === "preview" ? "Preview" : status === "countersigned" ? "Countersigned" : "Issued"}
              </Text>
```

Append the certificate `<Page>` right before the closing `</Document>` (after the first `</Page>`), guarded by `signature`:

```typescript
      </Page>
      {signature ? (
        <Page size="A4" style={s.page}>
          <Text style={s.certHeading}>Signature certificate</Text>
          <Text style={s.certLead}>{`Electronic signature record for hire order ${orderNo}.`}</Text>
          <View style={s.certRow}><Text style={s.certLabel}>Signer</Text><Text style={s.certValue}>{signature.signerName}</Text></View>
          {signature.signerEmail ? <View style={s.certRow}><Text style={s.certLabel}>Email</Text><Text style={s.certValue}>{signature.signerEmail}</Text></View> : null}
          <View style={s.certRow}><Text style={s.certLabel}>Method</Text><Text style={s.certValue}>{signature.method === "drawn" ? "Drawn signature" : "Typed signature"}</Text></View>
          <View style={s.certRow}><Text style={s.certLabel}>Signed at</Text><Text style={s.certValue}>{`${formatIsoDMY(signature.signedAtIso)} (UTC)`}</Text></View>
          {signature.ip ? <View style={s.certRow}><Text style={s.certLabel}>IP address</Text><Text style={s.certValue}>{signature.ip}</Text></View> : null}
          {signature.userAgent ? <View style={s.certRow}><Text style={s.certLabel}>Device</Text><Text style={s.certValue}>{signature.userAgent}</Text></View> : null}
          <View style={s.certRow}><Text style={s.certLabel}>Document SHA-256</Text><Text style={s.certValueMono}>{signature.documentSha256}</Text></View>
          <Text style={s.certConsent}>{signature.consentText}</Text>
          <View style={s.footer} fixed>
            <Text style={s.footerMono}>{orderNo}</Text>
            <Text style={s.footerText}>{`Generated by ShowFlow Pro · ${formatIsoDMY(generatedAtIso)}`}</Text>
            <Text style={s.footerMono} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
          </View>
        </Page>
      ) : null}
    </Document>
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
cd supabase/functions && deno test --allow-all --node-modules-dir=none _shared/hire-order-pdf/render.test.ts
```
Expected: PASS (3 new tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/hireOrders.ts supabase/functions/_shared/hire-order-pdf/render.tsx supabase/functions/_shared/hire-order-pdf/render.test.ts
git commit -m "render hire-order signature block + certificate page"
```

---

### Task 3: issueOne — stamp the issued-PDF hash + electronic signing link

**Files:**
- Modify: `supabase/functions/generate-hire-orders/index.ts`
- Test: `supabase/functions/generate-hire-orders/index.di.test.ts`

**Interfaces:**
- Consumes: existing `issueOne`, `IssueOrderRow`, `sendIssuedEmail`, `Countersign`, `APP_URL`, `encodeBase64`.
- Produces: a `sha256Hex(bytes): Promise<string>` helper; `issueOne` now stamps `issued_pdf_sha256` on the issued update and, for `electronic` mode, sets `signingUrl = ${APP_URL}/hire-orders/${o.id}`; the `Countersign` type is widened to include `'electronic'` (+ optional `email_producers_on_countersign`). The `documenso` branch is unchanged behaviorally.

- [ ] **Step 1: Write the failing tests** (append to `index.di.test.ts`)

```typescript
Deno.test("issue stamps issued_pdf_sha256 on the issued update", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder() },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  assertEquals(res.status, 200);
  const issuedUpdate = calls.find(
    (c) => c.table === "hire_orders" && c.method === "update" && (c.args[0] as { status?: string }).status === "issued",
  );
  const upd = issuedUpdate!.args[0] as { issued_pdf_sha256?: string };
  assert(typeof upd.issued_pdf_sha256 === "string" && /^[0-9a-f]{64}$/.test(upd.issued_pdf_sha256), "64-char hex hash stamped");
});

Deno.test("issue in electronic mode emails a signing_url pointing at the in-app order page", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder() },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_countersign" }, data: [{ org_id: ORG, value: { mode: "electronic" } }] },
      ],
    },
  });
  await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  const td = (email!.body as { templateData: Record<string, unknown> }).templateData;
  assertEquals(td.countersign_mode, "electronic");
  assert(String(td.signing_url).includes("/hire-orders/o-1"), `signing_url was ${td.signing_url}`);
});
```

- [ ] **Step 2: Run to verify they fail**

Run:
```bash
cd supabase/functions && deno test --allow-all --node-modules-dir=none generate-hire-orders/index.di.test.ts
```
Expected: FAIL (no `issued_pdf_sha256` on the update; `signing_url` undefined for electronic).

- [ ] **Step 3: Add the hash helper** near the other helpers in `index.ts`

```typescript
/** Lowercase hex SHA-256 of the given bytes (issued-document tamper anchor). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Widen the `Countersign` type + annotate**

```typescript
interface Countersign {
  // 'documenso' is retained for the dormant Documenso path (see issueOne + _shared/documenso.ts).
  mode: "manual" | "documenso" | "electronic";
  /** electronic mode only: also email producers the signed PDF on countersign. */
  email_producers_on_countersign?: boolean;
}
```

- [ ] **Step 5: Stamp the hash + set the electronic signing URL in `issueOne`**

Replace the issued-stamp update (currently `update({ status: "issued", issued_at: …, pdf_path: path })`) so it also stores the hash:

```typescript
  const issuedPdfSha256 = await sha256Hex(bytes);
  const { error: issueErr } = await admin
    .from("hire_orders")
    .update({ status: "issued", issued_at: deps.now().toISOString(), pdf_path: path, issued_pdf_sha256: issuedPdfSha256 })
    .eq("id", orderId);
  if (issueErr) return { ok: false, issues: ["transition_failed"] };
```

Immediately AFTER the existing `if (countersignModeUsed === "documenso") { … }` block (leave that block untouched — Task 12 adds its "not in use" comment), add the electronic branch:

```typescript
  // Electronic (in-app) countersign: nothing to send at issue time — the artist
  // signs later on the order page. Point the issued email's "Review and sign" CTA
  // at that page (the auth-gated detail route, keyed by the order UUID).
  if (countersignModeUsed === "electronic") {
    signingUrl = `${APP_URL}/hire-orders/${o.id}`;
  }
```

- [ ] **Step 6: Run to verify the tests pass**

Run:
```bash
cd supabase/functions && deno test --allow-all --node-modules-dir=none generate-hire-orders/index.di.test.ts
```
Expected: PASS (existing issue tests still green — they read individual fields, not a full-object equality).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/generate-hire-orders/index.ts supabase/functions/generate-hire-orders/index.di.test.ts
git commit -m "stamp issued-pdf hash + electronic signing link on issue"
```

---

### Task 4: The `hire-order-countersigned` email template

**Files:**
- Create: `supabase/functions/_shared/transactional-email-templates/hire-order-countersigned.tsx`
- Modify: `supabase/functions/_shared/transactional-email-templates/registry.ts`
- Test: `supabase/functions/_shared/transactional-email-templates/hire-order-countersigned.test.ts` (new)

**Interfaces:**
- Produces: `TEMPLATES['hire-order-countersigned']` — an entry whose component accepts `{ artist_name?, order_no?, date_label?, venue?, download_url?, _intro?, _cta_label?, _footer? }` and renders without throwing.

- [ ] **Step 1: Write the failing test**

```typescript
/// <reference types="npm:@types/react@18.3.1" />
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TEMPLATES } from "./registry.ts";

Deno.test("hire-order-countersigned is registered and renders", async () => {
  const entry = TEMPLATES["hire-order-countersigned"];
  assert(entry, "template registered");
  const { render } = await import("npm:@react-email/render@1.0.1");
  const html = await render(entry.component(entry.previewData ?? {}));
  assert(html.includes("countersigned") || html.includes("Countersigned"), "mentions countersigned");
  const subject = typeof entry.subject === "function" ? entry.subject(entry.previewData ?? {}) : entry.subject;
  assertEquals(typeof subject, "string");
});
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
cd supabase/functions && deno test --allow-all --node-modules-dir=none _shared/transactional-email-templates/hire-order-countersigned.test.ts
```
Expected: FAIL (`TEMPLATES["hire-order-countersigned"]` is undefined).

- [ ] **Step 3: Create the template** (model on `hire-order-issued.tsx`; no em/en dashes)

```typescript
/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry, TemplateData } from './registry.ts'
import { APP_URL } from '../app-url.ts'

interface Props {
  artist_name?: string
  order_no?: string
  date_label?: string
  venue?: string
  download_url?: string
  _intro?: string
  _cta_label?: string
  _footer?: string
}

const HireOrderCountersignedEmail = ({
  artist_name, order_no, date_label, venue, download_url, _intro, _cta_label, _footer,
}: Props) => {
  const name = artist_name || 'there'
  const date = date_label || 'your date'
  const place = venue || 'the venue'
  const url = download_url || APP_URL
  const ctaLabel = _cta_label || 'View signed order'
  const introText = _intro ||
    `Your hire order for ${date} at ${place} has been countersigned. A copy of the signed document is attached for your records.`
  const footerText = _footer || 'Questions about this hire order. Reply to this email and we will help.'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your hire order for {date} has been countersigned</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Hire order countersigned</Heading>
          <Text style={text}>Hi {name},</Text>
          <Text style={text}>{introText}</Text>
          <Section style={factsSection}>
            {order_no ? <Text style={factRow}><strong>Order.</strong> {order_no}</Text> : null}
            <Text style={factRow}><strong>Date.</strong> {date}</Text>
            <Text style={factRow}><strong>Venue.</strong> {place}</Text>
          </Section>
          <Section style={section}>
            <Button href={url} style={button}>{ctaLabel}</Button>
          </Section>
          <Text style={footer}>{footerText}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: HireOrderCountersignedEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) =>
    `Your hire order for ${data?.date_label || 'your date'} has been countersigned`,
  displayName: 'Hire order countersigned',
  previewData: {
    artist_name: 'Mara Lindqvist',
    order_no: 'HO-2026-0142',
    date_label: 'Sat, Aug 15 2026',
    venue: 'Tempodrom',
    download_url: `${APP_URL}/hire-orders/HO-2026-0142`,
  },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1: React.CSSProperties = { fontSize: '22px', fontWeight: 600, color: '#111827', margin: '0 0 16px' }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: '24px', color: '#374151', margin: '0 0 12px' }
const section: React.CSSProperties = { textAlign: 'center', margin: '32px 0' }
const button: React.CSSProperties = { backgroundColor: '#7c3aed', color: '#ffffff', fontSize: '15px', fontWeight: 600, padding: '12px 24px', borderRadius: '8px', textDecoration: 'none' }
const footer: React.CSSProperties = { fontSize: '12px', lineHeight: '18px', color: '#9ca3af', margin: '24px 0 0' }
const factsSection: React.CSSProperties = { margin: '16px 0', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }
const factRow: React.CSSProperties = { fontSize: '14px', lineHeight: '22px', color: '#374151', margin: '0 0 4px' }
```

- [ ] **Step 4: Register it** in `registry.ts` — add the import beside the others and the map entry:

```typescript
import { template as hireOrderCountersigned } from './hire-order-countersigned.tsx'
```
```typescript
  'hire-order-issued': hireOrderIssued,
  'hire-order-countersigned': hireOrderCountersigned,
  'account-email-changed': accountEmailChanged,
```

- [ ] **Step 5: Run to verify it passes**

Run:
```bash
cd supabase/functions && deno test --allow-all --node-modules-dir=none _shared/transactional-email-templates/hire-order-countersigned.test.ts
```
Expected: PASS. (If the repo already has a registry-wide preview test, run the whole templates dir too.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/transactional-email-templates/hire-order-countersigned.tsx supabase/functions/_shared/transactional-email-templates/registry.ts supabase/functions/_shared/transactional-email-templates/hire-order-countersigned.test.ts
git commit -m "add hire-order-countersigned email template"
```

---

### Task 5: The `sign` edge action (core)

**Files:**
- Modify: `supabase/functions/generate-hire-orders/index.ts`
- Test: `supabase/functions/generate-hire-orders/index.di.test.ts`

**Interfaces:**
- Consumes: `deps` (admin, userClient, now, renderHireOrderPdf, sendEmail), `resolveOrgSetting`, `requireFeature`, `encodeBase64`, `sha256Hex` (Task 3), `strField`, `APP_URL`, `formatMoney`, letterhead/terms/defaults settings shapes, the `RenderSignature` type from `_shared/hireOrders.ts`.
- Produces: `signOrder(deps, req, body): Promise<Response>`, routed in `handle()` before the org/producer gate; helpers `notifyProducersCountersigned(deps, order)`, `sendCountersignedEmails(deps, order, signedBytes, data, emailProducers)`. Response `{ countersigned: true, signed_pdf_path }` (or `{ countersigned: true, idempotent: true }`).

- [ ] **Step 1: Write the failing tests** (append to `index.di.test.ts`)

```typescript
// ── sign action ────────────────────────────────────────────────────────────

const SIGN_ORDER = {
  id: "o-1",
  org_id: ORG,
  order_no: "HO-1",
  status: "issued",
  artist_id: "a-A",
  terms_variant: "standard",
  fee_currency: "EUR",
  agent_name: null,
  agent_email: null,
  issued_pdf_sha256: "c".repeat(64),
  show_date_id: SD,
  show_dates: { city_id: "city-1", shows: { program: "Aida", sub_program: null } },
  data: {
    artist_name: { value: "Ann", source: "showflow" },
    recipient_email: { value: "ann@x.de", source: "showflow" },
    date: { value: "2026-06-15", source: "showflow" },
    venue: { value: "Colosseum", source: "showflow" },
    fee: { value: 500, source: "showflow" },
  },
};

function signDeps(overrides: { order?: unknown; artist?: unknown; mode?: string; featureOn?: boolean } = {}) {
  return makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: overrides.featureOn ?? true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: overrides.order ?? SIGN_ORDER },
        { when: { __write: true }, data: [{ id: "o-1" }] }, // the guarded transition matched a row
      ],
      artists: { data: overrides.artist ?? { id: "a-A" } },
      org_memberships: { data: [] },
      app_settings: [
        { when: { key: "hire_order_countersign" }, data: [{ org_id: ORG, value: { mode: overrides.mode ?? "electronic" } }] },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
}

const SIGN_BODY = { action: "sign", org_id: ORG, order_id: "o-1", method: "typed", typed_name: "Ann Lee", consent: true };

Deno.test("sign: linked artist signs an issued electronic order -> countersigned", async () => {
  const { deps, calls, invokeCalls } = signDeps();
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.countersigned, true);
  // signed PDF uploaded
  const up = calls.find((c) => c.table === "storage:hire-orders" && c.method === "upload" && String((c.args[0])).endsWith("-signed.pdf"));
  assert(up, "signed pdf uploaded");
  // audit row inserted
  const sig = calls.find((c) => c.table === "hire_order_signatures" && c.method === "insert");
  assert(sig, "audit row inserted");
  const row = (sig!.args[0] as Record<string, unknown>);
  assertEquals(row.method, "typed");
  assertEquals(row.hire_order_id, "o-1");
  assertEquals(row.document_sha256, "c".repeat(64));
  // transitioned with signed_pdf_path + countersign_mode
  const upd = calls.find((c) => c.table === "hire_orders" && c.method === "update" && (c.args[0] as { status?: string }).status === "countersigned");
  const patch = upd!.args[0] as { signed_pdf_path?: string; countersign_mode?: string };
  assert(patch.signed_pdf_path?.endsWith("-signed.pdf"));
  assertEquals(patch.countersign_mode, "electronic");
  // countersigned email to the artist
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertEquals((email!.body as { template_name: string }).template_name, "hire-order-countersigned");
});

Deno.test("sign: an unrelated user is rejected 403", async () => {
  const { deps } = signDeps({ artist: null });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer other" }, body: SIGN_BODY }), deps);
  assertEquals(res.status, 403);
});

Deno.test("sign: consent is required", async () => {
  const { deps } = signDeps();
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer artist" }, body: { ...SIGN_BODY, consent: false } }), deps);
  assertEquals(res.status, 400);
});

Deno.test("sign: a non-issued order is rejected 409", async () => {
  const { deps } = signDeps({ order: { ...SIGN_ORDER, status: "draft" } });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }), deps);
  assertEquals(res.status, 409);
});

Deno.test("sign: already-countersigned order is an idempotent 200", async () => {
  const { deps } = signDeps({ order: { ...SIGN_ORDER, status: "countersigned" } });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).idempotent, true);
});

Deno.test("sign: manual-mode org is rejected 409 wrong_mode", async () => {
  const { deps } = signDeps({ mode: "manual" });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }), deps);
  assertEquals(res.status, 409);
});

Deno.test("sign: feature-off org is denied", async () => {
  const { deps } = signDeps({ featureOn: false });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }), deps);
  assert(res.status === 403 || res.status === 402, `feature gate status was ${res.status}`);
});

Deno.test("download-url serves the signed copy once signed_pdf_path is set", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-artist" },
    tables: {
      org_memberships: { data: [] },
      platform_admins: { data: null },
      hire_orders: { data: { id: "o-1", org_id: ORG, artist_id: "a-A", status: "countersigned", pdf_path: "org-1/HO-1.pdf", signed_pdf_path: "org-1/HO-1-signed.pdf", order_no: "HO-1" } },
      artists: { data: { id: "a-A" } },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer artist" }, body: { action: "download-url", org_id: ORG, order_id: "o-1" } }), deps);
  assertEquals(res.status, 200);
  const signCall = calls.find((c) => c.table === "storage:hire-orders" && c.method === "createSignedUrl");
  assertEquals(signCall!.args[0], "org-1/HO-1-signed.pdf");
});
```

- [ ] **Step 2: Run to verify they fail**

Run:
```bash
cd supabase/functions && deno test --allow-all --node-modules-dir=none generate-hire-orders/index.di.test.ts
```
Expected: FAIL (`unknown_action` for `sign`).

- [ ] **Step 3: Add imports + route `sign` before the gate**

At the top of `index.ts`, extend the `_shared/hireOrders.ts` import to include the signature type and add `requireFeature`/`resolveOrgSetting` (already imported). Add to the import list:

```typescript
  type OrderFieldKey,
  type RenderSignature,
} from "../_shared/hireOrders.ts";
```

In `handle()`, add the `sign` route immediately after the `download-url` route (BOTH sit before the admin/producer gate because an artist holds neither role):

```typescript
  if (body.action === "download-url") return downloadUrl(deps, req, body);
  if (body.action === "sign") return signOrder(deps, req, body);
```

- [ ] **Step 4: Implement `signOrder` + helpers** (add near `downloadUrl`)

```typescript
// ── sign (own auth: the linked artist only) ────────────────────────────────

interface SignBody {
  org_id: string;
  order_id: string;
  method?: "typed" | "drawn";
  typed_name?: string;
  signature_png?: string;
  consent?: boolean;
}

/** Shape of the order select in signOrder (mirrors the select string). */
interface SignOrderRow {
  id: string;
  org_id: string;
  order_no: string;
  status: string;
  artist_id: string | null;
  terms_variant: string | null;
  fee_currency: string | null;
  agent_name: string | null;
  agent_email: string | null;
  issued_pdf_sha256: string | null;
  data: OrderData;
  show_date_id: string | null;
  show_dates: { city_id: string | null; shows: { program: string | null; sub_program: string | null } | null } | null;
}

const CONSENT_TEXT =
  "By signing, I agree that my electronic signature is the legal equivalent of my handwritten signature, and I accept the terms of this hire order.";
const MAX_SIGNATURE_PNG_CHARS = 2_000_000; // ~1.5MB decoded — a generous cap for a canvas PNG

async function signOrder(deps: Deps, req: Request, body: SignBody): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  if (!body.order_id) return json({ error: "order_id required" }, 400);

  // Own auth: any authenticated user; authorization decided against the loaded order.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await deps.userClient(authHeader).auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: orderRaw } = await admin
    .from("hire_orders")
    .select("id, org_id, order_no, status, artist_id, terms_variant, fee_currency, agent_name, agent_email, issued_pdf_sha256, data, show_date_id, show_dates(city_id, shows(program, sub_program))")
    .eq("id", body.order_id)
    .eq("org_id", org)
    .maybeSingle();
  if (!orderRaw) return json({ error: "not_found" }, 404);
  const o = orderRaw as unknown as SignOrderRow;

  // Only the linked artist may sign.
  if (!o.artist_id) return json({ error: "forbidden" }, 403);
  const { data: artistRow } = await admin
    .from("artists").select("id").eq("id", o.artist_id).eq("user_id", user.id).maybeSingle();
  if (!artistRow) return json({ error: "forbidden" }, 403);

  // Idempotency + status guard.
  if (o.status === "countersigned") return json({ countersigned: true, idempotent: true });
  if (o.status !== "issued") return json({ error: "not_issued" }, 409);

  // Feature + mode gate.
  const denied = await requireFeature(deps, org, "hire_orders");
  if (denied) return denied;
  const countersign = await resolveOrgSetting<Countersign>(admin, org, "hire_order_countersign", COUNTERSIGN_DEFAULT);
  if (countersign.mode !== "electronic") return json({ error: "wrong_mode" }, 409);

  // Consent + payload validation.
  if (body.consent !== true) return json({ error: "consent_required" }, 400);
  const method = body.method;
  if (method !== "typed" && method !== "drawn") return json({ error: "invalid_signature" }, 400);
  const typedName = (body.typed_name ?? "").trim();
  if (method === "typed" && typedName === "") return json({ error: "invalid_signature" }, 400);
  const png = body.signature_png ?? "";
  if (method === "drawn" && (!png.startsWith("data:image/png;base64,") || png.length > MAX_SIGNATURE_PNG_CHARS)) {
    return json({ error: "invalid_signature" }, 400);
  }

  const data = o.data;
  const signerName = strField(data, "artist_name") || typedName || "Artist";
  const signerEmail = strField(data, "recipient_email") || null;
  const signedAtIso = deps.now().toISOString();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = req.headers.get("user-agent") || null;

  // Store the drawn image (audit trail); typed signatures have no image.
  let signatureImagePath: string | null = null;
  if (method === "drawn") {
    const b64 = png.slice(png.indexOf(",") + 1);
    const pngBytes = decodeBase64(b64);
    signatureImagePath = `${org}/signatures/${o.order_no}.png`;
    const { error: imgErr } = await admin.storage.from(BUCKET).upload(signatureImagePath, pngBytes, {
      contentType: "image/png", upsert: true,
    });
    if (imgErr) return json({ error: "signature_upload_failed" }, 500);
  }

  // Re-render the signed PDF from the frozen snapshot.
  const [letterhead, terms, defaults] = await Promise.all([
    resolveOrgSetting<HireOrderLetterhead>(admin, org, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    resolveOrgSetting<TermsVariants>(admin, org, "hire_order_terms", TERMS_DEFAULT),
    resolveOrgSetting<OrderDefaults>(admin, org, "hire_order_defaults", DEFAULTS_DEFAULT),
  ]);
  const variant = (o.terms_variant as TermsVariant) ?? "standard";
  const effectiveLetterhead: HireOrderLetterhead = {
    ...letterhead,
    agent_name: o.agent_name ?? letterhead.agent_name,
    agent_email: o.agent_email ?? letterhead.agent_email,
  };
  const currency = o.fee_currency ?? defaults.currency ?? "EUR";
  const signature: RenderSignature = {
    method,
    typedName: method === "typed" ? typedName : undefined,
    imageDataUrl: method === "drawn" ? png : undefined,
    signerName,
    signerEmail: signerEmail ?? undefined,
    signedAtIso,
    ip: ip ?? undefined,
    userAgent: userAgent ?? undefined,
    documentSha256: o.issued_pdf_sha256 ?? "",
    consentText: CONSENT_TEXT,
  };
  const signedBytes = await deps.renderHireOrderPdf({
    data, orderNo: o.order_no, status: "countersigned", letterhead: effectiveLetterhead,
    terms: terms[variant] ?? [], currency, generatedAtIso: signedAtIso, signature,
  });

  // Upload the signed copy (keeps the original issued pdf_path intact).
  const signedPath = `${org}/${o.order_no}-signed.pdf`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(signedPath, signedBytes, {
    contentType: "application/pdf", upsert: true,
  });
  if (upErr) return json({ error: "signed_upload_failed" }, 500);

  // Audit row.
  const { error: sigErr } = await admin.from("hire_order_signatures").insert([{
    org_id: org,
    hire_order_id: o.id,
    signer_user_id: user.id,
    signer_name: signerName,
    signer_email: signerEmail,
    method,
    typed_name: method === "typed" ? typedName : null,
    signature_image_path: signatureImagePath,
    signed_at: signedAtIso,
    ip,
    user_agent: userAgent,
    consent_text: CONSENT_TEXT,
    document_sha256: o.issued_pdf_sha256,
    // dynamically assembled audit row -> single cast at the boundary
  }] as unknown as TablesInsert<"hire_order_signatures">[]);
  if (sigErr) return json({ error: "signature_insert_failed" }, 500);

  // Atomic + idempotent transition (guarded by status='issued').
  const { data: updatedRows, error: updErr } = await admin
    .from("hire_orders")
    .update({ status: "countersigned", countersigned_at: signedAtIso, signed_pdf_path: signedPath, countersign_mode: "electronic" })
    .eq("id", o.id)
    .eq("status", "issued")
    .select("id");
  if (updErr) return json({ error: "transition_failed" }, 500);
  const affected = Array.isArray(updatedRows) ? updatedRows.length > 0 : !!updatedRows;
  if (!affected) return json({ countersigned: true, idempotent: true });

  // Best-effort side effects — never undo a completed signing.
  await notifyProducersCountersigned(deps, o).catch((e) =>
    console.error("generate-hire-orders: sign producer notify failed", { org, orderId: o.id, error: (e as Error).message }));
  await notifyArtistCountersigned(deps, org, o, user.id).catch((e) =>
    console.error("generate-hire-orders: sign artist notify failed", { org, orderId: o.id, error: (e as Error).message }));
  await sendCountersignedEmails(deps, org, o, data, signedBytes, currency, !!countersign.email_producers_on_countersign).catch((e) =>
    console.error("generate-hire-orders: countersigned email failed", { org, orderId: o.id, error: (e as Error).message }));

  return json({ countersigned: true, signed_pdf_path: signedPath });
}

/** Notify the order's producers that the artist countersigned (in-app). Mirrors
 *  documenso-webhook's notifyProducers resolution: resolve_show_assignments on the
 *  order's show_date, falling back to org admins; deduped. */
async function notifyProducersCountersigned(deps: Deps, order: SignOrderRow): Promise<void> {
  const admin = deps.admin;
  const org = order.org_id;
  let recipientIds: string[] = [];
  if (order.show_dates) {
    const { data: producers } = await admin.rpc("resolve_show_assignments", {
      p_program: order.show_dates.shows?.program ?? "",
      p_sub_program: order.show_dates.shows?.sub_program ?? null,
      p_city_id: order.show_dates.city_id,
      p_org: org,
    } as ResolveShowAssignmentsArgs);
    recipientIds = ((producers ?? []) as unknown as ProducerAssignmentRow[]).map((p) => p.producer_user_id);
  }
  if (recipientIds.length === 0) {
    const { data: admins } = await admin.from("org_memberships").select("user_id").eq("org_id", org).eq("role", "admin");
    recipientIds = ((admins ?? []) as unknown as OrgAdminRow[]).map((a) => a.user_id);
  }
  recipientIds = [...new Set(recipientIds)] as string[];
  if (recipientIds.length === 0) return;
  const rows = recipientIds.map((uid) => ({
    org_id: org, user_id: uid, type: "hire_order_countersigned",
    title: "Hire order countersigned",
    message: `Hire order ${order.order_no} has been countersigned.`,
    related_entity_type: "hire_order", related_entity_id: order.id,
  }));
  await admin.from("notifications").insert(rows);
}

/** A confirmation notification for the signing artist. */
async function notifyArtistCountersigned(deps: Deps, org: string, order: SignOrderRow, userId: string): Promise<void> {
  await deps.admin.from("notifications").insert([{
    org_id: org, user_id: userId, type: "hire_order_countersigned",
    title: "Hire order signed",
    message: `You signed hire order ${order.order_no}.`,
    related_entity_type: "hire_order", related_entity_id: order.id,
  }]);
}

/** Email the artist the signed PDF; optionally email producers too (opt-in flag). */
async function sendCountersignedEmails(
  deps: Deps, org: string, order: SignOrderRow, data: OrderData, signedBytes: Uint8Array,
  _currency: string, emailProducers: boolean,
): Promise<void> {
  const attachment = { filename: `${order.order_no}-signed.pdf`, content_base64: encodeBase64(signedBytes) };
  const templateData = {
    artist_name: strField(data, "artist_name"),
    order_no: order.order_no,
    date_label: dateLabel(strField(data, "date")),
    venue: strField(data, "venue"),
    download_url: `${APP_URL}/hire-orders/${order.id}`,
  };
  const artistEmail = strField(data, "recipient_email");
  if (artistEmail) {
    await deps.sendEmail({
      template_name: "hire-order-countersigned",
      recipient_email: artistEmail,
      org_id: org,
      templateData,
      attachments: [attachment],
      idempotency_key: `hire-order-countersigned-${order.id}`,
    });
  }
  if (!emailProducers) return;
  // Resolve producer emails via auth admin (few per show); best-effort.
  let producerIds: string[] = [];
  if (order.show_dates) {
    const { data: producers } = await deps.admin.rpc("resolve_show_assignments", {
      p_program: order.show_dates.shows?.program ?? "",
      p_sub_program: order.show_dates.shows?.sub_program ?? null,
      p_city_id: order.show_dates.city_id,
      p_org: org,
    } as ResolveShowAssignmentsArgs);
    producerIds = ((producers ?? []) as unknown as ProducerAssignmentRow[]).map((p) => p.producer_user_id);
  }
  for (const uid of [...new Set(producerIds)]) {
    const { data: got } = await deps.admin.auth.admin.getUserById(uid);
    const email = (got as { user?: { email?: string } } | null)?.user?.email;
    if (!email) continue;
    await deps.sendEmail({
      template_name: "hire-order-countersigned",
      recipient_email: email,
      org_id: org,
      templateData: { ...templateData, _intro: `A hire order for ${templateData.venue || "a show"} has been countersigned by the artist. The signed copy is attached.` },
      attachments: [attachment],
      idempotency_key: `hire-order-countersigned-prod-${order.id}-${uid}`,
    });
  }
}
```

Add the `decodeBase64` import beside `encodeBase64`:

```typescript
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
```

Then make `download-url` serve the signed copy when present. In `DownloadOrderRow`, add `signed_pdf_path: string | null;`. In `downloadUrl`, add `signed_pdf_path` to the select string, and replace the path resolution + no-pdf guard so the signed copy wins:

```typescript
  const path = o.signed_pdf_path ?? o.pdf_path;
  if (!path) return json({ error: "no_pdf" }, 409);

  // Sign with the caller's client so storage RLS is the backstop.
  const { data: signed, error: signErr } = await userClient.storage
    .from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
```

(Replace the existing `if (!o.pdf_path) …` guard and the `createSignedUrl(o.pdf_path, …)` call.)

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
cd supabase/functions && deno test --allow-all --node-modules-dir=none generate-hire-orders/index.di.test.ts
```
Expected: PASS (all sign tests + existing tests green).

- [ ] **Step 6: Run the whole edge suite** (a behavior change here can ripple)

Run:
```bash
cd supabase/functions && deno test --allow-all --node-modules-dir=none
```
Expected: PASS across `supabase/functions/`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/generate-hire-orders/index.ts supabase/functions/generate-hire-orders/index.di.test.ts
git commit -m "add artist-authed sign action to generate-hire-orders"
```

---

### Task 6: Frontend data-access + hooks

**Files:**
- Modify: `src/data/hireOrders.ts` (add `signHireOrder`)
- Modify: `src/hooks/useHireOrders.ts` (add `useSignHireOrder`, `useHireOrderCountersignMode`)
- Create: `src/lib/hireOrders/signing.ts` (pure gating helper `canArtistSign`)
- Test: `src/data/hireOrders.signing.test.ts`, `src/lib/hireOrders/signing.test.ts`

**Interfaces:**
- Produces:
  - `signHireOrder(client, args: SignHireOrderArgs): Promise<void>` where `SignHireOrderArgs = { orgId: string; orderId: string; method: 'typed' | 'drawn'; typedName?: string; signaturePng?: string; consent: boolean }`.
  - `useSignHireOrder()` — mutation over `SignHireOrderArgs`.
  - `useHireOrderCountersignMode(orgId)` — query returning `HireOrderCountersign` (`{ mode; email_producers_on_countersign? }`).
  - `canArtistSign({ canManage, status, mode: string, isLinkedArtist }): boolean` — `mode` is a plain string so this task compiles before Task 10 widens `CountersignMode`.

- [ ] **Step 1: Write the failing tests**

`src/lib/hireOrders/signing.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { canArtistSign } from "./signing";

describe("canArtistSign", () => {
  const ok = { canManage: false, status: "issued", mode: "electronic" as const, isLinkedArtist: true };
  it("allows the linked artist on an issued electronic order", () => {
    expect(canArtistSign(ok)).toBe(true);
  });
  it("blocks producers/admins", () => {
    expect(canArtistSign({ ...ok, canManage: true })).toBe(false);
  });
  it("blocks non-issued statuses", () => {
    expect(canArtistSign({ ...ok, status: "countersigned" })).toBe(false);
    expect(canArtistSign({ ...ok, status: "draft" })).toBe(false);
  });
  it("blocks manual mode", () => {
    expect(canArtistSign({ ...ok, mode: "manual" })).toBe(false);
  });
  it("blocks a non-linked artist", () => {
    expect(canArtistSign({ ...ok, isLinkedArtist: false })).toBe(false);
  });
});
```

`src/data/hireOrders.signing.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { signHireOrder } from "./hireOrders";

describe("signHireOrder", () => {
  it("invokes generate-hire-orders with a sign payload", async () => {
    const fake = createFakeSupabase({ "fn:generate-hire-orders": { data: { countersigned: true }, error: null } });
    await signHireOrder(fake as never, { orgId: "o1", orderId: "ho1", method: "typed", typedName: "Ann Lee", consent: true });
    expect(fake.calls).toContainEqual({
      table: "fn:generate-hire-orders",
      method: "invoke",
      args: [{ action: "sign", org_id: "o1", order_id: "ho1", method: "typed", typed_name: "Ann Lee", signature_png: undefined, consent: true }],
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run:
```bash
npx vitest run src/lib/hireOrders/signing.test.ts src/data/hireOrders.signing.test.ts
```
Expected: FAIL (`canArtistSign` / `signHireOrder` not exported).

- [ ] **Step 3: Create the gating helper** `src/lib/hireOrders/signing.ts`

`mode` is typed as `string` (not `CountersignMode`) deliberately: this task lands BEFORE Task 10 widens `CountersignMode` to include `"electronic"`, so comparing against a `CountersignMode` literal here would not typecheck yet. A plain string keeps the helper order-independent.

```ts
/** Whether the current viewer may sign this order in-app: the linked artist,
 *  on an issued order, when the org is in electronic countersign mode. */
export function canArtistSign(args: {
  canManage: boolean;
  status: string;
  mode: string;
  isLinkedArtist: boolean;
}): boolean {
  return !args.canManage && args.status === "issued" && args.mode === "electronic" && args.isLinkedArtist;
}
```

- [ ] **Step 4: Add `signHireOrder`** to `src/data/hireOrders.ts` (near `updateHireOrderStatus`)

```ts
export interface SignHireOrderArgs {
  orgId: string;
  orderId: string;
  method: "typed" | "drawn";
  typedName?: string;
  signaturePng?: string;
  consent: boolean;
}

/** Artist-facing in-app signing: invokes generate-hire-orders' `sign` action. */
export async function signHireOrder(
  client: SupabaseClient<Database>,
  args: SignHireOrderArgs,
): Promise<void> {
  await invokeHireOrderAction(client, {
    action: "sign",
    org_id: args.orgId,
    order_id: args.orderId,
    method: args.method,
    typed_name: args.typedName,
    signature_png: args.signaturePng,
    consent: args.consent,
  });
}
```

- [ ] **Step 5: Add the hooks** to `src/hooks/useHireOrders.ts`

Add imports at the top:
```ts
import { resolveOrgSetting } from "@/data/settings";
import { COUNTERSIGN_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { HireOrderCountersign } from "@/components/settings/hireOrders/CountersignCard";
```
Add `signHireOrder` + `type SignHireOrderArgs` to the existing `@/data/hireOrders` import block.

Add the hooks (near `useMarkCountersigned`):
```ts
/** The org's countersign mode + producer-email flag (for the signing surface). */
export function useHireOrderCountersignMode(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["hire-orders", "countersign-mode", orgId],
    enabled: !!orgId,
    queryFn: () => resolveOrgSetting<HireOrderCountersign>(supabase, orgId!, "hire_order_countersign", COUNTERSIGN_DEFAULT),
  });
}

/** Artist in-app signing. On success busts the whole hire-orders domain so the
 *  detail page + any list re-render as countersigned. */
export function useSignHireOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: SignHireOrderArgs) => signHireOrder(supabase, args),
    onSuccess: () => {
      invalidateHireOrders(qc);
      toast.success("Hire order signed");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not sign the hire order");
    },
  });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```bash
npx vitest run src/lib/hireOrders/signing.test.ts src/data/hireOrders.signing.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/hireOrders.ts src/hooks/useHireOrders.ts src/lib/hireOrders/signing.ts src/lib/hireOrders/signing.test.ts src/data/hireOrders.signing.test.ts
git commit -m "add signHireOrder data-access + signing hooks"
```

---

### Task 7: SignaturePad component (Type / Draw)

**Files:**
- Modify: `package.json` + `package-lock.json` (add `signature_pad`)
- Create: `src/components/hireOrders/SignaturePad.tsx`
- Test: `src/components/hireOrders/SignaturePad.test.tsx`

**Interfaces:**
- Produces: `type SignatureValue = { method: 'typed'; typedName: string } | { method: 'drawn'; pngDataUrl: string }`; `SignaturePad({ value, onChange, disabled })`.

- [ ] **Step 1: Add the dependency**

Run:
```bash
npm install signature_pad@^5
```
Expected: `signature_pad` added to `dependencies`, `package-lock.json` updated.

- [ ] **Step 2: Write the failing test** (mock `signature_pad`; jsdom has no real canvas)

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the canvas library — jsdom cannot draw. The fake lets us drive onEnd/clear.
const instances: Array<{ onEnd?: () => void; empty: boolean }> = [];
vi.mock("signature_pad", () => ({
  default: class {
    onEnd?: () => void;
    empty = true;
    constructor(_c: unknown, opts?: { onEnd?: () => void }) { this.onEnd = opts?.onEnd; instances.push(this); }
    isEmpty() { return this.empty; }
    clear() { this.empty = true; }
    toDataURL() { return "data:image/png;base64,ZFAKE"; }
    addEventListener() {}
    off() {}
  },
}));

import { SignaturePad } from "./SignaturePad";

describe("SignaturePad", () => {
  beforeEach(() => { instances.length = 0; });

  it("emits a typed value as the name is entered", () => {
    const onChange = vi.fn();
    render(<SignaturePad value={null} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/full legal name/i), { target: { value: "Ann Lee" } });
    expect(onChange).toHaveBeenCalledWith({ method: "typed", typedName: "Ann Lee" });
  });

  it("clears the typed value to null when emptied", () => {
    const onChange = vi.fn();
    render(<SignaturePad value={{ method: "typed", typedName: "X" }} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/full legal name/i), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run:
```bash
npx vitest run src/components/hireOrders/SignaturePad.test.tsx
```
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `SignaturePad.tsx`**

```tsx
import { useEffect, useRef } from "react";
import SignaturePadLib from "signature_pad";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type SignatureValue =
  | { method: "typed"; typedName: string }
  | { method: "drawn"; pngDataUrl: string };

interface Props {
  value: SignatureValue | null;
  onChange: (v: SignatureValue | null) => void;
  disabled?: boolean;
}

/** Type-or-draw signature capture. Typed renders the name in a serif face as the
 *  signing mark; Draw uses signature_pad (velocity-smoothed ink, retina/touch
 *  handled). Emits null when the active method has no content. */
export function SignaturePad({ value, onChange, disabled }: Props) {
  const typed = value?.method === "typed" ? value.typedName : "";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePadLib | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // High-DPI crispness: size the backing store to the element's CSS box * ratio.
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d")?.scale(ratio, ratio);
    const pad = new SignaturePadLib(canvas, {
      onEnd: () => {
        if (pad.isEmpty()) onChange(null);
        else onChange({ method: "drawn", pngDataUrl: pad.toDataURL("image/png") });
      },
    });
    padRef.current = pad;
    return () => { pad.off(); padRef.current = null; };
    // Initialise once; onChange is stable enough for this ref-based widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearDrawn() {
    padRef.current?.clear();
    onChange(null);
  }

  return (
    <Tabs defaultValue="type" onValueChange={() => onChange(null)}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="type">Type</TabsTrigger>
        <TabsTrigger value="draw">Draw</TabsTrigger>
      </TabsList>
      <TabsContent value="type" className="space-y-2">
        <Label htmlFor="sig-typed" className="text-xs text-muted-foreground">Your full legal name</Label>
        <Input
          id="sig-typed"
          placeholder="Your full legal name"
          value={typed}
          disabled={disabled}
          onChange={(e) => {
            const name = e.target.value;
            onChange(name.trim() === "" ? null : { method: "typed", typedName: name });
          }}
        />
        {typed.trim() !== "" && (
          <div className="rounded-md border border-border bg-muted px-4 py-3 font-serif text-2xl text-foreground">
            {typed}
          </div>
        )}
      </TabsContent>
      <TabsContent value="draw" className="space-y-2">
        <canvas
          ref={canvasRef}
          className="h-40 w-full rounded-md border border-border bg-background touch-none"
        />
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={clearDrawn} disabled={disabled}>
            Clear
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run:
```bash
npx vitest run src/components/hireOrders/SignaturePad.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/hireOrders/SignaturePad.tsx src/components/hireOrders/SignaturePad.test.tsx
git commit -m "add SignaturePad (type or draw) component"
```

---

### Task 8: SignHireOrderDialog

**Files:**
- Create: `src/components/hireOrders/SignHireOrderDialog.tsx`
- Test: `src/components/hireOrders/SignHireOrderDialog.test.tsx`

**Interfaces:**
- Consumes: `SignaturePad`/`SignatureValue` (Task 7), `useSignHireOrder` (Task 6).
- Produces: `SignHireOrderDialog({ orderId, orgId, open, onOpenChange })`. Sign button disabled until a signature is present AND consent is checked; on click calls `useSignHireOrder().mutate(...)` and closes on success.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutate = vi.fn();
vi.mock("@/hooks/useHireOrders", () => ({
  useSignHireOrder: () => ({ mutate, isPending: false }),
}));
// SignaturePad is exercised in its own test; stub it to emit a typed value on click.
vi.mock("./SignaturePad", () => ({
  SignaturePad: ({ onChange }: { onChange: (v: unknown) => void }) => (
    <button onClick={() => onChange({ method: "typed", typedName: "Ann Lee" })}>set-sig</button>
  ),
}));

import { SignHireOrderDialog } from "./SignHireOrderDialog";

describe("SignHireOrderDialog", () => {
  beforeEach(() => mutate.mockReset());

  it("keeps Sign disabled until a signature and consent are present, then submits", () => {
    render(<SignHireOrderDialog orderId="ho1" orgId="o1" open onOpenChange={() => {}} />);
    const signBtn = () => screen.getByRole("button", { name: /sign hire order/i });
    expect(signBtn()).toBeDisabled();

    fireEvent.click(screen.getByText("set-sig"));       // signature present
    expect(signBtn()).toBeDisabled();                    // still need consent
    fireEvent.click(screen.getByRole("checkbox"));       // consent checked
    expect(signBtn()).toBeEnabled();

    fireEvent.click(signBtn());
    expect(mutate).toHaveBeenCalledWith(
      { orgId: "o1", orderId: "ho1", method: "typed", typedName: "Ann Lee", signaturePng: undefined, consent: true },
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
npx vitest run src/components/hireOrders/SignHireOrderDialog.test.tsx
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `SignHireOrderDialog.tsx`**

```tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SignaturePad, type SignatureValue } from "./SignaturePad";
import { useSignHireOrder } from "@/hooks/useHireOrders";

const CONSENT_TEXT =
  "By signing, I agree that my electronic signature is the legal equivalent of my handwritten signature, and I accept the terms of this hire order.";

interface Props {
  orderId: string;
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The artist's in-app signing modal. The order PDF stays visible on the page
 *  behind it, so the dialog references "the document shown on this page". */
export function SignHireOrderDialog({ orderId, orgId, open, onOpenChange }: Props) {
  const [sig, setSig] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);
  const sign = useSignHireOrder();

  function submit() {
    if (!sig || !consent) return;
    sign.mutate(
      {
        orgId,
        orderId,
        method: sig.method,
        typedName: sig.method === "typed" ? sig.typedName : undefined,
        signaturePng: sig.method === "drawn" ? sig.pngDataUrl : undefined,
        consent: true,
      },
      { onSuccess: () => { onOpenChange(false); setSig(null); setConsent(false); } },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Sign your hire order</DialogTitle>
          <DialogDescription>
            Review the document shown on this page, then add your signature to countersign it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <SignaturePad value={sig} onChange={setSig} disabled={sign.isPending} />
          <div className="flex items-start gap-2 rounded-lg border border-border p-3">
            <Checkbox id="sign-consent" checked={consent} onCheckedChange={(c) => setConsent(c === true)} className="mt-0.5" />
            <Label htmlFor="sign-consent" className="cursor-pointer text-xs font-normal text-muted-foreground">
              {CONSENT_TEXT}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sign.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!sig || !consent || sign.isPending}>
            {sign.isPending ? "Signing..." : "Sign hire order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
npx vitest run src/components/hireOrders/SignHireOrderDialog.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/hireOrders/SignHireOrderDialog.tsx src/components/hireOrders/SignHireOrderDialog.test.tsx
git commit -m "add SignHireOrderDialog"
```

---

### Task 9: Wire the signing surface into HireOrderDetailPage

**Files:**
- Modify: `src/pages/HireOrderDetailPage.tsx`
- Test: `src/pages/HireOrderDetailPage.signing.test.tsx` (new — gating assertions with mocked hooks)

**Interfaces:**
- Consumes: `useHireOrderCountersignMode`, `useMyArtist`, `canArtistSign`, `SignHireOrderDialog`.
- Produces: a "Review & sign" primary action for the linked artist on an issued electronic order that opens `SignHireOrderDialog`; producers/admins and non-electronic orders are unaffected.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const order = {
  id: "ho1", org_id: "o1", status: "issued", artist_id: "a1", order_no: "HO-1",
  data: {}, pdf_path: "o1/HO-1.pdf", fee_amount: null, fee_currency: "EUR",
  created_at: "2026-01-01", issued_at: "2026-01-02", countersigned_at: null, artists: { name: "Ann" },
};
vi.mock("@/hooks/useHireOrders", () => ({
  useHireOrder: () => ({ data: order, isLoading: false, isError: false }),
  useHireOrderAction: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkCountersigned: () => ({ mutate: vi.fn(), isPending: false }),
  useHireOrderCountersignMode: () => ({ data: { mode: "electronic" } }),
}));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: () => ({ data: { id: "a1" } }) }));
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig<object>()), useQuery: () => ({ data: null, isLoading: false, isError: false }) }));

const auth = { currentOrg: { id: "o1" }, hasRole: (r: string) => false };
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => auth }));

import HireOrderDetailPage from "./HireOrderDetailPage";

describe("HireOrderDetailPage signing", () => {
  it("shows Review & sign for the linked artist on an issued electronic order", () => {
    render(<MemoryRouter initialEntries={["/hire-orders/ho1"]}>{<HireOrderDetailPage />}</MemoryRouter>);
    expect(screen.getByRole("button", { name: /review & sign/i })).toBeInTheDocument();
  });
});
```

(Note: this test mocks `useQuery` globally to a no-op for the internal pdf-url query. If that proves brittle against the page's other `useQuery` usage, instead assert on the extracted `canArtistSign` gating — already covered in Task 6 — and keep this page test minimal.)

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
npx vitest run src/pages/HireOrderDetailPage.signing.test.tsx
```
Expected: FAIL (no "Review & sign" button).

- [ ] **Step 3: Wire the page**

Add imports:
```ts
import { useState } from "react";
import { useHireOrder, useHireOrderAction, useMarkCountersigned, useHireOrderCountersignMode } from "@/hooks/useHireOrders";
import { useMyArtist } from "@/hooks/useMyArtist";
import { canArtistSign } from "@/lib/hireOrders/signing";
import { SignHireOrderDialog } from "@/components/hireOrders/SignHireOrderDialog";
```
(Extend the existing `useHireOrders` import rather than duplicating it.)

In `HireOrderDetailPage()`, after the existing hooks, resolve mode + linkage and compute `canSign`:
```ts
  const countersignMode = useHireOrderCountersignMode(orgId);
  const { data: myArtist } = useMyArtist();
  const canManage = hasRole("admin") || hasRole("producer");
  const canSign = order
    ? canArtistSign({
        canManage,
        status: order.status,
        mode: countersignMode.data?.mode ?? "manual",
        isLinkedArtist: !!myArtist && myArtist.id === order.artist_id,
      })
    : false;
```
Pass `canManage`, `canSign`, and `orgId` into `<HireOrderDetail .../>` (replace the inline `canManage={hasRole(...)}` with `canManage={canManage}` and add `canSign={canSign}` and `orgId={orgId}`).

Extend `DetailProps` with `canSign: boolean` and `orgId: string`, and in `HireOrderDetail` add local dialog state + render the dialog:
```tsx
  const [signOpen, setSignOpen] = useState(false);
```
Pass `canSign` + `onSign={() => setSignOpen(true)}` into `<PrimaryAction .../>`, and render the dialog at the end of the returned tree (before the final closing `</div>`):
```tsx
      {canSign && (
        <SignHireOrderDialog orderId={order.id} orgId={orgId} open={signOpen} onOpenChange={setSignOpen} />
      )}
```

Extend `ActionProps` with `canSign: boolean` and `onSign: () => void`, and add the artist signing branch to `PrimaryAction` (before the `if (!canManage)` download branch):
```tsx
  if (canSign) {
    return (
      <div className="space-y-2">
        <Button className="w-full" onClick={onSign}>Review &amp; sign</Button>
        <Button variant="outline" className="w-full" onClick={onDownload} disabled={!hasPdf || downloadBusy}>
          <Download className="mr-1 h-4 w-4" /> Download PDF
        </Button>
      </div>
    );
  }
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
npx vitest run src/pages/HireOrderDetailPage.signing.test.tsx
```
Expected: PASS. If the global `useQuery` mock fights the page's pdf-url query, delete this page test and rely on `canArtistSign` unit coverage (Task 6) — note the removal in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/pages/HireOrderDetailPage.tsx src/pages/HireOrderDetailPage.signing.test.tsx
git commit -m "wire in-app signing into the hire-order viewer"
```

---

### Task 10: CountersignCard — electronic option + producer-email toggle

**Files:**
- Modify: `src/components/settings/hireOrders/CountersignCard.tsx`
- Modify: `src/components/settings/hireOrders/defaults.ts` (type only; default stays `manual`)
- Test: `src/components/settings/hireOrders/CountersignCard.test.tsx` (add cases; file exists per HireOrdersTab.test.tsx sibling — create if absent)

**Interfaces:**
- Produces: `type CountersignMode = "manual" | "electronic"`; `interface HireOrderCountersign { mode: CountersignMode; email_producers_on_countersign?: boolean }`. The card offers Manual + Electronic (no Documenso), and under Electronic a checkbox bound to `email_producers_on_countersign`. The Documenso "Test connection" button + `countersign-test` invocation are removed.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const upsert = vi.fn().mockResolvedValue(undefined);
vi.mock("@/data/settings", () => ({
  resolveOrgSetting: vi.fn().mockResolvedValue({ mode: "manual" }),
  upsertOrgSetting: (...a: unknown[]) => upsert(...a),
}));

import { CountersignCard } from "./CountersignCard";

describe("CountersignCard", () => {
  beforeEach(() => upsert.mockClear());

  it("offers Electronic and no Documenso option", async () => {
    renderWithProviders(<CountersignCard orgId="o1" />);
    await waitFor(() => expect(screen.getByText(/electronic signature/i)).toBeInTheDocument());
    expect(screen.queryByText(/documenso/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /test connection/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
npx vitest run src/components/settings/hireOrders/CountersignCard.test.tsx
```
Expected: FAIL (Documenso option still present / no "electronic signature" text).

- [ ] **Step 3: Rewrite the card body**

Change the exported types at the top:
```ts
export type CountersignMode = "manual" | "electronic";

export interface HireOrderCountersign {
  mode: CountersignMode;
  /** electronic mode only: also email producers the signed PDF. */
  email_producers_on_countersign?: boolean;
}
```

Remove the entire "Test connection" block: the `invokeHireOrderAction` import, `CountersignTestResult`, the `test` mutation, `testResult` state, and the whole `form.mode === "documenso"` panel + its button.

Replace the two radio options (`manual` + `documenso`) with `manual` + `electronic`, and add the producer-email checkbox under electronic:
```tsx
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <RadioGroupItem value="manual" id="ho-countersign-manual" className="mt-0.5" />
            <Label htmlFor="ho-countersign-manual" className="cursor-pointer font-normal">
              <span className="block text-sm font-medium">Manual</span>
              <span className="block text-xs text-muted-foreground">
                A producer marks the order as countersigned once the artist has signed outside ShowFlow.
              </span>
            </Label>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <RadioGroupItem value="electronic" id="ho-countersign-electronic" className="mt-0.5" />
            <Label htmlFor="ho-countersign-electronic" className="cursor-pointer font-normal">
              <span className="block text-sm font-medium">Electronic signature (in-app)</span>
              <span className="block text-xs text-muted-foreground">
                The artist reviews and signs the issued order inside ShowFlow. A signed PDF and audit record are stored automatically.
              </span>
            </Label>
          </div>
```
After the `RadioGroup`, add (replacing the removed documenso panel):
```tsx
        {form.mode === "electronic" && (
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Checkbox
              id="ho-email-producers"
              className="mt-0.5"
              checked={!!form.email_producers_on_countersign}
              onCheckedChange={(c) => setForm((f) => ({ ...f, email_producers_on_countersign: c === true }))}
            />
            <Label htmlFor="ho-email-producers" className="cursor-pointer font-normal">
              <span className="block text-sm font-medium">Also email producers the signed copy</span>
              <span className="block text-xs text-muted-foreground">
                When the artist signs, email the assigned producers a copy of the signed hire order. Producers are notified in-app either way.
              </span>
            </Label>
          </div>
        )}
```
Add `import { Checkbox } from "@/components/ui/checkbox";` and drop the now-unused imports (`CheckCircle2`, `invokeHireOrderAction`).

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
npx vitest run src/components/settings/hireOrders/CountersignCard.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Typecheck + lint the frontend**

Run:
```bash
npx tsc --noEmit && npm run lint
```
Expected: no errors (defaults.ts `COUNTERSIGN_DEFAULT` still `{ mode: "manual" }`, now typed against the new union; any `documenso` reference in `useHireOrders.ts` ISSUE_FAILURE_COPY stays valid — it is a plain string key).

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/hireOrders/CountersignCard.tsx src/components/settings/hireOrders/defaults.ts src/components/settings/hireOrders/CountersignCard.test.tsx
git commit -m "offer electronic countersign + producer-email toggle in settings"
```

---

### Task 11: Issued email — show the sign CTA in electronic mode

**Files:**
- Modify: `supabase/functions/_shared/transactional-email-templates/hire-order-issued.tsx`
- Test: `supabase/functions/_shared/transactional-email-templates/hire-order-issued.test.ts` (add a case; create if absent)

**Interfaces:**
- Produces: the issued email renders the "Review and sign" CTA (linking `signing_url`) when `countersign_mode` is `documenso` OR `electronic`.

- [ ] **Step 1: Write the failing test**

```typescript
/// <reference types="npm:@types/react@18.3.1" />
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { template } from "./hire-order-issued.tsx";

Deno.test("issued email shows the sign CTA in electronic mode", async () => {
  const { render } = await import("npm:@react-email/render@1.0.1");
  const html = await render(template.component({
    artist_name: "Ann", order_no: "HO-1", date_label: "Sat, Aug 15 2026", venue: "Tempodrom",
    download_url: "https://app.example/hire-orders/o-1",
    countersign_mode: "electronic",
    signing_url: "https://app.example/hire-orders/o-1",
  }));
  assert(html.includes("Review and sign"), "electronic mode shows the sign CTA");
});
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
cd supabase/functions && deno test --allow-all --node-modules-dir=none _shared/transactional-email-templates/hire-order-issued.test.ts
```
Expected: FAIL (electronic mode currently falls into the non-Documenso branch, no "Review and sign").

- [ ] **Step 3: Generalise the CTA condition**

In `hire-order-issued.tsx`, replace:
```typescript
  const isDocumenso = countersign_mode === 'documenso'
```
with:
```typescript
  const showSignCta = countersign_mode === 'documenso' || countersign_mode === 'electronic'
```
and replace the `{isDocumenso ? (` conditional with `{showSignCta ? (`. Leave the copy ("Review and sign your hire order online to confirm." + the button) as-is.

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
cd supabase/functions && deno test --allow-all --node-modules-dir=none _shared/transactional-email-templates/hire-order-issued.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/transactional-email-templates/hire-order-issued.tsx supabase/functions/_shared/transactional-email-templates/hire-order-issued.test.ts
git commit -m "show sign CTA in the issued email for electronic mode"
```

---

### Task 12: Docs + Documenso "not in use" annotations

**Files:**
- Modify: `docs/system-map.md`, `src/data/systemMap.ts`
- Modify: `docs/app-logic.md`
- Modify: `supabase/functions/_shared/documenso.ts`, `supabase/functions/documenso-webhook/index.ts` (header comments only)
- Modify: `supabase/functions/generate-hire-orders/index.ts` (comment on the `documenso` branch + `countersign-test`)

**Interfaces:** none (docs + comments). The system map must change in the same PR as the automation change (house rule).

- [ ] **Step 1: Annotate the dormant Documenso code**

At the top of `_shared/documenso.ts` and `documenso-webhook/index.ts`, add above the existing lead comment:
```typescript
// NOT IN USE (2026-07): superseded by in-app electronic signing (the `sign` action
// in generate-hire-orders + hire_order_signatures). Retained, dark, for a possible
// future self-hosted Documenso. See docs/superpowers/specs/2026-07-23-hire-orders-in-app-signing-design.md.
```
In `generate-hire-orders/index.ts`, above the `if (countersignModeUsed === "documenso") {` block and above the `case "countersign-test":`, add a one-line:
```typescript
  // NOT IN USE: dormant Documenso path — no org can select 'documenso' since the
  // settings UI offers only manual|electronic. Retained for a future self-hosted Documenso.
```

- [ ] **Step 2: Update `src/data/systemMap.ts`**

In the `f_hireorders` node's `detail`: add the `sign` action to `Trigger` ("+ `sign` from the artist's Review & sign dialog on HireOrderDetailPage"), to `Auth` ("`sign`: bespoke — the linked artist only, on an issued electronic order"), to `Writes` ("`issued_pdf_sha256` on issue; on `sign`: `hire_order_signatures` insert + `issued→countersigned` with `signed_pdf_path`/`countersign_mode='electronic'`; Storage `<org>/<order_no>-signed.pdf` + `<org>/signatures/<order_no>.png`"), and to `Effects` ("`hire-order-countersigned` email with the signed PDF to the artist, and to producers when `email_producers_on_countersign` is set; in-app `hire_order_countersigned` notifications"). In the `f_documenso` node, prefix `sub` with "DORMANT · " and add to `detail.Trigger` that this path is not in use (superseded by in-app signing).

- [ ] **Step 3: Update `docs/system-map.md`**

In the `### generate-hire-orders` section and the §4 summary row, add the `sign` action (trigger/auth/writes/effects) mirroring Step 2. In the `### documenso-webhook` section and its §3 table row + notification row, prefix with a "Dormant (not in use since 2026-07): superseded by in-app electronic signing" note. Add a notification-table row for the in-app countersign (`hire_order_countersigned` from `generate-hire-orders`).

- [ ] **Step 4: Update `docs/app-logic.md`**

Where the hire-order countersign flow is described, add a short paragraph: issued orders in electronic mode are signed by the artist inside ShowFlow (type or draw) on the order page; a signed PDF with a certificate page and an audit record are produced and the order becomes countersigned. Manual mode (producer marks countersigned) is unchanged.

- [ ] **Step 5: Verify the full suites are green**

Run:
```bash
npx vitest run && npm run lint && npx tsc --noEmit
cd supabase/functions && deno test --allow-all --node-modules-dir=none
```
Expected: all PASS. (pgTAP for Task 1 already validated via `execute_sql`.)

- [ ] **Step 6: Commit**

```bash
git add docs/system-map.md src/data/systemMap.ts docs/app-logic.md supabase/functions/_shared/documenso.ts supabase/functions/documenso-webhook/index.ts supabase/functions/generate-hire-orders/index.ts
git commit -m "document in-app signing + annotate dormant Documenso path"
```

---

## Deferred / out of scope for this plan

- **Public changelog + version bump.** The `hire_orders` feature ships dark (entitlement off), so there is no customer-facing behavior to announce yet. Fold a changelog entry + `package.json`/`APP_META.VERSION` bump into the hire-orders initiative's enable-and-tag step (target 1.10.0), not this PR.
- **Deploying `generate-hire-orders`.** Edge functions auto-deploy on merge to `main`; no new function is added (the `documenso-webhook` stays deployed but inert), so `config.toml` needs no change.
- **Producer-initiated signing / multi-signer / reminders / expiry.** Explicit non-goals (spec).

## Self-Review notes

- **Spec coverage:** signing schema + audit table (Task 1); signed PDF + certificate (Task 2, 5); issued-doc hash (Task 3); email (Task 4, 11); sign action with auth/consent/idempotency (Task 5); `download-url` serves the signed copy (Task 5, Step 4); frontend data/hooks/dialog/pad/page (Tasks 6-9); settings swap + producer-email toggle (Task 10); Documenso left dark (Task 12). All spec sections map to a task.
- **Trigger relaxation** the spec anticipated is unnecessary — the existing trigger does not freeze the new columns (documented in Task 1). This is the one deliberate deviation from the spec.
- **`ip` stored as `text`, not `inet`** (Task 1) — avoids an insert failure on a malformed `x-forwarded-for`; it is audit metadata, never queried as an address.
- **Type consistency:** `SignHireOrderArgs`, `SignatureValue`, `RenderSignature`, `HireOrderCountersign`/`CountersignMode`, and the `sign` payload keys (`typed_name`, `signature_png`, `consent`) are used identically across the data-access, hook, component, and edge tasks.
