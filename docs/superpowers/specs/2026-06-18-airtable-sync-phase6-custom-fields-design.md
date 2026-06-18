# Phase 6 — Custom / Extensible Synced Fields (design)

**Initiative:** Airtable sync engine. **Phase:** 6 (final). **Date:** 2026-06-18.
**Master spec:** [`2026-06-16-airtable-sync-engine-design.md`](./2026-06-16-airtable-sync-engine-design.md) §14.
**ADR:** [`docs/adr/0009-extensible-synced-fields.md`](../../adr/0009-extensible-synced-fields.md) (Accepted), constrained by
[`0003-pooled-multi-tenancy-isolation.md`](../../adr/0003-pooled-multi-tenancy-isolation.md).

This doc supersedes §14 where they differ; the deviations are explicit and listed in
[§Decisions](#decisions-locked-this-session).

---

## 1. Goal

Let an org admin capture Airtable fields beyond the core schema (date / program / sub-program /
city / venue / sessions) as **typed, configurable columns** on `show_dates` — displayed,
**filtered, and sorted** in the producer Shows & Bookings table — without a schema migration per
field and without polluting the pooled tenant schema.

The genuine long-tail candidates in the live German base today are informational fields like
`1. Show`, `2. Show`, `Status`, and a computed `Berechnung` label. (Program / Sub-Programm are
**not** custom — they are core, catalog-linked in Phase 2b.)

## 2. The load-bearing invariant (do not violate)

**Custom fields are display / filter / sort metadata only. They MUST NOT drive booking logic —
eligibility, offers, slots, or status run exclusively on core columns.** If a custom field ever
becomes load-bearing, a developer *promotes* it to a real typed column via the normal migration
path. This invariant is restated in code comments at every custom-field touch point (migration,
poll, page render).

## 3. Decisions locked this session

These refine / deviate from the master spec §14 and are intentional:

| # | Decision | Rationale |
|---|---|---|
| D1 | **Client-side filter/sort** — reuse the app's existing `useMemo` filter/sort over already-fetched rows with type-aware JS comparisons. **No** server-side casts, **no** GIN / expression indexes. | The whole app filters client-side (`ShowsBookingsPage` `filtered` memo, `applySort`, `inTimeframe`). §14's `(custom->>'k')::numeric` + GIN approach solves a problem this app does not have at 50 shows / 200 artists (currently 0 synced rows). Deviates from §14 by omission; revisit only if data volume forces server-side paging. |
| D2 | **Producer bookings table only** (`pageKey: 'bookings-producer'`). Artist/availability pages are untouched. | That is where admins/producers work; no evident artist-facing need. |
| D3 | **One combined PR.** | User choice. Internal task order is sequenced (below); the PR is still reviewable as a stack of commits. |
| D4 | **Editor integration = explicit threading (Fork A).** Custom defs flow through `getColumnDefs` / `getColumnTemplate` / `getColumnLabel` and a new optional `extraDefs` param on `resolveColumnTemplate`. | No hidden module-level global; testable; race-safe on org switch. |
| D5 | **Sort = additive `SortControl` extension (Fork B).** Optional `extraOptions` prop; the shared `SortValue` enum and `applySort` stay intact so no other page that uses `SortControl` is affected. | Smallest blast radius; avoids a second sort control or click-to-sort header rework. |
| D6 | `show_dates` entity only; `artists` / `shows` exist in the `entity` CHECK for forward-compat but are **not** wired. | YAGNI; generalization is purely additive later. |
| D7 | Definition `type` / `source` / `entity` use **CHECK constraints, not new PG enums.** | Keeps the migration additive and the domains easy to widen. |

## 4. Architecture overview

```
Airtable record ──► airtable-poll ──► show_dates.custom (jsonb bag, replace semantics, non-fatal)
                         ▲
                         │ loads (service role)
              custom_field_definitions  ◄── AirtableSyncTab capture card (admin, via src/data/customFields.ts)
                         │ loads (org member, RLS)
                         ▼
              EditorContext ──► getColumnDefs / getColumnTemplate / getColumnLabel
                         │            (custom ColumnDefs, kind:'custom')
                         ▼
              ShowsBookingsPage ──► cellFor 'custom.<key>' + <CustomFieldFilter> + SortControl extraOptions
                         (client-side filter/sort via src/lib/customFields.ts)
```

Two custom-field type definitions exist, one per runtime (no cross-runtime import):
`CustomFieldType = 'text'|'number'|'date'|'boolean'|'select'` in both
`src/lib/customFields.ts` (frontend) and `supabase/functions/_shared/customFields.ts` (Deno).

---

## 5. Component 1 — Database (migration via Supabase MCP)

> Env: no local supabase CLI; apply through the Supabase MCP (`apply_migration`), then
> `list_migrations` to read the **recorded real-timestamp version**, name the migration file to
> match, and regenerate `src/integrations/supabase/types.ts` via MCP. Run a `BEGIN; … ROLLBACK;`
> smoke first. pgTAP is CI-only.

```sql
-- 1. Additive value bag on show_dates
ALTER TABLE public.show_dates
  ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Per-org typed definition registry
CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  entity       text NOT NULL DEFAULT 'show_dates'
                 CHECK (entity IN ('show_dates','artists','shows')),
  key          text NOT NULL CHECK (key ~ '^[a-z0-9_]+$'),
  label        text NOT NULL,
  type         text NOT NULL CHECK (type IN ('text','number','date','boolean','select')),
  source       text NOT NULL DEFAULT 'airtable' CHECK (source IN ('airtable')),
  source_field text NOT NULL,
  options      jsonb,                       -- array of allowed option names for type='select'
  filterable   boolean NOT NULL DEFAULT true,
  sortable     boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, entity, key)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_org
  ON public.custom_field_definitions (org_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_org_entity
  ON public.custom_field_definitions (org_id, entity);

ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;

-- RESTRICTIVE org isolation (uniform tenant template)
CREATE POLICY org_isolation ON public.custom_field_definitions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), org_id))
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

-- PERMISSIVE: org members read (producers need defs to render/filter/sort), admins write
CREATE POLICY "Org members can view custom_field_definitions"
  ON public.custom_field_definitions FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins can manage custom_field_definitions"
  ON public.custom_field_definitions FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'));

CREATE TRIGGER update_custom_field_definitions_updated_at
  BEFORE UPDATE ON public.custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

- **No GIN/expression index** (D1).
- The poll reads definitions with the **service-role** client (bypasses RLS, all orgs). The frontend
  reads under the SELECT policy (org members) and writes under the admin policy.
- `types.ts` regen adds `custom: Json` to `show_dates` Row/Insert/Update and the new
  `custom_field_definitions` table type.

## 6. Component 2 — Sync wiring (`supabase/functions/airtable-poll`)

Pure, Deno-testable coercion in a new shared module
`supabase/functions/_shared/customFields.ts`:

```ts
export type CustomFieldType = 'text'|'number'|'date'|'boolean'|'select';

/** Coerce a raw Airtable field value to a storable custom value. ok:false ⇒ omit the key. */
export function coerceCustomValue(
  raw: unknown, type: CustomFieldType,
): { ok: true; value: string | number | boolean } | { ok: false } {
  if (raw === null || raw === undefined || raw === '') return { ok: false };
  switch (type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'date': {
      const m = String(raw).match(/^\d{4}-\d{2}-\d{2}/);   // Airtable date → YYYY-MM-DD
      return m ? { ok: true, value: m[0] } : { ok: false };
    }
    case 'boolean':
      return { ok: true, value: raw === true };            // Airtable omits checkbox when false
    case 'select':
    case 'text':
      if (typeof raw === 'object') return { ok: false };   // arrays / record-links unsupported
      return { ok: true, value: String(raw) };
  }
}
```

Wiring in `index.ts` (`syncOrg`):

1. **Once per org, before the record loop**, alongside the existing per-org setting reads, fetch
   the org's definitions (service role):
   `from('custom_field_definitions').select('key, source_field, type').eq('org_id', orgId).eq('entity','show_dates').eq('source','airtable')`.
   A failed/empty fetch ⇒ treat as `[]` (non-blocking).
2. **Per record**, build `custom` from those defs: read `fields[def.source_field]`, run
   `coerceCustomValue`; include `custom[def.key]` only when `ok`.
3. **Replace semantics:** set `payload.custom = builtObject` on **both** insert and update, so the bag
   always mirrors current Airtable state for defined fields. **Omit `custom` entirely** when the org
   has zero definitions (don't clobber the default).
4. **Non-fatal:** a missing/uncoercible value omits its key and never affects the
   date/show/city resolution or the `held_unresolved` path.

## 7. Component 3 — Capture UI (`src/components/settings/AirtableSyncTab.tsx`)

New `Card` rendered after the Field-mapping card, gated on `selectedTable`.

- **Data access (new file `src/data/customFields.ts`)** — definitions are a real table, so writes are
  immediate mutations (like the existing catalog-link mutations that bypass the settings draft), **not**
  the `get`/`set` draft used for `airtable_field_map`:

  ```ts
  export interface CustomFieldDefinition {
    id: string; org_id: string; entity: string; key: string; label: string;
    type: CustomFieldType; source: string; source_field: string;
    options: string[] | null; filterable: boolean; sortable: boolean;
  }
  export function fetchCustomFieldDefs(client, args: { orgId: string; entity?: string }): Promise<CustomFieldDefinition[]>;
  export function upsertCustomFieldDef(client, def: Partial<CustomFieldDefinition> & { org_id: string; entity: string; key: string }): Promise<CustomFieldDefinition>;
  export function deleteCustomFieldDef(client, id: string): Promise<void>;
  ```

- **UI behavior:**
  - List existing defs (React Query `['custom-field-definitions', orgId, 'show_dates']`) with
    label / source field / type / filterable / sortable + a remove button.
  - "Add custom field" picks an **unbound** Airtable field from `selectedTable.fields` (i.e. not used
    by `airtable_field_map` and not already a custom def). Auto-suggest `type` from the Airtable field
    type: `number`/`currency`/`percent` → number; `date`/`dateTime` → date; `checkbox` → boolean;
    `singleSelect` → select (carry `options.choices[].name` into `options`); else text.
  - Editable `key` (default = slugified source field, `^[a-z0-9_]+$`, unique per org+entity), `label`
    (default = Airtable field name), `type`, `filterable`, `sortable`.
  - Mutations invalidate the definitions query **and** `['custom-field-definitions', orgId]` (the editor's
    query) so columns refresh.
- **Fallback mode** (PAT lacks `schema.bases:read`): the card depends on `selectedTable`, which only
  exists in schema-accessible mode — so, like the Field-mapping card, it does not render in fallback.
  Free-text custom-field entry in fallback is **out of scope** for this phase.

## 8. Component 4 — Editor surfacing (Fork A: explicit threading)

**`src/features/editor/types.ts`** — extend `ColumnDef`:

```ts
export interface ColumnDef {
  id: string;            // 'custom.<key>' for custom columns
  table: string;         // 'custom' for custom columns
  column: string;        // '<key>' for custom columns
  kind?: 'static' | 'custom';     // default 'static'
  customType?: CustomFieldType;   // present when kind === 'custom'
  defaultVisible: boolean;
  defaultOrder: number;
}
```

**`src/features/editor/columnRegistries.ts`** — `resolveColumnTemplate` gains an optional `extraDefs`:

```ts
export function resolveColumnTemplate(
  pageKey: string, role: AppRole, savedTemplates: ColumnTemplates,
  extraDefs: ColumnDef[] = [],
): ColumnTemplate[] {
  const defs = [...pageColumnDefs(pageKey), ...extraDefs];
  // …unchanged validId/merge/order logic, now over `defs`…
}
```

Add a page→entity allowlist (D2/D6):

```ts
export const CUSTOM_FIELD_PAGES: Record<string, string> = { 'bookings-producer': 'show_dates' };
```

**`src/features/editor/EditorContext.tsx`:**

- New `useQuery(['custom-field-definitions', orgId], () => fetchCustomFieldDefs(supabase, { orgId }))`
  (all entities for the org; cheap). Expose the raw list via context as `customFieldDefs`.
- `customDefsForPage(pageKey)`: if `pageKey` in `CUSTOM_FIELD_PAGES`, map that entity's defs to
  `ColumnDef[]` (`id: 'custom.'+key`, `table:'custom'`, `column:key`, `kind:'custom'`,
  `customType:type`, `defaultVisible:false`, `defaultOrder` after static).
- `getColumnDefs(pageKey)` = `[...pageColumnDefs(pageKey), ...customDefsForPage(pageKey)]`.
- `getColumnTemplate(pageKey, role)` = `resolveColumnTemplate(pageKey, role, columnTemplates, customDefsForPage(pageKey))`.
- `getColumnLabel(colId)`: add a `custom.*` branch returning the def's `label` (from a
  `Map<columnId,label>` built off `customFieldDefs`) **before** the `columnDescriptions` lookup.
- Add `customFieldDefs` (and a `getCustomFieldDefs(entity)` helper) to `useEditorConfig()`'s
  return so pages can read def metadata (type, options, filterable, sortable) for cells/filters/sort.

`ColumnLayoutEditor` and `useColumnHeaders` need **no changes** — custom columns arrive through the
same `getColumnTemplate` / `getColumnLabel` they already consume (hidden by default, toggleable).
*(Verify `ColumnLayoutEditor` lists hidden columns for toggling — it does today.)*

## 9. Component 5 — Page render + client-side filter/sort (`ShowsBookingsPage.tsx`)

**Pure helpers (new `src/lib/customFields.ts`, vitest-covered):**

```ts
export type CustomFieldType = 'text'|'number'|'date'|'boolean'|'select';
export function formatCustomValue(value: unknown, type: CustomFieldType): string;        // display; null → '—'
export function compareCustomValues(a: unknown, b: unknown, type: CustomFieldType): number; // sort
export type CustomFilterState =
  | { kind: 'text'; q: string }
  | { kind: 'select'; value: string | null }
  | { kind: 'number'; min: number | null; max: number | null }
  | { kind: 'date'; from: Date | null; to: Date | null }
  | { kind: 'boolean'; value: boolean | null };
export function customFilterMatches(value: unknown, type: CustomFieldType, filter: CustomFilterState): boolean;
```

**Page changes:**

- Query `select` adds `custom`; `ShowDateRow` gains `custom: Record<string, unknown> | null`.
- Read the page's show_dates custom defs from `useEditorConfig().getCustomFieldDefs('show_dates')`;
  build a `Map<columnId, def>` for cell type lookup + the filterable/sortable lists.
- `cellFor` `default` branch: if `colId` starts with `custom.`, render
  `formatCustomValue(sd.custom?.[colId.slice(7)], def.customType)`. (Comment the boundary invariant here.)
- **Filter:** one generic `<CustomFieldFilter def value onChange>` (new
  `src/components/filters/CustomFieldFilter.tsx`) switching control by type — select→dropdown
  (options from `def.options`), text→contains `Input`, number→min/max, date→reuse `TimeframeFilter`,
  boolean→tri-state `Select`. Render one per `filterable` def in the filter bar; keep a
  `customFilters: Record<columnId, CustomFilterState>` state; AND each active predicate into the
  `filtered` memo via `customFilterMatches`.
- **Sort (Fork B):** `SortControl` gains optional `extraOptions?: { value: string; label: string }[]`;
  the page passes `sortable` defs as `{ value: 'custom:'+key, label: 'Custom: '+label }`. Page sort
  state widens locally to `SortValue | { customKey: string; dir: 'asc'|'desc' }`; the `filtered` memo
  branches to `compareCustomValues` for custom sorts and `applySort` otherwise. `SortValue` enum and
  `applySort` are unchanged.

## 10. Testing

| Layer | Coverage |
|---|---|
| **pgTAP** (CI) | `custom_field_definitions`: org-isolation (member sees own org rows only), admin-only write (producer/artist denied), `UNIQUE(org_id,entity,key)`, `key` CHECK rejects bad slugs, `entity`/`type`/`source` CHECKs; `show_dates.custom` defaults to `'{}'`. |
| **Deno** | `coerceCustomValue` per type incl. reject paths; `airtable-poll` writes the `custom` bag, replace semantics, and stays non-fatal when a source field is missing/malformed (existing `makeFakeDeps` harness). |
| **Vitest** | `lib/customFields` (`formatCustomValue`/`compareCustomValues`/`customFilterMatches` per type); `data/customFields` fetch/upsert/delete via `supabaseFake`; `resolveColumnTemplate` with `extraDefs` (custom survives validation, ordering, saved-template merge); `getColumnLabel` custom branch. |
| **Component** (vitest + RTL) | Producer table renders a custom column; a custom filter narrows rows; a custom sort reorders rows. Use `renderWithProviders` + fixtures. |

Test-first throughout (failing test before implementation), per CLAUDE.md.

## 11. Out of scope / deferred

- Server-side filter/sort, GIN / expression indexes (D1).
- `artists` / `shows` custom fields and any non-producer surface (D2/D6).
- Free-text custom-field capture in schema-`fallback` mode.
- The **promotion path** ("turn a custom field into a real column") — ADR-0009 action item #2; a docs
  follow-up, not code in this PR. Add a short note to `docs/app-logic.md` referencing it.

## 12. Task order (single PR, sequenced commits)

1. Migration (`show_dates.custom` + `custom_field_definitions` + RLS) via MCP; regen `types.ts`; pgTAP.
2. `_shared/customFields.ts` (`coerceCustomValue`) + Deno tests; wire `airtable-poll`; Deno poll test.
3. `src/data/customFields.ts` + vitest; `src/lib/customFields.ts` + vitest.
4. Editor threading (`types.ts`, `columnRegistries.ts`, `EditorContext.tsx`) + vitest.
5. Capture card in `AirtableSyncTab` (mutations + auto-typing).
6. `ShowsBookingsPage` render + `CustomFieldFilter` + `SortControl` extension; component tests.
7. `docs/app-logic.md` note (promotion path + that custom fields never drive booking logic).

## 13. Open questions

None blocking. Resolved this session: storage (table + jsonb), filter/sort locus (client-side),
surfaces (producer only), delivery (one PR), editor mechanism (Fork A), sort UX (Fork B),
boolean source (`checkbox`), domains via CHECK not enums.
