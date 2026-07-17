# Hire Orders Core Implementation Plan (initiative PRs ②③④)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Git safety:** never run `git reset --hard`, `git checkout -- .`, or any history-destroying command. Commit early and often on the current branch.

**Goal:** The hire-order engine end to end: schema + settings, PDF rendering behind a spike-gated port, Supabase Storage delivery, the `generate-hire-orders` edge function with the fully-filled auto-draft hook, email (with attachments) + notifications, and the first UI surfaces (V1 date-sheet card + modal, V3 document viewer, artist download).

**Architecture:** `hire_orders` stores an immutable `{value, source}` snapshot per document field resolved by a dual-home pure resolver (manual > sheet > showflow > default). One edge function owns draft/issue/preview/download-url actions; a status-transition trigger on `show_dates` dispatches auto-drafts through the existing pg_net cron machinery. Delivery rides the existing notification categories and transactional-email pipeline, extended with base64 attachments.

**Tech Stack:** Postgres/RLS + pg_net, Deno edge functions (DI), `@react-pdf/renderer` (spike-gated) or `pdf-lib` (fallback, both MIT), Supabase Storage (first use), Resend attachments, React 18 + TanStack Query v5, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-07-17-hire-orders-design.md` §§2-9. **Prerequisite: the entitlements plan (`2026-07-17-entitlements-platform.md`) is merged** — this plan consumes `requireFeature`, `checkFeature`, `is_feature_enabled`, `useFeature`, `ROUTE_FEATURES`.

## Global Constraints

Same as the entitlements plan (TDD; real-module imports; deno suite locally with `--node-modules-dir=none`, vitest/pgTAP/eslint in CI; migrations via MCP `apply_migration` with matching filenames; types via MCP `generate_typescript_types`; RLS + restrictive `org_isolation` on new tables; data-access pattern + supabaseFake; edge DI + `_shared` helpers; whole-suite Deno runs; no em/en-dashes in user-facing copy; lowercase imperative commits ≤72 chars). Additions:

- Every new edge function gets a `[functions.<name>]` block in `supabase/config.toml` in the same commit. `generate-hire-orders` is cron-secret + JWT dual-gated → `verify_jwt = false` (gateway must not force JWT; auth happens in-function via `requireCronOrRole`).
- Money is `numeric(10,2)` in SQL, string-formatted in TS via `formatMoney` (Task 3); never float arithmetic on fees.
- PDFs: bucket `hire-orders`, path `<org_id>/<order_no>.pdf`, signed URLs (3600s) only; never public.
- `docs/system-map.md` + `src/data/systemMap.ts` change in the same PR as any automation change (trigger, cron, edge function).
- Issued and countersigned orders are immutable except status fields (guarded in SQL, Task 1).

## File structure (what gets created/modified)

```
supabase/migrations/<ts>_hire_orders_schema.sql            (T1: enum, tables, guards, RLS)
supabase/migrations/<ts>_booking_fee_and_duration.sql      (T2: bookings.fee_amount, show_dates.duration_minutes)
supabase/migrations/<ts>_hire_orders_storage.sql           (T6: bucket + storage RLS)
supabase/migrations/<ts>_hire_order_notifications.sql      (T10: category_of/should_notify additions)
supabase/migrations/<ts>_fully_filled_hire_order_dispatch.sql (T9: trigger + pg_net dispatch)
supabase/tests/hire_orders.sql                             (pgTAP, grows over T1/T2/T9/T10)
src/lib/hireOrders/types.ts, resolveFields.ts, orderNo.ts, money.ts, validate.ts (+ .test.ts each) (T3)
supabase/functions/_shared/hireOrders.ts (+ .test.ts)      (T3 mirror + T7 renderer port type)
src/data/settings.ts                                       (T4: HIRE_ORDER default constants)
src/components/settings/hireOrders/*                       (T4: settings tab cards + rail)
src/pages/SettingsPage.tsx                                 (T4: new tab, feature-gated)
supabase/functions/_shared/hire-order-pdf/*                (T5 spike → T7 renderer + fonts)
supabase/functions/generate-hire-orders/index.ts (+ deno.json, index.di.test.ts) (T8)
supabase/functions/_shared/deps.ts                         (T10: EmailMessage.attachments)
supabase/functions/send-transactional-email/index.ts       (T10: forward attachments)
supabase/functions/_shared/transactional-email-templates/hire-order-issued.tsx + registry.ts (T10)
supabase/functions/_shared/notificationCategories.ts       (T10: category + maps)
src/data/hireOrders.ts (+ .test.ts)                        (T11)
src/hooks/useHireOrders.ts                                 (T11)
src/components/shows/hireOrders/HireOrdersCard.tsx, GenerateHireOrderDialog.tsx (+tests) (T12: V1)
src/components/shows/ShowDateDetailSheet.tsx               (T12: mount card after Assigned Artists)
src/pages/HireOrderDetailPage.tsx + src/components/hireOrders/* (T13: V3)
src/config/app.config.ts + src/App.tsx                     (T13: ROUTES.HIRE_ORDER_DETAIL + ROUTE_FEATURES)
src/components/bookings/ArtistBookingsView.tsx, dashboard/ArtistDashboard.tsx (T14)
e2e/hire-orders.spec.ts                                    (T15)
```

---

### Task 1: Schema migration — `hire_order_status`, `hire_orders`, `hire_order_imports`

**Files:**
- Create: `supabase/migrations/<real-ts>_hire_orders_schema.sql`
- Create: `supabase/tests/hire_orders.sql` (pgTAP; copy preamble style from `supabase/tests/`)

**Interfaces:**
- Produces: everything in spec §2.1/§2.5 verbatim. Later tasks rely on exact names: `hire_orders`, `hire_order_imports`, `hire_order_status` enum values `('draft','ready','issued','countersigned','void')`, columns as below, `enforce_hire_order_transition()`, `derive_org_for_hire_order()`.

- [ ] **Step 1: pgTAP first** — assert: both tables exist; enum values; `unique (org_id, order_no)`; partial unique index on active `booking_id`; RLS blocks producer of org B from selecting org A rows; artist with `user_id` can select own `issued` order but NOT `draft`; producer can INSERT only when `is_feature_enabled(org,'hire_orders')` (insert a disabling row, expect failure); transitions: `draft→ready→issued→countersigned` allowed, `issued→draft` rejected, `any→void` allowed; UPDATE of `data` on an `issued` row rejected; org-mismatch (booking from org B on org A order) rejected.

- [ ] **Step 2: Migration (apply via MCP, then save file)**

```sql
create type public.hire_order_status as enum ('draft','ready','issued','countersigned','void');

create table public.hire_order_imports (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  source     text not null check (source in ('xlsx','csv','gsheet')),
  file_name  text,
  mapping    jsonb not null,
  row_count  integer not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.hire_orders (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  order_no              text not null,
  status                public.hire_order_status not null default 'draft',
  booking_id            uuid references public.bookings(id) on delete set null,
  artist_id             uuid references public.artists(id) on delete set null,
  show_date_id          uuid references public.show_dates(id) on delete set null,
  data                  jsonb not null,
  fee_amount            numeric(10,2),
  fee_currency          text not null default 'EUR',
  terms_variant         text not null default 'standard' check (terms_variant in ('lean','standard','full')),
  pdf_path              text,
  countersign_mode      text check (countersign_mode in ('manual','documenso')),
  documenso_envelope_id text,
  import_id             uuid references public.hire_order_imports(id) on delete set null,
  created_by            uuid references auth.users(id),
  issued_at             timestamptz,
  countersigned_at      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, order_no)
);

create unique index hire_orders_active_booking_uniq
  on public.hire_orders (booking_id)
  where booking_id is not null and status <> 'void';
create index hire_orders_org_status_idx on public.hire_orders (org_id, status, created_at desc);
create index hire_orders_show_date_idx on public.hire_orders (show_date_id) where show_date_id is not null;
create index hire_orders_artist_idx on public.hire_orders (artist_id) where artist_id is not null;

create trigger update_hire_orders_updated_at before update on public.hire_orders
  for each row execute function public.update_updated_at_column();

-- Org consistency: linked entities must belong to org_id (mirror derive_org_id_for_booking).
create or replace function public.derive_org_for_hire_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.booking_id is not null and
     (select org_id from public.bookings where id = new.booking_id) <> new.org_id then
    raise exception 'booking belongs to a different org';
  end if;
  if new.artist_id is not null and
     (select org_id from public.artists where id = new.artist_id) <> new.org_id then
    raise exception 'artist belongs to a different org';
  end if;
  if new.show_date_id is not null and
     (select org_id from public.show_dates where id = new.show_date_id) <> new.org_id then
    raise exception 'show date belongs to a different org';
  end if;
  return new;
end $$;
create trigger derive_org_for_hire_order before insert or update of booking_id, artist_id, show_date_id
  on public.hire_orders for each row execute function public.derive_org_for_hire_order();

-- Lifecycle guard (mirror enforce_booking_transition, 20260714104826).
create or replace function public.enforce_hire_order_transition()
returns trigger language plpgsql as $$
begin
  if old.status = new.status then null;
  elsif old.status = 'draft'         and new.status in ('ready','void') then null;
  elsif old.status = 'ready'         and new.status in ('draft','issued','void') then null;
  elsif old.status = 'issued'        and new.status in ('countersigned','void') then null;
  elsif old.status = 'countersigned' and new.status = 'void' then null;
  else raise exception 'invalid hire order transition % -> %', old.status, new.status;
  end if;
  -- Issued documents are frozen: only status machinery may move.
  if old.status in ('issued','countersigned') and (
       new.data is distinct from old.data
    or new.fee_amount is distinct from old.fee_amount
    or new.fee_currency is distinct from old.fee_currency
    or new.terms_variant is distinct from old.terms_variant
    or new.order_no is distinct from old.order_no
    or new.pdf_path is distinct from old.pdf_path
  ) then
    raise exception 'issued hire orders are immutable';
  end if;
  return new;
end $$;
create trigger enforce_hire_order_transition before update on public.hire_orders
  for each row execute function public.enforce_hire_order_transition();

-- RLS
alter table public.hire_orders enable row level security;
alter table public.hire_order_imports enable row level security;

create policy "Producers manage hire orders" on public.hire_orders
  for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
  with check (
    (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
    and public.is_feature_enabled(org_id, 'hire_orders')
  );

create policy "Artists read own issued orders" on public.hire_orders
  for select to authenticated
  using (
    status in ('issued','countersigned')
    and artist_id in (select id from public.artists where user_id = auth.uid())
  );

create policy org_isolation on public.hire_orders as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

create policy "Producers manage hire order imports" on public.hire_order_imports
  for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
  with check (
    (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
    and public.is_feature_enabled(org_id, 'hire_orders')
  );
create policy org_isolation on public.hire_order_imports as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));
```

- [ ] **Step 3: Regenerate types via MCP; commit**

```bash
git add supabase/migrations/*_hire_orders_schema.sql supabase/tests/hire_orders.sql src/integrations/supabase/types.ts
git commit -m "add hire orders schema with lifecycle and rls guards"
```

---

### Task 2: `bookings.fee_amount` + `show_dates.duration_minutes`

**Files:** Create `supabase/migrations/<real-ts>_booking_fee_and_duration.sql`; extend `supabase/tests/hire_orders.sql`.

- [ ] **Step 1: pgTAP** — columns exist, correct types, both nullable; `fee_amount` rejects negative values.
- [ ] **Step 2: Migration**

```sql
alter table public.bookings   add column if not exists fee_amount numeric(10,2) check (fee_amount is null or fee_amount >= 0);
alter table public.show_dates add column if not exists duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 1440);
```

- [ ] **Step 3: Regenerate types; commit** — `git commit -m "add booking fee and show date duration columns"`

---

### Task 3: Pure library — field resolution, order numbers, money, validation (dual-home)

**Files:**
- Create: `src/lib/hireOrders/types.ts`, `resolveFields.ts`, `orderNo.ts`, `money.ts`, `validate.ts` + a `.test.ts` beside each
- Create: `supabase/functions/_shared/hireOrders.ts` (+ `.test.ts`) — mirror of types + resolveFields + orderNo + money + validate in ONE file (edge convention), header comment pointing at `src/lib/hireOrders/`

**Interfaces (produced; the edge fn, settings tab, V1/V2/V3 and the import wizard all consume these exact names):**

```ts
export type FieldSource = "showflow" | "sheet" | "manual" | "default";
export interface FieldValue<T = unknown> { value: T; source: FieldSource }
export type OrderFieldKey =
  | "artist_name" | "recipient_email" | "role" | "cast"
  | "date" | "venue" | "city" | "duration_min" | "sessions"
  | "fee" | "currency" | "notes";
export type OrderData = Partial<Record<OrderFieldKey, FieldValue>>;
export interface FieldLayers {
  showflow?: Partial<Record<OrderFieldKey, unknown>>;
  sheet?:    Partial<Record<OrderFieldKey, unknown>>;
  manual?:   Partial<Record<OrderFieldKey, unknown>>;
  defaults?: Partial<Record<OrderFieldKey, unknown>>;
}
export function resolveFields(layers: FieldLayers): OrderData;           // manual > sheet > showflow > default
export function formatOrderNo(pattern: string, parts: { prefix: string; date?: string; castCode?: string; seq: number }): string;
export function withCollisionSuffix(orderNo: string, attempt: number): string;  // attempt 0 => unchanged, 1 => "-2", 2 => "-3"
export function formatMoney(amount: string | number, currency: string): string; // "4,500.00" style, tabular-safe
export function orderReadyIssues(data: OrderData, letterhead: unknown): string[]; // [] means ready
```

- [ ] **Step 1: Failing tests** (each file):

```ts
// resolveFields.test.ts
it("applies precedence manual > sheet > showflow > default with source tags", () => {
  const out = resolveFields({
    defaults: { currency: "EUR", fee: "1000" },
    showflow: { artist_name: "Mara", venue: "Colosseum", fee: "2000" },
    sheet:    { venue: "Palladium", fee: "3000" },
    manual:   { fee: "4500" },
  });
  expect(out.artist_name).toEqual({ value: "Mara", source: "showflow" });
  expect(out.venue).toEqual({ value: "Palladium", source: "sheet" });
  expect(out.fee).toEqual({ value: "4500", source: "manual" });
  expect(out.currency).toEqual({ value: "EUR", source: "default" });
});
it("skips undefined and empty-string layer values", () => {
  const out = resolveFields({ showflow: { venue: "X" }, sheet: { venue: "" }, manual: { venue: undefined } });
  expect(out.venue).toEqual({ value: "X", source: "showflow" });
});

// orderNo.test.ts
it("renders the default pattern", () => {
  expect(formatOrderNo("{prefix}-{yyyy}-{mmdd}-{cast|seq}", { prefix: "HO", date: "2026-06-15", castCode: "B1", seq: 7 }))
    .toBe("HO-2026-0615-B1");
  expect(formatOrderNo("{prefix}-{yyyy}-{mmdd}-{cast|seq}", { prefix: "HO", date: "2026-06-15", seq: 7 }))
    .toBe("HO-2026-0615-7");
});
it("suffixes collisions", () => {
  expect(withCollisionSuffix("HO-2026-0615-B1", 0)).toBe("HO-2026-0615-B1");
  expect(withCollisionSuffix("HO-2026-0615-B1", 1)).toBe("HO-2026-0615-B1-2");
});

// money.test.ts
it("formats with two decimals and thousands separators", () => {
  expect(formatMoney("4500", "EUR")).toBe("€4,500.00");
  expect(formatMoney(4500.5, "EUR")).toBe("€4,500.50");
});

// validate.test.ts
it("ready gate requires fee, recipient email, date, and letterhead legal name", () => {
  expect(orderReadyIssues({}, {})).toEqual(expect.arrayContaining([
    "missing_fee", "missing_recipient_email", "missing_date", "missing_letterhead",
  ]));
  const ok = resolveFields({ manual: { fee: "4500", recipient_email: "a@b.de", date: "2026-06-15", artist_name: "M" } });
  expect(orderReadyIssues(ok, { legal_name: "Aurora GmbH" })).toEqual([]);
});
```

- [ ] **Step 2: Implement** — `resolveFields` iterates a fixed `ORDER_FIELD_KEYS` array over layers in precedence order, skipping `undefined` and `""`; `formatOrderNo` does token replacement (`{prefix}`, `{yyyy}`, `{mm}`, `{dd}`, `{mmdd}`, `{cast|seq}` = castCode if present else seq); `formatMoney` uses `Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })` with a currency-symbol map (`EUR: "€", USD: "$", CHF: "CHF "`); `orderReadyIssues` returns string codes only (UI translates to copy).
- [ ] **Step 3: Mirror to `_shared/hireOrders.ts` + Deno tests; run whole Deno suite.**
- [ ] **Step 4: Commit** — `git commit -m "add hire order field resolution and numbering lib"`

---

### Task 4: Settings tab — letterhead, defaults, numbering, terms, countersign mode

**Files:**
- Create: `src/components/settings/hireOrders/HireOrdersTab.tsx`, `LetterheadCard.tsx`, `OrderDefaultsCard.tsx`, `TermsVariantsCard.tsx`, `CountersignCard.tsx` (+ `HireOrdersTab.test.tsx`)
- Modify: `src/pages/SettingsPage.tsx` (new `TabsTrigger value="hire-orders"`, icon `FileSignature`, admin-gated AND `useFeature("hire_orders")`-gated)
- Modify: `src/config/app.config.ts` (export `HIRE_ORDER_DEFAULT_TERMS`, seeded from the design's 4 standard + 4 full clauses, EN copy, no em-dashes)

**Interfaces:**
- Consumes: `upsertOrgSetting`/`resolveOrgSetting` (`src/data/settings.ts`), `useSettingsAudit` (rail), `useFeature`.
- Produces: `app_settings` keys exactly as spec §2.6: `hire_order_letterhead`, `hire_order_terms`, `hire_order_numbering`, `hire_order_defaults`, `hire_order_countersign`. Export `HIRE_ORDER_AUDIT_KEYS = ["hire_order_letterhead","hire_order_terms","hire_order_numbering","hire_order_defaults","hire_order_countersign"]` from `HireOrdersTab.tsx` (the rail and dirty-tracking consume it; mirror `BOOKING_AUDIT_KEYS`, `BookingFlowTab.tsx:29-36`).

- [ ] **Step 1: Failing component test** — renders all five cards; letterhead legal-name input persists via `upsertOrgSetting(supabase, orgId, "hire_order_letterhead", …)`; countersign card offers exactly `manual` and `documenso` radio options with `manual` default; terms card lists three variant sub-editors (lean/standard/full) each with add/remove clause rows `{ title, body }`; tab hidden when `useFeature("hire_orders")` is false.
- [ ] **Step 2: Implement** — compose like `BookingFlowTab` (L126-161): cards in the left column, `FlowRail`-equivalent right rail (reuse the existing rail component if its props allow arbitrary audit keys; otherwise a thin local `HireOrdersRail` calling `useSettingsAudit(HIRE_ORDER_AUDIT_KEYS)`). Draft state per card with explicit Save per card (the PlatformDefaultsTab card idiom), invalidating `["app-settings"]`. Documenso option renders its config UI only in the extended plan; for now selecting `documenso` shows an inline note "Connect Documenso in a later step. Manual marking stays available." and persists the mode.
- [ ] **Step 3: Commit** — `git commit -m "add hire orders settings tab"`

---

### Task 5: Renderer spike — `@react-pdf/renderer` on the live edge runtime (timeboxed 1 day)

**Files:** Create `supabase/functions/hire-order-pdf-spike/index.ts` + `deno.json` + `[functions.hire-order-pdf-spike]` (`verify_jwt = true`) in `config.toml`. Deleted at the end of this task.

- [ ] **Step 1: Build the canary** — a minimal function: `import { renderToBuffer, Document, Page, Text, View, Font } from "npm:@react-pdf/renderer@^4"`; register one font from an in-memory `Uint8Array` (fetch Geist Regular TTF once, commit as base64 in a `fonts.ts` module; NO file-path font loading, `Deno.readFileSync` is blocklisted); render a two-page doc with a table-like `View` grid; return `{ ok: true, bytes: pdf.length }` and the first 8 bytes hex (expect `%PDF-` magic).
- [ ] **Step 2: Deploy via MCP `deploy_edge_function` and invoke with a super-admin JWT.**
Expected pass: HTTP 200, `bytes > 1000`, magic bytes correct, cold-start under ~10s, memory within limits (check function logs via MCP `get_logs`).
- [ ] **Step 3: Record the decision** — edit THIS plan file: check one box below, then implement Task 7 accordingly.
  - [ ] SPIKE PASSED → Task 7 uses `@react-pdf/renderer` (it supersedes pdf-lib).
  - [ ] SPIKE FAILED (note the failure mode here: ______) → Task 7 uses the `pdf-lib` fallback section.
- [ ] **Step 4: Tear down** — delete the spike function folder + config block; `supabase functions delete hire-order-pdf-spike` must be run by the user in a terminal (MCP has no delete) — ask for it in the task summary. Commit: `git commit -m "record hire order renderer spike outcome"`

---

### Task 6: Storage bucket + policies

**Files:** Create `supabase/migrations/<real-ts>_hire_orders_storage.sql`; extend `supabase/tests/hire_orders.sql`.

- [ ] **Step 1: pgTAP** — bucket row exists, `public = false`; an org member's JWT can SELECT an object row under `<their-org-id>/x.pdf` path; a member of another org cannot.
- [ ] **Step 2: Migration**

```sql
insert into storage.buckets (id, name, public) values ('hire-orders', 'hire-orders', false)
  on conflict (id) do nothing;

create policy "Org members read own hire order pdfs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'hire-orders'
    and public.is_org_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );
-- No INSERT/UPDATE/DELETE policies: writes go through the service role only.
```

- [ ] **Step 3: Commit** — `git commit -m "add private hire-orders storage bucket"`

---

### Task 7: Renderer implementation behind the port

**Files:**
- Create: `supabase/functions/_shared/hire-order-pdf/render.tsx` (or `.ts` for pdf-lib branch), `fonts.ts` (base64 Geist Regular/Medium/SemiBold + Geist Mono Regular), `render.test.ts`
- Modify: `supabase/functions/_shared/hireOrders.ts` (add the port type)

**Interfaces:**
- Produces: `export type RenderHireOrderPdf = (input: RenderInput) => Promise<Uint8Array>` and the concrete `renderHireOrderPdf`. `RenderInput = { data: OrderData; orderNo: string; status: "issued" | "preview"; letterhead: { legal_name: string; address_lines: string[]; registration_line?: string; agent_name?: string; agent_email?: string }; terms: Array<{ title: string; body: string }>; currency: string; generatedAtIso: string }`. Task 8 injects this via `Deps`.

- [ ] **Step 1: Failing Deno test**

```ts
Deno.test("renders a parseable pdf with the core fields", async () => {
  const bytes = await renderHireOrderPdf(makeRenderFixture()); // fixture builds a full OrderData
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert(bytes.length > 5_000);
});
Deno.test("preview watermark only in preview status", async () => {
  const issued = await renderHireOrderPdf({ ...makeRenderFixture(), status: "issued" });
  const preview = await renderHireOrderPdf({ ...makeRenderFixture(), status: "preview" });
  assert(preview.length !== issued.length); // watermark layer present
});
```

- [ ] **Step 2: Implement the template** (react-pdf branch) — one `<Page size="A4">` mirroring the design's `HireOrderDoc` structure top-to-bottom: letterhead row (legal name + address left, "Performance hire order" eyebrow + mono order number right), engagement title ("This order confirms the engagement of" + artist name 30pt display + role/cast line), two-column parties grid ("Hiring party" / "Engaged artist"), 4-cell facts strip (Date / Venue / Performance / Engagement fee, fee cell tinted `#F4F1FF`), running-order table from `sessions`, fees block with "Total payable" rule, numbered terms clauses, two signature lines ("For the Producer · <legal_name>" / "The Artist · <artist_name>"), footer (`orderNo · Generated by ShowFlow Pro · date · Page 1/1`). Colors: text `#15131C`, muted `#5B5A57`, faint `#8B8A85`, accent `#4738B0`, lines `#E5E2DA`. Fonts registered from `fonts.ts` bytes. `status === "preview"` adds a rotated 48pt "PREVIEW" text at 8% opacity.
  (pdf-lib fallback branch: same visual contract; build with `PDFDocument.create()`, `embedFont(fontBytes)`, a `drawRow(y, cells)` helper and a layout-constants table `{ margin: 48, colWidths: [...] }`; the tests above are renderer-agnostic and stay identical.)
- [ ] **Step 3: Run whole Deno suite; commit** — `git commit -m "add hire order pdf renderer behind port"`

---

### Task 8: `generate-hire-orders` edge function

**Files:**
- Create: `supabase/functions/generate-hire-orders/index.ts`, `deno.json`, `index.di.test.ts`
- Modify: `supabase/config.toml` (`[functions.generate-hire-orders]` `verify_jwt = false` — cron-secret callers, auth in-function)
- Modify: `supabase/functions/_shared/deps.ts` (add `renderHireOrderPdf: RenderHireOrderPdf` to `Deps` + `realDeps()`; `makeFakeDeps` stubs it with `() => new Uint8Array([0x25,0x50,0x44,0x46])`)

**Interfaces:**
- Consumes: `requireCronOrRole` (`_shared/auth.ts`), `requireFeature`/`checkFeature`, `resolveOrgSetting`, `resolveFields`/`formatOrderNo`/`withCollisionSuffix`/`orderReadyIssues` (Task 3), `renderHireOrderPdf` (Task 7), `deps.sendEmail` (Task 10 wires the template; until then issue skips email behind a template-exists check — NO: order tasks so Task 10 lands BEFORE Task 8 is exercised end-to-end; in this task, email send is implemented against the Task 10 contract and its DI test fakes `sendEmail`).
- Produces (consumed by all UI tasks + the extended plan):
  - `POST { action: "draft", org_id, show_date_id, booking_ids?, notify?: boolean }` → `{ created: string[], skipped: Array<{booking_id, reason}> }`
  - `POST { action: "issue", org_id, order_ids: string[] }` → `{ issued: string[], failed: Array<{order_id, issues: string[]}> }`
  - `POST { action: "preview", org_id, order_id }` → `{ pdf_base64: string }`
  - `POST { action: "download-url", org_id, order_id }` → `{ url: string, expires_in: 3600 }` (artists allowed for their own issued orders)

- [ ] **Step 1: Failing DI tests** (the broad `index.di.test.ts` contract suite, one test per branch):

```ts
Deno.test("draft creates one order per confirmed booking without an active order", async () => { /* fake admin with 2 confirmed bookings, 1 existing active order -> expect 1 insert, 1 skipped(exists) */ });
Deno.test("draft snapshots showflow fields with source tags and org defaults", async () => { /* assert inserted data.venue.source === 'showflow', currency source 'default' */ });
Deno.test("draft 403s when hire_orders entitlement is off", async () => { /* rpc is_feature_enabled false -> 403 feature_disabled */ });
Deno.test("draft with notify inserts hire_orders_ready producer notifications once", async () => {});
Deno.test("issue renders, uploads to hire-orders/<org>/<order_no>.pdf, stamps issued_at, sends email, notifies artist", async () => {});
Deno.test("issue refuses orders failing the ready gate and reports issue codes", async () => {});
Deno.test("issue is idempotent per order (already issued -> failed with 'already_issued')", async () => {});
Deno.test("order number collisions get -2 suffix", async () => {});
Deno.test("preview returns base64 pdf without persisting", async () => {});
Deno.test("download-url allows the linked artist and rejects an unrelated artist", async () => {});
Deno.test("rejects non-cron non-producer callers", async () => {});
```

- [ ] **Step 2: Implement `handle(req, deps)`** — skeleton:

```ts
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const body = await req.json().catch(() => null);
  if (!body?.action || !body?.org_id) return json({ error: "bad_request" }, 400);
  const gate = await requireCronOrRole(deps, req, ["admin", "producer"]);   // match its exact contract in _shared/auth.ts
  if (gate instanceof Response) return gate;
  const denied = await requireFeature(deps, body.org_id, "hire_orders");
  if (denied) return denied;
  switch (body.action) {
    case "draft":        return draftOrders(deps, body);
    case "issue":        return issueOrders(deps, body);
    case "preview":      return previewOrder(deps, body);
    case "download-url": return downloadUrl(deps, req, body);
    default:             return json({ error: "unknown_action" }, 400);
  }
}
if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

Key mechanics (each already test-pinned in Step 1): `draftOrders` loads confirmed bookings for the date (join artist name/email/cast_role, show_date date/venue/duration/sessions, city name), resolves settings (`hire_order_defaults`, `hire_order_numbering`, `hire_order_letterhead`), builds `resolveFields({ showflow, defaults })`, formats the order number (castCode from the show's cast/reference label; seq = count of org orders that day + 1), inserts with retry-on-unique-violation using `withCollisionSuffix` (max 5 attempts). `issueOrders` re-validates `orderReadyIssues`, renders via `deps.renderHireOrderPdf`, uploads `deps.admin.storage.from("hire-orders").upload(path, bytes, { contentType: "application/pdf", upsert: true })`, transitions `ready→issued` (drafts are auto-promoted `draft→ready` first when the gate passes), sends the Task-10 email with attachment + signed URL, inserts the artist notification (only when `artists.user_id` is set), all per-order with per-order error capture. `download-url`: if caller is an artist JWT (no producer role), verify the order's `artist_id` maps to their `artists.user_id` and status is issued/countersigned, then `createSignedUrl(path, 3600)`.
- [ ] **Step 3: Run whole Deno suite; commit** — `git commit -m "add generate-hire-orders edge function"`

---

### Task 9: Fully-filled auto-draft dispatch trigger

**Files:** Create `supabase/migrations/<real-ts>_fully_filled_hire_order_dispatch.sql`; extend pgTAP; update `docs/system-map.md` + `src/data/systemMap.ts`.

- [ ] **Step 1: Read the existing pg_net dispatch pattern** — `grep -rn "net.http_post" supabase/migrations/ | head`, open the newest cron-dispatch migration (the 20260624101342 timeout fix shows the canonical shape: functions URL, `X-Cron-Secret` from Vault, 30000ms timeout). Copy its Vault-read + http_post idiom exactly.
- [ ] **Step 2: pgTAP** — flipping a seeded date's status to `fully_filled` (via updating bookings so `compute_show_date_status` promotes it) with entitlement ON enqueues exactly one `net.http_post` call (assert on the `net.http_request_queue` table count or mock seam used by existing tests — inspect how existing trigger tests assert dispatches; if none do, assert instead that the trigger function exists and `is_feature_enabled` gating short-circuits by testing the trigger fn directly with entitlement off).
- [ ] **Step 3: Migration**

```sql
create or replace function public.dispatch_hire_order_drafts()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
  v_url text;
begin
  if new.status <> 'fully_filled' or old.status = 'fully_filled' then
    return null;
  end if;
  if not public.is_feature_enabled(new.org_id, 'hire_orders') then
    return null;
  end if;
  -- Vault read + URL construction copied from the existing cron dispatch migration.
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  v_url := '<functions-base-url-from-existing-pattern>/generate-hire-orders';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret', v_secret),
    body := jsonb_build_object('action','draft','org_id', new.org_id,'show_date_id', new.id,'notify', true),
    timeout_milliseconds := 30000
  );
  return null;
end $$;

create trigger dispatch_hire_order_drafts
  after update of status on public.show_dates
  for each row
  when (new.status = 'fully_filled' and old.status is distinct from new.status)
  execute function public.dispatch_hire_order_drafts();
```

- [ ] **Step 4: System map (both homes): new trigger node** — `show_dates.status -> fully_filled` → `generate-hire-orders(draft, notify)` → `hire_orders` + `hire_orders_ready` notification, gated by `is_feature_enabled(org,'hire_orders')`, cite the migration. Commit: `git commit -m "dispatch hire order drafts when a date fills"`

---

### Task 10: Email attachments, template, notification category

**Files:**
- Modify: `supabase/functions/_shared/deps.ts` (EmailMessage), `supabase/functions/send-transactional-email/index.ts` (validate + forward), their tests
- Create: `supabase/functions/_shared/transactional-email-templates/hire-order-issued.tsx`; register in `registry.ts`
- Modify: `supabase/functions/_shared/notificationCategories.ts`; create `supabase/migrations/<real-ts>_hire_order_notifications.sql` (SQL `category_of`/`should_notify` additions)
- Modify: `src/components/settings/EmailTemplatesCard.tsx` (`EMAIL_TEMPLATE_KEYS` + `hire-order-issued`)

**Interfaces:**
- Produces: `EmailMessage.attachments?: Array<{ filename: string; content_base64: string }>`; template name `"hire-order-issued"` with `templateData = { artist_name, order_no, date_label, venue, city, fee_label, download_url, countersign_mode, signing_url? }`; notification category `"hire_orders"`; in-app types `hire_orders_ready`, `hire_order_issued`, `hire_order_countersigned`.

- [ ] **Step 1: Failing Deno tests** — send-transactional-email: forwards `attachments` as `[{ filename, content }]` in the Resend body; rejects >2 attachments or any decoded payload >5MB with 400 `attachment_too_large`; omits the key entirely when absent (existing tests must not break). Categories: `categoryOf("hire_order_issued") === "hire_orders"` etc. (match the existing test file for `notificationCategories`).
- [ ] **Step 2: Implement TS side** — `notificationCategories.ts`: add `hire_orders: { label: "Hire orders", description: "Engagement sheets issued to you and their countersign status." }` to `NOTIFICATION_CATEGORIES`; map the three in-app types; map `"hire-order-issued"` in `EMAIL_TEMPLATE_CATEGORY`. Template `.tsx`: copy `org-invitation.tsx` structurally (Html/Container/Heading/Text/Button, brand violet `#7c3aed`); body: greeting, one-line confirmation ("<hirer> has issued your hire order for <date_label> at <venue>."), facts row, CTA button "View and download" → `download_url` (built with `_shared/app-url.ts`, never a hardcoded host), countersign paragraph switching on `countersign_mode` (`manual`: "Reply to confirm or sign and return the attached PDF." / `documenso`: button "Review and sign" → `signing_url`), footer per house template. Subject: `Your hire order for {date_label} at {venue}`. `previewData` filled with the Berlin fixture values.
- [ ] **Step 3: SQL migration** — recreate `category_of()` (and `should_notify` only if it inlines the mapping — check current definitions with `grep -rn "category_of" supabase/migrations/` and copy the newest body) adding: in-app types `hire_orders_ready|hire_order_issued|hire_order_countersigned → 'hire_orders'` and template `hire-order-issued → 'hire_orders'`. Apply via MCP, save file.
- [ ] **Step 4: Run whole Deno suite; commit** — `git commit -m "add hire order email template, attachments, category"`

---

### Task 11: Frontend data access + hooks

**Files:** Create `src/data/hireOrders.ts` + `src/data/hireOrders.test.ts`, `src/hooks/useHireOrders.ts`.

**Interfaces (produced; V1/V3/V4/V5 and artist surfaces consume):**

```ts
fetchHireOrdersForDate(client, showDateId): Promise<HireOrderRow[]>          // ['hire-orders','for-date',id]
fetchHireOrder(client, id): Promise<HireOrderRow>                            // ['hire-orders','detail',id]
fetchMyHireOrders(client, artistIds: string[]): Promise<HireOrderRow[]>      // ['hire-orders','mine',...]
invokeHireOrderAction(client, body): Promise<unknown>                        // functions.invoke('generate-hire-orders', { body })
updateHireOrderStatus(client, id, status): Promise<void>                     // markCountersigned/void via .update()
```

Invalidation rule (mirror the bookings domain): every mutation invalidates the `['hire-orders']` prefix, never sub-keys. `HireOrderRow` = `Database["public"]["Tables"]["hire_orders"]["Row"]` + joined `artists(name)` where needed (isolate `any` at the boundary per house rule).

- [ ] **Step 1: Failing supabaseFake tests** — for-date select filters `show_date_id` + orders by `created_at`; action invoke posts to `generate-hire-orders` with the given body; `updateHireOrderStatus` updates only `status` (+ `countersigned_at` when countersigned).
- [ ] **Step 2: Implement + hooks** — `useHireOrdersForDate(showDateId)`, `useHireOrder(id)`, `useMyHireOrders()` (feeds off `useMyArtist`), `useHireOrderAction()` (`useMutation` invalidating `['hire-orders']` and toasting per result), `useMarkCountersigned()`.
- [ ] **Step 3: Commit** — `git commit -m "add hire order data access and hooks"`

---

### Task 12: V1 — date-sheet card + generate modal

**Files:**
- Create: `src/components/shows/hireOrders/HireOrdersCard.tsx`, `GenerateHireOrderDialog.tsx` (+ `HireOrdersCard.test.tsx`)
- Modify: `src/components/shows/ShowDateDetailSheet.tsx` (mount after Assigned Artists, i.e. after the card ending at ~L775, before `<ChatPanel>` at ~L778)

**Interfaces:**
- Consumes: `useHireOrdersForDate`, `useHireOrderAction`, `useFeature("hire_orders")`, `canManage` (already computed in the sheet, L53), `bookingsForDate` + `showDate` (already loaded in the sheet), `bookingStatusBadgeClass`-style badge helpers.

- [ ] **Step 1: Failing component test** — with a `fully_filled` date and confirmed bookings lacking orders: renders the accent banner "This date is fully filled and ready for hire orders" + button "Generate hire orders"; with existing orders: renders one row per order (artist name, mono order number, status Badge, actions Preview / Issue / Download depending on status); hidden entirely when `useFeature("hire_orders")` is false; the management banner/rows require `canManage` (Task 14 later adds a read-only artist variant to this same card; build it so the producer branch is cleanly separable).
- [ ] **Step 2: Implement** — Card titled "Hire orders": banner (accent-50 background, Sparkles icon) when any confirmed booking lacks an active order (not gated on `fully_filled`; the copy switches: fully filled → "ready for hire orders", else → "Generate for confirmed artists"); rows list orders with status badges (`draft`=secondary, `ready`=accent, `issued`=warning "Awaiting countersign", `countersigned`=success); row actions: draft/ready → "Review and issue" (opens dialog), issued → "Download" (calls `download-url`, opens in new tab) + "Resend" (re-issue action is NOT re-render: calls issue idempotently to resend email only if the fn supports it, else omit Resend until the extended plan) — keep v1 actions to Preview / Issue / Download. `GenerateHireOrderDialog` mirrors the design's V1 modal: read-only fact fields (producer, artist, date, venue, duration, cast), fee input (`Input type="number"` writing to booking + manual layer), terms variant segmented control (Lean/Standard/Full), info note ("The PDF includes the running order and a countersignature block. The artist receives it by email."), footer: Preview PDF (opens base64 in new tab) / Cancel / "Issue and send" (issue action, success toast "Hire order issued to <artist>").
- [ ] **Step 3: Commit** — `git commit -m "add hire orders card and issue dialog to date sheet"`

---

### Task 13: V3 — document viewer page

**Files:**
- Create: `src/pages/HireOrderDetailPage.tsx`, `src/components/hireOrders/OrderTimeline.tsx`, `OrderFactsRail.tsx` (+ page test)
- Modify: `src/config/app.config.ts` (`ROUTES.HIRE_ORDER_DETAIL = "/hire-orders/:id"`, add to `ROUTE_FEATURES` → `hire_orders`), `src/App.tsx` (route, `requiredRoles` admin/producer/artist)

- [ ] **Step 1: Failing test** — page renders order header (mono number + status badge), a PDF `<iframe>`/`<object>` fed by the signed URL, the four-step timeline (Created / Issued to artist / Awaiting countersign / Countersigned with amber active state), recipient card (artist name + email), at-a-glance facts, and the primary action: producer sees "Mark countersigned" on issued orders (calls `useMarkCountersigned`); artist sees "Download PDF" only.
- [ ] **Step 2: Implement** — layout per design V3: header strip (back chevron, title "Performance hire order", badge, Edit disabled placeholder, Download), main grid `1fr 312px`: left = paper-tinted container with the embedded PDF (signed URL refreshed via `useQuery` staleTime 45min), right rail = timeline (map status → steps), recipient, facts, action button. Artists reach this page from notifications; producers from V1 rows. Role gate: artists allowed only when the order is theirs (the RLS already guarantees the fetch fails otherwise — render the standard destructive Alert on error).
- [ ] **Step 3: Commit** — `git commit -m "add hire order detail page with countersign timeline"`

---

### Task 14: Artist surfaces

**Files:** Modify `src/components/bookings/ArtistBookingsView.tsx` (row chip), `src/components/dashboard/ArtistDashboard.tsx` (orders card); tests beside each.

- [ ] **Step 1: Failing tests** — bookings view: rows whose date has an issued order for my artist show a `FileText` chip "Hire order" linking to `ROUTES.HIRE_ORDER_DETAIL`; dashboard: "Your hire orders" card lists issued/countersigned orders (order number, date, venue, status badge, Download) and renders nothing when `useFeature("hire_orders")` is false or the list is empty; date sheet: an artist (no `canManage`) viewing a date with their own issued order sees a read-only "Hire order" card row with a Download action (the producer management card stays hidden from them).
- [ ] **Step 2: Implement** using `useMyHireOrders()`; keep the chip inside the existing `_computed.my_status` cell rendering (ArtistBookingsView L194-203 area). For the date sheet, extend `HireOrdersCard` (Task 12) with an artist variant: when `!canManage` and `useMyHireOrders()` contains an issued/countersigned order for this `showDate.id`, render the read-only row (order number, status badge, Download via the `download-url` action); Task 12's producer behavior is unchanged.
- [ ] **Step 3: Commit** — `git commit -m "surface hire orders to artists"`

---

### Task 15: E2E + docs + PR

**Files:** Create `e2e/hire-orders.spec.ts`; modify `CLAUDE.md` (architecture entries: `data/hireOrders`, settings tab, edge fn categories line), `docs/app-logic.md` (short "Hire orders" domain section).

- [ ] **Step 1: E2E happy path** — seed org with entitlement on: producer confirms the last open slot → date flips fully filled → hire-orders card shows the auto-draft (poll) → producer opens dialog, sets fee, issues → artist session sees the dashboard card and downloads (assert the signed URL responds 200 with `application/pdf`).
- [ ] **Step 2: Push, verify CI green (all five layers), open PR** titled "hire orders core (initiative PRs 2-4)". No version bump yet.

## Self-review checklist

- Spec §§2-9 coverage: schema T1-2, resolver/numbering T3, settings T4, spike T5, storage T6, renderer T7, edge fn T8, trigger T9, delivery T10, data/hooks T11, V1 T12, V3 T13, artist T14, e2e T15. V2/V4/V5, import, Documenso live in `2026-07-17-hire-orders-extended.md`.
- Names consistent: `resolveFields`/`formatOrderNo`/`orderReadyIssues`/`renderHireOrderPdf`/`invokeHireOrderAction` identical across tasks.
- `verify_jwt = false` + `requireCronOrRole` + `requireFeature` on `generate-hire-orders`; artist path only through `download-url`.
