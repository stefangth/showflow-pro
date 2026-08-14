# i18n Phase 2 — Dashboard namespace, Help-center wiring, docs gating, dark language pack

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the dashboard-only UI surfaces to a new `dashboard` i18next namespace, point every "how this org works / what is still outstanding" explainer at the new Help center, gate Settings → Documentation to super-admins, and ship a dark super-admin `language_packages` entitlement that gates the whole language switcher.

**Architecture:** Four independent workstreams that share one branch (`claude/pr-280-phase-2-8e84dd`). (A) A `language_packages` entitlement (`defaultEnabled: false`) gates the account-menu language picker and forces English while off — this is what lets the still-rough German ship invisibly. (B) The `dashboard` namespace migrates only genuinely dashboard-scoped surfaces (the two big composers `stageChain.ts`/`moduleOnboarding.ts` are shared with the bookings/hire setup rails and are explicitly deferred to a later `onboarding` namespace PR). (C) All five `?tab=docs` explainer links repoint to `ROUTES.HELP`. (D) Settings → Documentation becomes super-admin-only across trigger, content, and deep-link layers.

**Tech Stack:** React 18 + Vite + TS, react-i18next (already configured in `src/i18n/`), Vitest + jsdom, Supabase (one new migration for the SQL entitlement twin), `i18next-parser` (new dev tooling).

**Spec:** `docs/superpowers/specs/2026-08-14-i18n-and-help-page-design.md` (this plan implements its "Phase 2" section, scoped to the dashboard domain, plus two owner-added asks: docs gating + a dark language-pack gate).

## Global Constraints

- **npm only.** Add deps with `npm install --save-dev`; commit `package.json` + `package-lock.json` together. Never create bun/yarn/pnpm lockfiles.
- **Zero-warning lint gate:** `npm run lint` runs with `--max-warnings 0`. `any` is banned.
- **German copy rules:** informal **"Du"**; **no em/en dashes** (`—`/`–`) anywhere in any catalog or content module (use period/comma/colon/`·`). Enforced by `src/i18n/copyLint.test.ts`.
- **Translation source of truth:** the canonical bilingual `TERMS` glossary in `src/i18n/terms.ts`. Reuse a term's German from `TERMS`; never re-translate a domain noun inline. Role names stay untranslated: Admin / Produktionsteam / Artist. Proper nouns stay: ShowFlow, Airtable.
- **Key parity:** every `de` catalog must have the exact keyset of its `en` twin (`src/i18n/keyParity.test.ts`). English is the canonical shape.
- **Typed keys:** unknown `t()` keys are `tsc` errors via `src/i18n/react-i18next.d.ts`. A new namespace must be added there.
- **Three type-check projects, all must pass:** `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, `deno check --node-modules-dir=none supabase/functions/*/index.ts` (only if you touch edge code — you touch the generated entitlements mirror, so run it).
- **Entitlements are a three-way mirror.** `src/lib/entitlements.ts` is the SOURCE (sentinel block). Regenerate the edge twin with `npm run sync:mirrors` (never hand-edit `supabase/functions/_shared/entitlements.ts`). The SQL twin `public.is_feature_enabled()` is NOT covered by the generator — hand-edit it in a new migration in the same commit. `npm run sync:mirrors:check` gates CI.
- **Migrations auto-apply on merge.** Do not hand-apply. Just add the migration file.
- **Ship dark:** `language_packages` `defaultEnabled: false`. Verify no customer sees a language picker or German text after this PR unless a super-admin flips the org entitlement on.
- **Changelog discipline:** never mention super-admin/platform actions (the language-pack toggle, the docs gating) in `public/changelog.md`. The one genuinely user-facing line is "the dashboard explainer now opens the Help center."

---

## File Structure

**New files:**
- `src/i18n/locales/en/dashboard.json`, `src/i18n/locales/de/dashboard.json` — the dashboard namespace catalogs.
- `i18next-parser.config.js` — extraction config (repo root).
- `supabase/migrations/<timestamp>_language_packages_entitlement.sql` — SQL twin `is_feature_enabled` case + a doc comment (no table changes needed; `org_entitlements` already stores arbitrary feature strings).

**Modified — language gate (A):**
- `src/lib/entitlements.ts` (SOURCE registry block), `supabase/functions/_shared/entitlements.ts` (regenerated), `src/components/layout/AppLayout.tsx` (gate picker + force-English effect), plus test updates.

**Modified — dashboard namespace (B):**
- `src/i18n/index.ts`, `src/i18n/react-i18next.d.ts` (register namespace).
- `src/pages/DashboardPage.tsx`, `src/components/dashboard/ArtistDashboard.tsx`, `src/components/dashboard/DirectBookingCard.tsx`, `src/components/dashboard/TierAttentionCard.tsx`, `src/components/dashboard/firstRun/{DashboardFirstRun,StageCard,FirstRunHeaderCard,FirstRunQueue}.tsx`, `src/hooks/useDashboardFirstRun.ts` (artist-queue copy only), plus their co-located tests.

**Modified — explainer links (C):**
- `src/pages/DashboardPage.tsx` (`handleGhost`), `src/components/bookings/setup/EligibilityStep.tsx`, `src/components/bookings/setup/LadderStep.tsx`, `src/components/shows/date/TierTimeline.tsx`, `src/lib/dashboard/moduleOnboarding.ts` (`ROLE_EXPLAINER_LINK_ROUTE` constant only — not its copy), plus their tests + the stale "docs is producer-facing" comments in `settingsTabs.ts`/`moduleOnboarding.ts`.

**Modified — docs gating (D):**
- `src/lib/settingsTabs.ts`, `src/pages/SettingsPage.tsx`, `src/components/settings/DocumentationTab.tsx`, plus tests.

**Wrap-up:**
- `public/changelog.md` + `public/changelog.json`, `package.json` + `src/config/app.config.ts` (version bump), `CLAUDE.md` (phase-2 namespace-per-domain note).

---

## Workstream A — dark `language_packages` entitlement + language-switcher gate

Do this FIRST: it must be in place before the dashboard German becomes reachable, so nothing German leaks to customers mid-branch.

### Task A1: Add the `language_packages` entitlement to the registry

**Files:**
- Modify: `src/lib/entitlements.ts:9-35` (the sentinel block)
- Test: `src/lib/entitlements.test.ts`

**Interfaces:**
- Produces: `FeatureKey` gains `"language_packages"`; `FEATURE_REGISTRY.language_packages` with `defaultEnabled: false`, `short: "LP"`.

- [ ] **Step 1: Update the failing test first.** In `src/lib/entitlements.test.ts`, add/extend a case asserting the new key defaults off:

```ts
it("language_packages ships dark (defaults off when no row exists)", () => {
  expect(isFeatureEnabled([], "language_packages")).toBe(false);
  expect(enabledFeatures([{ feature: "language_packages", enabled: true }]))
    .toContain("language_packages");
});
```

- [ ] **Step 2: Run it, watch it fail** (`"language_packages"` not assignable to `FeatureKey`).

Run: `npx vitest run src/lib/entitlements.test.ts`
Expected: FAIL (type error / key missing).

- [ ] **Step 3: Edit the SOURCE block** in `src/lib/entitlements.ts`:
  - Line 9: `export type FeatureKey = "booking_flow" | "hire_orders" | "language_packages";`
  - Line 17: widen `short:` union to `"BF" | "HO" | "LP"`.
  - Add to `FEATURE_REGISTRY` after `hire_orders`:

```ts
  language_packages: {
    key: "language_packages",
    label: "Language packages",
    description: "Non-English UI languages and the in-app language switcher.",
    defaultEnabled: false,
    short: "LP",
  },
```

- [ ] **Step 4: Regenerate the edge mirror.**

Run: `npm run sync:mirrors`
Then confirm no drift: `npm run sync:mirrors:check`
Expected: `_shared/entitlements.ts` block now byte-identical with the new key.

- [ ] **Step 5: Run vitest + the edge test + tsc.**

Run: `npx vitest run src/lib/entitlements.test.ts` and `deno test --allow-all supabase/functions/_shared/entitlements.test.ts`
Fix `supabase/functions/_shared/entitlements.test.ts` if it enumerates exact keys.
Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/entitlements.ts supabase/functions/_shared/entitlements.ts src/lib/entitlements.test.ts supabase/functions/_shared/entitlements.test.ts
git commit -m "add language_packages entitlement (dark, defaults off)"
```

### Task A2: SQL twin for `is_feature_enabled`

**Files:**
- Create: `supabase/migrations/<timestamp>_language_packages_entitlement.sql`

The SQL twin lives in `supabase/migrations/20260716233515_org_entitlements.sql` as a hardcoded `case`. It must learn the new key or `is_feature_enabled(org,'language_packages')` returns the `else false` branch (which is coincidentally correct-by-accident, but the registry must be explicit and future non-false defaults would break). Add an explicit case.

- [ ] **Step 1: Write the migration.** Name it with a timestamp AFTER the latest existing migration. Redefine the function `CREATE OR REPLACE`, copying the existing body from `20260716233515_org_entitlements.sql` and adding the branch:

```sql
-- Teach is_feature_enabled() about the language_packages module (ships dark).
-- Mirrors src/lib/entitlements.ts FEATURE_REGISTRY (defaultEnabled: false).
create or replace function public.is_feature_enabled(_org uuid, _feature text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select enabled from public.org_entitlements where org_id = _org and feature = _feature),
    case _feature
      when 'booking_flow' then true
      when 'hire_orders' then false
      when 'language_packages' then false
      else false
    end
  );
$$;
```

  (Read the real body of `20260716233515_org_entitlements.sql:28-40` first and preserve its exact signature/qualifiers — the snippet above is illustrative.)

- [ ] **Step 2: Verify locally** against the local stack if available:

Run: `npm run local:up` then in psql/execute_sql: `select public.is_feature_enabled(gen_random_uuid(), 'language_packages');`
Expected: `false`.
(If no local stack, skip — the merge applies it. Do NOT hand-apply to prod.)

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/
git commit -m "sql twin: is_feature_enabled knows language_packages"
```

### Task A3: Gate the account-menu language picker + force English while dark

**Files:**
- Modify: `src/components/layout/AppLayout.tsx` (picker section ~232-246; add effect near top)
- Test: `src/components/layout/AppLayout.test.tsx` (create if none; else extend)

**Interfaces:**
- Consumes: `useFeature("language_packages")` from `src/hooks/useEntitlements.ts` (returns `boolean`, registry-default `false` while loading — fails closed to dark, which is what we want). `loadStoredLang` from `src/i18n/config.ts`. The `i18n` default instance from `src/i18n`.

- [ ] **Step 1: Write the failing test.** In `AppLayout.test.tsx`, render with providers and a fake org whose entitlements lack `language_packages`; assert the language picker is absent, and with it present, the picker renders both labels:

```tsx
it("hides the language picker when language_packages is off", async () => {
  renderWithProviders(<AppLayout>{null}</AppLayout>, { entitlements: [] });
  // open account menu ...
  expect(screen.queryByText("Deutsch")).not.toBeInTheDocument();
});
it("shows the language picker when language_packages is on", async () => {
  renderWithProviders(<AppLayout>{null}</AppLayout>, {
    entitlements: [{ feature: "language_packages", enabled: true }],
  });
  // open account menu ...
  expect(await screen.findByText("Deutsch")).toBeInTheDocument();
});
```

  (Use the existing `renderWithProviders` entitlement seam — check how other tests seed `org_entitlements`; mirror that.)

- [ ] **Step 2: Run it, watch it fail** (picker always renders today).

- [ ] **Step 3: Implement.** In `AppLayout.tsx`:
  - Add `import i18n from '@/i18n';` and `import { loadStoredLang } from '@/i18n/config';` and `import { useFeature } from '@/hooks/useEntitlements';`.
  - `const languagePacksEnabled = useFeature('language_packages');`
  - Add a force-English effect (display-only; does NOT clear localStorage, so a re-enable restores the user's choice):

```tsx
useEffect(() => {
  if (!languagePacksEnabled) {
    if (i18n.language !== 'en') i18n.changeLanguage('en');
    return;
  }
  const stored = loadStoredLang();
  if (stored && i18n.language !== stored) i18n.changeLanguage(stored);
}, [languagePacksEnabled]);
```

  - Wrap the language section (the `<p>` header at ~232-234 AND the `SUPPORTED_LANGUAGES.map(...)` AND the trailing `<div className="my-1 h-px bg-border" />` divider at 247) in `{languagePacksEnabled && (<>...</>)}`.

- [ ] **Step 4: Run tests + tsc.**

Run: `npx vitest run src/components/layout/AppLayout.test.tsx && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/layout/AppLayout.tsx src/components/layout/AppLayout.test.tsx
git commit -m "gate language picker behind language_packages; force English while dark"
```

### Task A4: Fix platform/entitlement tests that pin the module set

**Files:**
- Modify: `src/components/platform/PlatformDefaultsTab.test.tsx`, `src/components/platform/EditOrgDialog.test.tsx` (only if they assert an exact module count/list)

The `DefaultModulesCard` and `EditOrgDialog` iterate `FEATURE_KEYS`, so a third switch now renders automatically. Any test asserting "exactly two toggles" or a fixed `{ booking_flow, hire_orders }` shape must gain the third key.

- [ ] **Step 1: Run the platform test suite, see what breaks.**

Run: `npx vitest run src/components/platform/`
Expected: FAIL on any exact-count/shape assertion.

- [ ] **Step 2: Update assertions** to include `language_packages: false` in stored `default_entitlements` fixtures and expected save payloads; update any `getAllByRole('switch')` length.

- [ ] **Step 3: Run + commit.**

Run: `npx vitest run src/components/platform/`

```bash
git add src/components/platform/
git commit -m "update platform tests for the language_packages default toggle"
```

---

## Workstream C — repoint the five explainer links to the Help center

Small, self-contained, and it removes the last reasons those links needed the docs tab — do it before gating docs (D).

### Task C1: Dashboard ghost CTA → `/help`

**Files:**
- Modify: `src/pages/DashboardPage.tsx:89-90`
- Test: `src/pages/DashboardPage.firstRun.test.tsx:232`

- [ ] **Step 1: Update the test.** Change the expectation at `DashboardPage.firstRun.test.tsx:232` from `"/settings?tab=docs"` to `ROUTES.HELP` (`"/help"`).
- [ ] **Step 2: Run it, watch it fail.** `npx vitest run src/pages/DashboardPage.firstRun.test.tsx`
- [ ] **Step 3: Implement.** `DashboardPage.tsx:90` → `const handleGhost = () => navigate(ROUTES.HELP);` and update the `//` comment above it (it currently says "Settings > Docs"). `ROUTES` is already imported.
- [ ] **Step 4: Run test → PASS.**
- [ ] **Step 5: Commit.** `git commit -m "point dashboard explainer CTA at the Help center"`

### Task C2: Booking-flow concept links → `/help`

**Files:**
- Modify: `src/components/bookings/setup/EligibilityStep.tsx:64`, `src/components/bookings/setup/LadderStep.tsx:79`, `src/components/shows/date/TierTimeline.tsx:200`
- Test: `src/components/bookings/setup/CoverageSteps.test.tsx:63`, `src/components/bookings/setup/LadderStep.test.tsx:102`, `src/components/shows/date/TierTimeline.test.tsx:225`

- [ ] **Step 1: Update the three tests** to expect `to={ROUTES.HELP}` / href `/help`.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement.** Change each `<Link to={`${ROUTES.SETTINGS}?tab=docs`}>` to `<Link to={ROUTES.HELP}>`. Confirm `ROUTES` import already present in each (it is, since they build the docs link from it).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git commit -m "point booking-flow concept links at the Help center"`

### Task C3: `ROLE_EXPLAINER_LINK_ROUTE` → `/help` + refresh stale comments

**Files:**
- Modify: `src/lib/dashboard/moduleOnboarding.ts:59-68` (route constant + comment)
- Modify: `src/lib/settingsTabs.ts:6-12` (comment that calls docs "a real destination for a producer")
- Test: `src/lib/dashboard/moduleOnboarding.test.ts:445-446`

> Note: only the ROUTE constant changes here — `moduleOnboarding.ts` copy stays English (it is deferred from the i18n migration). This keeps C independent of B.

- [ ] **Step 1: Update the test** at `moduleOnboarding.test.ts:445` to expect `ROLE_EXPLAINER_LINK_ROUTE === ROUTES.HELP`. Leave the `SETTINGS_TAB_PARAMS` contains-`"docs"` assertion (docs is still a valid tab param; it's just super-admin-gated now).
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement.** `moduleOnboarding.ts:68` → `export const ROLE_EXPLAINER_LINK_ROUTE = ROUTES.HELP;`. Rewrite the doc comment (lines 58-66) to say the explainer now points at the Help center (drop the "docs is not an admin-gated dead end" claim — after D it IS super-admin-only). In `settingsTabs.ts`, fix the comment block (lines 1-12) that describes `docs` as a producer deep-link target.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git commit -m "route role-explainer link to Help center; refresh docs comments"`

---

## Workstream D — gate Settings → Documentation to super-admins

### Task D1: Deep-link resolver learns super-admin-only tabs

**Files:**
- Modify: `src/lib/settingsTabs.ts`
- Test: `src/lib/settingsTabs.test.ts`

**Interfaces:**
- Produces: `resolveInitialTab(param: string | null, isAdmin: boolean, isSuperAdmin?: boolean): SettingsTabParam` (third arg optional, defaults `false`, so existing callers still type-check but should be updated).

- [ ] **Step 1: Update/extend the tests.** In `settingsTabs.test.ts`:

```ts
it("docs deep-link falls back for a non-super-admin", () => {
  expect(resolveInitialTab("docs", true, false)).toBe("organization");
});
it("docs deep-link opens for a super-admin", () => {
  expect(resolveInitialTab("docs", true, true)).toBe("docs");
});
```

  Update the existing `resolveInitialTab("docs", ...)` assertions accordingly.

- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement.** Add `const SUPER_ADMIN_ONLY: readonly SettingsTabParam[] = ["docs"];`. Extend the signature and add, after the `ADMIN_ONLY` guard:

```ts
if (!isSuperAdmin && SUPER_ADMIN_ONLY.includes(match)) return fallback;
```

- [ ] **Step 4: Run → PASS + tsc.**
- [ ] **Step 5: Commit.** `git commit -m "settingsTabs: docs is super-admin-only at the deep-link layer"`

### Task D2: Gate the Documentation trigger + content + deep-link call

**Files:**
- Modify: `src/pages/SettingsPage.tsx:178,182,284,507`
- Test: `src/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Update the test.** In `SettingsPage.test.tsx`, assert a non-super-admin does not see the Documentation trigger, and a `?tab=docs` deep-link for a non-super-admin lands on the default tab. (Seed `isSuperAdmin` via the auth mock the file already uses.)
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement.**
  - Line 284: `{ value: "docs", label: "Documentation", icon: BookOpen, show: isSuperAdmin }`.
  - Line 507: wrap the `<TabsContent value="docs">` in `{isSuperAdmin && ( ... )}`.
  - Lines 178 & 182: pass `isSuperAdmin` as the third arg to `resolveInitialTab(tabParam, isAdmin, isSuperAdmin)`. `isSuperAdmin` is already destructured at line 73.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git commit -m "gate Settings > Documentation tab to super-admins"`

### Task D3: Simplify DocumentationTab's now-dead guide-only branch

**Files:**
- Modify: `src/components/settings/DocumentationTab.tsx`
- Test: `src/components/settings/DocumentationTab.test.tsx`

The tab now only ever renders for super-admins, so `if (!isSuperAdmin) return guide;` (line 37) is unreachable from the app. Keep the component robust but update its test, which currently asserts a non-super-admin sees only the guide (that path is now dead from Settings).

- [ ] **Step 1: Update the test** to reflect that the tab is super-admin-only: keep a unit test that `isSuperAdmin` renders all three sub-tabs; drop/replace the "non-super-admin sees guide" case with a note that gating now happens at SettingsPage. (Do not delete the `isSuperAdmin` prop — it still guards the lazy System Map import.)
- [ ] **Step 2: Run the settings test dir.** `npx vitest run src/components/settings/DocumentationTab.test.tsx`
- [ ] **Step 3: Commit.** `git commit -m "update DocumentationTab test for super-admin-only tab"`

---

## Workstream B — the `dashboard` i18next namespace

Only genuinely dashboard-scoped surfaces. **Deferred (do NOT touch): `src/lib/dashboard/stageChain.ts`, `src/lib/dashboard/moduleOnboarding.ts` copy** (shared with bookings/hire rails → future `onboarding` namespace). **Do NOT translate `SAMPLE_PREVIEW` in `src/lib/dashboard/firstRun.ts`** (placeholder demo data). Every string added below needs `en` + `de`; German follows Du + no-dashes + `TERMS`.

### Task B1: Scaffold the `dashboard` namespace

**Files:**
- Create: `src/i18n/locales/en/dashboard.json`, `src/i18n/locales/de/dashboard.json`
- Modify: `src/i18n/index.ts`, `src/i18n/react-i18next.d.ts`

**Interfaces:**
- Produces: namespace `'dashboard'` registered; `useTranslation('dashboard')` typed.

- [ ] **Step 1:** Create both JSON files with a single seed key so parity is testable immediately:

```json
{ "cards": { "liveUpcoming": "Live & upcoming" } }
```

  and the `de` twin `{ "cards": { "liveUpcoming": "Live und bevorstehend" } }`.

- [ ] **Step 2: Register.** In `src/i18n/index.ts`: import both, add to `resources.en`/`resources.de`, add `'dashboard'` to the `ns` array. In `src/i18n/react-i18next.d.ts`: `import type enDashboard from './locales/en/dashboard.json';` and add `dashboard: typeof enDashboard;` to the `resources` block.
- [ ] **Step 3: Run the parity + copy-lint + type tests.**

Run: `npx vitest run src/i18n/ && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS (keyParity sees `dashboard` in both, copyLint clean).

- [ ] **Step 4: Commit.** `git commit -m "scaffold dashboard i18n namespace"`

### Task B2: Migrate `DirectBookingCard` + `TierAttentionCard` (proves the end-to-end pattern)

**Files:**
- Modify: `src/components/dashboard/DirectBookingCard.tsx`, `src/components/dashboard/TierAttentionCard.tsx`
- Modify catalogs: `en/dashboard.json`, `de/dashboard.json`
- Test: `src/components/dashboard/DirectBookingCard.test.tsx`, `src/components/dashboard/TierAttentionCard.test.tsx`

**Interpolation/plurals present:** `` `${date} · ${mainBooked} of ${mainSlots} booked` ``; `` `And ${n} more. See Bookings.` ``; `` `${date} · Tier ${tier} · ${filled} of ${required}` ``; `"At risk"`, `"Expires soon"`, `"Needs attention"`, `"Dates needing artists"`.

- [ ] **Step 1: Update the tests** to use the i18n-aware render (the shared render helper already boots the real i18n instance, so `getByText("Needs attention")` still resolves via the `en` catalog). Where a test asserted an interpolated literal, keep asserting the resolved English string.
- [ ] **Step 2: Add keys** under a `directBooking` / `tierAttention` group in both catalogs. Use i18next interpolation, not concatenation:

```json
"directBooking": {
  "title": "Dates needing artists",
  "row": "{{date}} · {{booked}} of {{slots}} booked",
  "more": "And {{count}} more. See Bookings."
}
```

  German (from TERMS: Besetzung; keep `·`, Du, no dashes): `"title": "Termine, die Besetzung brauchen"`, `"row": "{{date}} · {{booked}} von {{slots}} gebucht"`, `"more": "Und {{count}} weitere. Siehe Buchungen."` (verify against `TERMS` and refine — copy is dark, so refinement can continue post-merge).

- [ ] **Step 3: Implement** `useTranslation('dashboard')` in both components; replace literals with `t('directBooking.title')`, `t('directBooking.row', { date, booked: mainBooked, slots: mainSlots })`, etc. For true count plurals (`show`/`shows`, `date`/`dates`) use i18next `_one`/`_other` plural keys with `{ count }` (see `HelpPage.tsx:42-44` for the precedent).
- [ ] **Step 4: Run** `npx vitest run src/components/dashboard/DirectBookingCard.test.tsx src/components/dashboard/TierAttentionCard.test.tsx src/i18n/` **→ PASS.**
- [ ] **Step 5: Commit.** `git commit -m "i18n: migrate DirectBookingCard + TierAttentionCard to dashboard ns"`

### Task B3: Migrate `ArtistDashboard`

**Files:**
- Modify: `src/components/dashboard/ArtistDashboard.tsx`, catalogs
- Test: the four `ArtistDashboard.*.test.tsx` files

**Strings:** `"Dashboard"`, `"Failed to load your offers. Please refresh."`, `"Awaiting your response"`, `"You're all caught up. No pending offers."`, `"Respond"`, `"Your hire orders"`, empty-paperwork sentence, `"Download"` (aria), `"My Casts"`, `"Failed to load your casts."`, `"You haven't been added to any casts yet."`, `"Member"`. **Interpolated:** `` `${responded} of ${total} dates` ``, `` `+${n} more` ``. **Out of scope:** `meter.*` copy comes from `@/lib/flowCopy` (not dashboard) — leave it.

- [ ] **Step 1: Update tests** (i18n-aware; assert resolved EN).
- [ ] **Step 2: Add an `artist` group** to both catalogs; German from TERMS (Besetzung for casts, Engagementvertrag for hire orders).
- [ ] **Step 3: Implement** `useTranslation('dashboard')`; replace literals; interpolate the two counts; use plural keys for `dates`.
- [ ] **Step 4: Run** the ArtistDashboard tests + `src/i18n/` **→ PASS.**
- [ ] **Step 5: Commit.** `git commit -m "i18n: migrate ArtistDashboard to dashboard ns"`

### Task B4: Migrate `DashboardPage` (ProducerDashboard)

**Files:**
- Modify: `src/pages/DashboardPage.tsx`, catalogs
- Test: `src/pages/DashboardPage.test.tsx` (+ the firstRun test already touched in C1)

**Strings:** toasts `"Bookings confirmed"`, `"Bookings declined"`, `"Some bookings changed — refresh and retry"` (note: the em-dash-looking `—` here must become a period/comma in BOTH the English source AND German — copyLint bans it); card titles `"Live & upcoming"`, `"Next 14 days"`, `"Next 30 days"`; `"Dashboard"`, `"Cast confirmation status across upcoming dates."`; table headers `"Artist"`, `"Date / Show"`, `"Type"`, `"Understudy"`/`"Main"`, `"Cast confirmed"`, `"Ready to Confirm"`, `"Click to see pending shows →"`. **Interpolated/plural:** `` `Confirm ${n}` ``, `"Decline"`, `live date`/`live dates`, `` `${n} show(s)` ``, `%`.

- [ ] **Step 1: Update `DashboardPage.test.tsx`** to i18n-aware assertions.
- [ ] **Step 2: Add a `producer` group** to both catalogs. **Fix the `—` in `"Some bookings changed — refresh and retry"`** to `"Some bookings changed. Refresh and retry."` in the English catalog (the current literal would fail copyLint once it's a catalog string). German twin with Du.
- [ ] **Step 3: Implement** `useTranslation('dashboard')`; replace literals; `t('producer.confirmN', { count: selected.size })`; plural keys for `live date(s)` / `show(s)`.
- [ ] **Step 4: Run** `npx vitest run src/pages/DashboardPage.test.tsx src/pages/DashboardPage.firstRun.test.tsx src/i18n/` **→ PASS.**
- [ ] **Step 5: Commit.** `git commit -m "i18n: migrate ProducerDashboard to dashboard ns"`

### Task B5: Migrate the first-run leaf literals

**Files:**
- Modify: `src/components/dashboard/firstRun/DashboardFirstRun.tsx` (`"Pick up where you left off"`, `"Resume"`, `"Hide"`), `StageCard.tsx` (`"Slows filling"`, `"Admin"`, `"Running"`, `"Start here"`), `FirstRunHeaderCard.tsx` (`"On"`/`"Off"`), `FirstRunQueue.tsx` (`"Sample"`), catalogs
- Test: `src/components/dashboard/firstRun/{DashboardFirstRun,StageCard,firstRunLeaves}.test.tsx`

> These four leaves hold only static chrome literals — the prop-driven copy comes from the deferred composers, so this is a small, safe migration.

- [ ] **Step 1: Update tests** (i18n-aware).
- [ ] **Step 2: Add a `firstRun` group** to both catalogs. German: `"Admin"` stays `"Admin"` (role name, untranslated); translate the rest with Du.
- [ ] **Step 3: Implement** `useTranslation('dashboard')` in each leaf; replace the literals.
- [ ] **Step 4: Run** the firstRun test files + `src/i18n/` **→ PASS.**
- [ ] **Step 5: Commit.** `git commit -m "i18n: migrate first-run leaf chrome to dashboard ns"`

### Task B6: Migrate the artist-queue copy in `useDashboardFirstRun`

**Files:**
- Modify: `src/hooks/useDashboardFirstRun.ts` (artist queue rows only, ~L130-160)
- Test: `src/components/dashboard/firstRun/useDashboardFirstRun.test.tsx`

**Strings:** `"Open"`, `"Edit"`, `"Nothing yet"`, `` `${n} offer(s) arriving in tomorrow's digest` ``, `"Dates booked for you appear here"`, `"Your producer's schedule"`, `"Kept out of every list…"`, `` `Your first offer lands here once ${orgName}…` ``, `"your workspace"` fallback (leave the fallback literal — it's a data default, not display copy, but wrap the display string with interpolation).

> This is a hook, not a component — it can call `useTranslation('dashboard')` (hooks may call hooks). Prefer that over threading `t` in.

- [ ] **Step 1: Update the test** (i18n-aware; assert resolved EN, interpolated where needed).
- [ ] **Step 2: Add an `artistQueue` group**; German with Du + TERMS (Tagesübersicht for digest).
- [ ] **Step 3: Implement** `const { t } = useTranslation('dashboard');` in the hook; replace literals; interpolate `orgName` and the offer count (plural key).
- [ ] **Step 4: Run** the test + `src/i18n/` **→ PASS.**
- [ ] **Step 5: Commit.** `git commit -m "i18n: migrate artist first-run queue copy to dashboard ns"`

---

## Workstream E — i18next-parser tooling

> **CI gate deferred (owner call).** Add the parser + extraction config + scripts so the tooling exists and can be run locally, but do NOT wire it into `.github/workflows/ci.yml` in this PR. Enforcing it as a CI gate is a follow-up once the catalog↔code mapping is proven stable across a few domains.

### Task E1: Add `i18next-parser` + extraction config + local scripts

**Files:**
- Create: `i18next-parser.config.js`
- Modify: `package.json` (devDep + scripts)

**Interfaces:**
- Produces: `npm run i18n:extract` (writes/updates catalogs) and `npm run i18n:check` (fails on drift — new/orphaned keys not reflected in catalogs). Both are LOCAL-only for now; neither runs in CI this PR.

- [ ] **Step 1: Install.** `npm install --save-dev i18next-parser`
- [ ] **Step 2: Config.** Create `i18next-parser.config.js` scoped to migrated code, matching the existing catalog layout:

```js
export default {
  locales: ['en', 'de'],
  defaultNamespace: 'common',
  input: ['src/**/*.{ts,tsx}'],
  output: 'src/i18n/locales/$LOCALE/$NAMESPACE.json',
  keySeparator: '.',
  namespaceSeparator: false, // we pass ns via useTranslation('dashboard'); keys are dotted
  sort: true,
  failOnUpdate: false, // extract mode writes; the check script flips this on
  keepRemoved: true,   // do not delete keys the parser can't see (help content lives in TS modules)
};
```

  (Tune `namespaceSeparator`/`contextSeparator` after a dry run so it does not mangle the existing `help`/`common` catalogs. Verify a dry run leaves `en/common.json` + `en/help.json` byte-identical.)

- [ ] **Step 3: Scripts.** In `package.json`:

```json
"i18n:extract": "i18next-parser --config i18next-parser.config.js",
"i18n:check": "i18next-parser --config i18next-parser.config.js --fail-on-update"
```

- [ ] **Step 4: Dry-run safety.** Run `npm run i18n:extract` then `git status` — it must NOT rewrite `common.json`/`help.json` (if it does, adjust `keepRemoved`/separators until clean). Then run `npm run i18n:check` on the clean tree.

Run: `npm run i18n:check`
Expected: exit 0 on a tree whose catalogs match the code.

- [ ] **Step 5: Do NOT touch CI.** The CI gate is deferred (owner call) — leave `.github/workflows/ci.yml` unchanged. The scripts stay local-only.
- [ ] **Step 6: Commit.** `git commit -m "add i18next-parser extraction + local check scripts"`

---

## Workstream F — wrap-up: docs, changelog, version

### Task F1: Help-center impact + CLAUDE.md note

> **Owner directive: NO changelog bump.** Do NOT touch `public/changelog.md` / `public/changelog.json`, and do NOT bump the version in `package.json` / `src/config/app.config.ts`. Those steps are removed.

**Files:**
- Modify: `CLAUDE.md` (i18n section: record the dashboard namespace as the first phase-2 migration + the deferred `onboarding` namespace)

- [ ] **Step 1: Help-center impact.** Verify the existing Help FAQ (`src/lib/help/items.ts`) already covers tiers / eligibility / ladder / "how this org works" (the concepts the repointed links land on). If a concept is uncovered, add the Help item (EN + DE, Du) in THIS PR per Convention 2. Record the finding in the PR description ("Help center impact: repointed 5 explainer links to /help; existing items A?.?/… cover them; no new items" OR the items added).
- [ ] **Step 2: CLAUDE.md.** In the i18n section, note phase 2 has begun: `dashboard` namespace migrated; `stageChain.ts`/`moduleOnboarding.ts` copy deferred to a future `onboarding` namespace (shared with the bookings/hire setup rails); `language_packages` entitlement gates the switcher and ships dark.
- [ ] **Step 3: Commit.** `git commit -m "docs: i18n phase-2 notes (dashboard ns, deferred onboarding, language pack)"`

### Task F2: Full verification gate

- [ ] **Step 1:** `npm run lint`
- [ ] **Step 2:** `npx tsc -p tsconfig.app.json --noEmit && npx tsc -p tsconfig.tools.json --noEmit`
- [ ] **Step 3:** `deno check --node-modules-dir=none supabase/functions/_shared/entitlements.ts`
- [ ] **Step 4:** `npm run sync:mirrors:check`
- [ ] **Step 5:** `npm run test:coverage` (the full vitest suite CI runs)
- [ ] **Step 6:** `npm run i18n:check` (local sanity only — not a CI gate this PR; catalogs should be clean)
- [ ] **Step 7:** `npx vitest run src/i18n/` (keyParity + copyLint explicit)
- [ ] **Step 8:** Manual dark check: with no `language_packages` row, boot the app (`npm run dev` against the local stack) and confirm (a) no language picker in the account menu, (b) the dashboard renders English even with `localStorage['showflow.lang.v1']='de'` set, (c) the dashboard "how this org works" CTA navigates to `/help`, (d) Settings → Documentation is absent for a non-super-admin. Screenshot for the PR.

---

## Self-Review (author checklist — completed at plan-writing time)

- **Spec coverage:** Phase-2 "one namespace per domain" → Workstream B (dashboard only, composers explicitly deferred with rationale). Owner asks: Help-center wiring → C; docs gating → D; dark language pack → A. Tooling ask (i18next-parser) → E. Conventions (Help-center impact, changelog, key-parity, no-dashes, TERMS) → Global Constraints + F.
- **Placeholder scan:** German strings are produced during implementation by extract-then-translate against `TERMS` and verified by keyParity/copyLint — this is content, not a code placeholder; worked examples given for every interpolation/plural pattern. The one true unknown (exact next version number, exact migration timestamp) is resolved by a command in-step.
- **Type consistency:** `resolveInitialTab` third param `isSuperAdmin?: boolean` is defined in D1 and consumed in D2. `useFeature("language_packages")` (A3) matches the `FeatureKey` added in A1. `short: "LP"` union widened in A1 step 3.
- **Ordering:** A (dark gate) before B (German becomes reachable); C before D (removes docs-tab dependencies before gating it); B6 uses a hook so it may call `useTranslation`.
