# Wireflow v3 — Phase 5: Settings mirror, runtime v3 toggle, deep-linking, Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "go to production, but on the owner's terms" slice of Phase 5: a **super-admin, per-org runtime toggle** that turns the v3 Get running board on (superseding the build-time `GETRUNNING_V3` env flag) so the owner can test it live before committing; a **Settings mirror** of the v3 board; **deep-linking** into wizard steps (`?step=`) with per-page "finish setup" affordances; and generalizing the Airtable sync console into a **"Sources"** console that also shows Google-Sheet imports. A **deprecation map** doc is written. **v1 board code is NOT deleted and the build flag is NOT hard-flipped** — that final cutover is deferred to a follow-up phase, gated on the owner's explicit go-ahead after testing.

**Architecture:** All additive. Six workstreams, one PR:
- **A — Runtime per-org v3 flag.** A new `app_settings` key `getrunning_v3_enabled` (per-org, super-admin-writable) resolved through the existing `resolveOrgSetting`/`upsertOrgSetting` plumbing, with the build-time `GETRUNNING_V3` const as the fallback default. A `useGetRunningV3Enabled()` hook becomes the single source of truth for "is the v3 board live for this org", replacing every static read of `GETRUNNING_V3` in app UI. A super-admin-only `Switch` writes the setting.
- **B — Settings mirror.** A new admin+producer `get-running` tab (right after `how-it-works`) renders `GetRunningBoardV3 context="settings"` plus the super-admin toggle. The tab is visible to a super-admin always (for testing) and to admin/producer once v3 is enabled for the org.
- **C — Deep-linking.** A reverse `stepsForRoute()` resolver (the existing `STEP_FEATURE` map is forward-only and non-injective), a `?step=` reader in the board that takes precedence over the auto-open, and a shared `FinishSetupLink` affordance wired into the `/dates`, `/productions`, `/artists`, and `/contracts` page headers (shown only when v3 is enabled and the relevant step is not done).
- **D — Sources.** Parameterize the `sync_type='airtable_poll'` filter in `src/data/airtableSync.ts` so the console shows Sheet runs too (Phase 4 already writes them to `airtable_sync_log`), tag each run by source, and rename the tab + console copy from "Airtable Sync" to **"Sources"** (EN+DE), keeping the URL value `?tab=airtable` stable.
- **E — Toggle-aware retirement.** `useGetRunningNavVisible` branches on the runtime flag (v3 model when on, v1 model when off); the v3 retired state gains a `useRailDismissed` "hide from nav" control + a Settings-mirror link so the nav actually retires for a v3-enabled org.
- **F — Deprecation map + release.** The `docs/…/wireflow-v3-settings-deprecation.md` doc; changelog + version bump for the user-visible Sources change only (the v3 board stays unannounced behind the toggle).

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind + shadcn/ui, `@tanstack/react-query` v5, `react-router-dom` v6, Supabase (Postgres + RLS; no new migration — `app_settings` already exists), react-i18next (EN + DE). Tests: Vitest + @testing-library/react (jsdom) + the `src/test/` harness (`supabaseFake.ts`, `renderWithProviders.tsx`, `fixtures.ts`, `castHelpers.ts`).

**Spec:** `docs/superpowers/specs/2026-08-23-wireflow-v3-get-running-settings-design.md` (owner-approved 2026-08-23, commit 2a5f43bb), §5.2/§5.3 (board + step model), §8 "Settings mirror, retirement, deep-linking, deprecation", §9 Testing, §10 Phase 5. Prior plans (all merged): Phase 1 `…-phase-1-frame-board-model.md`, Phase 2 `…-phase-2-get-dates-wizard.md`, Phase 3 `…-phase-3-bookable-contracts-steps.md`, Phase 4 `…-phase-4-new-backend.md`.

**Three owner decisions locked before planning (AskUserQuestion, 2026-08-23):**
1. **Sources label:** rename the sync console tab + headers to **"Sources"** (source-neutral), tag each run by source, keep the URL param `?tab=airtable` stable so no deep links break.
2. **Go-live packaging:** do **NOT** hard-flip the flag or delete v1 in this phase. Instead **make the flag invocable in the UI** ("I will test it first"). v1 stays; the real cutover (v1 deletion + build-flag removal) is a later phase after the owner tests v3 in production.
3. **Toggle home + scope:** **super-admin, per-org, in Settings**, persisted in `app_settings` via `resolveOrgSetting`, superseding the build flag.

## Global Constraints

- **Additive; nothing deleted this phase.** Do NOT delete any v1 file (`src/lib/getRunning/tasks.ts`, `taskFeature.ts`, `taskPanelMeta.ts`, `src/components/getRunning/{GetRunningHeader,PhaseCard,TaskRow,RetiredBoard,TaskPanel,taskPanelRegistry}.tsx`, `src/components/getRunning/panels/DatesPanelBody.tsx`, `panels/airtable/{AirtableConnect,AirtableConnectRail,AirtableConnectionSummary,useLatchedOnReady}`, `src/hooks/useGetRunning.ts`, `HowThisOrgWorks.tsx`, `src/pages/DevGetRunningHarness.tsx`), do NOT remove the `GETRUNNING_V3` build const (`src/config/flags.ts`), and do NOT remove any Settings tab. The v1 `/get-running` and the v1 nav path must keep working byte-for-byte when the runtime flag is off. **`src/lib/getRunning/tasks.ts` must survive regardless** — `src/pages/AcceptInvitePage.tsx:16` imports runtime values from it.
- **The runtime flag supersedes, it does not replace, the build flag.** `GETRUNNING_V3` (`import.meta.env.VITE_GETRUNNING_V3 === "true"`; on in local `.env.development`, off in prod) stays as the **fallback default** passed into `resolveOrgSetting`. The per-org `app_settings` row, when present, wins. A local-dev environment therefore still shows v3 by default; prod shows v1 until a super-admin toggles a given org on.
- **No RLS/migration work.** `app_settings` already exists with a per-org write policy whose first disjunct is `has_org_role(auth.uid(), org_id, 'admin')`, and `has_org_role` returns true for super-admins (`is_super_admin` bypass, migration `20260603120000:64-66`). So a super-admin can upsert any org's setting row with no schema change. The read floor ("Authenticated users can view app settings") already lets every member read the resolved value. Do NOT add the key to `app_setting_capability` (leaving it unmapped keeps writes admin/super-admin-only, which is what we want).
- **Data access is `fetchX(client, args)` / `mutateX(client, args)` in `src/data/<domain>.ts`; hooks are thin wrappers** passing the `supabase` singleton. Test data-access with `src/test/supabaseFake.ts` (never `vi.mock` the client). `any` is banned (lint `--max-warnings 0`); tests use `src/test/castHelpers.ts`.
- **React Query keys are hierarchical by domain.** New keys: `["app-settings", "getrunning-v3-enabled", orgId]` for the flag query (reuse the existing `["app-settings", …]` prefix so a card save can bust it). The Sources/console reads already live under `["airtable", …]` — keep them there.
- **UI conventions (`docs/ui-conventions.md`), CI-enforced at `--max-warnings 0`.** Reuse `src/components/ui` primitives (`Switch`, `Button`, `Card`, `Eyebrow`, `StatusPill`, `Metric`, `Alert`); no raw hex/rgba/`text-[13px]`/`rounded-[10px]` outside `src/components/ui`; 13px control size (`text-control`); uppercase is `<Eyebrow>`; status colour from `TONES`/`StatusPill`; numbers are `<Metric>`; tint washes `bg-hover-tint`/`bg-well-tint`/`bg-accent-tint`. Match the existing v3 step-body idiom (`SourceStep.tsx`) and the Settings-card idiom.
- **i18n from the start.** Every new user-facing string goes through `t()`. Board/affordance copy → `getRunningV3` namespace (`src/i18n/locales/{en,de}/getRunningV3.json`); Settings tab label + Sources console copy → `settings` / `settingsAirtable` namespaces. EN canonical, DE at full key parity (`src/i18n/keyParity.test.ts`). **Add `'getRunningV3'` to the keyParity namespace list** (`src/i18n/keyParity.test.ts:23` — it is currently registered in `src/i18n/index.ts` but not parity-checked). No em/en dashes (`src/i18n/copyLint.test.ts`; regular hyphens OK), no exclamation marks, no emoji, German Du-form. App terminology wins over design copy: **production** (not "show"), **part/Position** (not "slot"), **Contract**/**Engagementvertrag** (not "hire order"). New domain terms go in `src/i18n/terms.ts` `TERMS`, never inlined.
- **Help-center / page-mini rules.** Per-PR: update `src/lib/help/items.ts` (EN+DE, Du) if this changes what a user asks (the Sources rename likely does — a help item mentioning "Airtable Sync" tab), or state "No help center impact." The get-running board has no page mini; the four target pages already have minis (`bookings`, `productions`, `artists`, `hireOrders`) and are not changed structurally, so state "No page mini change." in the PR.
- **Branch + merge.** Work on `claude/wireflow-v3-phase-5-525a2a` (currently `= origin/main`). Do not commit or push to `main`; `main` requires the owner's review approval (memory [[repo-no-required-checks-automerge]]). The executor never self-merges. Never cancel deploy/apply CI workflows (memory [[never-cancel-deploy-apply-workflows]]). Push with `SHOWFLOW_SKIP_VERIFY=1` / `--no-verify` if the worktree's secret-scan hook stalls the push (memory note in [[wireflow-v3-initiative]]); GitHub MCP PAT can't create PRs (403) → use `gh pr create` with `--body-file` (memory [[pr-body-via-file-not-heredoc]]).
- **Verify per layer before the PR:** `npm run lint`, `npx tsc -p tsconfig.app.json --noEmit`, `npx vitest run` (or `npm run verify:fast`), then live dev-stack visual verification (light + dark) of: the Settings mirror tab + toggle, `/get-running?step=<key>` deep links, each page affordance, and the renamed Sources console showing a Sheet run.

---

## File Structure

**Part A — Runtime per-org v3 flag + toggle:**
- Create: `src/data/getRunningFlag.ts` (+ `.test.ts`) — `GETRUNNING_V3_SETTING_KEY`, `fetchGetRunningV3Enabled(client, orgId)`, `setGetRunningV3Enabled(client, orgId, enabled)`.
- Create: `src/hooks/useGetRunningV3Enabled.ts` (+ `.test.tsx`) — `useGetRunningV3Enabled()` query + `useSetGetRunningV3Enabled()` mutation.
- Modify: `src/pages/GetRunningPage.tsx` (+ `.test.tsx`) — replace the static `GETRUNNING_V3` fork with the runtime hook.
- Create: `src/components/getRunning/v3/GetRunningV3Toggle.tsx` (+ `.test.tsx`) — super-admin `Switch`.

**Part B — Settings mirror tab:**
- Modify: `src/lib/settingsTabs.ts` (+ `settingsTabs.test.ts`) — add `"get-running"` param.
- Modify: `src/pages/SettingsPage.tsx` (+ `SettingsPage.test.tsx`) — nav item + `TabsContent` mounting the mirror + toggle.
- Create: `src/components/getRunning/v3/GetRunningSettingsMirror.tsx` (+ `.test.tsx`) — toggle + `GetRunningBoardV3 context="settings"`.
- Modify: `src/i18n/locales/{en,de}/settings.json` — `nav.items.getRunning`.
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json` — mirror/toggle copy.

**Part C — Deep-linking:**
- Modify: `src/lib/getRunning/stepFeature.ts` (+ `stepFeature.test.ts`) — `stepsForRoute()` reverse resolver + `PAPERWORK_ROUTE`.
- Modify: `src/components/getRunning/v3/GetRunningBoardV3.tsx` (+ `.test.tsx`) — `?step=` reader (page context only).
- Create: `src/components/getRunning/v3/FinishSetupLink.tsx` (+ `.test.tsx`) — the shared affordance.
- Modify: `src/pages/ShowsBookingsPage.tsx`, `src/pages/ProductionsPage.tsx`, `src/pages/ArtistsPage.tsx`, `src/pages/HireOrdersPage.tsx` (+ their tests) — mount the affordance in each header.
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json` — affordance copy.

**Part D — Sources:**
- Modify: `src/data/airtableSync.ts` (+ `.test.ts`) — add `sync_type` to `SyncLogSummary`/`SYNC_LOG_COLS`; parameterize the `sync_type` filter.
- Modify: `src/components/settings/airtable/ActivityTab.tsx`, `OverviewTab.tsx`, `StatusHeader.tsx` (+ tests) — per-run source tag; handle no-next-run for sheet.
- Modify: `src/hooks/useAirtableConsole.ts` (+ test) — pass both source types through; `deriveKpis` guards the "Next run" tile.
- Modify: `src/i18n/locales/{en,de}/settings.json` (`nav.items.airtable` → "Sources") + `src/i18n/locales/{en,de}/settingsAirtable.json` (console eyebrows/headers).

**Part E — Toggle-aware retirement:**
- Modify: `src/hooks/useGetRunningNavVisible.ts` (+ `.test.ts`) — branch on the runtime flag.
- Modify: `src/components/getRunning/v3/GetRunningBoardV3.tsx` (`RetiredBoardV3`) (+ test) — `useRailDismissed` hide-from-nav + Settings link.

**Part F — Deprecation map + release:**
- Create: `docs/superpowers/specs/wireflow-v3-settings-deprecation.md`.
- Modify: `src/i18n/keyParity.test.ts` — add `'getRunningV3'`.
- Modify: `public/changelog.md` (+ regenerated `public/changelog.json`), `package.json`, `src/config/app.config.ts` (`APP_META.VERSION`).
- Modify: `src/lib/help/items.ts` (if the Sources rename warrants a help edit) or state "No help center impact."

---

# PART A — Runtime per-org v3 flag + super-admin toggle

## Task A1: Data-access — `getRunningFlag.ts`

**Files:**
- Create: `src/data/getRunningFlag.ts`
- Test: `src/data/getRunningFlag.test.ts`

**Interfaces:**
- Consumes: `resolveOrgSetting<T>(client, orgId, key, fallback)` and `upsertOrgSetting(client, orgId, key, value)` from `src/data/settings.ts`; `GETRUNNING_V3` from `src/config/flags.ts`.
- Produces: `GETRUNNING_V3_SETTING_KEY: "getrunning_v3_enabled"`; `fetchGetRunningV3Enabled(client, orgId): Promise<boolean>`; `setGetRunningV3Enabled(client, orgId, enabled): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/getRunningFlag.test.ts
import { describe, it, expect } from "vitest";
import { makeSupabaseFake } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import {
  GETRUNNING_V3_SETTING_KEY,
  fetchGetRunningV3Enabled,
  setGetRunningV3Enabled,
} from "./getRunningFlag";

describe("getRunningFlag data-access", () => {
  it("returns the org override when a true row exists", async () => {
    const fake = makeSupabaseFake({
      app_settings: [{ org_id: "org-1", key: GETRUNNING_V3_SETTING_KEY, value: true }],
    });
    const enabled = await fetchGetRunningV3Enabled(asSupabase(fake.client), "org-1");
    expect(enabled).toBe(true);
  });

  it("falls back to the build-flag default when no row exists", async () => {
    const fake = makeSupabaseFake({ app_settings: [] });
    // GETRUNNING_V3 is false in the test env (VITE_GETRUNNING_V3 unset) → fallback false.
    const enabled = await fetchGetRunningV3Enabled(asSupabase(fake.client), "org-1");
    expect(enabled).toBe(false);
  });

  it("upserts the org row on set", async () => {
    const fake = makeSupabaseFake({ app_settings: [] });
    await setGetRunningV3Enabled(asSupabase(fake.client), "org-1", true);
    const calls = fake.from("app_settings").upsertCalls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toMatchObject({ org_id: "org-1", key: GETRUNNING_V3_SETTING_KEY, value: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/getRunningFlag.test.ts`
Expected: FAIL — module `./getRunningFlag` not found. (If `makeSupabaseFake`/`asSupabase`/`fake.from(...).upsertCalls` have slightly different names in this repo, first read `src/test/supabaseFake.ts` and an existing `src/data/*.test.ts` — e.g. `src/data/settings.test.ts` — and match the harness's actual API; adjust the test accordingly before moving on.)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/data/getRunningFlag.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { GETRUNNING_V3 } from "@/config/flags";

/** app_settings key for the per-org runtime override of the v3 Get running board.
 *  Unmapped in app_setting_capability on purpose, so writes stay admin/super-admin only. */
export const GETRUNNING_V3_SETTING_KEY = "getrunning_v3_enabled";

/** Effective "is the v3 board live for this org": per-org app_settings row if present,
 *  else the build-time GETRUNNING_V3 default (on in local dev, off in prod). */
export async function fetchGetRunningV3Enabled(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<boolean> {
  return resolveOrgSetting<boolean>(client, orgId, GETRUNNING_V3_SETTING_KEY, GETRUNNING_V3);
}

/** Super-admin sets (or clears) the org's v3 override. */
export async function setGetRunningV3Enabled(
  client: SupabaseClient<Database>,
  orgId: string | null,
  enabled: boolean,
): Promise<void> {
  await upsertOrgSetting(client, orgId, GETRUNNING_V3_SETTING_KEY, enabled);
}
```

Note: confirm `upsertOrgSetting`'s exact signature in `src/data/settings.ts:94` (it takes `(client, orgId, key, value: Json)`); a boolean is valid `Json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/getRunningFlag.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/getRunningFlag.ts src/data/getRunningFlag.test.ts
git commit -m "v3 phase 5: per-org getrunning_v3_enabled data-access"
```

## Task A2: Hook — `useGetRunningV3Enabled`

**Files:**
- Create: `src/hooks/useGetRunningV3Enabled.ts`
- Test: `src/hooks/useGetRunningV3Enabled.test.tsx`

**Interfaces:**
- Consumes: `fetchGetRunningV3Enabled`, `setGetRunningV3Enabled` (Task A1); `useAuth` (`currentOrg`); the `supabase` singleton; `useQuery`/`useMutation`/`useQueryClient`.
- Produces: `useGetRunningV3Enabled(): { enabled: boolean; isLoading: boolean }` (defaults `enabled` to `GETRUNNING_V3` while loading, so first paint matches the build default and never flashes the wrong board); `useSetGetRunningV3Enabled(): UseMutationResult<void, unknown, boolean>` that invalidates `["app-settings"]`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/hooks/useGetRunningV3Enabled.test.tsx
import { describe, it, expect } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { useGetRunningV3Enabled } from "./useGetRunningV3Enabled";

describe("useGetRunningV3Enabled", () => {
  it("resolves the org override to true", async () => {
    const { result } = renderHookWithProviders(() => useGetRunningV3Enabled(), {
      auth: { currentOrg: { id: "org-1" } },
      supabaseSeed: { app_settings: [{ org_id: "org-1", key: "getrunning_v3_enabled", value: true }] },
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useGetRunningV3Enabled.test.tsx`
Expected: FAIL — module not found. (First read `src/test/renderWithProviders.tsx` for the actual `renderHookWithProviders` / provider-seed API — mirror an existing hook test such as `src/hooks/useGetRunningV3.test.tsx` — and match its `auth` + supabase-seed shape; adjust this test to the real API before continuing.)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hooks/useGetRunningV3Enabled.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { GETRUNNING_V3 } from "@/config/flags";
import { fetchGetRunningV3Enabled, setGetRunningV3Enabled } from "@/data/getRunningFlag";

export function useGetRunningV3Enabled(): { enabled: boolean; isLoading: boolean } {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const q = useQuery({
    queryKey: ["app-settings", "getrunning-v3-enabled", orgId],
    enabled: !!orgId,
    queryFn: () => fetchGetRunningV3Enabled(supabase, orgId),
  });
  return { enabled: q.data ?? GETRUNNING_V3, isLoading: q.isLoading };
}

export function useSetGetRunningV3Enabled() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => setGetRunningV3Enabled(supabase, orgId, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-settings"] }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useGetRunningV3Enabled.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGetRunningV3Enabled.ts src/hooks/useGetRunningV3Enabled.test.tsx
git commit -m "v3 phase 5: useGetRunningV3Enabled runtime-flag hook"
```

## Task A3: Wire `GetRunningPage` to the runtime flag

**Files:**
- Modify: `src/pages/GetRunningPage.tsx` (the fork at lines 98-102; import at line 15)
- Test: `src/pages/GetRunningPage.test.tsx`

**Interfaces:**
- Consumes: `useGetRunningV3Enabled` (Task A2).
- Produces: nothing new; the page now renders v3 when the runtime flag resolves true, else the unchanged v1 board.

- [ ] **Step 1: Write the failing test** — add a case to `src/pages/GetRunningPage.test.tsx` asserting that with the org override `getrunning_v3_enabled = true` seeded, the page renders the v3 board (assert on a v3-only testid/text, e.g. the hero card heading from `getRunningV3` copy), and with it unset (build flag false) it renders the v1 board. Read the existing test file first to reuse its render helper + how it seeds auth/org, then add the two cases.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/GetRunningPage.test.tsx`
Expected: FAIL — the page still forks on the static const, so the seeded override has no effect.

- [ ] **Step 3: Implement.** In `src/pages/GetRunningPage.tsx`:
  - Remove the `import { GETRUNNING_V3 } from "@/config/flags";` at line 15.
  - Add `import { useGetRunningV3Enabled } from "@/hooks/useGetRunningV3Enabled";`.
  - Near the top of the component, add `const { enabled: v3Enabled } = useGetRunningV3Enabled();` (place it with the other hook calls, above the early returns — hooks must run unconditionally).
  - Replace the fork:

```tsx
  // Wireflow v3 board when the org has it enabled (per-org app_settings override,
  // super-admin-toggled in Settings; falls back to the GETRUNNING_V3 build default).
  // Everything below is the v1 board, unchanged, for orgs still on v1.
  if (v3Enabled) {
    return <GetRunningBoardV3 context="page" />;
  }
```

  Keep the artist `<Navigate>` redirect and the loading skeleton above this. (Note: `useGetRunningV3()` is called inside `GetRunningBoardV3`, and the v1 `useGetRunning()` is called in the v1 branch below — both are already unconditional within their own component trees; adding `useGetRunningV3Enabled` at the top of `GetRunningPage` keeps the page's own hook order stable.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/GetRunningPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/GetRunningPage.tsx src/pages/GetRunningPage.test.tsx
git commit -m "v3 phase 5: GetRunningPage picks board by runtime flag"
```

## Task A4: Super-admin toggle component

**Files:**
- Create: `src/components/getRunning/v3/GetRunningV3Toggle.tsx`
- Test: `src/components/getRunning/v3/GetRunningV3Toggle.test.tsx`

**Interfaces:**
- Consumes: `useGetRunningV3Enabled`, `useSetGetRunningV3Enabled` (Task A2); `useAuth` (`isSuperAdmin`); `Switch`, `Card` primitives; `toast` from sonner; `useTranslation("getRunningV3")`.
- Produces: `GetRunningV3Toggle` — renders **null** for a non-super-admin; for a super-admin renders a small card with a `Switch` bound to the setting, a title, and a one-line explanation that this only affects this org.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/getRunning/v3/GetRunningV3Toggle.test.tsx
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { GetRunningV3Toggle } from "./GetRunningV3Toggle";

describe("GetRunningV3Toggle", () => {
  it("renders nothing for a non-super-admin", () => {
    const { container } = renderWithProviders(<GetRunningV3Toggle />, {
      auth: { isSuperAdmin: false, currentOrg: { id: "org-1" } },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the switch for a super-admin", async () => {
    renderWithProviders(<GetRunningV3Toggle />, {
      auth: { isSuperAdmin: true, currentOrg: { id: "org-1" } },
    });
    expect(await screen.findByRole("switch")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/getRunning/v3/GetRunningV3Toggle.test.tsx`
Expected: FAIL — module not found. (Match `renderWithProviders`'s real `auth` seed shape — read the harness / an existing component test.)

- [ ] **Step 3: Implement.** Render `null` when `!isSuperAdmin`. Otherwise a `Card` with the `Switch` (`checked={enabled}`), `onCheckedChange` firing the mutation and a `toast.success`/`toast.error`; disable while `isLoading` or mutation `isPending`. All strings via `t("toggle.*")`. Match the Settings-card idiom (13px control text, `Eyebrow` for any uppercase label, tokens only). Keep it compact — one row.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/getRunning/v3/GetRunningV3Toggle.test.tsx`
Expected: PASS

- [ ] **Step 5: Add copy + commit.** Add `toggle.*` keys to `src/i18n/locales/{en,de}/getRunningV3.json` (EN canonical, DE Du-form, no dashes). Then:

```bash
git add src/components/getRunning/v3/GetRunningV3Toggle.tsx src/components/getRunning/v3/GetRunningV3Toggle.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 phase 5: super-admin per-org v3 toggle component"
```

---

# PART B — Settings mirror tab

## Task B1: Register the `get-running` settings-tab param

**Files:**
- Modify: `src/lib/settingsTabs.ts` (add `"get-running"` to `SETTINGS_TAB_PARAMS` after `"how-it-works"` — line 26; do NOT add to `ADMIN_ONLY`/`SUPER_ADMIN_ONLY`)
- Test: `src/lib/settingsTabs.test.ts`

- [ ] **Step 1: Write the failing test** — add a case asserting `SETTINGS_TAB_PARAMS` includes `"get-running"` and that `resolveInitialTab("get-running", /*isAdmin*/ true, false, false)` returns `"get-running"` (i.e. an admin deep-linking `?tab=get-running` lands on it, not the default). Read the existing test to reuse its helpers.

- [ ] **Step 2: Run** `npx vitest run src/lib/settingsTabs.test.ts` → FAIL.

- [ ] **Step 3: Implement** — insert `"get-running",` right after `"how-it-works",` in `SETTINGS_TAB_PARAMS` (`src/lib/settingsTabs.ts:26`).

- [ ] **Step 4: Run** `npx vitest run src/lib/settingsTabs.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settingsTabs.ts src/lib/settingsTabs.test.ts
git commit -m "v3 phase 5: add get-running settings tab param"
```

## Task B2: The mirror component `GetRunningSettingsMirror`

**Files:**
- Create: `src/components/getRunning/v3/GetRunningSettingsMirror.tsx`
- Test: `src/components/getRunning/v3/GetRunningSettingsMirror.test.tsx`

**Interfaces:**
- Consumes: `GetRunningV3Toggle` (Task A4); `GetRunningBoardV3` (`context="settings"`).
- Produces: `GetRunningSettingsMirror` — stacks the toggle (super-admin only, self-hiding) above `<GetRunningBoardV3 context="settings" />`.

- [ ] **Step 1: Write the failing test** — assert it renders the board (a v3-only text/testid) and, for a super-admin, also the toggle `switch`.

- [ ] **Step 2: Run** → FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// src/components/getRunning/v3/GetRunningSettingsMirror.tsx
import { GetRunningBoardV3 } from "./GetRunningBoardV3";
import { GetRunningV3Toggle } from "./GetRunningV3Toggle";

/** Settings → Get running mirror: the super-admin runtime toggle above the same
 *  v3 board the standalone page renders, in the settings content frame. */
export function GetRunningSettingsMirror(): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <GetRunningV3Toggle />
      <GetRunningBoardV3 context="settings" />
    </div>
  );
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/getRunning/v3/GetRunningSettingsMirror.tsx src/components/getRunning/v3/GetRunningSettingsMirror.test.tsx
git commit -m "v3 phase 5: GetRunningSettingsMirror (toggle + board)"
```

## Task B3: Mount the mirror tab in `SettingsPage`

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (nav item after `how-it-works` at line 277; `TabsContent` after the `how-it-works` content at ~line 416; new import; `isSuperAdmin` already destructured at line 76)
- Modify: `src/i18n/locales/{en,de}/settings.json` (`nav.items.getRunning`)
- Test: `src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `GetRunningSettingsMirror` (Task B2); `useGetRunningV3Enabled` (Task A2) for the visibility gate.
- Produces: a `get-running` tab, visible when `isSuperAdmin || ((isAdmin || isProducer) && v3Enabled)`.

- [ ] **Step 1: Write the failing test** — add cases to `SettingsPage.test.tsx`: (a) a super-admin sees the "Get running" nav trigger even with v3 disabled; (b) a plain admin does NOT see it when v3 disabled; (c) a plain admin DOES see it when the org override seeds `getrunning_v3_enabled = true`; (d) navigating to `?tab=get-running` (allowed) renders the mirror (assert on the board or toggle). Reuse the file's existing render + seed helpers.

- [ ] **Step 2: Run** `npx vitest run src/pages/SettingsPage.test.tsx` → FAIL.

- [ ] **Step 3: Implement.**
  - Import: `import { GetRunningSettingsMirror } from "@/components/getRunning/v3/GetRunningSettingsMirror";` and `import { useGetRunningV3Enabled } from "@/hooks/useGetRunningV3Enabled";`.
  - Add `const { enabled: v3Enabled } = useGetRunningV3Enabled();` near the other hook reads (~line 147).
  - Define `const showGetRunning = isSuperAdmin || ((isAdmin || isProducer) && v3Enabled);`.
  - In `navGroups`, insert into the `organization` group right after the `how-it-works` item (line 277):

```tsx
      { value: "get-running", label: t('nav.items.getRunning'), icon: Rocket, show: showGetRunning },
```

  (Reuse the `Rocket` icon already imported for `how-it-works`, or pick another already-imported icon; do not add a new lucide import if an apt one exists.)
  - Add the content block right after the `how-it-works` `TabsContent` (~line 416):

```tsx
        {showGetRunning && (
          <TabsContent value="get-running" className="mt-4">
            <GetRunningSettingsMirror />
          </TabsContent>
        )}
```

  - Add `"getRunning": "Get running"` (EN) / `"getRunning": "Loslegen"` (DE — confirm the term against `src/i18n/terms.ts`; if the initiative already localizes the board title, reuse that exact term) to `nav.items` in both `settings.json` files.

- [ ] **Step 4: Run** `npx vitest run src/pages/SettingsPage.test.tsx` and `npx vitest run src/i18n/keyParity.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx src/i18n/locales/en/settings.json src/i18n/locales/de/settings.json src/pages/SettingsPage.test.tsx
git commit -m "v3 phase 5: Settings get-running mirror tab"
```

---

# PART C — Deep-linking into wizard steps

## Task C1: Reverse resolver `stepsForRoute()`

**Files:**
- Modify: `src/lib/getRunning/stepFeature.ts`
- Test: `src/lib/getRunning/stepFeature.test.ts`

**Interfaces:**
- Consumes: `STEP_FEATURE` (existing, `Record<GetRunningStepKey, { route; tab?; crumbKey; shortKey }>`), `GetRunningStepKey`, `ROUTES`.
- Produces:
  - `stepsForRoute(route: string, tab?: SettingsTabParam): GetRunningStepKey[]` — every step key whose `STEP_FEATURE` entry matches `route` (and `tab` when the entry has one). Order is board order (the order keys appear in `STEP_FEATURE`).
  - `PAPERWORK_STEP_KEYS: GetRunningStepKey[]` — the five paperwork steps, exported so the `/contracts` page (which no step routes to) can target that phase.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/lib/getRunning/stepFeature.test.ts
import { stepsForRoute, PAPERWORK_STEP_KEYS } from "./stepFeature";
import { ROUTES } from "@/config/app.config";

it("resolves /dates to its four source steps in order", () => {
  expect(stepsForRoute(ROUTES.BOOKINGS)).toEqual(["source", "connect", "map", "cities"]);
});
it("resolves /productions to the productions step", () => {
  expect(stepsForRoute(ROUTES.PRODUCTIONS)).toEqual(["productions"]);
});
it("resolves /artists to the artists step", () => {
  expect(stepsForRoute(ROUTES.ARTISTS)).toEqual(["artists"]);
});
it("exposes the paperwork steps for the contracts page", () => {
  expect(PAPERWORK_STEP_KEYS).toEqual(["letterhead", "fee", "terms", "document", "countersign"]);
});
```

(Confirm the exact route constants and the `STEP_FEATURE` route values first — `source`/`connect`/`map`/`cities` all point at `ROUTES.BOOKINGS` per the research; if a key's route differs, fix the expectation to match `STEP_FEATURE`.)

- [ ] **Step 2: Run** `npx vitest run src/lib/getRunning/stepFeature.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `stepFeature.ts`:

```ts
const STEP_KEYS = Object.keys(STEP_FEATURE) as GetRunningStepKey[];

/** Every step whose home is this route (+ optional settings tab), in board order.
 *  STEP_FEATURE is forward-only and non-injective (e.g. /dates owns 4 steps), so a
 *  page resolves its "finish setup" target by picking the first not-done step here. */
export function stepsForRoute(route: string, tab?: SettingsTabParam): GetRunningStepKey[] {
  return STEP_KEYS.filter((k) => {
    const f = STEP_FEATURE[k];
    return f.route === route && (tab === undefined || f.tab === tab);
  });
}

/** The paperwork phase's steps. Exported because /contracts (ROUTES.HIRE_ORDERS)
 *  is not the STEP_FEATURE home of any step — the setup steps live at
 *  /settings?tab=hire-orders — so the contracts page targets the phase directly. */
export const PAPERWORK_STEP_KEYS: GetRunningStepKey[] = ["letterhead", "fee", "terms", "document", "countersign"];
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/getRunning/stepFeature.ts src/lib/getRunning/stepFeature.test.ts
git commit -m "v3 phase 5: stepsForRoute reverse resolver"
```

## Task C2: Board reads `?step=`

**Files:**
- Modify: `src/components/getRunning/v3/GetRunningBoardV3.tsx`
- Test: `src/components/getRunning/v3/GetRunningBoardV3.test.tsx`

**Interfaces:**
- Consumes: `useSearchParams` (react-router); the existing `handleOpenStep(phase, step)` + `visibleSteps` + the `model.phases` (each `GetRunningStep` carries `.phase`); the existing `autoOpenedRef` auto-open effect (lines 118-127).
- Produces: page-context deep-link behaviour — when `context === "page"` and `?step=<valid, visible, unblocked key>` is present on mount, the board opens that step (and it wins over `firstBlockingStep`).

- [ ] **Step 1: Write the failing test** — render `<GetRunningBoardV3 context="page" />` inside a router seeded with `?step=artists` and a model where `artists` is visible and its phase is unblocked; assert the wizard for the artists step is mounted (assert on a step-body testid/heading). Add a second case: `context="settings"` ignores `?step=` (so the mirror at `/settings?tab=get-running&...` never hijacks). Reuse the existing test file's model fixture + router wrapper.

- [ ] **Step 2: Run** `npx vitest run src/components/getRunning/v3/GetRunningBoardV3.test.tsx` → FAIL.

- [ ] **Step 3: Implement.**
  - Add `import { useSearchParams } from "react-router-dom";`.
  - In the component: `const [searchParams] = useSearchParams();` and `const stepParam = context === "page" ? searchParams.get("step") : null;`.
  - Add a deep-link effect that runs when the model arrives and takes precedence over auto-open. Guard it with the same `autoOpenedRef` so the two don't fight:

```tsx
  useEffect(() => {
    if (autoOpenedRef.current || !model) return;
    // A valid ?step= wins over the first-blocking auto-open.
    if (stepParam) {
      const target = stepParam as GetRunningStepKey;
      const owner = model.phases.find((p) => visibleSteps(p.steps).some((s) => s.key === target));
      if (owner && owner.waitsOn == null) {
        autoOpenedRef.current = true;
        handleOpenStep(owner.key, target);
        return;
      }
    }
    // Fall through to the existing first-blocking behaviour.
    autoOpenedRef.current = true;
    const step = firstBlockingStep(model);
    if (step) {
      setSelectedPhase(step.phase);
      setSelectedStep(step.key);
    }
  }, [model, stepParam]);
```

  Replace the existing lines 118-127 auto-open effect with this merged one (do not leave two effects both flipping `autoOpenedRef`). `handleOpenStep` (lines 153-161) already validates visibility and `waitsOn`, so an out-of-range param safely no-ops into the fall-through. Keep `handleOpenStep`/`firstBlockingStep`/`visibleSteps` imports intact.

- [ ] **Step 4: Run** → PASS. Also re-run `src/components/getRunning/v3/GetRunningBoardV3.hiddenSteps.test.tsx` and `board.test.tsx` to confirm no regression in the existing auto-open behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/components/getRunning/v3/GetRunningBoardV3.tsx src/components/getRunning/v3/GetRunningBoardV3.test.tsx
git commit -m "v3 phase 5: board opens ?step= deep link (page context)"
```

## Task C3: The shared `FinishSetupLink` affordance

**Files:**
- Create: `src/components/getRunning/v3/FinishSetupLink.tsx`
- Test: `src/components/getRunning/v3/FinishSetupLink.test.tsx`
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json` (affordance copy)

**Interfaces:**
- Consumes: `useGetRunningV3Enabled` (Task A2); `useGetRunningV3` (`{ model, isLoading }`); `stepsForRoute` + `PAPERWORK_STEP_KEYS` (Task C1); `visibleSteps` from `steps.ts`; `Link` (react-router); `ROUTES`; `Button` (variant link/outline sm); `useTranslation("getRunningV3")`.
- Produces: `FinishSetupLink({ steps }: { steps: GetRunningStepKey[] })` — given a candidate step-key list, renders **null** unless: v3 is enabled AND the model is loaded AND at least one candidate step is visible, not-done, and `actionableByViewer`. When it renders, it links to `${ROUTES.GET_RUNNING}?step=<first such key>` with a short "Finish setup" label naming the step.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/getRunning/v3/FinishSetupLink.test.tsx
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { FinishSetupLink } from "./FinishSetupLink";

describe("FinishSetupLink", () => {
  it("renders nothing when v3 is disabled", () => {
    const { container } = renderWithProviders(<FinishSetupLink steps={["artists"]} />, {
      auth: { currentOrg: { id: "org-1" } },
      // v3 disabled (no app_settings override, build flag false)
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("links to the first not-done candidate step when v3 is enabled", async () => {
    renderWithProviders(<FinishSetupLink steps={["artists"]} />, {
      auth: { currentOrg: { id: "org-1" } },
      supabaseSeed: {
        app_settings: [{ org_id: "org-1", key: "getrunning_v3_enabled", value: true }],
        // seed data such that the `artists` step is not done + actionable
      },
    });
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", expect.stringContaining("/get-running?step=artists"));
  });
});
```

(The second case depends on the `useGetRunningV3` model deriving `artists` as not-done from seed data — read `src/hooks/useGetRunningV3.ts` + `src/lib/getRunning/steps.ts` to learn which signals drive `artists.done`, and seed accordingly, OR, if seeding the whole model is heavy, factor the pure decision into a helper `pickFinishStep(model, candidates)` and unit-test that directly, then keep the component test to the v3-disabled null case + a smoke render. Prefer the pure-helper split — it is DRY and avoids fixture sprawl.)

- [ ] **Step 2: Run** `npx vitest run src/components/getRunning/v3/FinishSetupLink.test.tsx` → FAIL.

- [ ] **Step 3: Implement.** Compute `enabled` from `useGetRunningV3Enabled`; short-circuit `null` when disabled or model loading. Flatten the model's visible steps, intersect with the `steps` prop, pick the first that is `!done && actionableByViewer && !hidden`. If none, return `null`. Otherwise render a `Link to={`${ROUTES.GET_RUNNING}?step=${key}`}` styled as a subtle button (`variant="outline" size="sm"` or a link-styled button per the header idiom), label `t("finishSetup.label")` (e.g. EN "Finish setup" / DE "Einrichtung abschließen" — confirm against TERMS). Keep the pure pick in a co-located `pickFinishStep(model, candidates)` for testability.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Add copy + commit.** Add `finishSetup.*` keys to both `getRunningV3.json`. Then:

```bash
git add src/components/getRunning/v3/FinishSetupLink.tsx src/components/getRunning/v3/FinishSetupLink.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 phase 5: FinishSetupLink deep-link affordance"
```

## Task C4: Wire the affordance into the four page headers

**Files:**
- Modify: `src/pages/ProductionsPage.tsx` (header action area ~line 195), `src/pages/ArtistsPage.tsx` (action cluster `div` line 235), `src/pages/HireOrdersPage.tsx` (action cluster `div` line 137), `src/pages/ShowsBookingsPage.tsx` (producer header ~lines 496-503, right side currently empty)
- Test: the co-located `*.test.tsx` for each page (smoke: the affordance mounts and, with v3 disabled, is absent)

**Interfaces:**
- Consumes: `FinishSetupLink` + `stepsForRoute`/`PAPERWORK_STEP_KEYS` + `ROUTES`.

For each page, add one `<FinishSetupLink steps={...} />` into the header, computing `steps` via the resolver so the wiring stays declarative:
- **ProductionsPage:** `steps={stepsForRoute(ROUTES.PRODUCTIONS)}` → `["productions"]`. Place beside the "New production" button.
- **ArtistsPage:** `steps={stepsForRoute(ROUTES.ARTISTS)}` → `["artists"]`. Place in the `flex items-center gap-2` cluster (line 235).
- **HireOrdersPage:** `steps={PAPERWORK_STEP_KEYS}` (no step routes to `/contracts`). Place in the `flex items-center gap-2` cluster (line 137).
- **ShowsBookingsPage (producer branch only):** `steps={stepsForRoute(ROUTES.BOOKINGS)}` → `["source","connect","map","cities"]`. Add a right-side element to the header flex (lines 496-503). Do NOT touch the artist branch.

- [ ] **Step 1: Write the failing test** — for each page test, assert the affordance is absent with v3 disabled (default). Keep it light; the affordance's own logic is unit-tested in C3. Read each page test to reuse its render/seed.

- [ ] **Step 2: Run** the four page tests → they should PASS immediately for the "absent when disabled" assertion once the component is imported and mounted (since `FinishSetupLink` returns null when disabled). If a test asserts presence-when-enabled, seed the override. Treat any failure as a wiring bug.

- [ ] **Step 3: Implement** the four header edits (import `FinishSetupLink`, `stepsForRoute`/`PAPERWORK_STEP_KEYS`, `ROUTES` as needed). No new copy (the label lives in `FinishSetupLink`).

- [ ] **Step 4: Run** all four page test files → PASS. Run `npm run lint` on the touched files.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProductionsPage.tsx src/pages/ArtistsPage.tsx src/pages/HireOrdersPage.tsx src/pages/ShowsBookingsPage.tsx src/pages/*.test.tsx
git commit -m "v3 phase 5: finish-setup affordance on dates/productions/artists/contracts"
```

---

# PART D — Sources console (Airtable + Sheet)

## Task D1: Data layer — include Sheet runs, tag by source

**Files:**
- Modify: `src/data/airtableSync.ts` (`SyncLogSummary` lines 4-14, `SYNC_LOG_COLS` line 16, the two `.eq("sync_type","airtable_poll")` filters at lines 37 & 54)
- Test: `src/data/airtableSync.test.ts`

**Interfaces:**
- Produces: `SyncLogSummary` gains `sync_type: string`; `fetchLatestSyncLog`/`fetchRecentSyncLogs` no longer hard-filter to `airtable_poll` — they return both `airtable_poll` and `sheet_import` runs (org-scoped), newest first, so the console shows a unified history.

- [ ] **Step 1: Write the failing test** — seed `airtable_sync_log` with one `airtable_poll` row and one `sheet_import` row for the org; assert `fetchRecentSyncLogs` returns both (ordered by `synced_at` desc) and each carries its `sync_type`. Assert `fetchLatestSyncLog` returns the newer of the two.

- [ ] **Step 2: Run** `npx vitest run src/data/airtableSync.test.ts` → FAIL (current code filters out `sheet_import` and `SyncLogSummary` has no `sync_type`).

- [ ] **Step 3: Implement** — add `sync_type` to the `SyncLogSummary` interface and to `SYNC_LOG_COLS` (`"id, sync_type, status, records_processed, imported_count, new_count, updated_count, held_count, error_details, synced_at"`); remove `.eq("sync_type","airtable_poll")` from both queries (keep `.eq("org_id", orgId)` + the ordering/limit). Decide (and comment) whether to keep `airtable_poll` + `sheet_import` only or all sync types — restrict to those two with `.in("sync_type", ["airtable_poll","sheet_import"])` so an unrelated future sync type doesn't leak into this console.

- [ ] **Step 4: Run** `npx vitest run src/data/airtableSync.test.ts` → PASS. Then grep for other `SyncLogSummary` consumers (`useAirtableConsole`, plus v3 airtable step components if any consume it) and run their tests — a widened interface is additive and should not break them.

- [ ] **Step 5: Commit**

```bash
git add src/data/airtableSync.ts src/data/airtableSync.test.ts
git commit -m "v3 phase 5: sync console reads Airtable + Sheet runs"
```

## Task D2: Console UI — source tag + no-next-run for sheet + "Sources" rename

**Files:**
- Modify: `src/hooks/useAirtableConsole.ts` (`deriveKpis` "Next run" tile — sheet runs are manual, no scheduled next run)
- Modify: `src/components/settings/airtable/ActivityTab.tsx` + `OverviewTab.tsx` + `StatusHeader.tsx` (show each run's source; header eyebrow copy)
- Modify: `src/components/settings/airtable/console.ts` (`deriveKpis`) if the next-run guard lives there
- Modify: `src/i18n/locales/{en,de}/settings.json` (`nav.items.airtable` value → "Sources" / "Quellen" — confirm DE against TERMS) and `src/i18n/locales/{en,de}/settingsAirtable.json` (console eyebrows/titles that say "Airtable" → source-neutral "Sources"/"Sync")
- Test: the touched components' `*.test.tsx` + `src/components/settings/airtable/console.test.ts`

**Interfaces:**
- Consumes: `SyncLogSummary.sync_type` (Task D1).

- [ ] **Step 1: Write the failing test** — (a) `console.test.ts`: `deriveKpis` for a latest run with `sync_type="sheet_import"` omits (or renders "manual"/empty for) the "Next run" tile; for `airtable_poll` it still shows the interval-based next run. (b) `ActivityTab.test.tsx`: a run list with mixed `sync_type`s renders a per-row source label (assert both "Airtable" and "Sheet" appear). Read the existing tests to reuse fixtures.

- [ ] **Step 2: Run** the three test files → FAIL.

- [ ] **Step 3: Implement** — in `deriveKpis`, gate the "Next run" tile on `latest.sync_type === "airtable_poll"` (a manual sheet import has no next scheduled run — render "Manual" or drop the tile). In `ActivityTab`/`OverviewTab`, render a small source tag per run (a `StatusPill`/`Eyebrow`-styled label from `sync_type`, copy `t("source.airtable")`/`t("source.sheet")`). Rename the tab label (`settings.json` `nav.items.airtable`) and any "Airtable"-worded console eyebrows/headers in `settingsAirtable.json` to "Sources"/"Sync" — but **do not rename the `value="airtable"` tab key** (line 287/468 in SettingsPage) so `?tab=airtable` and existing deep links keep working. Keep Airtable-specific setup copy (PAT, base, table, view) as-is; only the source-neutral chrome changes.

- [ ] **Step 4: Run** the touched tests + `npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAirtableConsole.ts src/components/settings/airtable/ src/i18n/locales/en/settings.json src/i18n/locales/de/settings.json src/i18n/locales/en/settingsAirtable.json src/i18n/locales/de/settingsAirtable.json
git commit -m "v3 phase 5: rename Airtable Sync to Sources, tag runs by source"
```

---

# PART E — Toggle-aware retirement

## Task E1: `useGetRunningNavVisible` branches on the runtime flag

**Files:**
- Modify: `src/hooks/useGetRunningNavVisible.ts`
- Test: `src/hooks/useGetRunningNavVisible.test.ts`

**Interfaces:**
- Consumes: `useGetRunningV3Enabled` (Task A2), `useGetRunningV3` (v3 model), `useGetRunning` (v1 model, kept), `useRailDismissed`.
- Produces: unchanged return type (`boolean`). When v3 is enabled for the org, nav visibility/retirement is driven by the **v3** model (`GetRunningModelV3.complete`/`bookingOn`/`hireOrdersOn`); when disabled, the existing **v1** path is byte-unchanged.

- [ ] **Step 1: Write the failing test** — add a case: with v3 enabled + a complete v3 model + dismissed, the hook returns `false` (nav retires); with v3 disabled it still uses the v1 model (existing cases stay green). Read the existing test to reuse its seeding.

- [ ] **Step 2: Run** `npx vitest run src/hooks/useGetRunningNavVisible.test.ts` → FAIL.

- [ ] **Step 3: Implement** — call both `useGetRunning()` and `useGetRunningV3()` (hooks must run unconditionally) plus `useGetRunningV3Enabled()`, then select `const model = v3Enabled ? v3Model : v1Model;` and apply the same visibility rules (`!bookingOn && !hireOrdersOn → false`; `complete && dismissed → false`; else true). Note both model types expose `complete`/`bookingOn`/`hireOrdersOn` (v3: `src/lib/getRunning/steps.ts:66-68`), so the downstream logic is identical. Keep `useRailDismissed("getRunning", orgId)`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGetRunningNavVisible.ts src/hooks/useGetRunningNavVisible.test.ts
git commit -m "v3 phase 5: nav retirement uses v3 model when v3 enabled"
```

## Task E2: v3 retired state gains hide-from-nav + Settings link

**Files:**
- Modify: `src/components/getRunning/v3/GetRunningBoardV3.tsx` (the inline `RetiredBoardV3`, lines 47-65)
- Test: `src/components/getRunning/v3/GetRunningBoardV3.test.tsx`

**Interfaces:**
- Consumes: `useRailDismissed("getRunning", orgId)` (same key the v1 `RetiredBoard` uses, so the two share dismissal state); `ROUTES.SETTINGS`; `Link`/`Button`.

- [ ] **Step 1: Write the failing test** — render the board with a complete model; assert the retired state shows a "hide from nav" control and a link to Settings (`/settings?tab=get-running`). Clicking hide calls the dismiss setter (spy via the rail-dismissed hook or assert the persisted flag). Reuse the existing complete-model fixture in the test file.

- [ ] **Step 2: Run** `npx vitest run src/components/getRunning/v3/GetRunningBoardV3.test.tsx` → FAIL.

- [ ] **Step 3: Implement** — in `RetiredBoardV3`, wire a `useRailDismissed("getRunning", orgId)` dismiss button ("Hide from the sidebar") and a `Link to={`${ROUTES.SETTINGS}?tab=get-running`}` ("Manage in Settings"), matching the v1 `RetiredBoard` behaviour and the v3 visual idiom. `orgId` is already in scope in the board component; if `RetiredBoardV3` is a nested function without it, pass `orgId` as a prop.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Add copy + commit** — any new strings into `getRunningV3.json` (EN+DE). Then commit the board + copy.

```bash
git add src/components/getRunning/v3/GetRunningBoardV3.tsx src/components/getRunning/v3/GetRunningBoardV3.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 phase 5: v3 retired state hide-from-nav + settings link"
```

---

# PART F — Deprecation map, i18n gate, release

## Task F1: Settings deprecation map doc

**Files:**
- Create: `docs/superpowers/specs/wireflow-v3-settings-deprecation.md`

- [ ] **Step 1: Write the doc.** One table: every Settings tab the wizard now duplicates, with a keep/redirect/retire recommendation and the reason, sourced from spec §8. Redundant editing surfaces (recommend later redirect-into-board): Booking engine (flow+timing), Casts & coverage (coverage), Skills (skills), Contracts settings (letterhead/fee/terms/document/countersign). Keep untouched: Sources (Airtable+Sheet), People, Roles & rights, Activity, Trust & data, Documentation, Organization, Notifications, Email templates. State explicitly: **no tab is removed in this initiative without separate owner approval; this document is a recommendation, not an action.**

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/wireflow-v3-settings-deprecation.md
git commit -m "v3 phase 5: settings deprecation map"
```

## Task F2: Add `getRunningV3` to key-parity + close i18n gates

**Files:**
- Modify: `src/i18n/keyParity.test.ts` (add `'getRunningV3'` to the namespace list at line 23)

- [ ] **Step 1:** Add `'getRunningV3'` to the parity `for` loop namespace list.
- [ ] **Step 2: Run** `npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts` → PASS. If parity fails, reconcile EN/DE keys in `getRunningV3.json` until green (this catches any earlier task that added an EN key without its DE twin).
- [ ] **Step 3: Commit**

```bash
git add src/i18n/keyParity.test.ts src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 phase 5: enforce getRunningV3 key parity"
```

## Task F3: Help center + changelog + version bump

**Files:**
- Modify: `src/lib/help/items.ts` (EN+DE) if a help item references the "Airtable Sync" tab (the rename to "Sources" likely warrants an edit); else state "No help center impact." in the PR.
- Modify: `public/changelog.md`, then regenerate `public/changelog.json`; `package.json` `version`; `src/config/app.config.ts` `APP_META.VERSION`.

- [ ] **Step 1: Help.** Grep `src/lib/help/items.ts` for "Airtable"; if a user-facing help item names the tab, update EN+DE to "Sources" (Du-form, no dashes). Otherwise record "No help center impact."

- [ ] **Step 2: Changelog.** Bump `1.17.2 → 1.18.0` (new user-facing feature: the Sources console now shows Google Sheet imports; the tab is renamed to Sources). **Do NOT announce the v3 Get running board** — it is still behind a super-admin per-org toggle (and per CLAUDE.md, super-admin/platform actions are never in the changelog). Add a newest-first block to `public/changelog.md`:

```markdown
## 1.18.0 — Aug 23, 2026

*Sources: one home for every date feed*

### Improved
- **Sources** — the Airtable sync settings are now "Sources" and show your Google Sheet imports alongside Airtable runs, each tagged by where it came from.
```

  (Adjust wording to house voice; no dashes, no exclamation marks.)

- [ ] **Step 3: Regenerate JSON + bump versions.** Run `deno run --allow-read --allow-write scripts/changelog-to-json.ts`. Set `version` in `package.json` and `APP_META.VERSION` in `src/config/app.config.ts` to `1.18.0`.

- [ ] **Step 4: Commit**

```bash
git add public/changelog.md public/changelog.json package.json src/config/app.config.ts src/lib/help/items.ts
git commit -m "v3 phase 5: Sources changelog + v1.18.0"
```

## Task F4: Full verification + live visual + PR

- [ ] **Step 1: Static + unit.** Run `npm run lint`, `npx tsc -p tsconfig.app.json --noEmit`, `npx vitest run` (or `npm run verify:fast`). All green, `--max-warnings 0`.

- [ ] **Step 2: Live dev-stack visual (light + dark)** via the preview tools:
  - Settings → new "Get running" tab: super-admin sees the toggle; flipping it on/off flips `/get-running` between v3 and v1 (reload); the mirror board renders in the settings frame (no double padding).
  - `/get-running?step=artists` (and one paperwork deep link) opens the right wizard step.
  - Each of `/dates`, `/productions`, `/artists`, `/contracts`: the "Finish setup" affordance appears only when v3 is enabled and the step is not done, and links into the board.
  - Settings → Sources: the console shows a Sheet run tagged as such, no "Next run" tile for it; label reads "Sources".
  - Verify no console errors (`read_console_messages`), take screenshots for the PR.

- [ ] **Step 3: Open the PR.** Push the branch (`SHOWFLOW_SKIP_VERIFY=1` if the secret-scan hook stalls). `gh pr create --title "Wireflow v3 Phase 5: Settings mirror, runtime v3 toggle, deep-linking, Sources" --body-file <file>` (memory [[pr-body-via-file-not-heredoc]]). PR body: what shipped, the three owner decisions, **explicitly note v1 is NOT deleted and the flag is NOT hard-flipped** (deferred cutover, gated on owner testing), the per-org super-admin toggle path, "No page mini change.", and the help-center line. Do NOT self-merge (owner approval required).

---

## Self-Review notes (author)

- **Spec §8 coverage:** mirror (B), retirement (E1/E2), deep-linking (C), Airtable→Sources (D), deprecation map (F1). ✅ The only §8/§10 item deliberately deferred is "flip the flag on; delete v1 board code" — replaced by the owner-chosen runtime toggle (A) per the 2026-08-23 decision; the deletion is a named follow-up phase.
- **`tasks.ts` survival:** no task deletes it (AcceptInvitePage depends on it). ✅
- **Flag semantics:** the build const `GETRUNNING_V3` is kept as the resolver fallback everywhere (A1 fallback arg, A2 loading default, E1 nothing removed). ✅
- **`?tab=airtable` stability:** D2 renames only labels/copy, never the tab `value`. ✅
- **Type/name consistency:** `useGetRunningV3Enabled` returns `{ enabled, isLoading }` (used identically in A3, B3, E1, C3); `stepsForRoute`/`PAPERWORK_STEP_KEYS` names match between C1 and C4. ✅
