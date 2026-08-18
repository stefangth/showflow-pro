# Get Running In-Panel Editors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Honor the Get-running board's core premise — "every task is finished in a panel on the same screen, so nobody is sent into a settings tab to guess" — by replacing the five task panels that currently reuse the old setup-rail *link-out* bodies (`dates`, `people`, `team`, `ladder`, `eligibility`) with genuine in-panel editors, and retire the now-redundant `/settings?tab=sync-log` tab.

**Architecture:** Each of the five panels gets a purpose-built body component under `src/components/getRunning/panels/` that renders inside the existing `TaskPanel` frame's scroll slot and reuses the proven `src/data/*` functions + mutation patterns from the Settings surfaces (never re-implementing the writes). Heavy flows that genuinely can't fit a 440px column open the *existing* surface as a controlled overlay (`ArtistImportDialog`, `AirtableSyncTab`, `ShowFormDialog`) rather than navigating away. `taskPanelRegistry.tsx` swaps each old step for its new panel body one task at a time; a final cleanup task deletes the orphaned steps and runs full verification.

**Tech Stack:** React 18 + TS + Vite, Tailwind v3 + shadcn/ui (Radix), react-router v6, @tanstack/react-query v5, react-i18next (EN + DE), vitest + @testing-library/react. Data-access via `src/data/*` with the `supabaseFake` test harness (`src/test/supabaseFake.ts`, `renderWithProviders.tsx`, `fixtures.ts`).

**Spec:** `docs/superpowers/specs/2026-08-17-setup-settings-design/` — the imported design. Screens for this plan: `screens/01_01_Get_running.html` (the `ladder` "Cast priorities" panel, drawn verbatim) and `screens/02_02_Task_panels.html` (the choice/values/document frame + footer). Approved before/after mock: the "In-Panel Task Editors" artifact (published this session). Two owner decisions locked: (1) bulk artist import opens `ArtistImportDialog` as an **overlay** on the board; (2) first-time Airtable connect is deferred to design screen 11 (later phase) — the `dates` panel shows the **steady state** in-panel now and opens the existing `AirtableSyncTab` as an overlay for the connect/manage path until then.

## Global Constraints

- **Package manager:** npm only (`npm ci`); never create bun/yarn/pnpm lockfiles.
- **Lint gate:** `npm run lint` is zero-warning (`--max-warnings 0`). `any` is banned — use an explicit row interface + single `as unknown as` cast at the query boundary, or the typed test helpers (`src/test/castHelpers.ts`).
- **Typecheck is three projects** — run all three after each task: `npx tsc -p tsconfig.app.json --noEmit` (covers `src/`), `npx tsc -p tsconfig.tools.json --noEmit`, `deno check --node-modules-dir=none supabase/functions/*/index.ts` (only if an edge fn is touched — none is in this plan).
- **Tokens (verified 2026-08-17):** semantic Tailwind utility where one exists, else the CSS-var arbitrary form `*-[var(--token)]`, never a raw hex. `#6E5CF6`→`bg-primary`/`text-primary` (filled ticks, primary buttons, brand only); **accent TEXT/links `#5848D8`→`text-accent-600`** (eyebrows, action links, "Pick tier 1", "Link a cast") — never `text-primary` for text; active-nav text `#4738B0`→`text-accent-700`; `#F6F4EF`→`bg-background`; `#FFFFFF`→`bg-card`; `#FAF8F4`→`bg-muted`; `#EFEDE7`→`bg-[var(--surface-3)]`; `#5B5A57`→`text-muted-foreground`; `#8B8A85`→`text-[var(--text-faint)]`; `#E6E3E0`→`border-border`. Accent stops `bg-accent-50..900` do NOT take opacity modifiers (silently solid). Shadows → `shadow-elev1..4`, never `shadow-[var(--shadow-2)]`. **No underlined `text-primary` links** — the old steps' `text-primary underline` is exactly the color bug being removed.
- **Badges/chips — existing `Badge` variants only** (`amber-*`/`surface` are NOT registered Tailwind colors): amber "Blocks …" → `variant="risk"`; green "Covered / All covered" → `variant="confirmed"`; grey "Admin only / neutral" → `variant="neutral"`; violet "Open / Current" → `variant="accent"`. Inline amber fills → `bg-[var(--amber-100)] text-[var(--amber-600)]`.
- **i18n:** every new user-facing string via `t()` in the existing `getRunning` namespace, EN **and** DE authored in the same task (`src/i18n/keyParity.test.ts` fails CI on any gap). German uses informal "Du"; **no em/en dashes anywhere in copy** (`copyLint.test.ts` enforces both). Reuse `src/i18n/terms.ts` `TERMS` for domain terms.
- **Role literals:** the `producer` role displays as "Production Team" via `roleLabel()` (`src/config/app.config.ts`); never compare against the display string, always the literal `'producer'`.
- **Query keys:** hierarchical `['domain','sub',...params]`; mutations invalidate the whole domain prefix. Reuse the EXACT keys the Settings surfaces already use so an open panel shares their cache (listed per task).
- **Calendars:** week starts Monday (`weekStartsOn={1}`) — only relevant if a step editor renders a calendar (none here).
- **Tests import the real module** — never re-implement production logic in a test. Test behavior, not implementation details. Data-access via `supabaseFake`; components via `renderWithProviders`.
- **Producer path unchanged:** these panels render only for `task.actionableByViewer === true` (admins, or a producer who holds the capability). A producer who cannot act still gets `TaskPanel`'s existing `WaitsOnPanelBody` (a named "Waits on {admin}" + a Settings deep-link) — do NOT remove that branch; it is correct for a viewer who genuinely cannot edit.
- **Commit frequently** — one per task minimum, imperative lowercase ≤72 chars, end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. Do not push until the plan says to (Task 8). Branch is already `claude/pr-311-design-review-992808`.

---

## File Structure

**New files**
- `src/components/getRunning/panels/UnlocksNote.tsx` — the shared "What this unlocks" accent-50 callout (screen 01/02). One responsibility: render an accent note block.
- `src/components/getRunning/panels/TeamPanelBody.tsx` (+ `.test.tsx`) — inline producer invite + roster.
- `src/components/getRunning/panels/PeoplePanelBody.tsx` (+ `.test.tsx`) — roster count + inline add-artist + "Import a sheet" overlay.
- `src/components/getRunning/panels/DatesPanelBody.tsx` (+ `.test.tsx`) — Airtable sync status + held-records + "add a show" overlay + "Set up / manage Airtable sync" overlay.
- `src/components/getRunning/panels/LadderPanelBody.tsx` (+ `.test.tsx`) — per-city tier-1 picker (the "Cast priorities" editor).
- `src/components/getRunning/panels/EligibilityPanelBody.tsx` (+ `.test.tsx`) — per show×city coverage gaps + "Link a cast".

**Modified files**
- `src/components/getRunning/taskPanelRegistry.tsx` — swap `ShowsStep`/`PeopleStep`/`TeamStep`/`LadderStep`/`EligibilityStep` for the new panel bodies (one task each). Keep `SlotsStep`/`FlowStep`/`TimingStep`/`LetterheadStep`/`TermsStep`/`CountersignStep` untouched — they are already genuine in-panel forms.
- `src/i18n/locales/en/getRunning.json` + `src/i18n/locales/de/getRunning.json` — new `panel.eyebrow.*` / `panel.footerNote.*` wording for the five keys, plus a new `panel.body.*` subtree for the editors' inline copy.
- `src/pages/SettingsPage.tsx` + `src/i18n/locales/{en,de}/settings.json` — remove the redundant `sync-log` tab (Task 1).

**Deleted files (Task 8, grep-guarded)**
- `src/components/bookings/setup/ShowsStep.tsx`, `PeopleStep.tsx`, `TeamStep.tsx`, `LadderStep.tsx`, `EligibilityStep.tsx` and their co-located tests — only after confirming no consumer outside `taskPanelRegistry.tsx` remains.

---

## Task decomposition & self-review note

Task 1 (sync-log retirement) is independent and low-risk — a clean warm-up. Tasks 2–6 each build one panel body, wire its registry entry, and add its i18n, so each is independently reviewable end-to-end (a reviewer can accept `team` while `ladder` is still pending). Order is by ascending complexity: `team` (pure invite form) → `people` (form + overlay) → `dates` (status + two overlays) → `ladder` (mutation grid) → `eligibility` (coverage grid). Task 7 is the visual + full-suite gate; Task 8 is the risky delete-orphans sweep with its own typecheck gate. The single design-mapping decision (which flows stay overlays vs full in-panel) is locked by the two owner decisions in the header.

---

### Task 1: Retire the redundant `/settings?tab=sync-log` tab

The Airtable sync surface (`AirtableSyncTab`) already owns full sync history — latest + 30 recent runs + an Activity runs tab (`["airtable","sync-log",orgId]` / `["airtable","recent-logs",orgId]`). PR 311 additionally folded the old Admin sync-log card into a separate Settings `sync-log` tab (`["admin-sync",orgId]` via `fetchAdminSyncLogs`). That is a duplicate; remove the standalone tab.

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (remove the `sync-log` nav item, its `useQuery`, the `SYNC_LOG_LIMIT` const, the `<TabsContent value="sync-log">` body, and the now-unused `fetchAdminSyncLogs` import + `Database` icon import if unused elsewhere)
- Modify: `src/i18n/locales/en/settings.json`, `src/i18n/locales/de/settings.json` (remove `nav.items.syncLog` and the `syncLog.*` subtree, EN + DE, keeping parity)
- Test: `src/pages/SettingsPage.people.test.tsx` (or the nearest existing SettingsPage test) — assert no sync-log tab renders

**Interfaces:**
- Consumes: nothing new.
- Produces: `SettingsPage` no longer renders a `sync-log` tab; `fetchAdminSyncLogs` is unreferenced in `SettingsPage.tsx`.

- [ ] **Step 1: Inventory the exact lines.** `grep -n "sync-log\|syncLog\|SyncLog\|fetchAdminSyncLogs\|SYNC_LOG_LIMIT\|admin-sync" src/pages/SettingsPage.tsx` and `grep -rn "syncLog\|sync-log" src/i18n/locales/{en,de}/settings.json`. Confirm `fetchAdminSyncLogs` is imported only in `SettingsPage.tsx` (`grep -rn fetchAdminSyncLogs src/`) — if `src/data/admin.ts` still exports it and no one else uses it, leave the export (harmless) but note it.

- [ ] **Step 2: Write the failing test.** In the SettingsPage test file, render as admin with `renderWithProviders` and assert the sync-log tab is gone:

```tsx
it('no longer renders a standalone sync-log tab', async () => {
  renderWithProviders(<SettingsPage />, { role: 'admin' /* match the file's existing helper */ });
  // The tab trigger label came from settings.json nav.items.syncLog.
  expect(screen.queryByRole('tab', { name: /sync log/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run — expect FAIL** (the tab still renders): `npx vitest run src/pages/SettingsPage.people.test.tsx`

- [ ] **Step 4: Implement the removal.** Delete: the `{ value: "sync-log", ... }` nav item (~line 310), the `syncLogs` `useQuery` block (~lines 180-184), `SYNC_LOG_LIMIT` (~line 45), the `<TabsContent value="sync-log">…</TabsContent>` body (~lines 492-516), and the `fetchAdminSyncLogs` import if now unused. If `Database` (lucide) is now unused in the file, drop it from the import. Remove `nav.items.syncLog` + the `syncLog` object from both `settings.json` files. Leave the Activity/audit tab as-is (it is not a duplicate).

- [ ] **Step 5: Run — expect PASS**, plus parity + lint + typecheck: `npx vitest run src/pages/SettingsPage.people.test.tsx src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`.

- [ ] **Step 6: Commit** `refactor(settings): retire redundant sync-log tab (lives in Airtable sync)`.

---

### Task 2: `team` panel — inline producer invite (screen 02 "values" shape)

Replace `TeamStep` (a link-out to People) with an in-panel invite: the current team roster + an email + role field that calls the existing `create-invitation` path. Admin-only task (`team.adminOnly === true`), so this body renders only for an admin viewer.

**Files:**
- Create: `src/components/getRunning/panels/UnlocksNote.tsx`
- Create: `src/components/getRunning/panels/TeamPanelBody.tsx`, `TeamPanelBody.test.tsx`
- Modify: `src/components/getRunning/taskPanelRegistry.tsx` (import + render `TeamPanelBody` for `case "team"`)
- Modify: `src/i18n/locales/{en,de}/getRunning.json` (rewrite `panel.eyebrow.team`, `panel.footerNote.team`; add `panel.body.team.*`)

**Interfaces:**
- Consumes: `useOrgMembers(orgId)` → `{ data?: OrgMember[] }` where `OrgMember = { user_id; email; display_name; roles: AppRole[]; last_sign_in_at }` (`src/hooks/useOrgMembers.ts`, `src/data/members.ts:6`); `useInvitationMutations(orgId)` → `{ create }` with `create.mutate({ email, role })` (`src/hooks/useInvitationMutations.ts:11`); `roleLabel` (`src/config/app.config.ts`); the `AppRole` literal `'producer'`.
- Produces: `<TeamPanelBody orgId={string|null} onDone={() => void} />`; `<UnlocksNote>{children}</UnlocksNote>` (label from `getRunning:panel.unlocksLabel`).

- [ ] **Step 1: Build `UnlocksNote`.** A pure presentational block matching the design callout: `<div className="rounded-[var(--radius-l)] border border-accent-200 bg-accent-50 p-3 flex flex-col gap-1">` with an uppercase `text-[11px] font-semibold tracking-[1.6px] text-accent-700` label (`t('panel.unlocksLabel')` = "What this unlocks") and a `text-[13px] leading-[19px]` body slot for `children`. Add `panel.unlocksLabel` to both getRunning.json files ("What this unlocks" / "Was das freischaltet").

- [ ] **Step 2: Write the failing test** `TeamPanelBody.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeSupabaseFake } from '@/test/supabaseFake'; // match the harness's actual export
import { TeamPanelBody } from './TeamPanelBody';

it('invites a producer without leaving the panel', async () => {
  // Seed the fake so list_org_members returns one admin, and create-invitation succeeds.
  const { client, calls } = makeSupabaseFake({ /* seed per supabaseFake conventions */ });
  renderWithProviders(<TeamPanelBody orgId="org-1" onDone={() => {}} />, { client, role: 'admin' });

  await userEvent.type(screen.getByLabelText(/invite by email/i), 'lena@nordstadt.de');
  await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

  await waitFor(() => {
    // create-invitation edge fn invoked with role 'producer'
    expect(calls.functionInvocations).toContainEqual(
      expect.objectContaining({ name: 'create-invitation', body: expect.objectContaining({ role: 'producer', email: 'lena@nordstadt.de' }) }),
    );
  });
  // no navigation / no link out
  expect(screen.queryByRole('link', { name: /people|admin/i })).not.toBeInTheDocument();
});
```

Adjust the seed/assert helpers to the real `supabaseFake` API (read `src/test/supabaseFake.ts` and an existing `src/data/*.test.ts` first; the shapes above are the intent, not verbatim helper names).

- [ ] **Step 3: Run — expect FAIL** (`TeamPanelBody` undefined): `npx vitest run src/components/getRunning/panels/TeamPanelBody.test.tsx`

- [ ] **Step 4: Implement `TeamPanelBody`.** Structure:
  - `const { data: members } = useOrgMembers(orgId);` render a compact roster well (`bg-muted`, one `minirow` per member: a 24px `bg-accent-100 text-accent-700` initials avatar, `display_name || email`, right-aligned `roleLabel(member.roles[0])`).
  - A `field`: `<label>` "Invite by email" + a two-up row: an email `<Input>` (react-hook-form or a plain controlled `useState` is fine here — no zod schema needed for one field, but validate non-empty + basic email shape before enabling the button) and a role display fixed to Production Team (this task only invites producers; render a static `roleLabel('producer')` pill, not a select — keep scope tight).
  - `const { create } = useInvitationMutations(orgId);` submit → `create.mutate({ email, role: 'producer' }, { onSuccess: () => { setEmail(''); onDone(); } })`. Disable the button while `create.isPending` or the email is invalid; surface `create.isError` via `toast.error` (sonner) — the hook already invalidates `["org-invitations"]`+`["members"]`.
  - `<UnlocksNote>{t('panel.body.team.unlocks')}</UnlocksNote>`.
  - The primary "Send invite" button lives in THIS body (bottom), exactly like `FlowStep`/`TimingStep` render their own primary — `TaskPanel`'s footer stays chrome-only (note + Later).
  - All copy via `t('panel.body.team.*')`; add EN+DE: `emailLabel` ("Invite by email"/"Per E-Mail einladen"), `emailPlaceholder`, `send` ("Send invite"/"Einladung senden"), `roleFixed` (reuse `roleLabel`), `unlocks` ("Producers can take confirmations off your plate once offers start landing."/DE with Du). Rewrite `panel.eyebrow.team` → "Team · admin only" ("Team · nur Admin") and `panel.footerNote.team` → "They get an email invite" ("Sie erhalten eine E-Mail-Einladung").

- [ ] **Step 5: Wire the registry.** In `taskPanelRegistry.tsx` replace `case "team": return <TeamStep />;` with `case "team": return <TeamPanelBody orgId={orgId} onDone={onDone} />;` and swap the import.

- [ ] **Step 6: Run — expect PASS**, plus `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`, `npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts`.

- [ ] **Step 7: Commit** `feat(get-running): in-panel producer invite for the team task`.

---

### Task 3: `people` panel — inline add-artist + import overlay (screen 02 "values" shape)

Replace `PeopleStep` (links to `/artists` + `/admin`) with a roster count, an inline single add-artist form, and an "Import a sheet" button that opens the existing `ArtistImportDialog` as a controlled overlay (owner decision #1).

**Files:**
- Create: `src/components/getRunning/panels/PeoplePanelBody.tsx`, `PeoplePanelBody.test.tsx`
- Modify: `src/components/getRunning/taskPanelRegistry.tsx` (`case "people"`)
- Modify: `src/i18n/locales/{en,de}/getRunning.json` (`panel.eyebrow.people`, `panel.footerNote.people`, `panel.body.people.*`)

**Interfaces:**
- Consumes: `useCreateArtistLite()` → `mutate({ orgId, name, email })` (`src/hooks/useHireOrders.ts:397`, invalidates `["artists"]`); `ArtistImportDialog` props `{ open; onOpenChange; orgId; existingEmails: string[]; canInvite?: boolean }` (`src/components/artists/ArtistImportDialog.tsx:23`); the active-artist count from `useBookingSetupStatus(orgId).artistCount` (already fetched by the registry — thread it in as a prop rather than re-fetching); `fetchArtists(client, orgId)` for `existingEmails` (or reuse the registry's read); the invite capability exactly as `ArtistsPage.tsx` resolves it (`useCan(...)` — read ArtistsPage for the exact action string; do not guess).
- Produces: `<PeoplePanelBody orgId={string|null} artistCount={number|null} onDone={() => void} />`.

- [ ] **Step 1: Write the failing test** `PeoplePanelBody.test.tsx`: seed the fake so an insert into `artists` succeeds; render, type a name + email, click "Add", assert the fake recorded an `artists` insert with `{ name, email, org_id }` and that `onDone` fired; assert an "Import a sheet" button exists and clicking it reveals the import dialog (assert a dialog role appears) — NOT a navigation. Run — expect FAIL.

- [ ] **Step 2: Run — expect FAIL:** `npx vitest run src/components/getRunning/panels/PeoplePanelBody.test.tsx`

- [ ] **Step 3: Implement `PeoplePanelBody`.**
  - Roster status row: `artistCount` → a `Badge variant="confirmed"` "{n} active" + muted "artists on the roster" (pluralize via i18n `_one`/`_other`). When `artistCount === 0`, use `variant="neutral"` and copy "No artists yet".
  - Inline add: a `<label>` "Add an artist", a full-name `<Input>`, a two-up row of email `<Input>` + an "Add" primary button. `const add = useCreateArtistLite();` submit → `add.mutate({ orgId: orgId!, name, email: email || null }, { onSuccess: () => { reset(); onDone(); } })`. Disable while pending or name empty. `toast.error` on failure.
  - A `divider-or` ("or") then an outline "Import a sheet…" button → `setImportOpen(true)`. Render `<ArtistImportDialog open={importOpen} onOpenChange={setImportOpen} orgId={orgId!} existingEmails={existingEmails} canInvite={canInvite} />` (fetch `existingEmails` via a `useQuery(['artists','emails',orgId], () => fetchArtists(supabase, orgId!).then(a => a.map(x => x.email).filter(Boolean)))` or reuse an existing artists read; `canInvite` from the same `useCan` ArtistsPage uses).
  - `<UnlocksNote>{t('panel.body.people.unlocks')}</UnlocksNote>` ("Offers and direct bookings both pick from this list. Artists get no email until you offer them a date.").
  - Rewrite `panel.eyebrow.people` → "Roster · blocks booking" and `panel.footerNote.people` → "No email until you offer a date". EN+DE for every string, Du, no dashes.

- [ ] **Step 4: Wire the registry.** `case "people": return <PeoplePanelBody orgId={orgId} artistCount={artistCount} onDone={onDone} />;` — the registry already computes `artistCount` from `useBookingSetupStatus`; pass it through (drop the now-unused `PeopleStep` `inactiveCount` prop path). Swap the import.

- [ ] **Step 5: Run — expect PASS** + tsc + lint + keyParity + copyLint.

- [ ] **Step 6: Commit** `feat(get-running): in-panel add-artist + import overlay for the people task`.

---

### Task 4: `dates` panel — sync status + overlays (screen 02 "status" shape; owner decision #2)

Replace `ShowsStep` (buttons to Productions + `/settings?tab=airtable`) with an in-panel Airtable sync status, a held-records affordance, an "add a show by hand" overlay, and a "Set up / manage Airtable sync" button that opens the existing `AirtableSyncTab` as an overlay. First-time connect stays the overlay path until design screen 11 lands.

**Files:**
- Create: `src/components/getRunning/panels/DatesPanelBody.tsx`, `DatesPanelBody.test.tsx`
- Modify: `src/components/getRunning/taskPanelRegistry.tsx` (`case "dates"`)
- Modify: `src/i18n/locales/{en,de}/getRunning.json` (`panel.eyebrow.dates`, `panel.footerNote.dates`, `panel.body.dates.*`)

**Interfaces:**
- Consumes: `fetchLatestSyncLog(supabase, orgId): Promise<SyncLogSummary | null>` (`src/data/airtableSync.ts:29`; `SyncLogSummary = { id; status; records_processed; imported_count; new_count; updated_count; held_count; error_details; synced_at }`) under the exact key `["airtable","sync-log",orgId]`; `AirtableSyncTab` props `{ orgId; readOnly?; canTriggerSync? }` (`src/components/settings/AirtableSyncTab.tsx:73`) — resolve `readOnly`/`canTriggerSync` via `useCan` exactly as `SettingsPage.tsx:526` does (read those lines for the capability strings); `ShowFormDialog` props `{ open; onOpenChange; show?; allShows; onSaved? }` (`src/components/catalog/ShowFormDialog.tsx:34`) with `allShows` from `useShows()`; `Dialog`/`DialogContent` from `@/components/ui/dialog`.
- Produces: `<DatesPanelBody orgId={string|null} onDone={() => void} />`.

- [ ] **Step 1: Write the failing test** `DatesPanelBody.test.tsx`: (a) seed `fetchLatestSyncLog` to return `{ synced_at, records_processed: 148, held_count: 4, status: 'success' }` → assert "148" and "4" render and a "Resolve" affordance appears; (b) seed it to return `null` (unconnected) → assert a "Set up Airtable sync" button renders instead of a status card; (c) assert clicking "Set up Airtable sync" opens an overlay (a dialog role) rather than navigating (no `<a href*="/settings">`). Run — expect FAIL.

- [ ] **Step 2: Run — expect FAIL:** `npx vitest run src/components/getRunning/panels/DatesPanelBody.test.tsx`

- [ ] **Step 3: Implement `DatesPanelBody`.**
  - `const syncQ = useQuery({ queryKey: ['airtable','sync-log',orgId], enabled: !!orgId, queryFn: () => fetchLatestSyncLog(supabase, orgId) });` (same key as `AirtableSyncTab`, so the overlay's "Sync now" refreshes this card).
  - **Connected (syncQ.data != null):** a status card (`bg-muted` well): a green-dot `Badge variant="confirmed"` "Airtable connected" + muted "synced {time}" (format `synced_at` via `src/lib/dates.ts` helpers) + right-aligned mono `{records_processed} dates`. When `held_count > 0`, a held row: an amber count chip `bg-[var(--amber-100)] text-[var(--amber-600)]`, "{n} records held on the last run", and an outline "Resolve" button → `setAirtableOpen(true)` (opens the overlay; the Activity tab there lists held rows).
  - **Unconnected (syncQ.data == null and not loading):** a muted line "No dates yet. Connect Airtable or add a show by hand." + a primary "Set up Airtable sync" button → `setAirtableOpen(true)`.
  - Always: a `divider-or` "or add one by hand" + an outline "New show" button → `setShowOpen(true)`, rendering `<ShowFormDialog open={showOpen} onOpenChange={setShowOpen} allShows={shows} onSaved={() => { setShowOpen(false); onDone(); }} />` (`shows` from `useShows()`).
  - The Airtable overlay: `<Dialog open={airtableOpen} onOpenChange={setAirtableOpen}><DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto"><AirtableSyncTab orgId={orgId} readOnly={!canConfigureAirtable} canTriggerSync={canTriggerSync} /></DialogContent></Dialog>` — give it height + scroll (the tab is tall and opens its own nested dialogs; verify focus/scroll in Task 7's visual check).
  - `<UnlocksNote>{t('panel.body.dates.unlocks')}</UnlocksNote>` ("Every downstream step — slots, priorities, eligibility — reads from these dates.").
  - Rewrite `panel.eyebrow.dates` → "Dates · feeds every step" and `panel.footerNote.dates` → "Sync runs hourly". EN+DE, Du, no dashes (use a comma/period instead of the em dash in the unlocks copy — reword to avoid dashes entirely: "Every downstream step reads from these dates: slots, priorities and eligibility.").

- [ ] **Step 4: Wire the registry.** `case "dates": return <DatesPanelBody orgId={orgId} onDone={onDone} />;`, swap import.

- [ ] **Step 5: Run — expect PASS** + tsc + lint + keyParity + copyLint.

- [ ] **Step 6: Commit** `feat(get-running): in-panel Airtable status + add-show/manage overlays for the dates task`.

---

### Task 5: `ladder` panel — per-city tier picker (screen 01 "Cast priorities" editor, verbatim)

Replace the read-only `LadderStep` (+ "Rank casts in Settings" link) with the design's in-panel ranker: a row per city-with-dates, its tier-1 cast shown as a chip or a "Pick tier 1" affordance, writing through the proven `cast_city_priority` functions.

**Files:**
- Create: `src/components/getRunning/panels/LadderPanelBody.tsx`, `LadderPanelBody.test.tsx`
- Modify: `src/components/getRunning/taskPanelRegistry.tsx` (`case "ladder"`)
- Modify: `src/i18n/locales/{en,de}/getRunning.json` (`panel.eyebrow.ladder`, `panel.footerNote.ladder`, `panel.body.ladder.*`)

**Interfaces:**
- Consumes: `LadderCoverageInputs = { futurePairs: {showId; cityId: string|null}[]; showPriorities: {showId; cityId; castId; priority}[]; cityPriorities: {cityId; castId; priority}[] }` from `useBookingSetupStatus(orgId).coverage` (already fetched by the registry — thread it in as a prop); `useAllCities()` for city names; `fetchCasts(supabase, orgId)` + `fetchCastMemberCounts(supabase, orgId)` for the cast picker options; `setCastCityPriority(supabase, { orgId, cityId, castId, priority })` and `clearCastCityPriority(supabase, rowId)` (`src/data/casts.ts:98,149`); `fetchCastCityPriority(supabase, orgId)` under key `["cast-city-priority", orgId]`. Reference the mutation-invalidation pattern in `src/components/settings/castsCoverage/CoveragePanel.tsx` (org path invalidates `["cast-city-priority"]` + `["eligibility"]`) and `TierCell.tsx`'s Popover option list.
- Produces: `<LadderPanelBody orgId={string|null} coverage={LadderCoverageInputs|undefined} onDone={() => void} />`.

- [ ] **Step 1: Write the failing test** `LadderPanelBody.test.tsx`: seed a `coverage` where Hamburg has a tier-1 (`cityPriorities: [{cityId:'ham',castId:'nord',priority:1}]`) and Leipzig has dates but no tier-1; seed `fetchCasts` to return two casts and the priority write to succeed. Assert Hamburg shows the cast chip and Leipzig shows "Pick tier 1"; click "Pick tier 1", choose a cast, assert `cast_city_priority` was written with `{ city_id:'lei', cast_id, priority:1, org_id }`. Run — expect FAIL.

- [ ] **Step 2: Run — expect FAIL:** `npx vitest run src/components/getRunning/panels/LadderPanelBody.test.tsx`

- [ ] **Step 3: Implement `LadderPanelBody`.**
  - `cityIds = [...new Set(coverage?.futurePairs.map(p => p.cityId).filter(Boolean))]` (cities with future dates). Header caption: `t('panel.body.ladder.citiesWithDates')` + a right-aligned mono `{unranked} unranked` (unranked = cities with no `priority===1` row in `cityPriorities`) in `text-[var(--amber-600)]`.
  - A `listcard` (`border border-border rounded-[var(--radius-l)]`), one row per city: city name + a mono meta line "{dateCount} dates" (dateCount = futurePairs count for that city; append "· no tier 1" when unranked). Right side:
    - Ranked city → the tier-1 cast name as `Badge variant="accent"` (look up name from `fetchCasts`) + an optional dashed "Add tier 2" affordance (opens the same picker with `priority = maxPriority+1`).
    - Unranked city → a dashed accent "Pick tier 1" button (`border-dashed border-accent-200 text-accent-700`).
  - The picker: a shadcn `Popover` (or `DropdownMenu`) listing casts (`fetchCasts` + member counts), on select → `mut.mutate({ orgId, cityId, castId, priority })` where the mutation is an inline `useMutation` mirroring `CoveragePanel` (invalidate `["cast-city-priority"]` + `["eligibility"]`). After a successful write that leaves zero unranked cities, call `onDone()`.
  - `<UnlocksNote>` computes: pick the first still-unranked city and its date count → `t('panel.body.ladder.unlocks', { count, city })` ("Rank {city} too and {count} dates become offerable in tonight's digest."). When none unranked, render a "done" variant ("Every city with dates has a tier 1.").
  - Rewrite `panel.eyebrow.ladder` → "Priorities · blocks offers", `panel.footerNote.ladder` → "Ranking is per city". EN+DE, Du, no dashes.
  - Keep this panel **org-scope only** (`cast_city_priority`); per-show overrides remain the province of Settings → Casts & coverage (the panel's job is to get every city a tier 1 so offers can flow). Do not build the show-scope segmented control here.

- [ ] **Step 4: Wire the registry.** `case "ladder": return <LadderPanelBody orgId={orgId} coverage={coverage} onDone={onDone} />;` (the registry already has `coverage` from `useBookingSetupStatus`). Swap import.

- [ ] **Step 5: Run — expect PASS** + tsc + lint + keyParity + copyLint.

- [ ] **Step 6: Commit** `feat(get-running): in-panel cast-priority ranker for the ladder task`.

---

### Task 6: `eligibility` panel — coverage gaps + "Link a cast" (screen 02 "list" shape)

Replace the read-only `EligibilityStep` (+ "Link casts in Settings" link) with a per show×city coverage list that resolves gaps in place by ranking a cast for that show.

**Files:**
- Create: `src/components/getRunning/panels/EligibilityPanelBody.tsx`, `EligibilityPanelBody.test.tsx`
- Modify: `src/components/getRunning/taskPanelRegistry.tsx` (`case "eligibility"`)
- Modify: `src/i18n/locales/{en,de}/getRunning.json` (`panel.eyebrow.eligibility`, `panel.footerNote.eligibility`, `panel.body.eligibility.*`)

**Interfaces:**
- Consumes: `resolveCoverage(coverage): CoverageResult` where `CoverageResult = { uncoveredPairs: {showId; cityId}[]; hasNullCity: boolean }` (`src/lib/bookings/setupStatus.ts:145`); the same `coverage` prop threaded from the registry; `useShows()` for show names + `useAllCities()` for city names; `fetchCasts`/`fetchCastMemberCounts` for the picker; `setShowCastPriority(supabase, { showId; cityId; castId; priority; orgId })` (`src/data/eligibility.ts:136`) — setting priority 1 both links the cast (creates the eligibility gate row) and covers the pair; invalidate `["eligibility"]` + the show consumers (`["eligible-artists"]`, `["artist-eligible-dates"]`, `["offer-tiers"]`) as `CoveragePanel`'s show path does.
- Produces: `<EligibilityPanelBody orgId={string|null} coverage={LadderCoverageInputs|undefined} onDone={() => void} />`.

- [ ] **Step 1: Write the failing test** `EligibilityPanelBody.test.tsx`: seed `coverage` with two future pairs where one (Die Zauberflöte · Leipzig) has no tier-1 anywhere → `resolveCoverage` returns it in `uncoveredPairs`; seed `fetchCasts` + the write. Assert the covered pair renders a green "Covered" badge and the gap renders "Link a cast"; click it, pick a cast, assert `setShowCastPriority` wrote `{ show_id, city_id, cast_id, priority:1, org_id }`. Run — expect FAIL.

- [ ] **Step 2: Run — expect FAIL:** `npx vitest run src/components/getRunning/panels/EligibilityPanelBody.test.tsx`

- [ ] **Step 3: Implement `EligibilityPanelBody`.**
  - `const result = useMemo(() => coverage ? resolveCoverage(coverage) : { uncoveredPairs: [], hasNullCity: false }, [coverage]);`
  - Build the full list of future (show,city) pairs from `coverage.futurePairs` (unique), marking each covered/uncovered by membership in `result.uncoveredPairs`. Header caption `t('panel.body.eligibility.showsWithDates')` + a right-aligned mono `{result.uncoveredPairs.length} gap(s)` in amber.
  - Row per pair: "{showName} · {cityName}" + a mono meta "{dateCount} dates". Right side: covered → `Badge variant="confirmed"` "Covered"; uncovered → a dashed accent "Link a cast" button opening a cast `Popover` → `mut.mutate({ showId, cityId, castId, priority: 1, orgId })`. When the last gap closes, `onDone()`.
  - If `result.hasNullCity`, a muted footnote "Some dates have no city set. Fix the date to include it." (Du, no dashes).
  - `<UnlocksNote>` for the first gap: `t('panel.body.eligibility.unlocks', { count, show })` ("Link a cast to {show} and its {count} dates become offerable.").
  - Rewrite `panel.eyebrow.eligibility` → "Coverage · blocks offers", `panel.footerNote.eligibility` → "A show's own cast beats the city ranking". EN+DE, Du, no dashes.

- [ ] **Step 4: Wire the registry.** `case "eligibility": return <EligibilityPanelBody orgId={orgId} coverage={coverage} onDone={onDone} />;`. Swap import.

- [ ] **Step 5: Run — expect PASS** + tsc + lint + keyParity + copyLint.

- [ ] **Step 6: Commit** `feat(get-running): in-panel coverage-gap linker for the eligibility task`.

---

### Task 7: Visual fidelity pass + full suite

**Files:** none required; fixes land in the panel files if the visual pass finds drift.

- [ ] **Step 1: Update the panel-shape metadata + waits-on producer copy.** In `src/lib/getRunning/taskPanelMeta.ts`, revise `TASK_PANEL_SHAPE` so the five keys read their true new shapes (`dates: 'values'` status, `people: 'values'`, `team: 'values'`, `ladder: 'values'` list, `eligibility: 'values'` list) — descriptive only, but keep it honest. Leave `panel.waitsOn.settingsLink.ladder/eligibility` as-is (still correct for the producer read-only path).

- [ ] **Step 2: Run the full unit gate.** `npx vitest run`, then `npm run test:coverage` (CI thresholds), `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, `npm run lint`, `npm run sync:mirrors:check`, `npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts`. Fix all fallout.

- [ ] **Step 3: Help-center impact.** The onboarding flow's substance changed (tasks now finish in place). Update `src/lib/help/items.ts` (EN + DE, Du) where it describes setting up casts/eligibility/artists/team, or state "No help center impact." with a reason in the PR body. Re-run `keyParity`/`copyLint`.

- [ ] **Step 4: Commit** `chore(get-running): panel-shape metadata, i18n parity, help center`.

---

### Task 8: Retire the orphaned link-out steps + final typecheck sweep

**Files (delete, grep-guarded):** `src/components/bookings/setup/ShowsStep.tsx`, `PeopleStep.tsx`, `TeamStep.tsx`, `LadderStep.tsx`, `EligibilityStep.tsx` + their co-located `*.test.tsx`.

- [ ] **Step 1: Inventory consumers.** `grep -rn "ShowsStep\|PeopleStep\|TeamStep\|LadderStep\|EligibilityStep" src/` — confirm each appears only in its own file, its own test, and (now removed) `taskPanelRegistry.tsx`. If any is still referenced elsewhere (e.g. a rail not yet retired), do NOT delete it; note the live consumer in the commit and leave the file.

- [ ] **Step 2: Delete the orphaned files** (only those with no remaining consumer). Remove any now-unused imports they pulled (`buildBookingOnboarding`, `ladderScopeNote`, etc.) only if those become unreferenced (`grep` first).

- [ ] **Step 3: Full typecheck + suite.** `npx tsc -p tsconfig.app.json --noEmit` (this is the gate that surfaces a missed consumer), `npx vitest run`, `npm run lint`, `npm run test:coverage`. Fix fallout.

- [ ] **Step 4: Commit** `refactor(get-running): remove orphaned link-out setup steps`.

- [ ] **Step 5: Push + open the PR** (Task-level, after Task 7's visual gate and this sweep both pass). Push the branch and open a PR titled `fix(get-running): finish onboarding tasks in the panel (design fidelity)` describing: the premise restored, the five panels rebuilt, the two owner decisions (import overlay, Airtable overlay + screen-11 deferral), the sync-log tab retirement, and the help-center line.

---

## Self-Review

**Spec coverage.** Premise ("finished in a panel, nobody sent to a settings tab") → the five link-out panels rebuilt (Tasks 2-6) + orphan cleanup (Task 8). Owner decision #1 (import overlay) → Task 3. Owner decision #2 (Airtable overlay + screen-11 deferral) → Task 4. Finding 2 (colors: `text-primary underline` → `text-accent-600`, no underlines) → enforced by the Global Constraints token rule in every panel task. Finding 2 (i18n: hardcoded English → `t()`) → every panel task authors EN+DE. Finding 3 (redundant sync-log tab) → Task 1. Visual fidelity + full gate → Task 7. The design's genuine in-panel forms (`flow`/`slots`/`timing`/`letterhead`/`terms`/`countersign`) are explicitly left untouched. Screens 07/08/09/11 remain out of scope (later phases).

**Placeholder scan.** Each panel task names the exact reuse functions (with file:line), the exact query keys to share, the exact i18n keys to add, and a concrete failing test. The one deliberate "read this first" instructions — the `supabaseFake` seed API, the `useCan` capability strings for Airtable/invite, and the `CoveragePanel`/`TierCell` Popover pattern — are real "verify current API before wrapping" steps (the code exists; the executor confirms the exact shape rather than the plan guessing a capability action string and getting it wrong).

**Type consistency.** `onDone: () => void` and `orgId: string | null` are the shared panel-body contract across Tasks 2-6; `coverage: LadderCoverageInputs | undefined` is threaded from the registry into `ladder`/`eligibility` (matching what `useBookingSetupStatus` already returns and what the old `LadderStep`/`EligibilityStep` already received); `artistCount: number | null` threaded into `people`. `UnlocksNote` (Task 2) is consumed by every later panel. The registry's existing `useBookingSetupStatus(bookingOrgId)` read (giving `coverage`, `artistCount`) is reused, not duplicated.

**Open item confirmed at execution:** the `ladder`/`eligibility` panels are org-scope only in-panel (per-show ladder overrides stay in Settings) — a deliberate scope line, noted in Tasks 5-6, keeping the 440px panel focused on "get every city/show a tier-1 cast so offers can flow."
