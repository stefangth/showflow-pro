# Booking Templates and UI Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-coded booking presets with platform-managed templates seeded into new organizations, show customization on the selected template, and deliver the approved Booking Engine, New date, and Airtable UI clarifications.

**Architecture:** A normalized `booking_flow_templates` platform setting owns four flow-and-timing definitions, while each organization stores `booking_flow_template` as its selected identity alongside existing flow and timing rows. Provisioning copies the current Off definition into new org-owned rows. Organization UI compares its draft against the current selected platform definition to derive the Custom badge without cascading template edits into org values.

**Tech Stack:** React 18, TypeScript, TanStack Query, Vitest/Testing Library, Supabase `app_settings`, Deno Edge Functions, pgTAP.

## Global Constraints

- New organizations start on the platform-defined Off template.
- Platform template changes never write through to existing organization settings.
- Remove the standalone Custom tile; place a design-system `Custom` badge beside the selected template name when values diverge.
- Templates include normalized flow policy and the three timing values; Resend sender address stays separate.
- Platform templates may seed portable `show` or `program` reference fields; an org-specific custom-field selection is customization.
- Keep the at-risk watcher, cron cadence, capacity math, Airtable intervals, and Airtable server enforcement unchanged.
- New date Tier 1 opening changes only the in-app create dialog; edit and Airtable paths retain current behavior.
- Use npm only for root dependencies; add no dependency.

---

### Task 1: Normalized booking-template domain model

**Files:**
- Modify: `src/lib/bookingFlow.ts`
- Modify: `src/lib/bookingFlow.test.ts`
- Modify: `supabase/functions/_shared/bookingFlow.ts`
- Modify: `supabase/functions/_shared/bookingFlow.test.ts`

**Interfaces:**
- Produces `BookingTemplateName`, `BookingTemplateDefinition`, `BookingFlowTemplates`, `BOOKING_FLOW_TEMPLATE_DEFAULTS`, `normalizeBookingFlowTemplates(value)`, `bookingTemplateMatches(flow, times, template)`, and `inferBookingTemplate(flow, times, templates)`.
- `BookingTemplateDefinition` is `{ flow: BookingFlow; times: FlowTimes }`; names are `classic | fasttrack | direct | off`.

- [ ] **Step 1: Write failing browser-runtime tests**

Add cases proving malformed JSON falls back per template, Off normalizes inactive, other templates normalize active, exact flow/timing equality matches, timing or flow divergence does not match, and inference returns an exact name or Classic when none match.

```ts
const templates = normalizeBookingFlowTemplates(null);
expect(templates.off.flow.active).toBe(false);
expect(templates.fasttrack.flow.active).toBe(true);
expect(bookingTemplateMatches(templates.classic.flow, templates.classic.times, templates.classic)).toBe(true);
expect(bookingTemplateMatches(templates.classic.flow, { ...templates.classic.times, windowHours: 72 }, templates.classic)).toBe(false);
expect(inferBookingTemplate(templates.direct.flow, templates.direct.times, templates)).toBe("direct");
```

- [ ] **Step 2: Run the browser test and verify RED**

Run: `npx vitest run src/lib/bookingFlow.test.ts`

Expected: FAIL because the template helpers do not exist.

- [ ] **Step 3: Implement the browser model**

Build canonical definitions from existing preset fields plus `BOOKING_ENGINE_DEFAULTS` timing values. Normalize each stored definition independently. Compare every normalized flow field, including `reference_field`, and all timing values.

- [ ] **Step 4: Add the mirrored Edge-runtime implementation and tests**

Mirror the types/defaults/parser in `_shared/bookingFlow.ts`. Run `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/bookingFlow.test.ts`; expect PASS.

- [ ] **Step 5: Run both focused suites and commit**

Run: `npx vitest run src/lib/bookingFlow.test.ts && deno test --allow-all --node-modules-dir=none supabase/functions/_shared/bookingFlow.test.ts`

Commit: `add normalized booking template model`

---

### Task 2: Platform template persistence and editor

**Files:**
- Modify: `src/data/platform.ts`
- Modify: `src/data/platform.test.ts`
- Create: `src/components/platform/BookingTemplatesDefaultsCard.tsx`
- Create: `src/components/platform/BookingTemplatesDefaultsCard.test.tsx`
- Modify: `src/components/platform/PlatformDefaultsTab.tsx`
- Modify: `src/components/platform/PlatformDefaultsTab.test.tsx`
- Modify: `src/components/settings/bookingFlow/FlowTimeline.tsx`
- Modify: `src/components/settings/bookingFlow/FlowTimeline.test.tsx`

**Interfaces:**
- Consumes the Task 1 model.
- Produces `fetchPlatformBookingTemplates(client): Promise<BookingFlowTemplates>` and `savePlatformBookingTemplates(client, templates): Promise<void>` over the platform-only `booking_flow_templates` row.

- [ ] **Step 1: Write failing data tests**

Test a platform-only read, normalized fallback when absent, and a save that upserts `{ org_id: null, key: "booking_flow_templates", value: templates }`.

- [ ] **Step 2: Run data tests and verify RED**

Run: `npx vitest run src/data/platform.test.ts`; expect missing-function failures.

- [ ] **Step 3: Implement focused template data functions**

Keep the legacy scalar reader for compatibility; do not mix the template object into its scalar type.

- [ ] **Step 4: Write failing component tests**

Cover four named tabs, loading one definition, editing a switch and timing field, saving all four without clobbering the other three, and preventing a platform custom-field reference.

- [ ] **Step 5: Run component tests and verify RED**

Run: `npx vitest run src/components/platform/BookingTemplatesDefaultsCard.test.tsx src/components/platform/PlatformDefaultsTab.test.tsx`; expect the card to be absent.

- [ ] **Step 6: Implement the platform editor**

Use design-system Tabs and reuse `FlowTimeline`. Add `allowCustomReference?: boolean` defaulting true and pass false in platform scope. Force active state from the template name. Keep sender address separate and revise legacy cascade copy.

- [ ] **Step 7: Run focused tests and commit**

Run: `npx vitest run src/data/platform.test.ts src/components/platform/BookingTemplatesDefaultsCard.test.tsx src/components/platform/PlatformDefaultsTab.test.tsx src/components/settings/bookingFlow/FlowTimeline.test.tsx`

Commit: `add platform booking template editor`

---

### Task 3: Seed Off and authorize selected-template persistence

**Files:**
- Modify: `supabase/functions/provision-org/index.ts`
- Modify: `supabase/functions/provision-org/index.di.test.ts`
- Create: migration with `supabase migration new booking_template_identity`
- Modify: `src/lib/appSettingCapabilitySql.test.ts`
- Modify: `supabase/tests/rls/app_settings_capabilities.sql`

**Interfaces:**
- Consumes Edge `normalizeBookingFlowTemplates`.
- Produces org-owned `booking_flow`, three timing rows, and `booking_flow_template = "off"` at provisioning.

- [ ] **Step 1: Write failing provisioning tests**

Seed a platform template fake and assert five org rows copy the Off definition. Add absent/malformed-platform fallback coverage.

- [ ] **Step 2: Run provisioning tests and verify RED**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/provision-org/index.di.test.ts`; expect failure because only one flow row is written.

- [ ] **Step 3: Implement best-effort template seeding**

Resolve and normalize platform templates, then upsert all five org rows in one call after successful entitlement seeding. Preserve log-and-continue behavior.

- [ ] **Step 4: Generate the capability migration**

Run `supabase migration new booking_template_identity`. Map `booking_flow_template` to `producer_can_edit_booking_settings`; leave `booking_flow_templates` unmapped and platform-only.

- [ ] **Step 5: Extend SQL twin and pgTAP tests**

Add the org identity key to the exact map. Prove an enabled producer may write it and may not create a platform-template key.

- [ ] **Step 6: Run focused tests and commit**

Run `deno test --allow-all --node-modules-dir=none supabase/functions/provision-org/index.di.test.ts`, `npx vitest run src/lib/appSettingCapabilitySql.test.ts`, and—when the local stack is available—`npm run test:db -- supabase/tests/rls/app_settings_capabilities.sql`.

Commit: `seed off booking template for new organizations`

---

### Task 4: Organization selection, Custom badge, permissions, and alert copy

**Files:**
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/pages/SettingsPage.test.tsx`
- Modify: `src/components/settings/bookingFlow/auditKeys.ts`
- Modify: `src/components/settings/bookingFlow/BookingFlowTab.tsx`
- Modify: `src/components/settings/bookingFlow/BookingFlowTab.test.tsx`
- Modify: `src/components/settings/bookingFlow/FlowPresets.tsx`
- Create: `src/components/settings/bookingFlow/FlowPresets.test.tsx`
- Modify: `src/components/settings/bookingFlow/FlowTimeline.tsx`
- Modify: `src/components/settings/bookingFlow/FlowTimeline.test.tsx`

**Interfaces:**
- Consumes Task 1 helpers and the effective platform template row from SettingsPage.
- Persists `booking_flow_template` with other keys in `BOOKING_AUDIT_KEYS`.

- [ ] **Step 1: Write failing preset-row tests**

Assert four buttons and no Custom tile; the selected customized tile contains a `Custom` Badge; disabled mode disables and greys all buttons.

- [ ] **Step 2: Run preset tests and verify RED**

Run: `npx vitest run src/components/settings/bookingFlow/FlowPresets.test.tsx`; expect failure against the standalone Custom tile.

- [ ] **Step 3: Implement the row**

Use props `active: BookingTemplateName`, `customized?: boolean`, and `disabled`. Render `<Badge variant="secondary">Custom</Badge>` only inside the active tile.

- [ ] **Step 4: Write failing BookingFlowTab tests**

Cover legacy identity inference, selecting a current platform definition, local switch/timing divergence, platform-definition divergence without org mutation, read-only disabling, and exact approved at-risk copy.

- [ ] **Step 5: Run BookingFlowTab tests and verify RED**

Run: `npx vitest run src/components/settings/bookingFlow/BookingFlowTab.test.tsx`; expect hard-coded-preset failures.

- [ ] **Step 6: Implement template-aware organization editing**

Normalize `get("booking_flow_templates")`; resolve identity from `get("booking_flow_template")` or inference; compare draft flow/times; apply selected platform flow/times and identity together. Add the identity key to SettingsPage's editable and booking-audit allowlists.

- [ ] **Step 7: Add approved alert copy**

Use “Alert the production team when the open tier cannot fill the remaining primary slots” and “Checked hourly. An alert is sent when accepted bookings plus live pending offers are fewer than the required primary slots.”

- [ ] **Step 8: Run focused tests and commit**

Run: `npx vitest run src/components/settings/bookingFlow/FlowPresets.test.tsx src/components/settings/bookingFlow/BookingFlowTab.test.tsx src/components/settings/bookingFlow/FlowTimeline.test.tsx src/pages/SettingsPage.test.tsx`

Commit: `make organization booking templates customizable`

---

### Task 5: Make New date Tier 1 offers opt-in

**Files:**
- Modify: `src/components/shows/ShowDateFormDialog.tsx`
- Modify: `src/components/shows/ShowDateFormDialog.test.tsx`

**Interfaces:** No new interface; create-mode state initializes false on every open.

- [ ] **Step 1: Write failing tests**

With `auto_open_tier1: true`, assert create opens unchecked and reopens unchecked; submitting untouched does not open a tier; checking explicitly does. Keep edit auto-open coverage unchanged.

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run src/components/shows/ShowDateFormDialog.test.tsx`; expect the flow effect to check the box.

- [ ] **Step 3: Implement create-only opt-in**

Reset `openOffers` false when create opens and remove flow-driven create initialization. Do not change `shouldAutoOpenTier1` or edit submission.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/components/shows/ShowDateFormDialog.test.tsx`

Commit: `default new date tier one offers to off`

---

### Task 6: Airtable sub-hour warning

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx`
- Modify: `src/components/settings/AirtableSyncTab.test.tsx`

**Interfaces:** Visibility derives from `airtable_poll_interval_minutes < 60`.

- [ ] **Step 1: Write failing tests**

Assert the informational warning at 5, 15, and 30 minutes, its absence at 60, and unchanged autosave behavior.

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx`; expect missing warning copy.

- [ ] **Step 3: Implement exact approved warning**

Render a standard Alert below the frequency controls for sub-hour choices, without blocking selection.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx`

Commit: `warn about frequent airtable sync limits`

---

### Task 7: Cross-runtime verification and documentation

**Files:**
- Modify if stale: `src/data/systemMap.ts`
- Modify if stale: `CLAUDE.md`

**Interfaces:** Consumes all prior tasks; produces no new runtime API.

- [ ] **Step 1: Update stale architecture statements**

Revise only text that still says presets are hard-coded or booking defaults cascade. Keep citations aligned with final paths.

- [ ] **Step 2: Run focused aggregate suites**

Run the changed Vitest files together, then run `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/bookingFlow.test.ts supabase/functions/provision-org/index.di.test.ts`.

Expected: PASS.

- [ ] **Step 3: Run static checks**

Run `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, and `deno check --node-modules-dir=none supabase/functions/*/index.ts`.

Expected: PASS.

- [ ] **Step 4: Run repository verification**

Run: `npm run verify:fast`

Expected: lint, type checks, build, unit coverage, Deno checks, mirrors, and secret scan pass.

- [ ] **Step 5: Review the final diff**

Run: `git diff --check && git status --short && git diff --stat`

Commit documentation if needed: `document platform booking templates`
