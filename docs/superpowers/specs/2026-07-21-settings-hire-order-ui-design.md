# Settings & hire-order UI improvements — design

**Date:** 2026-07-21
**Branch:** `claude/settings-hire-order-ui-e95721`
**Status:** Approved design, pending implementation plan

Three independent, small-to-medium changes in the Settings / hire-orders area. They can
land as separate commits (and could be separate PRs); Part 1 is the smallest and should
go first.

---

## Part 1 — Fix: cannot type spaces or new lines in Letterhead → Address

### Problem

In `src/components/settings/hireOrders/LetterheadCard.tsx`, the **Address** field is a
controlled `<Textarea>` whose value is derived from the `address_lines: string[]` state
and whose `onChange` re-parses on **every keystroke**:

```ts
function parseLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}
// value  = serializeLines(form.address_lines)   // lines.join("\n")
// change = setForm(f => ({ ...f, address_lines: parseLines(e.target.value) }))
```

Because the value round-trips through `parseLines` on each render:
- a **trailing space** is removed by `.trim()` before it can render, so the space never
  "sticks";
- pressing **Enter** creates a temporary empty line that `.filter(Boolean)` drops, so a
  new line can never be started.

Only the Address field is affected. Legal name and Registration line are plain controlled
`<Input>`s that bind `e.target.value` directly, so they already accept spaces.

### Fix

Edit only the Address field to hold the **raw** textarea string in local state while
editing, and parse into `address_lines` only on **Save**.

- Add local state `addressText: string`, seeded alongside the existing form seed
  (`seededRef`) from `serializeLines(data.address_lines)`.
- `<Textarea value={addressText} onChange={(e) => setAddressText(e.target.value)} />` — no
  transform on change.
- In the save mutation, derive `address_lines` from `addressText`:
  - `split("\n")`
  - trim **trailing** whitespace per line only (`line.replace(/\s+$/, "")`) — preserves
    leading indentation and interior spaces;
  - drop empty lines only from the **top and bottom** of the array, preserving interior
    blank lines (so a blank line can still be used for vertical spacing in the PDF).
- The `parseLines`/`serializeLines` helpers stay for the seed/save transforms; only their
  call sites move (change → save).

### Test (regression, test-first)

Add to the LetterheadCard test suite (co-located):
- Type `"Street 1\n\n10999 Berlin "` into the Address textarea; assert the textarea value
  is exactly that string (spaces and blank line preserved, not collapsed).
- Click Save; assert `upsertOrgSetting` was called with
  `address_lines: ["Street 1", "", "10999 Berlin"]` (trailing space stripped, interior
  blank kept, no leading/trailing blank).

### Files

- `src/components/settings/hireOrders/LetterheadCard.tsx`
- `src/components/settings/hireOrders/LetterheadCard.test.tsx` (new, or add to
  `HireOrdersTab.test.tsx` if that is where LetterheadCard is exercised)

---

## Part 2 — Feature: per-order Agent name + email override

### Today

`agent_name` and `agent_email` are set once, org-wide, in Settings → Hire orders →
Letterhead (`hire_order_letterhead` app_setting). At issue/preview the edge function
`generate-hire-orders` resolves the letterhead org-wide and passes it to
`renderHireOrderPdf`; `render.tsx` prints `Booking agent: {agent_name}` and the email.
There is no per-order agent value — `OrderData` (the `data` JSONB snapshot) does not carry
agent fields, and should not: agent is a hiring-party/letterhead concept, not an
order fact sourced from the showflow/sheet/manual/default layers.

### Behavior (WYSIWYG)

In the **Generate hire order** dialog (`GenerateHireOrderDialog`), add an **Agent** field
group with `Agent name` and `Agent email` inputs:

- On open, both fields are **prefilled with the effective value as real editable text**:
  the order's own stored override if present, otherwise the org letterhead default. (Not a
  grey placeholder — the org default is shown *in* the field until overwritten.)
- Editing a field → that value becomes the per-order override.
- Untouched → remains the org default (persisted as `null` = "inherit", which renders
  identically to the shown default).
- Cleared to blank → the PDF prints **no** agent for that order. The field shows exactly
  what will render.
- Quiet helper hint under the group: *"Prefilled from your organization letterhead."*
  (The earlier "leave blank to use the organization default" wording is dropped — it would
  contradict the now-visible default.)

### Storage

Add two nullable columns to `hire_orders`, mirroring the existing scalar-on-the-row
pattern (`fee_amount`, `terms_variant`, `fee_currency`):

- `agent_name text` (nullable)
- `agent_email text` (nullable)

`null` = inherit the org letterhead. An explicit `""` = print empty (no agent). Migration
via the migration tool; regenerate **both** mirrored type files
(`src/integrations/supabase/types.ts` and
`supabase/functions/_shared/database.types.ts` — byte-equality sync-tested). Existing RLS
on `hire_orders` already covers the new columns; no policy change.

Ships inside the dark `hire_orders` entitlement, so customer impact is nil until enabled,
but the migration does land on prod.

### Data layer

- Extend `HireOrderReview` (`src/data/hireOrders.ts`) with optional
  `agentName?: string | null` and `agentEmail?: string | null`.
- `updateHireOrderReview` writes `agent_name` / `agent_email` when provided, applying the
  blank→persist / effective-value rules below.

### Dialog

- The dialog needs the org letterhead default for the prefill. Load it via
  `resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", …)` through a
  small hook (e.g. `useHireOrderLetterhead(orgId)`) or an inline `useQuery`, reusing the
  existing `Letterhead` type / query key `["app-settings", "hire_order_letterhead", orgId]`.
- Seed `agentName` / `agentEmail` local state to `order.agent_name ?? letterhead.agent_name ?? ""`
  and `order.agent_email ?? letterhead.agent_email ?? ""`.
- Capture `initialAgentName` / `initialAgentEmail` once (the prefill), like the existing
  `initialFeeAmount` / `initialVariant` baseline.
- Extend the existing `persist()` "changed?" check to also fire when
  `agentName !== initialAgentName || agentEmail !== initialAgentEmail`. The dialog includes
  `agentName` / `agentEmail` in the review payload **only for the field(s) that changed**;
  `updateHireOrderReview` writes a column only for a provided key. So:
  - **unchanged** → key omitted → column left intact (`null` stays `null` = inherit the
    org default that was shown);
  - **changed to a value** → that exact string is stored;
  - **cleared to blank** → `""` is stored (prints no agent).
- Place the Agent group after the Terms selector (or grouped with the read-only facts as
  an editable block), styled consistently with the existing fee/terms controls.

### Edge function

In both `issueOne` and `previewOrder` (`supabase/functions/generate-hire-orders/index.ts`):

- Add `agent_name, agent_email` to the order `select` (lines ~627 and ~815) and to the
  `IssueOrderRow` / `PreviewOrderRow` interfaces.
- Before `renderHireOrderPdf`, merge the order override over the resolved letterhead:

  ```ts
  const effectiveLetterhead = {
    ...letterhead,
    agent_name: o.agent_name ?? letterhead.agent_name,
    agent_email: o.agent_email ?? letterhead.agent_email,
  };
  ```

  Pass `effectiveLetterhead` to `renderHireOrderPdf`. `null` inherits; an explicit `""`
  overrides to empty (`render.tsx` already treats a falsy `agent_name` as "no agent line",
  so `""` prints nothing).
- `render.tsx` is unchanged — it already reads `letterhead.agent_name/agent_email`.
- The readiness gate `orderReadyIssues(data, letterhead)` is unaffected (agent is optional).

### Tests

- **Dialog** (`GenerateHireOrderDialog.test.tsx`): agent fields prefill from the letterhead
  default; editing name + email and issuing calls the review mutation with the new
  `agentName`/`agentEmail`; an untouched dialog does not write agent columns.
- **Data** (`src/data/hireOrders.test.ts` or co-located): `updateHireOrderReview` writes
  `agent_name` / `agent_email` per the blank/effective rules.
- **Edge** (`index.di.test.ts`): issue and preview with an order-level agent override call
  `renderHireOrderPdf` with the merged letterhead (overridden agent); with `null` columns
  they inherit the org letterhead.

### Files

- Migration (new) + regenerated `types.ts` (both mirrors)
- `src/data/hireOrders.ts`
- `src/components/shows/hireOrders/GenerateHireOrderDialog.tsx`
- `src/hooks/useHireOrders.ts` (if a letterhead hook is added)
- `supabase/functions/generate-hire-orders/index.ts`
- Tests listed above

---

## Part 3 — Redesign: Settings vertical left nav

### Problem

`SettingsPage` renders ~11 `TabsTrigger`s (icon + label) in a shadcn `TabsList`, which is
`inline-flex` and never wraps. Past ~7 tabs the bar overflows to the right off the content
container. This is a poor fit for a settings surface with this many sections.

### Design

Replace the horizontal `TabsList` with a **two-column layout**: a sticky left rail of
grouped section links, content pane on the right. Keep the Radix `Tabs` root (`value` /
`onValueChange` wiring, keyboard nav, `TabsContent` bodies) — only the list becomes
vertical.

- Left rail: `role="tablist"` vertical (`flex flex-col`), sections grouped under small
  uppercase muted group headers:
  - **Organization** — Organization · Production Ownership · Casts & Cities
  - **Automation** — Airtable Sync · Booking flow · Scheduling · Hire orders
  - **Preferences** — Filters · Notifications
  - **Help** — Documentation
- The Scheduling item keeps its attention dot (`schedulingWarnings > 0`).
- Each item and each group header respects the existing role / entitlement gating
  (`isAdmin`, `isProducer`, `hireOrdersEntitled`). A group header renders only when the
  current role can see ≥1 item within it.
- Layout: `md:grid md:grid-cols-[220px_1fr] md:gap-8`. Widen the page container from
  `max-w-4xl` to fit the rail (e.g. `max-w-5xl`/`max-w-6xl`).
- **Mobile** (`< md`): the rail collapses to a contained, horizontally-scrollable row of
  section pills (`overflow-x-auto`) above the content, so nothing overflows the viewport.
- The page-level Save button / unsaved-changes banner and the Booking-flow tab's own
  scoped rail behavior are unchanged.

Only `src/pages/SettingsPage.tsx` changes. Every tab's content component is untouched.

### Test

Add a focused `SettingsPage` test (or extend an existing one): the grouped nav renders,
switching a section swaps the visible `TabsContent`, and admin-only sections are hidden for
a producer-only role. (jsdom + `renderWithProviders`.)

### Files

- `src/pages/SettingsPage.tsx`
- `src/pages/SettingsPage.test.tsx` (new or extended)

---

## Sequencing

1. Part 1 (bug fix) — smallest, purely a fix.
2. Part 2 (agent override) — migration + edge fn + dialog.
3. Part 3 (settings nav) — layout refactor.

Each part is independently testable and shippable. Standard gates apply: `npm run lint`
(zero warnings), `npx vitest run`, and the Deno edge-function suite
(`--node-modules-dir=none`) for Part 2.
