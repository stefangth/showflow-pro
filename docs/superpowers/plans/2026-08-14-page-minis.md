# Page Minis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every route an evergreen, role-aware, bilingual "page mini" that explains its module in four steps, pinned above the page body and hideable per browser.

**Architecture:** A reusable `<PageMini page="…" />` frame resolves the viewer's role in the active org, reads a per-page bilingual `MiniDef` from a registry, and renders four steps (numbered label + token-only miniature illustration + one explanation line), or a slim Resume bar when hidden. Hide/Resume persistence reuses the existing `useRailDismissed` hook (localStorage, per-page × per-org × per-browser). Copy is a typed EN+DE data module (the `src/lib/help/` pattern); illustrations are pure presentational React.

**Tech Stack:** React 18 + TS, Tailwind semantic tokens + shadcn, react-i18next (`useLanguage`), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-14-page-minis-design.md`

## Global Constraints

- **Package manager:** npm only (`npm ci` / `npm run …`). Never create bun/yarn/pnpm lockfiles.
- **Styling:** semantic tokens only (`--surface`, `--bg`, `--text`, `--text-muted`, `--text-faint`, `--accent-500/600/700`, `--line`, `--radius-xs/s/m/l`, `--green/amber/red-500/600/100`). Accent numbered stops do NOT support Tailwind opacity modifiers. Week starts Monday: leading pad `(monthStart.getDay()+6)%7`, headers Mon–Sun.
- **Copy:** No em/en dashes anywhere (`copyLint.test.ts` gates it — use period/comma/colon). German uses informal **"Du"** (no "Sie/Ihre/…"). Reuse `src/i18n/terms.ts` `TERMS` for domain terms; do not re-coin. Never compare against role display strings — check the literal `'producer'` etc.
- **i18n shape:** EN is canonical; DE must match EN key-for-key. Minis are a **typed data module** (`src/lib/minis/`), not a flat JSON namespace, so they are NOT added to `keyParity.test.ts`/`translationCompleteness.test.ts` loops; instead they get their own structural + en≠de guard test and are fed into `copyLint.test.ts`.
- **Gating:** minis add no entitlement and no route change. They render only for a viewer who has a variant; they inherit the route's existing role/feature gate. DE only appears for `language_packages`-entitled orgs (AppLayout forces English otherwise), so every mini must read correctly in English.
- **Lint gate:** `npm run lint` is zero-warning (`--max-warnings 0`). `any` is banned.
- **Typecheck:** `npx tsc -p tsconfig.app.json --noEmit` must pass.

---

## File Structure

**New:**
- `src/lib/minis/types.ts` — `Lang`, `Bi`, `MiniRole`, `PageKey`, `MiniStepCopy`, `MiniDef`, `MiniArt`.
- `src/lib/minis/pages/{settings,bookings,availability,chats,productions,artists,admin,platform,hireOrders}.ts` — one `MiniDef` each (bilingual copy + illustration ref).
- `src/lib/minis/index.ts` — `MINIS: Record<PageKey, MiniDef>` barrel; `PAGE_KEYS`.
- `src/lib/minis/minis.test.ts` — structural + en≠de guard.
- `src/lib/minis/resolveMiniRole.ts` + `.test.ts` — pure role→variant resolver.
- `src/components/minis/PageMini.tsx` + `.test.tsx` — the frame.
- `src/components/minis/atoms.tsx` — shared miniature atoms (MiniCalendar, MiniRow, MiniBadge, MiniMeter, MiniTimeline, MiniField).
- `src/components/minis/illustrations/{Settings,Bookings,Availability,Chats,Productions,Artists,Admin,Platform,HireOrders}Mini.tsx` — four nodes each.

**Modified:**
- `src/i18n/copyLint.test.ts` — feed `src/lib/minis` strings into `enContent`/`deContent`.
- `src/pages/{SettingsPage,ShowsBookingsPage,AvailabilityPage,ChatsListPage,ProductionsPage,ArtistsPage,AdminPage,PlatformPage,HireOrdersPage}.tsx` — drop `<PageMini page="…" />` at the header→body seam.
- `CLAUDE.md` — "New page / route checklist" gains the page-mini step; add `src/lib/minis` + `src/components/minis` to the architecture map.
- `public/changelog.md` + regenerate `public/changelog.json`.
- `src/lib/help/items.ts` (EN+DE) — help-center impact pass (a Q/A on what the page mini is / how to bring it back).

---

## Phase A — Foundation + Settings exemplar (serial)

### Task A0: DE terminology alignment (no code)

**Files:** read-only — `src/i18n/terms.ts`, `src/i18n/locales/de/bookings.json`, `src/i18n/locales/de/availability.json`, `src/lib/help/items.ts`.

- [ ] **Step 1:** Read `TERMS` and the existing DE bookings/availability catalogs; write down the established DE for: offer, booking, show date, cast, skill, soft-booked/hold, confirmed, digest, tier, understudy, blocked date, hire order, letterhead, terms, countersign, audit trail. Use these exact words in all DE mini copy below. Role names (Admin / Produktionsteam / Artist) and proper nouns (ShowFlow, Airtable) stay untranslated. Reconcile the DE in this plan's Content Appendix against that list before authoring the copy files.

### Task A1: Content model types

**Files:**
- Create: `src/lib/minis/types.ts`
- Test: (typecheck only; exercised by later tests)

**Interfaces:**
- Produces:
  ```ts
  import type { Lang } from '@/i18n/config';
  export type Bi = Record<Lang, string>;
  export type MiniRole = 'admin' | 'producer' | 'artist' | 'super';
  export type PageKey =
    | 'settings' | 'bookings' | 'availability' | 'chats'
    | 'productions' | 'artists' | 'admin' | 'platform' | 'hireOrders';
  export interface MiniStepCopy { label: Bi; text: Bi }
  /** exactly four steps */
  export type MiniSteps = readonly [MiniStepCopy, MiniStepCopy, MiniStepCopy, MiniStepCopy];
  export interface MiniDef {
    page: PageKey;
    route: string;                 // e.g. ROUTES.SETTINGS
    eyebrow: Bi;
    subnote?: Bi;                  // muted right-side note in the header
    variants: Partial<Record<MiniRole, MiniSteps>>;
  }
  ```

- [ ] **Step 1:** Write `types.ts` with the block above. `MiniArt` (the four illustration nodes) is NOT in the data module — it lives with the component (Task A3), keyed by `PageKey`.
- [ ] **Step 2:** `npx tsc -p tsconfig.app.json --noEmit` → PASS.
- [ ] **Step 3:** Commit `feat(minis): content model types`.

### Task A2: `resolveMiniRole`

**Files:**
- Create: `src/lib/minis/resolveMiniRole.ts`
- Test: `src/lib/minis/resolveMiniRole.test.ts`

**Interfaces:**
- Consumes: `MiniDef`, `MiniRole` from `./types`.
- Produces:
  ```ts
  export interface MiniRoleCtx {
    hasRole: (r: 'admin' | 'producer' | 'artist') => boolean;
    isSuperAdmin: boolean;
    impersonating: boolean;   // isImpersonating(...) — super-admin bypass only when false
  }
  export function resolveMiniRole(def: MiniDef, ctx: MiniRoleCtx): MiniRole | null;
  ```
  Rules: if `ctx.isSuperAdmin && !ctx.impersonating` → `'super'` if present, else first present of `admin`,`producer`,`artist`. Otherwise → first of `admin`,`producer`,`artist` that BOTH `ctx.hasRole(r)` and `def.variants[r]` exist; artists map to `'artist'`. Else `null`. (Using `hasRole` means editor view-as is already reflected, since `hasRole` honors view-as.)

- [ ] **Step 1: failing test** — cover: producer viewer on a def with admin+producer variants → `'producer'`; admin viewer → `'admin'`; artist viewer on artist-only def → `'artist'`; super-admin (not impersonating) on def with `super` → `'super'`; super-admin on def without `super` (e.g. admin-only) → `'admin'`; super-admin impersonating a producer → `'producer'`; viewer with no matching variant → `null`.

```ts
import { describe, it, expect } from 'vitest';
import { resolveMiniRole } from './resolveMiniRole';
import type { MiniDef, MiniSteps } from './types';
const s = [] as unknown as MiniSteps;
const def = (variants: MiniDef['variants']): MiniDef => ({ page:'settings', route:'/settings', eyebrow:{en:'',de:''}, variants });
const ctx = (o: Partial<import('./resolveMiniRole').MiniRoleCtx> & { role?: 'admin'|'producer'|'artist' }) => ({
  hasRole: (r: 'admin'|'producer'|'artist') => o.role === r,
  isSuperAdmin: o.isSuperAdmin ?? false,
  impersonating: o.impersonating ?? false,
});
describe('resolveMiniRole', () => {
  it('picks producer for a producer viewer', () => {
    expect(resolveMiniRole(def({admin:s,producer:s}), ctx({role:'producer'}))).toBe('producer');
  });
  it('picks admin for an admin viewer', () => {
    expect(resolveMiniRole(def({admin:s,producer:s}), ctx({role:'admin'}))).toBe('admin');
  });
  it('super-admin without a super variant falls back to admin', () => {
    expect(resolveMiniRole(def({admin:s}), ctx({isSuperAdmin:true}))).toBe('admin');
  });
  it('super-admin with a super variant uses it', () => {
    expect(resolveMiniRole(def({admin:s,super:s}), ctx({isSuperAdmin:true}))).toBe('super');
  });
  it('impersonating super-admin follows the impersonated role', () => {
    expect(resolveMiniRole(def({admin:s,producer:s}), ctx({role:'producer',isSuperAdmin:true,impersonating:true}))).toBe('producer');
  });
  it('returns null when the viewer has no variant', () => {
    expect(resolveMiniRole(def({admin:s}), ctx({role:'artist'}))).toBeNull();
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/minis/resolveMiniRole.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `resolveMiniRole.ts`.
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit `feat(minis): role→variant resolver`.

### Task A3: Shared atoms + Settings illustration

**Files:**
- Create: `src/components/minis/atoms.tsx`, `src/components/minis/illustrations/SettingsMini.tsx`

**Interfaces:**
- Produces from `atoms.tsx`: presentational, token-only, no props beyond simple data —
  `MiniCard` (the inner surface panel), `MiniRow` ({avatar?, label, trailing?}), `MiniBadge`
  ({tone:'accent'|'amber'|'green'|'neutral', label}), `MiniMeter` ({pct, label}), `MiniField`
  ({label, value}), `MiniCalendar` ({month, cells:{day,tone}[]}), `MiniTimeline` ({items:{label,sub}[]}),
  `MiniAvatar` ({initials, color}).
- Produces from `SettingsMini.tsx`: `export const settingsArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode]`
  matching the four Settings steps (Booking engine: two `MiniField` rows for digest hours + response window; Casts and cities: a small city→tier ladder list; Hire orders: a letterhead/terms/countersign field stack; Audit trail: a `MiniTimeline` of who-changed-what). Mirror the design's Settings-in-spirit — token-only, ~compact.

- [ ] **Step 1:** Build `atoms.tsx` per the design's inline styles, using semantic tokens (translate the canvas's `var(--surface)`/`var(--accent-600)`/badges directly). Keep each atom small and prop-driven.
- [ ] **Step 2:** Build `SettingsMini.tsx` `settingsArt` from atoms.
- [ ] **Step 3:** `npx tsc -p tsconfig.app.json --noEmit` → PASS; `npm run lint` → clean.
- [ ] **Step 4:** Commit `feat(minis): shared atoms + settings illustration`.

### Task A4: Settings `MiniDef` (bilingual) + registry + guard test

**Files:**
- Create: `src/lib/minis/pages/settings.ts`, `src/lib/minis/index.ts`, `src/lib/minis/minis.test.ts`

**Interfaces:**
- Consumes: `MiniDef` from `../types`, `ROUTES` from `@/config/app.config`.
- Produces: `export const settingsMini: MiniDef`; `export const MINIS: Record<PageKey, MiniDef>`
  (settings only for now); `export const PAGE_KEYS: readonly PageKey[]`.

- [ ] **Step 1:** Author `settings.ts` using the **Settings** entry of the Content Appendix (EN + DE, both roles: admin, producer; plus `super` = admin copy). Eyebrow EN "What settings decide". Steps EN labels: Booking engine, Casts and cities, Hire orders, Audit trail.
- [ ] **Step 2:** Author `index.ts` barrel.
- [ ] **Step 3: failing test** `minis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MINIS, PAGE_KEYS } from './index';
const LANGS = ['en','de'] as const;
describe('MINIS registry', () => {
  it('every def has an eyebrow and 4 steps per variant in both languages', () => {
    for (const key of PAGE_KEYS) {
      const def = MINIS[key];
      expect(def, key).toBeTruthy();
      for (const l of LANGS) expect(def.eyebrow[l].length, `${key} eyebrow ${l}`).toBeGreaterThan(0);
      for (const [role, steps] of Object.entries(def.variants)) {
        expect(steps!.length, `${key}/${role} step count`).toBe(4);
        for (const st of steps!) for (const l of LANGS) {
          expect(st.label[l].length, `${key}/${role} label ${l}`).toBeGreaterThan(0);
          expect(st.text[l].length, `${key}/${role} text ${l}`).toBeGreaterThan(0);
        }
      }
    }
  });
  it('DE is never a verbatim copy of EN (guards against paste-through)', () => {
    for (const key of PAGE_KEYS) {
      const def = MINIS[key];
      for (const [role, steps] of Object.entries(def.variants))
        for (let i=0;i<steps!.length;i++)
          expect(steps![i].text.de, `${key}/${role} step ${i} untranslated`).not.toBe(steps![i].text.en);
    }
  });
});
```

- [ ] **Step 4:** Run `npx vitest run src/lib/minis/minis.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(minis): settings copy + registry + guard test`.

### Task A5: `PageMini` frame

**Files:**
- Create: `src/components/minis/PageMini.tsx`, `src/components/minis/PageMini.test.tsx`

**Interfaces:**
- Consumes: `MINIS`, `resolveMiniRole`, `useAuth` (`hasRole`,`isSuperAdmin`,`roles`,`viewAsRole`,`viewAsUser`,`currentOrg`), `isImpersonating` from `@/features/auth/orgRoles`, `useRailDismissed` from `@/components/setup/useRailDismissed`, `useLanguage` from `@/features/i18n/LanguageContext`, `DashboardWelcomeCollapsed`, the per-page `*Art` arrays.
- Produces: `export function PageMini({ page }: { page: PageKey }): JSX.Element | null`.

Behavior: build `MiniRoleCtx` (`impersonating = isImpersonating({isSuperAdmin,roles,viewAsRole,viewAsUser})`); `role = resolveMiniRole(def, ctx)`; if `null` → return null. `orgId = currentOrg?.id ?? null`. `[dismissed, dismiss, undismiss] = useRailDismissed('mini.'+page, orgId)`. `lang = useLanguage().lang`. An `ART: Record<PageKey, readonly ReactNode[]>` map (imported from the illustrations barrel) supplies the four nodes. If `dismissed` → render `<DashboardWelcomeCollapsed label={eyebrow[lang]} hint={RESUME_HINT[lang]} ctaLabel={RESUME_CTA[lang]} onOpen={undismiss} />`. Else render the card: header (eyebrow · spacer · subnote?[lang] · Hide button→`dismiss`), then a responsive grid (`grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`) of the four steps: number (`font-mono accent-600`) + label (`uppercase accent-600`), the illustration `MiniCard`, and the explanation (`text-muted`). `RESUME_HINT = {en:'Pick up where you left off', de:'…'}`, `RESUME_CTA = {en:'Resume', de:'…'}` (see appendix).

- [ ] **Step 1: failing test** `PageMini.test.tsx` (use `renderWithProviders` from `src/test/renderWithProviders`; stub auth to an admin in an org). Assert: renders the settings eyebrow "What settings decide" and all four labels; clicking "Hide" hides the grid and shows "Resume"; the localStorage key `showflow.mini.settings.hidden.<orgId>` becomes `"true"`; clicking "Resume" restores the grid. Add a second render as an artist → component returns null (nothing rendered).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `PageMini.tsx` + an `illustrations/index.ts` barrel exporting `ART` (settings only for now; other keys added in Phase B).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(minis): PageMini frame with hide/resume`.

### Task A6: Mount on Settings + copyLint wiring + verify

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (after the unsaved-changes bar, before `<Tabs>`: `<PageMini page="settings" />`), `src/i18n/copyLint.test.ts`.

- [ ] **Step 1:** Add `<PageMini page="settings" />` at the seam in `SettingsPage.tsx`.
- [ ] **Step 2:** In `copyLint.test.ts`, import `MINIS`/`PAGE_KEYS` and push every `eyebrow`, `subnote`, step `label`, step `text` (both langs) into `enContent`/`deContent` so the dash + informal-Du lint covers minis.
- [ ] **Step 3:** Run `npx vitest run src/i18n/copyLint.test.ts src/lib/minis src/components/minis` → PASS.
- [ ] **Step 4:** `npx tsc -p tsconfig.app.json --noEmit` + `npm run lint` → clean.
- [ ] **Step 5:** Browser-verify Settings (dev server): full mini renders under the header, Hide→Resume works, light + dark. Screenshot.
- [ ] **Step 6:** Commit `feat(minis): mount settings page mini + lint coverage`.

**⛳ Checkpoint:** the exemplar is complete. The pattern (types → copy → illustration → frame → mount → tests) is now fixed and repeatable.

---

## Phase B — Remaining eight minis (parallelizable)

Each page below is an independent unit touching only its own three files
(`src/lib/minis/pages/<page>.ts`, `src/components/minis/illustrations/<Page>Mini.tsx`, its
page file) plus two shared one-line edits (registry barrel `index.ts` and illustrations
`index.ts`). **Dispatch the eight illustration builds to parallel subagents**; the
orchestrator authors the eight bilingual copy files (from the Content Appendix, consistent
terminology) and performs the two barrel edits + page mounts to avoid merge contention on
the shared barrels. Each page repeats the Task-A pattern:

1. Author `pages/<page>.ts` `MiniDef` from the Content Appendix (all applicable roles; `super` = admin copy unless the appendix gives a distinct super line).
2. Build `illustrations/<Page>Mini.tsx` `<page>Art` (four nodes) from `atoms.tsx`, matching the design's miniature for that page.
3. Add the def to `MINIS` and the art to the illustrations barrel.
4. Mount `<PageMini page="<page>" />` at the page's header→body seam.
5. `minis.test.ts` (already generic over `PAGE_KEYS`) + copyLint now cover it — run them; typecheck + lint clean; browser-verify EN.
6. Commit `feat(minis): <page> page mini`.

Pages, roles, and seams:
- **B1 bookings** — roles admin, producer (super→admin). `ShowsBookingsPage.tsx` producer view, after the setup rail block, before `<div className="min-w-0 space-y-6">`. Illustration: tier offer list, calendar with offer day, confirm list with status badges, fill meters (4/4 main, 1/2 understudy) + hire-orders drafted row.
- **B2 availability** — role artist (super→artist). `AvailabilityPage.tsx` after header, before filter row. Illustration: eligible-dates calendar, block-a-date calendar + blocked count, an offer card (sessions/answer-by + Accept/Decline), a confirmed timeline.
- **B3 chats** — roles admin, producer, artist, super. `ChatsListPage.tsx` header→body seam. Illustration: thread-per-date row, membership list, a message bubble pair, an archived chip.
- **B4 productions** — roles admin, producer (super→admin). `ProductionsPage.tsx` seam. Illustration: a show row, its dates list, a slots stepper (main/understudy), an Airtable-synced chip.
- **B5 artists** — roles admin, producer (super→admin). `ArtistsPage.tsx` seam. Illustration: a talent record card, a skills chip row, a casts/priority list, an invite/account status row.
- **B6 admin** — role admin (super→admin). `AdminPage.tsx` seam. Illustration: invite bar with emails, a duplicate-caught chip, an accepted membership row, a role dropdown row.
- **B7 platform** — role super only. `PlatformPage.tsx` seam. Illustration: provision-org field stack, module toggles per org, a cross-org users row, a system-health status row. Subnote "Super-admin only · across every org".
- **B8 hireOrders** — roles admin, producer (no super needed distinct; super→admin). `HireOrdersPage.tsx` seam, under its own setup rail. Illustration: a draft order card with provenance, an issue/send row, a countersign toggle, a bulk-import/set-up-once row. Subnote "Numbering and defaults from Settings · Hire orders".

**⛳ Checkpoint:** run the full `minis.test.ts` (all nine keys), `copyLint.test.ts`, typecheck, lint. Every route now shows its mini.

---

## Phase C — Convention, docs, verify, PR (serial)

### Task C1: Make it a convention
- [ ] Update `CLAUDE.md` "New page / route checklist": add step "Add a page mini: author `src/lib/minis/pages/<page>.ts` (EN+DE, informal Du, reuse TERMS), build its illustration, register it, and drop `<PageMini page="…" />` below the setup rail. If the page has no mini, state 'No mini.' with a reason." Add `src/lib/minis/` and `src/components/minis/` to the architecture map.
- [ ] Commit `docs: page minis as a new-page convention`.

### Task C2: Help-center impact + changelog
- [ ] `src/lib/help/items.ts`: add a short bilingual Q/A (e.g. "What is the panel at the top of each page, and how do I bring it back?") — informal Du, no dashes, TERMS-consistent.
- [ ] `public/changelog.md`: new `## X.Y.Z — Aug 14, 2026` block, `*theme*`, `### New` bullet `- **Page guides** — …` written for end users (no super-admin/platform mentions). Bump `version` in `package.json` and `APP_META.VERSION` in `src/config/app.config.ts` to match.
- [ ] Regenerate: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`.
- [ ] Commit `feat: changelog + help for page minis`.

### Task C3: Full verification + rebase + PR
- [ ] `npm run verify:fast` (lint, typecheck app+tools, build, vitest+coverage, deno) → green.
- [ ] Rebase onto latest `origin/main` (other work is in flight there); resolve any registry/i18n conflicts; re-run `verify:fast`.
- [ ] Open PR with the spec + plan linked, screenshots (light/dark, EN; DE for an entitled org), and a "Help center impact" note.

---

## Content Appendix — bilingual copy (source of truth)

> EN is verbatim from the imported design (dashes normalized to commas/periods per the no-dash
> rule). DE authored per Task A0 terminology (informal Du, no dashes). `super` variant = the
> admin copy unless a distinct super line is given. `subnote` is the muted header note.
> Resume bar: EN hint "Pick up where you left off" / CTA "Resume"; DE hint "Mach dort weiter, wo du aufgehört hast" / CTA "Wieder einblenden".

### settings — eyebrow EN "What settings decide" / DE "Was Einstellungen festlegen"
Labels EN: Booking engine · Casts and cities · Hire orders · Audit trail
Labels DE: Buchungs-Engine · Besetzungen und Städte · Engagementschreiben · Änderungsprotokoll
- admin/super:
  1. EN: These hours decide when artists hear about an offer and how long they have to answer it. · DE: Diese Uhrzeiten legen fest, wann Artists von einem Angebot erfahren und wie lange sie zum Antworten haben.
  2. EN: The priority ladder per city. It is the order the offer engine walks when a tier falls short. · DE: Die Prioritätenreihenfolge je Stadt. In dieser Reihenfolge geht die Angebots-Engine vor, wenn eine Stufe nicht reicht.
  3. EN: Letterhead, terms and countersign mode are yours. Orders cannot be issued on empty terms. · DE: Briefkopf, Konditionen und Gegenzeichnungsmodus liegen bei dir. Ohne Konditionen lässt sich kein Schreiben ausstellen.
  4. EN: Every settings change records who changed what, so an odd booking outcome can be traced back. · DE: Jede Änderung hält fest, wer was geändert hat, damit sich ein seltsames Buchungsergebnis zurückverfolgen lässt.
- producer:
  1. EN: These hours decide when your artists hear about an offer and how long they have to answer. · DE: Diese Uhrzeiten legen fest, wann deine Artists von einem Angebot erfahren und wie lange sie zum Antworten haben.
  2. EN: The ladder the offer engine walks per city. Read it here to know who gets offered next. · DE: Die Reihenfolge, die die Angebots-Engine je Stadt durchläuft. Hier siehst du, wer als Nächstes ein Angebot bekommt.
  3. EN: Until an admin sets the terms, no order can be issued. The blocker is listed so you know why. · DE: Solange ein Admin die Konditionen nicht gesetzt hat, lässt sich kein Schreiben ausstellen. Der Grund steht dabei.
  4. EN: When a booking behaves oddly, this says which setting changed, who changed it, and when. · DE: Wenn sich eine Buchung seltsam verhält, steht hier, welche Einstellung sich geändert hat, wer es war und wann.

### bookings — eyebrow EN "How a date gets cast" / DE "Wie ein Termin besetzt wird" · subnote EN "Windows and digest hours from Settings · Booking engine" / DE "Fenster und Digest-Zeiten aus Einstellungen · Buchungs-Engine"
Labels EN: Tier opens · Artist responds · You confirm · Fully filled
Labels DE: Stufe öffnet · Artist antwortet · Du bestätigst · Voll besetzt
- admin/super:
  1. EN: The ladder you set in Settings decides who is offered. Blocked dates and missing skills filter out first. · DE: Die Reihenfolge aus den Einstellungen legt fest, wer ein Angebot bekommt. Geblockte Tage und fehlende Skills fallen zuerst raus.
  2. EN: 48h from the daily digest, not from when the offer was made. Unanswered offers expire. · DE: 48 Std. ab dem täglichen Digest, nicht ab dem Zeitpunkt des Angebots. Unbeantwortete Angebote verfallen.
  3. EN: Accepted offers become soft-booked depending on your setting. Confirming is yours, singly or in bulk from the date sheet. · DE: Angenommene Angebote werden je nach Einstellung vorgemerkt. Das Bestätigen liegt bei dir, einzeln oder gesammelt im Terminblatt.
  4. EN: At full main cast the date flips to fully filled and, if the module is on, drafts its hire orders. · DE: Bei voller Hauptbesetzung springt der Termin auf voll besetzt und entwirft, wenn das Modul an ist, seine Engagementschreiben.
- producer: step 1 EN: Every eligible artist in the tier is offered at once. · DE: Alle geeigneten Artists der Stufe bekommen gleichzeitig ein Angebot. (steps 2–4 as admin)

### availability — eyebrow EN "How your calendar works" / DE "Wie dein Kalender funktioniert" · subnote EN "You only see dates you are eligible for" / DE "Du siehst nur Termine, für die du infrage kommst"
Labels EN: Eligible dates · Block a date · Answer an offer · Confirmed
Labels DE: Passende Termine · Tag blocken · Angebot beantworten · Bestätigt
- artist/super:
  1. EN: A date appears when a cast you are in is eligible for it and you hold every required skill. · DE: Ein Termin taucht auf, wenn eine Besetzung, in der du bist, dafür infrage kommt und du alle nötigen Skills hast.
  2. EN: Blocked dates never reach you as an offer. Nobody has to chase you for a no. · DE: Geblockte Tage erreichen dich nie als Angebot. Niemand muss dir wegen einer Absage hinterherlaufen.
  3. EN: Accepting soft-books you. The producer confirms, and the confirmation digest tells you when. · DE: Mit dem Annehmen wirst du vorgemerkt. Das Produktionsteam bestätigt, und der Bestätigungs-Digest sagt dir, wann.
  4. EN: Once confirmed you are on the cast list, in the date chat, and any hire order comes to you. · DE: Sobald du bestätigt bist, stehst du auf der Besetzungsliste, bist im Termin-Chat und ein etwaiges Engagementschreiben kommt zu dir.

### chats — eyebrow EN "How threads work" / DE "Wie Threads funktionieren"
- admin/producer/super labels EN: One thread per date · Who is in it · Talk about the date · Archived
  labels DE: Ein Thread je Termin · Wer dabei ist · Über den Termin reden · Archiviert
  1. EN: Threads are created per show date. There is no free-form channel to keep track of. · DE: Threads entstehen je Showtermin. Es gibt keinen freien Kanal, den du im Blick behalten musst.
  2. EN: Membership follows the booking. An artist joins when they accept and leaves if it is cancelled. · DE: Die Mitgliedschaft folgt der Buchung. Ein Artist kommt beim Annehmen dazu und geht bei einer Stornierung wieder raus.
  3. EN: Everything about one date sits in one place, next to the cast and the times it refers to. · DE: Alles zu einem Termin liegt an einem Ort, direkt neben der Besetzung und den zugehörigen Zeiten.
  4. admin/super EN: A thread freezes 30 days past the show date. Admins keep full access to archived threads. · DE: Ein Thread friert 30 Tage nach dem Showtermin ein. Admins behalten vollen Zugriff auf archivierte Threads.
     producer EN: A thread freezes 30 days past the show date. It stays readable for everyone who was in it. · DE: Ein Thread friert 30 Tage nach dem Showtermin ein. Er bleibt für alle lesbar, die dabei waren.
- artist labels EN: Only your dates · You join on accept · Ask about the date · Archived
  labels DE: Nur deine Termine · Beim Annehmen dabei · Zum Termin fragen · Archiviert
  1. EN: You see a thread for each date you are booked on. There is nothing else to scroll through. · DE: Du siehst einen Thread für jeden Termin, für den du gebucht bist. Mehr gibt es nicht zu scrollen.
  2. EN: Accepting an offer puts you in the thread. Declining or cancelling takes you out of it. · DE: Ein Angebot anzunehmen bringt dich in den Thread. Ablehnen oder Stornieren nimmt dich wieder raus.
  3. EN: Call times, changes and questions live next to the date they are about, not in your inbox. · DE: Startzeiten, Änderungen und Fragen stehen neben dem Termin, um den es geht, nicht in deinem Postfach.
  4. EN: A thread freezes 30 days past the show date. You keep reading it, you just cannot post. · DE: Ein Thread friert 30 Tage nach dem Showtermin ein. Du liest weiter mit, kannst nur nichts mehr posten.

### productions — eyebrow EN "How the catalog works" / DE "Wie der Katalog funktioniert"
Labels EN: A show · Its dates · Slots per show · Synced dates
Labels DE: Eine Show · Ihre Termine · Slots je Show · Synchronisierte Termine
- admin/super:
  1. EN: A show is the production template, one row per program and sub-program pair, not per night. · DE: Eine Show ist die Produktionsvorlage, eine Zeile je Programm und Unterprogramm, nicht je Abend.
  2. EN: Each date is one performance: city, venue, session times. Status is derived from its bookings. · DE: Jeder Termin ist eine Vorstellung: Stadt, Spielort, Sessionzeiten. Der Status ergibt sich aus den Buchungen.
  3. EN: Until main and understudy slots are set, a date can never reach fully filled. It reads Unconfigured. · DE: Solange Haupt- und Understudy-Slots nicht gesetzt sind, wird ein Termin nie voll besetzt. Er steht auf Nicht konfiguriert.
  4. EN: Dates from Airtable are owned by the sync. You control the mapping in Settings · Airtable sync. · DE: Termine aus Airtable gehören der Synchronisierung. Das Mapping steuerst du in Einstellungen · Airtable-Sync.
- producer: step 4 EN: Dates that arrive from Airtable are owned by the sync, edit them at the source, not here. · DE: Termine, die aus Airtable kommen, gehören der Synchronisierung. Bearbeite sie an der Quelle, nicht hier. (steps 1–3 as admin)

### artists — eyebrow EN "How the roster works" / DE "Wie das Ensemble verwaltet wird"
- admin/super labels EN: A talent record · Skills · Casts · Invite and link
  labels DE: Ein Talentprofil · Skills · Besetzungen · Einladen und verknüpfen
  1. EN: An artist exists in your catalog whether or not they ever log in. External artists are normal. · DE: Ein Artist existiert in deinem Katalog, ob er sich jemals anmeldet oder nicht. Externe Artists sind normal.
  2. EN: Skills gate offers. An artist must hold every skill a show and its date require, not just one. · DE: Skills steuern Angebote. Ein Artist muss jeden Skill haben, den eine Show und ihr Termin verlangen, nicht nur einen.
  3. EN: Casts are how eligibility and the offer ladder are expressed. Priority is set per city. · DE: Über Besetzungen werden Eignung und Angebotsreihenfolge ausgedrückt. Die Priorität wird je Stadt gesetzt.
  4. EN: Invite an artist and their login links to this record on accept, offers then go to their login email. · DE: Lädst du einen Artist ein, verknüpft sich sein Login beim Annehmen mit diesem Profil, Angebote gehen dann an seine Login-Adresse.
- producer labels EN: A talent record · Skills · Casts · Accounts / labels DE: Ein Talentprofil · Skills · Besetzungen · Konten
  step 4 EN: You can see whether an artist has an account. Inviting one is an admin action. · DE: Du siehst, ob ein Artist ein Konto hat. Das Einladen ist eine Admin-Aktion. (steps 1–3 as admin)

### admin — eyebrow EN "How people get in" / DE "Wie Leute reinkommen"
Labels EN: Invite by email · Duplicates caught · They accept · Roles later
Labels DE: Per E-Mail einladen · Dubletten erkannt · Sie nehmen an · Rollen später
- admin/super:
  1. EN: You pick the role at invite time. Paste several addresses at once for a bulk invite. · DE: Du wählst die Rolle beim Einladen. Füge mehrere Adressen auf einmal ein für eine Sammeleinladung.
  2. EN: The invite bar matches against members and pending invites live, before you send anything. · DE: Die Einladungsleiste gleicht live mit Mitgliedern und offenen Einladungen ab, bevor du etwas sendest.
  3. EN: Accepting writes the org membership. An artist invite also links their talent record. · DE: Das Annehmen schreibt die Org-Mitgliedschaft. Eine Artist-Einladung verknüpft zusätzlich das Talentprofil.
  4. EN: Change a role or remove a member here. Every check is enforced again in the database. · DE: Ändere hier eine Rolle oder entferne ein Mitglied. Jede Prüfung wird in der Datenbank erneut durchgesetzt.

### platform — eyebrow EN "What the console controls" / DE "Was die Konsole steuert" · subnote EN "Super-admin only · across every org" / DE "Nur Super-Admin · über alle Orgs hinweg"
Labels EN: Provision an org · Modules per org · Users across orgs · System health
Labels DE: Org bereitstellen · Module je Org · Nutzer über Orgs · Systemzustand
- super:
  1. EN: One action creates the org, seeds its catalog, and invites the first admin. · DE: Eine Aktion legt die Org an, befüllt ihren Katalog und lädt den ersten Admin ein.
  2. EN: Entitlements are per org. A module that is off locks its nav item instead of hiding it. · DE: Berechtigungen gelten je Org. Ein ausgeschaltetes Modul sperrt seinen Navigationseintrag, statt ihn zu verstecken.
  3. EN: One directory over every org: memberships, artist links, email changes, suspend, delete. · DE: Ein Verzeichnis über alle Orgs: Mitgliedschaften, Artist-Verknüpfungen, E-Mail-Änderungen, Sperren, Löschen.
  4. EN: Cron and edge-function health, recomputed every 15 minutes and kept for 30 days. · DE: Zustand von Cron und Edge-Functions, alle 15 Minuten neu berechnet und 30 Tage lang aufbewahrt.

### hireOrders — eyebrow EN "How hire orders work" / DE "Wie Engagementschreiben funktionieren" · subnote EN "Numbering and defaults from Settings · Hire orders" / DE "Nummerierung und Vorgaben aus Einstellungen · Engagementschreiben"
- admin labels EN: Draft from booking · Issue and send · Countersign · Set it up once
  labels DE: Entwurf aus Buchung · Ausstellen und senden · Gegenzeichnen · Einmal einrichten
  1. EN: A date that fills auto-drafts an order. Every field names where it came from. · DE: Ein Termin, der voll wird, entwirft automatisch ein Schreiben. Jedes Feld nennt seine Herkunft.
  2. EN: Issue one order or a whole batch. The artist gets the PDF by email and in the app. · DE: Stelle ein Schreiben oder einen ganzen Stapel aus. Der Artist bekommt das PDF per E-Mail und in der App.
  3. EN: Mark it countersigned by hand, or the artist signs in the app and it flips itself. · DE: Markiere es von Hand als gegengezeichnet, oder der Artist unterschreibt in der App und es springt selbst um.
  4. EN: Letterhead, terms and countersign mode are yours to set. Drafting works before they are done. · DE: Briefkopf, Konditionen und Gegenzeichnungsmodus setzt du selbst. Das Entwerfen geht schon davor.
- producer: labels EN steps 1–3 as admin, step 4 label EN "Import in bulk" / DE "Sammelimport"
  step 4 EN: Map columns once, link unknown artists, fix what is flagged, then draft everything at once. · DE: Ordne Spalten einmal zu, verknüpfe unbekannte Artists, behebe Markiertes, dann entwirf alles auf einmal.
