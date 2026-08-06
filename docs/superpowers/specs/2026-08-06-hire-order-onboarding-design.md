# Hire order onboarding: readiness rail and issue preflight

Date: 2026-08-06
Branch: `claude/hire-order-onboarding-comparison-342ec1`
Design source: Claude Design project "Hire order onboarding approaches", frame `1a`
(Readiness rail), with the per-order blocker surfacing from frames `1b` and `1c`.

## Problem

The hire-orders module ships dark and, once an org turns it on, there is **no onboarding
anywhere in the app**. There is no checklist, no first-run surface, no setup prompt. The
org lands on `/hire-orders` with an empty table and no indication that anything must be
configured.

Three concrete failures follow.

1. **A guaranteed first-issue failure.** `HIRE_ORDER_DEFAULT_TERMS`
   (`src/config/app.config.ts:143`) is three templates with **zero clauses each**, and
   `issueOne` rejects an order whose resolved variant has no clauses with `missing_terms`
   (`supabase/functions/generate-hire-orders/index.ts:1747`). Every new org therefore hits
   a hard stop on its first issue.
2. **The stop is discovered after the click.** `OrderSlideOver.handleIssue` fires `issue`
   blind; the failure comes back as a `toast.error` built from `ISSUE_FAILURE_COPY`
   (`src/hooks/useHireOrders.ts:140`). The producer learns what was wrong only after
   trying, and the copy points at "Settings" without taking them there.
3. **Nothing tells a producer they are blocked by someone else.**
   `producer_can_edit_hire_order_settings` defaults **false**
   (`src/lib/capabilities.ts:52`), so on most orgs a producer cannot fix letterhead or
   terms at all and has no way to see that.

The gate itself is sound and is not the problem. `orderReadyIssues` is called at exactly
one place server-side, inside `issueOne`; none of the four draft paths gate on readiness.
"Draft always, block only at Issue" is already the implemented contract. This spec makes
that existing contract **visible ahead of the click** instead of reporting it afterwards.

## Goals

- An org can go from module-on to first issued order without opening Settings, and without
  ever hitting a failure it could not have seen coming.
- The three org-level prerequisites (letterhead, terms, countersign decision) are set from
  a persistent rail beside a working page, writing through the **same** data path as the
  Settings cards, so the two surfaces cannot drift.
- Real starter terms exist at platform level and can be imported into an org in one click.
- Per-order blockers surface **before** the Issue action, with an inline fix where the
  viewer is permitted to make it and an explicit "admin only" state where they are not.
- Nothing about the server contract, the readiness rule, the signing model, or the PDF
  changes.

## Non-goals

- **No new countersign mode.** The design frame offers "confirm by click only"; that does
  not exist and building it would touch the electronic-countersign DB gate, the
  `issue_snapshot` freeze, and the hand-maintained consent-text mirror. Decided: keep
  `manual` | `electronic` and rewrite the step copy. See §4.
- **No logo field.** The design frame shows a "Logo" dropzone in the letterhead panel.
  There is no `logo` on the `Letterhead` interface and none in `pdfTheme`. Out of scope.
- **No nav badge.** The design frame adds a "New" pill to the Hire orders nav item.
  `NavBadge` is a single-value union already carrying `awaitingCountersign`. Dropped.
- **No new routes and no artist nav entry.** The artist frame is a single order, and
  `/hire-orders/:id` is already artist-accessible (`src/App.tsx:63`). It is a restyle.
- **No HTML re-render of the document.** The design frames draw the document as HTML for
  mockup convenience. The PDF is the legal artifact and has a whole theme/renderer system
  behind it. Every surface keeps embedding the real PDF.
- **No migration.** Nothing here needs schema, RLS, or a DB function change. See §2.4.

---

## 1. Org setup status

A new pure module, `src/lib/hireOrders/setupStatus.ts`, derives "what still has to happen
before this org can issue" from resolved settings. It is the single client-side source for
the rail, and it is deliberately **separate from** `orderReadyIssues`.

The two answer different questions and must not be merged:

| | `orderReadyIssues` (exists) | `computeSetupStatus` (new) |
|---|---|---|
| Scope | one order | the whole org |
| Inputs | `OrderData` + letterhead | letterhead + terms + countersign row |
| Codes | `missing_fee`, `missing_recipient_email`, `missing_date`, `missing_letterhead` | `letterhead`, `terms`, `countersign` |
| Mirrored to edge | Yes | No, client-only |

They overlap on letterhead only. `computeSetupStatus` is client-only because it drives a
UI affordance; the authoritative gate stays exactly where it is.

### Step semantics

- **`letterhead`** is done when `legal_name` is non-blank. This matches the
  `missing_letterhead` rule in `orderReadyIssues` exactly, and must keep matching it.
  `blocksIssue: true`.
- **`terms`** is done when `resolveTermsClauses(setting, defaultTemplateId(setting))`
  returns at least one clause. This matches the `missing_terms` rule the edge function
  applies at `index.ts:1747`. `blocksIssue: true`.
- **`countersign`** is done when the org has **its own** `hire_order_countersign` row, that
  is, someone made an explicit decision. Inheriting `COUNTERSIGN_DEFAULT` (`manual`) is
  not a decision. `blocksIssue: **false**` — manual mode issues perfectly well.

That last distinction matters and the rail must show it: two steps carry a "Blocks issue"
chip, the third does not. A checklist that claims three blockers when there are two trains
the user to distrust it.

### Shape

```ts
export type SetupStepKey = "letterhead" | "terms" | "countersign";

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
  /** Whether leaving this undone will make `issue` fail. */
  blocksIssue: boolean;
}

export interface HireOrderSetupStatus {
  steps: SetupStep[];        // always all three, in rail order
  doneCount: number;
  totalCount: number;        // 3
  /** Every blocking step is done: the org can issue. */
  canIssue: boolean;
  /** Every step is done, blocking or not: the rail can retire. */
  complete: boolean;
}
```

## 2. Platform terms library

### 2.1 Decision: a separate key, imported explicitly

Terms live under `hire_order_terms`, which already resolves org row → platform default →
code fallback in both runtimes (`src/data/settings.ts:36`,
`supabase/functions/_shared/settings.ts:25`). Putting starter templates on that key as a
platform default would make every non-overriding org inherit them silently.

**Rejected.** These are contract clauses printed on a legal document. Under silent
inheritance, a super-admin editing the platform templates would change the terms every
non-overriding org issues from that moment on, with no signal to those orgs. That is not
acceptable for contract text.

**Chosen:** a distinct platform-only key, `hire_order_terms_library`, holding a catalogue
of templates that an org **copies** into its own `hire_order_terms`. The org then owns a
frozen copy it can edit. Later platform edits never reach an org that already imported.

### 2.2 Resolution

```
hire_order_terms_library  =  platform app_settings row (org_id IS NULL)
                          ?? HIRE_ORDER_STARTER_TERMS  (code constant)
```

Read from the client with the existing `resolveOrgSetting(client, null, ...)`. No new
data path.

### 2.3 Starter content

`src/lib/hireOrders/starterTerms.ts` exports `HIRE_ORDER_STARTER_TERMS`, two templates:

| id | name |
|---|---|
| `platform-standard-engagement` | Standard engagement |
| `platform-guest-per-session` | Guest artist, per session |

Ids are prefixed `platform-` deliberately. Orders persist `terms_variant` as a free-form
id, and reusing the bare id `standard` would collide with the legacy `lean` / `standard` /
`full` branch in `normalizeTermsSetting`, which silently rewrites that shape. The CHECK
constraint that once made free-form ids fail was dropped in
`20260724160549_drop_hire_orders_terms_variant_check.sql`, so prefixed ids are safe.

> **The clause text in this spec is a drafting starting point and has not had legal
> review.** It is written to be product-agnostic and jurisdiction-neutral, per the
> "no tenant coupling" rule in CLAUDE.md. Treat legal sign-off as a release gate, not an
> implementation gate: the code path does not change if the wording does.

### 2.4 Why no migration

The library is a platform `app_settings` row, and `org_isolation` on `app_settings`
already reads `org_id is null or is_org_member(...)` for SELECT with
`is_org_member(...)` for WITH CHECK, and `is_org_member` has a super-admin arm
(`20260603150000_drop_user_roles_and_has_role.sql:17`). So platform rows are readable by
every member and writable by super-admins today.

`app_setting_capability('hire_order_terms_library')` returns `null`, which the write
policies treat as admin-only. That is the correct fail-safe: producers must not edit the
platform library.

Shipping the starter content as a **code constant** rather than a seeded row means no
environment needs a manual data step. Given that migrations in this repo are applied
manually and have caused production incidents when a merge outran the apply, a feature
that needs no migration at all is the right shape.

### 2.5 Editing the library

A `HireOrderTermsLibraryCard` is added to `PlatformDefaultsTab`, following the four cards
already there (`StarterCatalogCard`, `BookingEngineDefaultsCard`, `AirtableDefaultsCard`,
`DefaultModulesCard`): `resolveOrgSetting(supabase, null, key, fallback)` to read,
`savePlatformSetting` to write, seed-once via `seededRef`.

### 2.6 Import

`importTermsTemplates(client, { orgId, current, templates })` appends the chosen library
templates to the org's existing `hire_order_terms.templates` and sets `default_id` to the
first imported template when the org has no live default. It **appends**, never replaces:
an org that already wrote its own templates must not lose them by clicking an import
button.

Ids collide only if the same library template is imported twice; on re-import of an
existing id, the existing org template is left untouched.

## 3. Wiring the Settings cards into the rail

The rail must not become a second write path. Every card in
`src/components/settings/hireOrders/` does the identical thing today: `useQuery` over
`resolveOrgSetting` → seed local form once via `seededRef` → `useMutation` over
`upsertOrgSetting` → toast → invalidate `["app-settings"]`. That is the reusable part.

### 3.1 Structure

```
src/components/settings/hireOrders/
  fields/LetterheadFields.tsx  NEW  presentational, with a `children` slot
  fields/CountersignFields.tsx NEW  presentational
  fields/TermsLibraryPicker.tsx NEW presentational library picker
  LetterheadCard.tsx        MOD  Settings shell: LetterheadFields + agent block as children
  CountersignCard.tsx       MOD  Settings shell over CountersignFields
  TermsVariantsCard.tsx     MOD  gains an "Import from library" affordance

src/lib/hireOrders/
  letterhead.ts             NEW  linesFromText / serializeLines / mergeLetterhead

src/components/hireOrders/setup/
  SetupRail.tsx             NEW
  SetupStepRow.tsx          NEW
  LetterheadStep.tsx        NEW  rail shell: LetterheadFields with no children
  TermsStep.tsx             NEW  rail shell over TermsLibraryPicker
  CountersignStep.tsx       NEW  rail shell over CountersignFields
  ProducerWaitingCard.tsx   NEW
  useRailDismissed.ts       NEW
```

### 3.2 Why letterhead and countersign are shared components but terms is not

Letterhead compact is a strict subset of letterhead full: the same fields, fewer of them.
So `LetterheadFields` owns the three shared fields and takes a `children` slot; Settings
passes its agent name, agent email and signature-upload block into it, and the rail
passes nothing. That is the whole compact-versus-full difference, expressed without a
variant enum that both call sites would have to keep interpreting the same way.
Countersign is small enough that the rail shows the whole thing, so it needs neither.

Terms is different in kind. Settings has a full clause editor (add / remove / reorder
clause title and body). The rail has a **picker over the platform library**. Those are not
the same UI at two densities; they are two UIs. So `TermsLibraryPicker` is a new
component used in three places: the rail step, the preflight sheet (§5), and as an
"Import from library" affordance inside `TermsVariantsCard` so Settings gains the same
one-click start.

### 3.3 The merge rule

`LetterheadFields` renders `legal_name`, `address_lines`, `registration_line`. Without
the Settings agent block as children it omits `agent_name`, `agent_email`,
`agent_signature_path`, which is what the rail renders.

**The rail's save must merge onto the currently stored value, never replace it.** Saving
`{legal_name, address_lines, registration_line}` alone would null out an agent signature
that an admin had configured in Settings. This is the single most likely defect in this
change and carries a dedicated regression test.

### 3.4 Gating

One gate, read once, passed down as `readOnly`:

```ts
const canEditSettings = useCan("edit_hire_order_settings");
```

`useCan` returns `true` for admins unconditionally. A producer on an org that has enabled
`producer_can_edit_hire_order_settings` gets the full rail; a producer on a default org
gets `ProducerWaitingCard`. No role branching anywhere in the rail.

This mirrors, but does not enforce, the RLS in
`20260723190624_app_settings_capability_rls.sql`. The server is the enforcement.

### 3.5 Change history comes free

`HIRE_ORDER_AUDIT_KEYS` already lists all three keys, and the Settings tab's change-history
rail reads it via `useSettingsAudit`. Because the rail writes through `upsertOrgSetting` on
the same keys, rail edits appear in Settings history with no extra work. This is the
concrete payoff of refusing a second write path.

## 4. Countersign step copy

The design frame's two options ("Draw or type a signature" / "Confirm by click only") do
not map onto the implemented modes. The implemented pair is:

| stored | design-frame-aligned label | sub-label |
|---|---|---|
| `electronic` | Artist signs in ShowFlow | Signature, timestamp and IP are stored with the order. |
| `manual` | Signatures handled outside ShowFlow | A producer marks the order countersigned once it is signed. |

The rail step keeps position 3, keeps its number, and carries **no** "Blocks issue" chip.

## 5. Per-order preflight

Two surfaces, both over one new pure module `src/lib/hireOrders/preflight.ts`, which
combines the existing `orderReadyIssues` with the terms-variant liveness check that
`HireOrderEditPage` already performs inline (`HireOrderEditPage.tsx:456-462`), and tags
each blocker with whether *this viewer* can fix it.

```ts
export type BlockerKey =
  | "missing_fee" | "missing_recipient_email" | "missing_date"
  | "missing_letterhead" | "missing_terms";

export interface Blocker {
  key: BlockerKey;
  /** Fixable from the order itself (fee, email, date) vs an org setting. */
  scope: "order" | "org";
  /** Whether the current viewer may fix it: order scope always, org scope by capability. */
  fixable: boolean;
}

export function computeBlockers(input: {
  data: OrderData;
  letterhead: unknown;
  terms: HireOrderTermsSetting;
  termsVariant: string | null;
  canEditSettings: boolean;
}): Blocker[];
```

`computeBlockers` calls `orderReadyIssues` rather than re-deriving it. That keeps one rule
in one place: if the edge function's gate changes, only the mirror pair moves and
`computeBlockers` follows automatically.

### 5.1 Contextual callout on the edit page (design frame 1b)

`HireOrderEditPage` already renders `[428px_1fr]` fields-left / live-PDF-right with a
debounced 800ms preview, and already computes `orderReadyIssues` at line 451. The frame's
"The header is a placeholder → Use it" becomes a `SetupCallout` above the preview pane,
shown when an **org-scope** blocker is present, offering the one-click fix that the rail
step offers. It is exactly the same write, at the moment the gap is visible on the
document.

### 5.2 Preflight sheet at the Issue click (design frame 1c)

`OrderSlideOver.handleIssue` stops firing blind. Clicking Issue opens
`IssuePreflightSheet`:

- Zero blockers: a one-line confirmation and Issue proceeds.
- Blockers with `fixable: true`: an inline control per blocker (fee input, letterhead legal
  name input, terms library picker), and a disabled "Issue and send" until clear.
- Blockers with `fixable: false`: an "Admin only" state, no control, and the sheet keeps
  "Keep as draft" as the way out.

### 5.3 Batch issue

`OrdersTable` bulk-selects and issues N orders. The frame's sheet is single-order and does
not answer this. `BatchIssuePreflightDialog` shows a per-order summary
("3 of 7 can be issued now, 4 need a fee") and issues **only the clean subset**, leaving
the blocked rows selected so they can be fixed and retried. This preserves the existing
behaviour in `OrdersTable`'s `onSuccess`, which already re-checks failed ids deliberately.

### 5.4 The producer rail copy

The design frame names the admin ("Katrin Behrens · admin") and offers "Nudge Katrin".
`list_org_members` is admin-guarded and raises `42501` for producers
(`20260604160000_org_member_management.sql:8`), so naming them needs a new RPC, and the
nudge needs a new notification type plus rate limiting.

**Decided: generic copy, no name, no nudge, for this release.** `ProducerWaitingCard`
reads "An admin needs to finish setup before orders can be sent." Naming and nudging are a
separate, self-contained follow-up that does not block anything here.

## 6. Empty state

The `HireOrderReadyBanner` on Shows & Bookings stays where it is
(`ShowsBookingsPage.tsx:279`). The Hire orders page therefore should not grow a second,
richer "generate now" CTA for the same dates.

The design frame's per-artist ready list would need a new join (show_dates → confirmed
bookings → artists → venue/city) plus per-date fee resolution;
`useDatesReadyForHireOrder` returns only `readyIds` and coverage. **Decided: the empty
state is a compact pointer** using the existing `readyIds.length`, linking to Shows &
Bookings. Upgrading to the full list later is additive and touches one component.

## 7. Rail dismissal

The rail has a "Hide" affordance. `app_settings` is org-scoped, so storing dismissal there
would hide the rail for every admin in the org at once.

**Decided: `localStorage`, keyed `showflow.hireOrderSetup.hidden.<orgId>`**, matching the
`showflow_editor_mode` and `showflow.currentOrg` precedent in `AuthContext`. It does not
follow a user across devices; that is an accepted limitation for a surface that retires
itself once setup is complete. A DB-backed per-user UI-state table is the durable answer
and is out of scope.

The rail is additionally suppressed whenever `setupStatus.complete` is true, so the common
case never needs a dismissal at all.

## 8. Artist signing surface

`HireOrderDetailPage` keeps the embedded real PDF, the facts rail and the timeline. The
artist branch changes only in that the signing affordance moves out of the
`SignHireOrderDialog` modal into an inline strip directly below the document, per the
design frame.

`canArtistSign` (`src/lib/hireOrders/signing.ts`) is unchanged, the consent text is
unchanged, and the `SignaturePad` component is reused as-is. This is presentation only.

---

## Test plan

| Layer | What |
|---|---|
| Unit | `computeSetupStatus` over the three settings, including the "inherited default is not a decision" case for countersign |
| Unit | `computeBlockers`: order-scope vs org-scope, `fixable` under both capability values, and that it delegates to `orderReadyIssues` |
| Unit | `importTermsTemplates` appends rather than replaces, and no-ops on a duplicate id |
| Unit | `HIRE_ORDER_STARTER_TERMS` contains no em dash or en dash in any title or body |
| Data | `hasOrgSettingRow` against `supabaseFake` |
| Component | Rail renders three steps, two carrying "Blocks issue"; retires when complete |
| Component | **Regression: the compact letterhead save preserves `agent_signature_path`** |
| Component | `ProducerWaitingCard` renders when `edit_hire_order_settings` is false |
| Component | `IssuePreflightSheet` disables Issue while a blocker stands, and shows "Admin only" for an org blocker a producer cannot fix |
| Component | `BatchIssuePreflightDialog` issues only the clean subset |

No pgTAP and no Deno tests: nothing in this spec changes the database or an edge function.

## Rollout

Everything sits behind the `hire_orders` entitlement, which defaults off. Ships dark.

Changelog: the newest shipped block is `1.13.0` (July 25, 2026). This is user-facing
feature work, so it is a MINOR bump. If both plans land on the same calendar day they
fold into **one** version entry with multiple `### New` / `### Improved` sections, never
one patch version each. Bump `version` in `package.json` and `APP_META.VERSION` in
`src/config/app.config.ts` to match, and regenerate `public/changelog.json` with the deno
script rather than hand-editing it.

Nothing here is super-admin facing except the platform terms-library card, which per the
changelog rules must **not** be mentioned in `public/changelog.md` at all.
