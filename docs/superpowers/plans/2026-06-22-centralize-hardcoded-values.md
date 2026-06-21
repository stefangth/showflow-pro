# Centralize Hardcoded Values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove drift-prone and convention-violating hardcoded values surfaced by the audit, replacing them with single-sourced constants, design tokens, and `ROUTES`, and wire the booking-engine defaults into both the existing org Settings UI and a new super-admin Platform Defaults UI.

**Architecture:** The four org-tunable booking-engine defaults (`offer_response_window_hours`, `offer_digest_hour_berlin`, `confirmation_digest_hour_berlin`, `resend_from_address`) get one canonical home per runtime — `BOOKING_ENGINE_DEFAULTS` in `src/config/app.config.ts` (frontend) mirrored by an identical const in `supabase/functions/_shared/settings.ts` (edge), since the two runtimes cannot share an import. At runtime an org override (Settings → Booking Engine) or a platform-default row (Platform → Defaults, new) wins via `resolveOrgSetting`; the constants are the last-resort fallback. Remaining items (dead config, route literals, magic numbers, color tokens) are mechanical single-file cleanups.

**Tech Stack:** React 18 + TypeScript + Vite, Tailwind + shadcn/ui, TanStack Query, Supabase (Deno edge functions), Vitest (frontend, via `npx vitest`), Deno test (edge). **Local-env note:** this machine is Deno-only (no Node) — frontend `vitest`/`eslint`/`vite build` run in CI; the edge suite runs locally with `deno test --allow-all --node-modules-dir=none`.

---

## File Structure

**Create:**
- `src/config/app.config.test.ts` — contract test locking the canonical `BOOKING_ENGINE_DEFAULTS` values.
- `docs/superpowers/plans/2026-06-22-centralize-hardcoded-values.md` — this plan.

**Modify:**
- `src/config/app.config.ts` — replace dead `BOOKING_CONFIG` with `BOOKING_ENGINE_DEFAULTS`; add `APP_META.MARKETING_URL`.
- `src/data/platform.ts` + `src/data/platform.test.ts` — batched platform-default read/write for the booking-engine settings.
- `src/components/platform/PlatformDefaultsTab.tsx` — new "Booking engine defaults" card (super-admin UI).
- `src/pages/SettingsPage.tsx` — org Booking Engine form reads the constant instead of inline literals.
- `supabase/functions/_shared/settings.ts` + `send-offer-digest`, `send-confirmation-digest`, `send-transactional-email` `index.ts` — shared edge constant + use it as the resolver fallback.
- `src/components/dashboard/ArtistDashboard.tsx`, `src/App.tsx` — route literals → `ROUTES`.
- `src/data/notifications.ts`, `src/pages/AdminPage.tsx` — named `.limit()` constants.
- `src/index.css`, `src/pages/LoginPage.tsx`, `src/lib/avatar.ts` — color tokens + intent comments.
- `CLAUDE.md` — doc references to the renamed config.

---

## Task 1: Canonical `BOOKING_ENGINE_DEFAULTS` constant (FE) + contract test

**Files:**
- Test: `src/config/app.config.test.ts` (create)
- Modify: `src/config/app.config.ts` (replace `BOOKING_CONFIG`)

- [ ] **Step 1: Write the failing test**

```ts
// src/config/app.config.test.ts
import { describe, it, expect } from "vitest";
import { BOOKING_ENGINE_DEFAULTS } from "./app.config";

describe("config/app.config", () => {
  it("BOOKING_ENGINE_DEFAULTS holds the canonical booking-engine fallbacks (mirror of supabase/functions/_shared/settings.ts)", () => {
    expect(BOOKING_ENGINE_DEFAULTS).toEqual({
      offer_response_window_hours: 48,
      offer_digest_hour_berlin: 19,
      confirmation_digest_hour_berlin: 20,
      resend_from_address: "ShowFlow <noreply@showflow.pro>",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/app.config.test.ts`
Expected: FAIL — `BOOKING_ENGINE_DEFAULTS` is not exported.

- [ ] **Step 3: Replace the dead `BOOKING_CONFIG` block with the constant**

In `src/config/app.config.ts`, replace the `BOOKING_CONFIG` export with:

```ts
/**
 * Canonical fallback defaults for the org-tunable booking-engine settings.
 *
 * These mirror the edge-function fallbacks in
 * `supabase/functions/_shared/settings.ts` (BOOKING_ENGINE_DEFAULTS) — the two
 * runtimes can't share an import, so keep them in sync. At runtime an org
 * override (Settings → Booking Engine) or a platform default (Platform →
 * Defaults) wins via resolveOrgSetting; these literals are the last-resort
 * fallback used only when neither row exists.
 */
export const BOOKING_ENGINE_DEFAULTS = {
  /** Hours an artist has to respond to an offer before it expires. */
  offer_response_window_hours: 48,
  /** Hour (Berlin, 0–23) the daily offer digest is sent. */
  offer_digest_hour_berlin: 19,
  /** Hour (Berlin, 0–23) the daily confirmation digest is sent. */
  confirmation_digest_hour_berlin: 20,
  /** Default Resend sender address for transactional email. */
  resend_from_address: 'ShowFlow <noreply@showflow.pro>',
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/app.config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/app.config.ts src/config/app.config.test.ts
git commit -m "refactor(config): single-source booking-engine defaults; drop dead BOOKING_CONFIG"
```

---

## Task 2: Platform booking-defaults data layer (batched read/write)

**Files:**
- Test: `src/data/platform.test.ts:62` (add cases after the `savePlatformSetting` test)
- Modify: `src/data/platform.ts` (import constant; append type + two functions)

- [ ] **Step 1: Write the failing tests**

Add the import `import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";` and the new functions to the existing import from `./platform`, then add:

```ts
it("fetchPlatformBookingDefaults merges platform rows over the code defaults", async () => {
  const fake = createFakeSupabase({
    app_settings: {
      data: [
        { key: "offer_digest_hour_berlin", value: 7 },
        { key: "offer_response_window_hours", value: 0 }, // 0 is a valid override, not "unset"
        { key: "resend_from_address", value: "Acme <hi@acme.com>" },
      ],
      error: null,
    },
  });
  const out = await fetchPlatformBookingDefaults(fake as never);
  expect(out.offer_digest_hour_berlin).toBe(7);
  expect(out.offer_response_window_hours).toBe(0);
  expect(out.resend_from_address).toBe("Acme <hi@acme.com>");
  expect(out.confirmation_digest_hour_berlin).toBe(BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin);
  expect(fake.calls).toContainEqual({ table: "app_settings", method: "is", args: ["org_id", null] });
});

it("fetchPlatformBookingDefaults returns all code defaults when no platform rows exist", async () => {
  const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
  expect(await fetchPlatformBookingDefaults(fake as never)).toEqual(BOOKING_ENGINE_DEFAULTS);
});

it("savePlatformBookingDefaults upserts all four NULL-org rows in one call", async () => {
  const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
  await savePlatformBookingDefaults(fake as never, {
    offer_response_window_hours: 24,
    offer_digest_hour_berlin: 8,
    confirmation_digest_hour_berlin: 9,
    resend_from_address: "Acme <hi@acme.com>",
  });
  expect(fake.calls).toContainEqual({
    table: "app_settings",
    method: "upsert",
    args: [
      [
        { org_id: null, key: "offer_response_window_hours", value: 24 },
        { org_id: null, key: "offer_digest_hour_berlin", value: 8 },
        { org_id: null, key: "confirmation_digest_hour_berlin", value: 9 },
        { org_id: null, key: "resend_from_address", value: "Acme <hi@acme.com>" },
      ],
      { onConflict: "org_id,key" },
    ],
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/platform.test.ts`
Expected: FAIL — `fetchPlatformBookingDefaults` / `savePlatformBookingDefaults` not exported.

- [ ] **Step 3: Implement the data layer**

In `src/data/platform.ts`, change `import type { AppRole } from "@/config/app.config";` to `import { BOOKING_ENGINE_DEFAULTS, type AppRole } from "@/config/app.config";`, then append:

```ts
export type BookingEngineDefaults = {
  offer_response_window_hours: number;
  offer_digest_hour_berlin: number;
  confirmation_digest_hour_berlin: number;
  resend_from_address: string;
};

const BOOKING_DEFAULT_KEYS = Object.keys(BOOKING_ENGINE_DEFAULTS) as (keyof BookingEngineDefaults)[];

/** Read the platform-default (org_id IS NULL) booking-engine settings in one
 *  query, falling back to the canonical code defaults for any key without a row. */
export async function fetchPlatformBookingDefaults(
  client: SupabaseClient<Database>,
): Promise<BookingEngineDefaults> {
  const { data, error } = await client
    .from("app_settings")
    .select("key, value")
    .is("org_id", null)
    .in("key", BOOKING_DEFAULT_KEYS as string[]);
  if (error) throw error;
  const byKey = new Map(
    ((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]),
  );
  const out: BookingEngineDefaults = { ...BOOKING_ENGINE_DEFAULTS };
  for (const key of BOOKING_DEFAULT_KEYS) {
    const v = byKey.get(key);
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

/** Upsert all four platform-default booking-engine settings in one call (super-admin only). */
export async function savePlatformBookingDefaults(
  client: SupabaseClient<Database>,
  values: BookingEngineDefaults,
): Promise<void> {
  const rows = BOOKING_DEFAULT_KEYS.map((key) => ({
    org_id: null as string | null,
    key: key as string,
    value: values[key] as Json,
  }));
  const { error } = await client.from("app_settings").upsert(rows, { onConflict: "org_id,key" });
  if (error) throw error;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/platform.test.ts`
Expected: PASS (all cases, old and new).

- [ ] **Step 5: Commit**

```bash
git add src/data/platform.ts src/data/platform.test.ts
git commit -m "feat(platform): batched read/write for platform booking-engine defaults"
```

---

## Task 3: Edge shared constant + resolver-fallback refactor

**Files:**
- Modify: `supabase/functions/_shared/settings.ts` (add const)
- Modify: `supabase/functions/send-offer-digest/index.ts`, `send-confirmation-digest/index.ts`, `send-transactional-email/index.ts`
- Test: existing `supabase/functions/**/index.di.test.ts` already assert the default values (19/20/48 + from-address)

- [ ] **Step 1: Confirm the existing suite is green (baseline)**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: `ok | 504 passed | 0 failed`.

- [ ] **Step 2: Add the mirrored constant to `_shared/settings.ts`**

After the `SettingRow` interface, add:

```ts
/**
 * Canonical fallback defaults for the org-tunable booking-engine settings.
 * Mirrors the frontend `src/config/app.config.ts` BOOKING_ENGINE_DEFAULTS — the
 * two runtimes can't share an import, so keep them in sync. An org override or a
 * platform default wins via resolveOrgSetting; these are the last-resort fallback.
 */
export const BOOKING_ENGINE_DEFAULTS = {
  offer_response_window_hours: 48,
  offer_digest_hour_berlin: 19,
  confirmation_digest_hour_berlin: 20,
  resend_from_address: "ShowFlow <noreply@showflow.pro>",
} as const;
```

- [ ] **Step 3: Use the constant in the three edge functions**

`send-offer-digest/index.ts`: add `BOOKING_ENGINE_DEFAULTS` to the `_shared/settings.ts` import, then:
```ts
targetHour = await resolveOrgSetting<number>(admin, org.id, 'offer_digest_hour_berlin', BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin);
// ...
offerWindowHours = await resolveOrgSetting<number>(admin, org.id, 'offer_response_window_hours', BOOKING_ENGINE_DEFAULTS.offer_response_window_hours);
```
`send-confirmation-digest/index.ts`: add the import, then:
```ts
targetHour = await resolveOrgSetting<number>(admin, org.id, 'confirmation_digest_hour_berlin', BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin);
```
`send-transactional-email/index.ts`: add the import, then:
```ts
const fromAddress = await resolveOrgSetting<string>(
  admin, orgId, 'resend_from_address', BOOKING_ENGINE_DEFAULTS.resend_from_address)
```

- [ ] **Step 4: Run the full edge suite (behavior unchanged → still green)**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: `ok | 504 passed | 0 failed`. (Per env memory: run the **whole** suite, never a single file.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/settings.ts supabase/functions/send-offer-digest/index.ts supabase/functions/send-confirmation-digest/index.ts supabase/functions/send-transactional-email/index.ts
git commit -m "refactor(edge): source booking-engine fallbacks from shared constant"
```

---

## Task 4: Wire the existing org Settings form to the constant

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Import the constant**

Change `import { ROUTES } from '@/config/app.config';` to `import { ROUTES, BOOKING_ENGINE_DEFAULTS } from '@/config/app.config';`.

- [ ] **Step 2: Replace the four inline literals in `BookingEngineTab`**

```tsx
placeholder={BOOKING_ENGINE_DEFAULTS.resend_from_address}
// ...
value={get('offer_response_window_hours', BOOKING_ENGINE_DEFAULTS.offer_response_window_hours)}
// ...
value={get('offer_digest_hour_berlin', BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin)}
// ...
value={get('confirmation_digest_hour_berlin', BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin)}
```

- [ ] **Step 3: Verify no literal fallbacks remain**

Run: `rg -n "get\('offer_response_window_hours', 48\)|get\('offer_digest_hour_berlin', 19\)|get\('confirmation_digest_hour_berlin', 20\)|placeholder=\"ShowFlow" src/pages/SettingsPage.tsx`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "refactor(settings): org Booking Engine form reads BOOKING_ENGINE_DEFAULTS"
```

---

## Task 5: New super-admin "Booking engine defaults" Platform UI

**Files:**
- Modify: `src/components/platform/PlatformDefaultsTab.tsx` (split into two cards)

- [ ] **Step 1: Restructure the tab into two cards**

Replace the single-card export with a wrapper rendering the existing starter-catalog card plus a new booking-defaults card. Imports add:
```tsx
import {
  savePlatformSetting, EMPTY_STARTER_TEMPLATE, type StarterCatalogTemplate,
  fetchPlatformBookingDefaults, savePlatformBookingDefaults, type BookingEngineDefaults,
} from "@/data/platform";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import { Input } from "@/components/ui/input";
```
Wrapper:
```tsx
export function PlatformDefaultsTab() {
  return (
    <div className="space-y-6">
      <StarterCatalogCard />
      <BookingEngineDefaultsCard />
    </div>
  );
}
```
Move the existing query/state/mutation/JSX into `function StarterCatalogCard() { ... }` unchanged.

- [ ] **Step 2: Add the booking-defaults card**

```tsx
function BookingEngineDefaultsCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["platform", "booking-defaults"],
    queryFn: () => fetchPlatformBookingDefaults(supabase),
  });
  const [form, setForm] = useState<BookingEngineDefaults>({ ...BOOKING_ENGINE_DEFAULTS });
  useEffect(() => { if (data) setForm(data); }, [data]);
  const save = useMutation({
    mutationFn: () => savePlatformBookingDefaults(supabase, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform", "booking-defaults"] }); toast.success("Booking engine defaults saved"); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Booking engine defaults</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Platform-wide fallbacks for the booking engine. An organization that sets its own value in
          Settings → Booking Engine overrides these.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="bd-window">Offer response window (hours)</Label>
            <Input id="bd-window" type="number" min={1}
              value={form.offer_response_window_hours}
              placeholder={String(BOOKING_ENGINE_DEFAULTS.offer_response_window_hours)}
              onChange={(e) => setForm((f) => ({ ...f, offer_response_window_hours: Number(e.target.value) }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bd-offer-hour">Offer digest hour (Berlin)</Label>
            <Input id="bd-offer-hour" type="number" min={0} max={23}
              value={form.offer_digest_hour_berlin}
              placeholder={String(BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin)}
              onChange={(e) => setForm((f) => ({ ...f, offer_digest_hour_berlin: Number(e.target.value) }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bd-conf-hour">Confirmation digest hour (Berlin)</Label>
            <Input id="bd-conf-hour" type="number" min={0} max={23}
              value={form.confirmation_digest_hour_berlin}
              placeholder={String(BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin)}
              onChange={(e) => setForm((f) => ({ ...f, confirmation_digest_hour_berlin: Number(e.target.value) }))} />
          </div>
        </div>
        <div className="space-y-1.5 max-w-sm">
          <Label htmlFor="bd-from">Default sender address (Resend)</Label>
          <Input id="bd-from" type="text"
            value={form.resend_from_address}
            placeholder={BOOKING_ENGINE_DEFAULTS.resend_from_address}
            onChange={(e) => setForm((f) => ({ ...f, resend_from_address: e.target.value }))} />
          <p className="text-xs text-muted-foreground">Sender for all transactional email unless an org overrides it.</p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save defaults</Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Build to verify the component compiles**

Run: `npm run build`
Expected: success, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/platform/PlatformDefaultsTab.tsx
git commit -m "feat(platform): super-admin Booking engine defaults card"
```

---

## Task 6: Marketing URL → `APP_META` (#7)

**Files:**
- Modify: `src/config/app.config.ts`, `src/pages/LoginPage.tsx`

- [ ] **Step 1: Add `MARKETING_URL` to `APP_META`**

```ts
export const APP_META = {
  NAME: 'ShowFlow',
  DESCRIPTION: 'Artist Booking SaaS for live show productions',
  VERSION: '1.0.0',
  /** Public marketing site — used for the "Book a demo" CTA on the login page. */
  MARKETING_URL: 'https://showflow.pro',
} as const;
```

- [ ] **Step 2: Use it in `LoginPage.tsx`** (`APP_META` is already imported)

```tsx
href={`${APP_META.MARKETING_URL}/signup`}
```

- [ ] **Step 3: Verify the literal is gone**

Run: `rg -n "showflow\.pro/signup" src/`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add src/config/app.config.ts src/pages/LoginPage.tsx
git commit -m "refactor(login): source marketing CTA URL from APP_META"
```

---

## Task 7: Route literals → `ROUTES` (#11, #12)

**Files:**
- Modify: `src/components/dashboard/ArtistDashboard.tsx`, `src/App.tsx`

- [ ] **Step 1: ArtistDashboard — import + two links**

Add `import { ROUTES } from '@/config/app.config';`, then replace both occurrences:
```tsx
to={`${ROUTES.AVAILABILITY}?filter=unanswered`}
```

- [ ] **Step 2: App.tsx — route patterns** (`ROUTES` already imported)

```tsx
<Route path={ROUTES.HOME} element={<Navigate to={ROUTES.LOGIN} replace />} />
<Route path={ROUTES.SIGNUP} element={<Navigate to={ROUTES.LOGIN} replace />} />
```

- [ ] **Step 3: Verify no literals remain**

Run: `rg -n 'to="/availability|path="/"|path="/signup"' src/components/dashboard/ArtistDashboard.tsx src/App.tsx`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/ArtistDashboard.tsx src/App.tsx
git commit -m "refactor(routes): use ROUTES constants for availability/home/signup links"
```

---

## Task 8: Named `.limit()` constants (#14)

**Files:**
- Modify: `src/data/notifications.ts`, `src/pages/AdminPage.tsx`

- [ ] **Step 1: notifications.ts** — existing test `src/data/notifications.test.ts` asserts `.limit(50)`; the value stays `50` so it remains green.

```ts
/** Newest-N notifications fetched for the notification bell. */
export const NOTIFICATIONS_LIMIT = 50;
// ...
.limit(NOTIFICATIONS_LIMIT);
```

- [ ] **Step 2: AdminPage.tsx** — add module constants and use them

```ts
/** Row caps for the admin activity panels. */
const AUDIT_LOG_LIMIT = 50;
const SYNC_LOG_LIMIT = 20;
// ...
.limit(AUDIT_LOG_LIMIT);  // booking_audit_log
.limit(SYNC_LOG_LIMIT);   // airtable_sync_log
```

- [ ] **Step 3: Run the notifications test**

Run: `npx vitest run src/data/notifications.test.ts`
Expected: PASS (recorded `limit` arg is still `50`).

- [ ] **Step 4: Commit**

```bash
git add src/data/notifications.ts src/pages/AdminPage.tsx
git commit -m "refactor: name the notification/admin pagination limits"
```

---

## Task 9: Color tokens + intent comments (#8, #9)

**Files:**
- Modify: `src/index.css`, `src/pages/LoginPage.tsx`, `src/lib/avatar.ts`

- [ ] **Step 1: Add auth-hero tokens to `:root` in `index.css`** (after `--shadow-3`)

```css
/* ── Auth hero (LoginPage immersive sign-in) — fixed brand art, theme-independent ── */
--auth-bg: #0a0912;
--auth-hero-gradient:
  radial-gradient(120% 90% at 30% 14%, rgba(255, 150, 180, 0.16) 0%, rgba(255, 150, 180, 0) 46%),
  linear-gradient(178deg, #0a1130 0%, #271a47 34%, #4c2a5e 56%, #8d3a5f 78%, #d7705f 100%);
--auth-scrim: linear-gradient(105deg, rgba(11, 9, 18, 0.88) 0%, rgba(11, 9, 18, 0.62) 34%, rgba(11, 9, 18, 0.3) 58%, rgba(11, 9, 18, 0.04) 100%);
--auth-top-fade: linear-gradient(180deg, rgba(11, 9, 18, 0.5), rgba(11, 9, 18, 0));
--auth-card: rgba(18, 16, 27, 0.55);
--auth-hairline: rgba(255, 255, 255, 0.1);
```

- [ ] **Step 2: Reference tokens in `LoginPage.tsx`** — delete the `HERO_GRADIENT` const and swap:
  - `bg-[#0a0912]` → `bg-[var(--auth-bg)]`
  - base gradient → `style={{ background: 'var(--auth-hero-gradient)' }}`
  - scrim → `style={{ background: 'var(--auth-scrim)' }}`
  - top fade → `style={{ background: 'var(--auth-top-fade)' }}`
  - wordmark + headline `text-white` → `text-foreground` (container forces `.dark`)
  - card `border-white/10 bg-[rgba(18,16,27,0.55)]` → `border-[var(--auth-hairline)] bg-[var(--auth-card)]`
  - footer `border-white/10` → `border-[var(--auth-hairline)]`

- [ ] **Step 3: Document the avatar palette as intentional data (`src/lib/avatar.ts`)**

```ts
/*
 * Stable 6-colour avatar palette — deterministic from any string seed.
 * These hex pairs are intentional DATA, not theme tokens: each avatar must keep
 * the same tint across light/dark mode (a person's colour shouldn't change with
 * the theme), so they are fixed here rather than pulled from index.css.
 */
```

- [ ] **Step 4: Verify residual colors gone + build**

Run: `rg -n "text-white|border-white/10|#0a0912|HERO_GRADIENT" src/pages/LoginPage.tsx` → no matches.
Run: `npm run build` → success.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/pages/LoginPage.tsx src/lib/avatar.ts
git commit -m "refactor(login): move auth-hero colors to CSS tokens; document avatar palette"
```

---

## Task 10: Docs + final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the two `BOOKING_CONFIG` references in `CLAUDE.md`** to `BOOKING_ENGINE_DEFAULTS` (architecture tree comment + Key files table row, noting it mirrors `_shared/settings.ts`).

- [ ] **Step 2: Full verification sweep**

```bash
rg -n "BOOKING_CONFIG|SOFT_BOOK_EXPIRY" src/ supabase/   # expect: none
deno test --allow-all --node-modules-dir=none supabase/functions/   # expect: 504 passed
npx vitest run                                            # expect: all pass (CI/Node)
npm run lint && npm run build                             # expect: clean + success (CI/Node)
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rename BOOKING_CONFIG → BOOKING_ENGINE_DEFAULTS references"
```

---

## Deliberate non-changes (decisions, not omissions)

- **#10 mobile overlay `bg-black/50` (`AppLayout.tsx`)** — left as-is. It matches the repo's own shadcn overlay convention (`ui/dialog.tsx` uses `bg-black/80`); the table's suggested `bg-foreground/50` would invert to a light scrim in dark mode (a regression). A dark scrim must stay dark in both themes.
- **#13 toast magic numbers (`use-toast.ts`)** — already extracted as named constants (`TOAST_LIMIT`, `TOAST_REMOVE_DELAY`) in the vendored shadcn file. No change needed.

---

## Self-Review

**1. Spec coverage:** All 14 audit items map to a task — #1–4/#6 → Tasks 1–5; #5 → Task 1; #7 → Task 6; #11/#12 → Task 7; #14 → Task 8; #8/#9 → Task 9; docs → Task 10; #10/#13 → Deliberate non-changes. ✓
**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N"; every code step shows real code. ✓
**3. Type consistency:** `BookingEngineDefaults`, `fetchPlatformBookingDefaults`, `savePlatformBookingDefaults`, `BOOKING_ENGINE_DEFAULTS`, and the four setting keys are spelled identically across Tasks 1–5 and the edge mirror (Task 3). ✓
