# Hire-order Batching and Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tracked resend/view actions, drawing-first theme-aware signing, and aggregated multi-artist hire-order creation with a signing-first email.

**Architecture:** Persist aggregate schedules through a new `hire_order_dates` child table and a frozen `engagement_dates` document snapshot. Extend the existing `generate-hire-orders` edge function with batch-draft and resend actions; keep all issued documents immutable by resending their stored bytes. Update the wizard and existing-order slide-over to consume the new API while retaining the current single-date/manual paths.

**Tech Stack:** React 18, TypeScript, TanStack Query, Radix UI, Vitest, Supabase/Postgres migrations and pgTAP, Deno edge functions, React Email, react-pdf.

## Global Constraints

- Preserve all existing single-date hire orders and their `show_date_id` behavior.
- An aggregate produces one hire order per artist, with one or more linked dates; a selected artist must have at least one date.
- Fee, currency, duration, and running order are batch-wide; do not add per-artist overrides.
- A resend may only reuse a stored issued/signed PDF and must never alter document data, issue snapshot, or signature records.
- `last_sent_at` changes only after the email provider accepts a resend or initial issued email.
- Electronic/Documenso email must place Review and sign before View and download; manual mode retains View and download as the primary CTA.
- Update the mirrored browser and edge `OrderData` contracts together.

---

## File structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260724120000_hire_order_dates_and_delivery.sql` | Child-date table, delivery timestamp, RLS, ownership/duplicate guards, and legacy-index replacement. |
| `supabase/tests/db/hire_order_dates.sql` | pgTAP coverage for date ownership, active duplicate protection, and void/recreate behavior. |
| `src/integrations/supabase/types.ts` / `supabase/functions/_shared/database.types.ts` | Mirrored generated schema definitions for the new table and `last_sent_at`. |
| `src/lib/hireOrders/types.ts` / `supabase/functions/_shared/hireOrders.ts` | Mirrored `EngagementDate` and `engagement_dates` snapshot contract. |
| `supabase/functions/_shared/hire-order-pdf/render.tsx` | Renders multi-date engagement facts without changing legacy single-date output. |
| `supabase/functions/_shared/transactional-email-templates/hire-order-issued.tsx` | Gives signing CTA priority and supports multi-date email labels. |
| `supabase/functions/generate-hire-orders/index.ts` | Batch draft, immutable resend, delivery stamping, and shared email construction. |
| `src/data/hireOrders.ts` / `src/hooks/useHireOrders.ts` | Typed client requests/results and cache invalidation for batch/resend. |
| `src/components/hireOrders/OrderSlideOver.tsx` | Created/last-sent metadata plus View and Resend actions. |
| `src/components/hireOrders/SignaturePad.tsx` | Draw-first tabs and theme-aware canvas pen colour. |
| `src/components/hireOrders/NewOrderWizard.tsx` | Artist multi-select, shared-date defaults, per-artist matrix, grouped review/result. |

## Task 1: Persist aggregate dates and last-send timestamps

**Files:**
- Create: `supabase/migrations/20260724120000_hire_order_dates_and_delivery.sql`
- Create: `supabase/tests/db/hire_order_dates.sql`
- Modify: `src/integrations/supabase/types.ts:1055-1150`
- Modify: `supabase/functions/_shared/database.types.ts:1055-1150`

**Interfaces:**
- Produces: `hire_order_dates(hire_order_id uuid, show_date_id uuid, position smallint, org_id uuid)` with unique `(hire_order_id, show_date_id)` and active artist/date enforcement.
- Produces: nullable `hire_orders.last_sent_at timestamptz`.
- Consumes: `hire_orders.status`, `artist_id`, `org_id`; `show_dates.org_id`.

- [ ] **Step 1: Write failing pgTAP tests for organisation ownership and duplicate protection.**

```sql
select plan(5);

select throws_ok(
  $$insert into public.hire_order_dates (hire_order_id, show_date_id, org_id, position)
    values ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000222', '00000000-0000-0000-0000-000000000333', 0)$$,
  '.*hire order date belongs to a different org.*',
  'rejects a child date from another organisation'
);

select throws_ok(
  $$select public.assert_hire_order_dates_available(
      '00000000-0000-0000-0000-000000000444',
      '00000000-0000-0000-0000-000000000555',
      array['00000000-0000-0000-0000-000000000666']::uuid[])$$,
  '.*active hire order already covers.*',
  'blocks an active aggregate date already held by the artist'
);
```

- [ ] **Step 2: Run the focused database test and verify it fails because the relation/helper do not exist.**

Run: `npm run test:db -- supabase/tests/db/hire_order_dates.sql`

Expected: FAIL with a missing relation or missing function error.

- [ ] **Step 3: Add the migration with child table, RLS, and race-safe date guard.**

```sql
alter table public.hire_orders add column last_sent_at timestamptz;

create table public.hire_order_dates (
  hire_order_id uuid not null references public.hire_orders(id) on delete cascade,
  show_date_id uuid not null references public.show_dates(id) on delete restrict,
  org_id uuid not null references public.organizations(id) on delete cascade,
  position smallint not null check (position >= 0),
  primary key (hire_order_id, show_date_id),
  unique (hire_order_id, position)
);

create or replace function public.enforce_hire_order_date_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select org_id from public.hire_orders where id = new.hire_order_id) <> new.org_id
     or (select org_id from public.show_dates where id = new.show_date_id) <> new.org_id then
    raise exception 'hire order date belongs to a different org';
  end if;
  return new;
end $$;

create trigger enforce_hire_order_date_org before insert or update on public.hire_order_dates
  for each row execute function public.enforce_hire_order_date_org();
```

Add the `assert_hire_order_dates_available(p_org, p_artist, p_dates)` security-definer helper. It must lock or otherwise serialize the active-order lookup, examine both legacy `hire_orders.show_date_id` and `hire_order_dates`, and raise `active hire order already covers a selected date` when any overlap exists. Call it from the batch edge action before inserts and maintain a database trigger/constraint path that prevents concurrent overlap. Add producer/admin select policy plus restrictive org isolation policy mirroring `hire_orders`.

- [ ] **Step 4: Mirror the generated schema types.**

Add `last_sent_at: string | null` to every `hire_orders` Row/Insert/Update definition and add the complete `hire_order_dates` Row/Insert/Update/Relationships declaration to both generated type mirrors. The declarations must be byte-for-byte equivalent aside from their surrounding module path.

- [ ] **Step 5: Re-run focused database tests and typecheck.**

Run: `npm run test:db -- supabase/tests/db/hire_order_dates.sql && npm run build`

Expected: pgTAP passes; Vite build completes without a stale generated-schema error.

- [ ] **Step 6: Commit the persistence contract.**

```bash
git add supabase/migrations/20260724120000_hire_order_dates_and_delivery.sql supabase/tests/db/hire_order_dates.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "feat: persist hire-order aggregate dates and delivery time"
```

## Task 2: Extend the frozen document model, PDF, and issued-email template

**Files:**
- Modify: `src/lib/hireOrders/types.ts:1-55`
- Modify: `supabase/functions/_shared/hireOrders.ts:1-65`
- Modify: `supabase/functions/_shared/hire-order-pdf/render.tsx:277-430`
- Modify: `supabase/functions/_shared/hire-order-pdf/render.test.ts`
- Modify: `supabase/functions/_shared/transactional-email-templates/hire-order-issued.tsx:1-100`
- Modify: `supabase/functions/_shared/transactional-email-templates/hire-order-issued.test.ts`

**Interfaces:**
- Produces: `EngagementDate = { show_date_id: string; date: string; venue: string | null; city: string | null }`.
- Produces: `data.engagement_dates.value: EngagementDate[]` when an order aggregates dates.
- Consumes: existing `data.date`, `venue`, `city`, `sessions`, and current email template data.

- [ ] **Step 1: Write the failing renderer/template assertions.**

```ts
Deno.test("aggregate PDF renders every engagement date", async () => {
  const bytes = await renderHireOrderPdf({
    ...BASE,
    data: {
      ...BASE.data,
      engagement_dates: { value: [
        { show_date_id: "sd-1", date: "2026-08-15", venue: "Tempodrom", city: "Berlin" },
        { show_date_id: "sd-2", date: "2026-08-16", venue: "Tempodrom", city: "Berlin" },
      ], source: "showflow" },
    },
  });
  assert(bytes.length > 0 && bytes[0] === 0x25);
});

assert(html.indexOf("Review and sign") < html.indexOf("View and download"));
```

- [ ] **Step 2: Run the focused function tests and verify the new template ordering assertion fails.**

Run: `deno test --allow-all supabase/functions/_shared/hire-order-pdf/render.test.ts supabase/functions/_shared/transactional-email-templates/hire-order-issued.test.ts`

Expected: FAIL because `engagement_dates` is not an accepted field and View/download appears first.

- [ ] **Step 3: Define the shared snapshot field in both runtimes.**

```ts
export interface EngagementDate {
  show_date_id: string;
  date: string;
  venue: string | null;
  city: string | null;
}

export type OrderFieldKey =
  | "artist_name" | "recipient_email" | "role" | "cast" | "date"
  | "venue" | "city" | "duration_min" | "sessions" | "fee"
  | "currency" | "notes" | "engagement_dates";
```

Keep `engagement_dates` out of editable field sections and `ORDER_FIELD_KEYS` if it would expose a raw JSON editor; preserve it when drafts are edited by merging the existing snapshot object.

- [ ] **Step 4: Render aggregate dates and reprioritise email CTAs.**

Add an `engagementDatesOf(data)` helper in the PDF renderer that validates an array of date objects. When it has more than one item, replace the single date fact value with a compact joined date label and render a “Engagement dates” list before the running order. Retain exact legacy rendering when the helper returns zero/one row.

In the email template, render the signing section before the download section when `showSignCta` is true:

```tsx
{showSignCta ? (
  <Section style={section}><Button href={signing_url || APP_URL} style={button}>Review and sign</Button></Section>
) : null}
<Section style={section}><Button href={downloadUrl} style={button}>{ctaLabel}</Button></Section>
```

Use `Review document` as the secondary electronic CTA label; leave manual `View and download` unchanged.

- [ ] **Step 5: Run focused renderer/template tests.**

Run: `deno test --allow-all supabase/functions/_shared/hire-order-pdf/render.test.ts supabase/functions/_shared/transactional-email-templates/hire-order-issued.test.ts`

Expected: PASS, including electronic CTA ordering and existing manual template output.

- [ ] **Step 6: Commit document and template behavior.**

```bash
git add src/lib/hireOrders/types.ts supabase/functions/_shared/hireOrders.ts supabase/functions/_shared/hire-order-pdf/render.tsx supabase/functions/_shared/hire-order-pdf/render.test.ts supabase/functions/_shared/transactional-email-templates/hire-order-issued.tsx supabase/functions/_shared/transactional-email-templates/hire-order-issued.test.ts
git commit -m "feat: render aggregated hire-order dates"
```

## Task 3: Add batch drafting and immutable resending to the edge function

**Files:**
- Modify: `supabase/functions/generate-hire-orders/index.ts:1-1400`
- Modify: `supabase/functions/generate-hire-orders/index.di.test.ts`
- Modify: `src/data/hireOrders.ts:206-216`
- Modify: `src/hooks/useHireOrders.ts:100-215`
- Modify: `src/hooks/useHireOrders.test.ts:297-350`

**Interfaces:**
- Consumes: `{ action: "draft-batch", org_id, artists: [{ artist_id, show_date_ids }], manual }`.
- Produces: `{ created: string[], skipped: [{ artist_id, reason }], errors: [{ artist_id, reason }] }`.
- Consumes: `{ action: "resend", org_id, order_id }`.
- Produces: `{ sent_at: string }` only after email success.

- [ ] **Step 1: Write failing DI tests for batch grouping and resend safety.**

```ts
Deno.test("draft-batch creates one order per artist and snapshots all assigned dates", async () => {
  const res = await handle(makeRequest({ headers: JWT, body: {
    action: "draft-batch", org_id: ORG,
    artists: [
      { artist_id: "a-1", show_date_ids: ["sd-1", "sd-2"] },
      { artist_id: "a-2", show_date_ids: ["sd-1"] },
    ],
    manual: { fee: 900, currency: "EUR", duration_min: 75, sessions: ["20:00"] },
  } }), deps);
  assertEquals((await res.json()).created.length, 2);
});

Deno.test("resend stamps last_sent_at only after the provider accepts", async () => {
  deps.sendEmail = () => Promise.resolve({ data: { id: "email-2" }, error: null });
  const response = await handle(makeRequest({ headers: JWT, body: { action: "resend", org_id: ORG, order_id: "o-1" } }), deps);
  assertEquals(response.status, 200);
  assertEquals(fake.updated("hire_orders").last_sent_at, NOW);
});
```

- [ ] **Step 2: Run the DI file and verify failures are caused by unknown actions.**

Run: `deno test --allow-all supabase/functions/generate-hire-orders/index.di.test.ts`

Expected: FAIL with `unknown_action` for `draft-batch` and `resend`.

- [ ] **Step 3: Implement `draft-batch` through one reusable per-artist helper.**

Define strict request/result types, reject empty arrays/duplicate artist IDs/empty per-artist date arrays, fetch all artists and show dates scoped to the request organisation, sort dates ascending, and call the database availability guard before each insert. Build one `engagement_dates` snapshot and retain first-date top-level fields for legacy readers:

```ts
const engagementDates: EngagementDate[] = dates.map((d) => ({
  show_date_id: d.id, date: d.date, venue: d.venue, city: d.cityName,
}));
showflow.date = engagementDates[0].date;
showflow.venue = engagementDates[0].venue;
showflow.city = engagementDates[0].city;
showflow.engagement_dates = engagementDates;
```

Insert the parent via existing collision-safe numbering, then insert its `hire_order_dates` rows in ascending `position`. Per-artist `try/catch` must append an error/skip result and continue the batch. Use the same supplied `manual` layer for every artist.

- [ ] **Step 4: Implement `resend` without rendering a new document.**

Load `id, status, data, order_no, artist_id, pdf_path, signed_pdf_path, fee_currency`, reject anything except `issued`/`countersigned`, recipient-less data, or absent storage path. Download `signed_pdf_path ?? pdf_path`, call the existing `sendIssuedEmail` helper with a `deliveryKind: "resend"` parameter, and use:

```ts
idempotency_key: deliveryKind === "resend"
  ? `hire-order-resend-${order.id}-${deps.now().toISOString()}`
  : `hire-order-issued-${order.id}`,
```

Only after `sendEmail` reports no error, update `{ last_sent_at: deps.now().toISOString() }`. In `issueOne`, call the same helper and stamp `last_sent_at` after its initial email succeeds. Do not make email delivery failure undo the issued state.

- [ ] **Step 5: Add browser mutation invalidation and user-facing errors.**

Extend `WRITE_ACTIONS` to include `draft-batch` and `resend`; add the draft-batch count/skip copy. Keep `preview`/`download-url` read-only. `invokeHireOrderAction` stays the single client boundary.

- [ ] **Step 6: Run function and hook tests.**

Run: `deno test --allow-all supabase/functions/generate-hire-orders/index.di.test.ts && npm test -- src/hooks/useHireOrders.test.ts`

Expected: PASS, with resend failure leaving `last_sent_at` unchanged and batch returning independent artist outcomes.

- [ ] **Step 7: Commit the server/client action contract.**

```bash
git add supabase/functions/generate-hire-orders/index.ts supabase/functions/generate-hire-orders/index.di.test.ts src/data/hireOrders.ts src/hooks/useHireOrders.ts src/hooks/useHireOrders.test.ts
git commit -m "feat: batch and resend hire-order delivery"
```

## Task 4: Enhance the existing-order drawer and signature control

**Files:**
- Modify: `src/components/hireOrders/OrderSlideOver.tsx:1-210`
- Modify: `src/components/hireOrders/OrderSlideOver.test.tsx:1-145`
- Modify: `src/components/hireOrders/SignaturePad.tsx:1-110`
- Modify: `src/components/hireOrders/SignaturePad.test.tsx:1-120`
- Modify: `src/lib/dates.ts:1-50`

**Interfaces:**
- Consumes: `HireOrderListRow.created_at`, `last_sent_at`, status, order id.
- Produces: drawer buttons `View` and `Resend`; `SignaturePad` starts on `draw`.

- [ ] **Step 1: Write failing component tests.**

```tsx
it("shows created and last-sent timestamps plus View and Resend for an issued order", () => {
  renderWithProviders(<OrderSlideOver order={order({ status: "issued", last_sent_at: "2026-07-24T09:30:00Z" })} open onOpenChange={vi.fn()} orgId="org-1" />);
  expect(screen.getByText(/created/i)).toBeInTheDocument();
  expect(screen.getByText(/last sent/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^view$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^resend$/i })).toBeInTheDocument();
});

it("opens Draw first and uses white ink in a dark root", () => {
  document.documentElement.classList.add("dark");
  render(<SignaturePad value={null} onChange={vi.fn()} />);
  expect(screen.getByRole("tab", { name: "Draw" })).toHaveAttribute("data-state", "active");
  expect(instances[0].penColor).toBe("#ffffff");
});
```

- [ ] **Step 2: Run the component tests and verify the new UI assertions fail.**

Run: `npm test -- src/components/hireOrders/OrderSlideOver.test.tsx src/components/hireOrders/SignaturePad.test.tsx`

Expected: FAIL because timestamps/actions are absent and Type is the active tab.

- [ ] **Step 3: Implement local timestamp formatting and drawer actions.**

Add `formatTimestampLocal(input)` in `src/lib/dates.ts` using `new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })`. In the slide-over, render a small “Delivery” definition list using `created_at` and `last_sent_at ?? "Not sent yet"`. Add `handleView` that closes then navigates to `ROUTES.HIRE_ORDER_DETAIL`, and `handleResend` that invokes `{ action: "resend", org_id: orgId, order_id }`, leaving the sheet open so the invalidated record refreshes. Render Resend only for issued/countersigned orders and disable it while pending.

- [ ] **Step 4: Make the pad draw-first and theme-aware.**

Pass a pen color to `signature_pad` when the canvas callback creates it:

```ts
const dark = document.documentElement.classList.contains("dark");
const pad = new SignaturePadLib(node, { penColor: dark ? "#ffffff" : "#15131C" });
```

Set `<Tabs defaultValue="draw">`, preserve clearing-on-tab-change, and update the test fake constructor to retain the provided options. Ensure test cleanup removes the `dark` root class.

- [ ] **Step 5: Run focused tests.**

Run: `npm test -- src/components/hireOrders/OrderSlideOver.test.tsx src/components/hireOrders/SignaturePad.test.tsx`

Expected: PASS, including manual/electronic countersign gating from existing tests.

- [ ] **Step 6: Commit the producer and artist UX updates.**

```bash
git add src/components/hireOrders/OrderSlideOver.tsx src/components/hireOrders/OrderSlideOver.test.tsx src/components/hireOrders/SignaturePad.tsx src/components/hireOrders/SignaturePad.test.tsx src/lib/dates.ts
git commit -m "feat: add hire-order resend and draw signing defaults"
```

## Task 5: Convert the linked-order wizard to a hybrid batch matrix

**Files:**
- Modify: `src/components/hireOrders/NewOrderWizard.tsx:1-590`
- Modify: `src/components/hireOrders/NewOrderWizard.test.tsx:1-270`
- Modify: `src/data/hireOrders.ts:1-205` (only if a typed `BatchDraftResult` is added)

**Interfaces:**
- Consumes: `ArtistLite[]`, `ShowDateLite[]`, batch fee/running-order state.
- Produces: `draft-batch` request with `artists: Array<{ artist_id: string; show_date_ids: string[] }>`.
- Preserves: `draft-manual` for the No linked date single-artist flow.

- [ ] **Step 1: Write failing wizard tests for common dates, individual exceptions, and grouped review.**

```tsx
it("creates one batch payload row per selected artist with its checked dates", async () => {
  renderWizard();
  await selectArtists("Ann Artist", "Ben Booker");
  await selectCommonDates("Berlin", "Hamburg");
  fireEvent.click(screen.getByRole("checkbox", { name: /ben booker.*hamburg/i }));
  await reachReviewWithFee();
  fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
  expect(invokeCalls()[0]).toMatchObject({
    action: "draft-batch",
    artists: [
      { artist_id: "a1", show_date_ids: ["sd1", "sd2"] },
      { artist_id: "a2", show_date_ids: ["sd1"] },
    ],
  });
});
```

- [ ] **Step 2: Run the wizard test and verify it fails because artist/date selection is singular.**

Run: `npm test -- src/components/hireOrders/NewOrderWizard.test.tsx`

Expected: FAIL because multi-select controls and matrix checkboxes do not exist.

- [ ] **Step 3: Replace linked step-one scalar state with batch selection state.**

Use `selectedArtistIds: string[]`, `selectedShowDateIds: string[]`, and `artistDateIds: Record<string, string[]>`. Artist selection uses checkbox rows inside the existing searchable popover. Date selection uses the same pattern. “Apply selected dates to all” sets each selected artist's list to the selected date IDs; matrix cells toggle a single date for one artist. Remove a deselected artist from `artistDateIds`; remove a deselected date from every artist.

- [ ] **Step 4: Make review, submission, and success state batch-aware.**

Require every selected artist to retain one date before Continue. Build the request exactly once:

```ts
const draftBody = () => ({
  action: "draft-batch" as const,
  org_id: orgId,
  artists: selectedArtistIds.map((artist_id) => ({ artist_id, show_date_ids: artistDateIds[artist_id] ?? [] })),
  manual: buildManualDict(),
});
```

On success, retain `created: string[]` and result rows rather than one id. Review shows each artist and formatted selected dates. The success copy reads “N hire orders created”; Open order is shown only when exactly one order was created, otherwise Close returns to the tracking list. Issue uses all successfully created IDs. Keep manual mode's existing one-order behavior unchanged.

- [ ] **Step 5: Run the focused wizard suite.**

Run: `npm test -- src/components/hireOrders/NewOrderWizard.test.tsx`

Expected: PASS for legacy manual/single-date flows and new shared/default-plus-exception matrix behavior.

- [ ] **Step 6: Commit batch-wizard behavior.**

```bash
git add src/components/hireOrders/NewOrderWizard.tsx src/components/hireOrders/NewOrderWizard.test.tsx src/data/hireOrders.ts
git commit -m "feat: create grouped hire orders for multiple artists"
```

## Task 6: Verify the whole hire-order surface and update system documentation

**Files:**
- Modify: `src/data/systemMap.ts:299-304`
- Modify: tests only when a verified full-suite failure reveals a stale assertion.

**Interfaces:**
- Documents: `draft-batch` and `resend` actions, aggregate links, last-send tracking, and signing-first email.

- [ ] **Step 1: Update the system-map contract.**

Replace the wizard/action description with wording that explicitly lists `draft-manual` (single manual), `draft-batch` (one order per artist with aggregate dates), `issue`, `resend`, `preview`, `download-url`, and `sign`. State that resend reads stored PDF bytes and stamps `last_sent_at` only after successful provider acceptance.

- [ ] **Step 2: Run the complete browser quality gate.**

Run: `npm test && npm run lint && npm run build`

Expected: all Vitest suites pass, ESLint exits zero, and the production build succeeds.

- [ ] **Step 3: Run the complete edge/database quality gate.**

Run: `npm run test:functions && npm run test:db`

Expected: all Deno and pgTAP suites pass, including existing signing, generated PDF, and hire-order tests.

- [ ] **Step 4: Inspect the final diff and commit verification/documentation.**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only intentional files changed.

```bash
git add src/data/systemMap.ts
git commit -m "docs: map aggregate hire-order delivery flow"
```

## Plan self-review

- Spec coverage: Task 1 implements persistent dates/timestamps; Task 2 preserves them in issued artifacts and CTA order; Task 3 provides batch/resend behavior; Task 4 implements drawer/signing UI; Task 5 implements the selected hybrid UX; Task 6 verifies and documents the integrated flow.
- No-placeholder scan: all planned changes have concrete interfaces, test commands, expected outcomes, and implementation snippets.
- Type consistency: `draft-batch`, `resend`, `EngagementDate`, `engagement_dates`, and `last_sent_at` use the same names across persistence, edge, client, UI, and tests.
