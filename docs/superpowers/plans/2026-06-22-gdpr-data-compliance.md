# GDPR Data & Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user self-serve data export, account deletion, and granular notification preferences, plus super-admin org export and org deletion — all GDPR-compliant and honoring the `booking_audit_log` never-delete rule.

**Architecture:** Pure-SQL operations are `SECURITY DEFINER` RPCs (pgTAP-tested); only account deletion needs the auth admin API, so it (and the large org-export bundle) are edge functions (DI pattern). Account deletion anonymizes-and-retains shared/audit rows; org deletion is a hard tenant teardown. Notification preferences are a per-user `category × channel` matrix enforced by one email gate (in `send-transactional-email`, which also covers digests) and one `BEFORE INSERT` gate trigger on `notifications`.

**Tech Stack:** Supabase (Postgres + RLS + RPCs, Deno edge functions), React 18 + Vite + TypeScript, `@tanstack/react-query`, `react-hook-form` + `zod`, `sonner`, shadcn/ui. Tests: vitest (+ `src/test/supabaseFake.ts`, `renderWithProviders`), pgTAP (CI), Deno DI (`_shared/testing.ts`).

**Spec:** `docs/superpowers/specs/2026-06-22-gdpr-data-compliance-design.md`

---

## Conventions used throughout

- **Migrations** are applied via the Supabase MCP `apply_migration` tool (it records a real-timestamp version, e.g. `20260622HHMMSS`). After applying, save the identical SQL to `supabase/migrations/<version>_<name>.sql` so the repo matches, then regenerate `src/integrations/supabase/types.ts` via the MCP `generate_typescript_types` tool. Never hand-edit `types.ts`. pgTAP runs in CI only — write the `.sql` test, do not expect to run it locally.
- **Deno edge tests** run locally with: `deno test --allow-all --node-modules-dir=none supabase/functions/<name>/`. Run the **whole** suite (`deno test --allow-all --node-modules-dir=none supabase/functions/`) after any edge change.
- **Vitest** runs locally: `npx vitest run <path>`.
- **Commits**: imperative, lowercase, ≤72 chars. Commit at the end of each task.
- **No local Node/supabase-CLI/Docker** — vitest/pgTAP/lint/build are validated in CI; the Deno suite runs locally.

## File Structure (created / modified)

**Shared category model (source of truth):**
- Create `supabase/functions/_shared/notificationCategories.ts` — pure category list + `type→category` + `template→category` maps (Deno + browser safe).
- Create `src/lib/notificationCategories.ts` — re-exports the shared module (mirrors `src/lib/identity.ts`).

**Notification preferences:**
- Migration: `notification_preferences` table + RLS + `should_notify` RPC.
- Migration: `category_of` SQL fn + `gate_notification_pref` BEFORE INSERT trigger on `notifications`.
- Create `src/data/notificationPreferences.ts`, `src/hooks/useNotificationPreferences.ts`.
- Modify `supabase/functions/send-transactional-email/index.ts` (per-category email gate).

**Data export:**
- Migration: `export_my_data` RPC.
- Create `src/data/account.ts` (`exportMyData`, `deleteMyAccount`).
- Create `supabase/functions/export-org-data/` edge function.
- Modify `src/data/platform.ts` (`exportOrgData`, `deleteOrg`).

**Deletion:**
- Migration: `anonymize_user` + `sole_admin_orgs` RPCs.
- Migration: `delete_org` RPC.
- Create `supabase/functions/delete-my-account/` edge function.
- Modify `supabase/functions/_shared/testing.ts` (fake `auth.admin.deleteUser`).

**Frontend surfaces:**
- Modify `src/pages/ProfilePage.tsx` (3 new cards).
- Modify `src/components/platform/EditOrgDialog.tsx` (danger zone).

**Wrap-up:**
- Modify `package.json`, `src/config/app.config.ts` (1.5.0), `public/changelog.md` (+regenerate JSON), `CLAUDE.md`.

> **Refinements vs the spec** (behavior-equivalent, lower-risk): (1) in-app enforcement is one `BEFORE INSERT` trigger on `notifications`, not edits to each emitting trigger; (2) digest senders need no edit — they send through `send-transactional-email`; (3) the category maps live in a shared pure module re-exported to the frontend, per the `identity.ts` precedent.

---

## Task 1: Shared notification-category model

**Files:**
- Create: `supabase/functions/_shared/notificationCategories.ts`
- Create: `src/lib/notificationCategories.ts`
- Test: `src/lib/notificationCategories.test.ts`

- [ ] **Step 1: Write the shared pure module**

Create `supabase/functions/_shared/notificationCategories.ts`:

```ts
// Single source of truth for notification categories (GDPR notification prefs).
// Pure + dependency-free so it runs in Deno (edge gate) and the browser (re-export),
// mirroring the identity.ts pattern. The SQL category_of()/should_notify() functions
// mirror IN_APP_TYPE_CATEGORY — keep them in sync.

export const NOTIFICATION_CATEGORIES = [
  { key: "booking_offers", label: "Booking offers", description: "New offers awaiting your response" },
  { key: "booking_confirmations", label: "Booking confirmations", description: "When one of your bookings is confirmed" },
  { key: "booking_activity", label: "Booking activity", description: "Producer updates — artists accepting offers" },
  { key: "schedule_changes", label: "Schedule changes", description: "Date, session, and cancellation changes" },
  { key: "at_risk", label: "At-risk & escalations", description: "Tiers at risk of going unfilled and cast escalations" },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["key"];

export const NOTIFICATION_CHANNELS = ["email", "in_app"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** In-app `notifications.type` value -> category. Unmapped types are always delivered. */
export const IN_APP_TYPE_CATEGORY: Record<string, NotificationCategory> = {
  booking_confirmed: "booking_confirmations",
  booking_ready_to_confirm: "booking_activity",
  schedule_change: "schedule_changes",
  session_added: "schedule_changes",
  session_removed: "schedule_changes",
  session_retimed: "schedule_changes",
  cancelled: "schedule_changes",
  tier_at_risk: "at_risk",
  cast_escalation_requested: "at_risk",
};

/** Email `template_name` -> category. Unmapped templates (invites, password reset) always send. */
export const EMAIL_TEMPLATE_CATEGORY: Record<string, NotificationCategory> = {
  "artist-offer-digest": "booking_offers",
  "artist-confirmation-digest": "booking_confirmations",
  "cast-escalation-requested": "at_risk",
};

/** The category for an email template, or null when it is critical/uncategorized (always send). */
export function categoryForTemplate(templateName: string): NotificationCategory | null {
  return EMAIL_TEMPLATE_CATEGORY[templateName] ?? null;
}
```

- [ ] **Step 2: Write the frontend re-export**

Create `src/lib/notificationCategories.ts`:

```ts
// Re-export the shared category model so the UI and the edge gate never diverge
// (mirrors src/lib/identity.ts).
export {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  IN_APP_TYPE_CATEGORY,
  EMAIL_TEMPLATE_CATEGORY,
  categoryForTemplate,
  type NotificationCategory,
  type NotificationChannel,
} from "../../supabase/functions/_shared/notificationCategories.ts";
```

- [ ] **Step 3: Write the failing test**

Create `src/lib/notificationCategories.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  IN_APP_TYPE_CATEGORY,
  categoryForTemplate,
} from "./notificationCategories";

describe("notification category model", () => {
  it("exposes five categories and two channels", () => {
    expect(NOTIFICATION_CATEGORIES.map((c) => c.key)).toEqual([
      "booking_offers", "booking_confirmations", "booking_activity", "schedule_changes", "at_risk",
    ]);
    expect(NOTIFICATION_CHANNELS).toEqual(["email", "in_app"]);
  });

  it("maps known in-app types and email templates to categories", () => {
    expect(IN_APP_TYPE_CATEGORY["booking_confirmed"]).toBe("booking_confirmations");
    expect(IN_APP_TYPE_CATEGORY["tier_at_risk"]).toBe("at_risk");
    expect(categoryForTemplate("artist-offer-digest")).toBe("booking_offers");
  });

  it("returns null for critical/unmapped templates (always send)", () => {
    expect(categoryForTemplate("org-invitation")).toBeNull();
    expect(categoryForTemplate("password-reset")).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/notificationCategories.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/notificationCategories.ts src/lib/notificationCategories.ts src/lib/notificationCategories.test.ts
git commit -m "feat: shared notification-category model"
```

---

## Task 2: notification_preferences table + should_notify RPC

**Files:**
- Migration (apply via MCP): `notification_preferences`
- Save: `supabase/migrations/<version>_notification_preferences.sql`
- Test: `supabase/tests/rpc/should_notify.sql` (CI-only)
- Regenerate: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Per-user notification preferences (category x channel). Opt-out model:
-- a missing row / key = enabled, so existing users keep all notifications.
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "own notif prefs - select" on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());
create policy "own notif prefs - insert" on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());
create policy "own notif prefs - update" on public.notification_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger update_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.update_updated_at_column();

-- Returns whether a user wants a (category, channel) notification.
-- Defaults to TRUE when the row, the category key, or the channel key is absent.
create or replace function public.should_notify(p_user uuid, p_category text, p_channel text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (prefs -> p_category ->> p_channel)::boolean
       from public.notification_preferences
      where user_id = p_user),
    true
  );
$$;

revoke all on function public.should_notify(uuid, text, text) from public, anon;
grant execute on function public.should_notify(uuid, text, text) to authenticated;
```

- [ ] **Step 2: Apply + persist + regenerate types**

Apply via MCP `apply_migration` (name: `notification_preferences`). Save identical SQL to `supabase/migrations/<version>_notification_preferences.sql`. Regenerate `src/integrations/supabase/types.ts` via MCP `generate_typescript_types`.

- [ ] **Step 3: Write the pgTAP test (CI-only)**

Create `supabase/tests/rpc/should_notify.sql`:

```sql
-- should_notify: defaults true; respects an explicit false; per channel.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000009a0','authenticated','authenticated','np@x.com',now(),'{"provider":"email"}','{}',now(),now());
SET session_replication_role = DEFAULT;

SELECT ok(public.should_notify('00000000-0000-0000-0000-0000000009a0','booking_offers','email'),
  'no row -> enabled');

INSERT INTO public.notification_preferences (user_id, prefs)
VALUES ('00000000-0000-0000-0000-0000000009a0',
        '{"booking_offers":{"email":false}}'::jsonb);

SELECT ok(NOT public.should_notify('00000000-0000-0000-0000-0000000009a0','booking_offers','email'),
  'explicit false -> disabled');
SELECT ok(public.should_notify('00000000-0000-0000-0000-0000000009a0','booking_offers','in_app'),
  'missing channel key -> enabled');
SELECT ok(public.should_notify('00000000-0000-0000-0000-0000000009a0','schedule_changes','email'),
  'missing category key -> enabled');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ supabase/tests/rpc/should_notify.sql src/integrations/supabase/types.ts
git commit -m "feat: notification_preferences table and should_notify rpc"
```

---

## Task 3: category_of + BEFORE INSERT gate trigger on notifications

**Files:**
- Migration (apply via MCP): `notifications_pref_gate`
- Save: `supabase/migrations/<version>_notifications_pref_gate.sql`
- Test: `supabase/tests/triggers/notifications_pref_gate.sql` (CI-only)

- [ ] **Step 1: Write the migration SQL**

```sql
-- Maps an in-app notification type to a preference category (mirrors
-- IN_APP_TYPE_CATEGORY in _shared/notificationCategories.ts). NULL = always deliver.
create or replace function public.category_of(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'booking_confirmed' then 'booking_confirmations'
    when 'booking_ready_to_confirm' then 'booking_activity'
    when 'schedule_change' then 'schedule_changes'
    when 'session_added' then 'schedule_changes'
    when 'session_removed' then 'schedule_changes'
    when 'session_retimed' then 'schedule_changes'
    when 'cancelled' then 'schedule_changes'
    when 'tier_at_risk' then 'at_risk'
    when 'cast_escalation_requested' then 'at_risk'
    else null
  end;
$$;

-- One gate for ALL in-app notification inserts (trigger- and app-emitted):
-- skip the insert when the recipient disabled in_app for this category.
create or replace function public.gate_notification_pref()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_category text;
begin
  v_category := public.category_of(NEW.type);
  if v_category is null then
    return NEW; -- uncategorized/critical types are always delivered
  end if;
  if public.should_notify(NEW.user_id, v_category, 'in_app') then
    return NEW;
  end if;
  return null; -- recipient disabled in-app for this category
end;
$$;

drop trigger if exists gate_notification_pref_trigger on public.notifications;
create trigger gate_notification_pref_trigger
before insert on public.notifications
for each row execute function public.gate_notification_pref();
```

- [ ] **Step 2: Apply + persist**

Apply via MCP `apply_migration` (name: `notifications_pref_gate`). Save identical SQL to `supabase/migrations/<version>_notifications_pref_gate.sql`. (No new types — no schema change.)

- [ ] **Step 3: Write the pgTAP test (CI-only)**

Create `supabase/tests/triggers/notifications_pref_gate.sql`:

```sql
-- gate_notification_pref: disabled category is skipped; enabled/unmapped inserted.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000009b0','authenticated','authenticated','gate@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000009c0','GateOrg','gate-org');
INSERT INTO public.notification_preferences (user_id, prefs)
VALUES ('00000000-0000-0000-0000-0000000009b0','{"at_risk":{"in_app":false}}'::jsonb);
SET session_replication_role = DEFAULT;

-- disabled category -> not inserted
INSERT INTO public.notifications (user_id, org_id, type, title)
VALUES ('00000000-0000-0000-0000-0000000009b0','00000000-0000-0000-0000-0000000009c0','tier_at_risk','x');
SELECT is((SELECT count(*)::int FROM public.notifications
           WHERE user_id='00000000-0000-0000-0000-0000000009b0' AND type='tier_at_risk'),
          0, 'disabled in_app category is skipped');

-- enabled category (default) -> inserted
INSERT INTO public.notifications (user_id, org_id, type, title)
VALUES ('00000000-0000-0000-0000-0000000009b0','00000000-0000-0000-0000-0000000009c0','booking_confirmed','y');
SELECT is((SELECT count(*)::int FROM public.notifications
           WHERE user_id='00000000-0000-0000-0000-0000000009b0' AND type='booking_confirmed'),
          1, 'enabled category is inserted');

-- unmapped type -> always inserted
INSERT INTO public.notifications (user_id, org_id, type, title)
VALUES ('00000000-0000-0000-0000-0000000009b0','00000000-0000-0000-0000-0000000009c0','some_future_type','z');
SELECT is((SELECT count(*)::int FROM public.notifications
           WHERE user_id='00000000-0000-0000-0000-0000000009b0' AND type='some_future_type'),
          1, 'unmapped type is always inserted');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ supabase/tests/triggers/notifications_pref_gate.sql
git commit -m "feat: in-app notification preference gate trigger"
```

---

## Task 4: notificationPreferences data-access

**Files:**
- Create: `src/data/notificationPreferences.ts`
- Test: `src/data/notificationPreferences.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/data/notificationPreferences.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchMyNotificationPreferences, updateMyNotificationPreferences } from "./notificationPreferences";

describe("fetchMyNotificationPreferences", () => {
  it("selects the prefs row and returns the map", async () => {
    const fake = createFakeSupabase({
      notification_preferences: { data: { prefs: { at_risk: { email: false } } }, error: null },
    });
    const result = await fetchMyNotificationPreferences(fake as never, "u1");
    expect(result).toEqual({ at_risk: { email: false } });
    expect(fake.calls).toContainEqual({ table: "notification_preferences", method: "eq", args: ["user_id", "u1"] });
  });

  it("returns {} when there is no row", async () => {
    const fake = createFakeSupabase({ notification_preferences: { data: null, error: null } });
    expect(await fetchMyNotificationPreferences(fake as never, "u1")).toEqual({});
  });
});

describe("updateMyNotificationPreferences", () => {
  it("upserts the prefs map keyed by user_id", async () => {
    const fake = createFakeSupabase({ notification_preferences: { data: null, error: null } });
    await updateMyNotificationPreferences(fake as never, "u1", { at_risk: { email: false } });
    expect(fake.calls).toContainEqual({
      table: "notification_preferences", method: "upsert",
      args: [{ user_id: "u1", prefs: { at_risk: { email: false } } }, { onConflict: "user_id" }],
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/notificationPreferences.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/data/notificationPreferences.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { NotificationCategory, NotificationChannel } from "@/lib/notificationCategories";

export type NotificationPrefs = Partial<
  Record<NotificationCategory, Partial<Record<NotificationChannel, boolean>>>
>;

/** The current user's notification preferences map ({} = all defaults / enabled). */
export async function fetchMyNotificationPreferences(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<NotificationPrefs> {
  const { data, error } = await client
    .from("notification_preferences")
    .select("prefs")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return ((data?.prefs ?? {}) as NotificationPrefs);
}

/** Upsert the full prefs map for the current user. */
export async function updateMyNotificationPreferences(
  client: SupabaseClient<Database>,
  userId: string,
  prefs: NotificationPrefs,
): Promise<void> {
  const { error } = await client
    .from("notification_preferences")
    .upsert({ user_id: userId, prefs: prefs as never }, { onConflict: "user_id" });
  if (error) throw error;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/data/notificationPreferences.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/notificationPreferences.ts src/data/notificationPreferences.test.ts
git commit -m "feat: notification preferences data-access"
```

---

## Task 5: useNotificationPreferences hook

**Files:**
- Create: `src/hooks/useNotificationPreferences.ts`
- Test: `src/hooks/useNotificationPreferences.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useNotificationPreferences.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

const fetchSpy = vi.fn().mockResolvedValue({ at_risk: { email: false } });
vi.mock("@/data/notificationPreferences", () => ({
  fetchMyNotificationPreferences: (...a: unknown[]) => fetchSpy(...a),
  updateMyNotificationPreferences: vi.fn(),
}));

import { useNotificationPreferences } from "./useNotificationPreferences";

describe("useNotificationPreferences", () => {
  it("loads the current user's prefs", async () => {
    const { result } = renderHookWithProviders(() => useNotificationPreferences());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ at_risk: { email: false } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/hooks/useNotificationPreferences.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useNotificationPreferences.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  fetchMyNotificationPreferences,
  updateMyNotificationPreferences,
  type NotificationPrefs,
} from "@/data/notificationPreferences";

export function useNotificationPreferences() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notification-preferences", user?.id],
    queryFn: () => fetchMyNotificationPreferences(supabase, user!.id),
    enabled: !!user?.id,
  });
}

export function useUpdateNotificationPreferences() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: NotificationPrefs) => updateMyNotificationPreferences(supabase, user!.id, prefs),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/hooks/useNotificationPreferences.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNotificationPreferences.ts src/hooks/useNotificationPreferences.test.tsx
git commit -m "feat: useNotificationPreferences hook"
```

---

## Task 6: Per-category email gate in send-transactional-email

**Files:**
- Modify: `supabase/functions/send-transactional-email/index.ts`
- Test: `supabase/functions/send-transactional-email/index.pref.test.ts`

The gate resolves the recipient address → `user_id`, maps `templateName` → category, and skips the send when `should_notify(user, category, 'email')` is false. It **fails open**: unmapped/critical templates and unresolvable recipients always send. It sits right after the existing `suppressed_emails` check.

- [ ] **Step 1: Add the import**

In `supabase/functions/send-transactional-email/index.ts`, add to the imports at the top:

```ts
import { categoryForTemplate } from "../_shared/notificationCategories.ts";
```

- [ ] **Step 2: Insert the gate after the suppression block**

Immediately after the `if (suppressed) { ... }` block (right before the `// Get or create unsubscribe token` comment), insert:

```ts
  // Per-category email preference gate (fail-open). Critical/unmapped templates
  // (invites, password reset) have no category and always send.
  const prefCategory = categoryForTemplate(templateName)
  if (prefCategory) {
    const { data: prefUser } = await admin
      .from('profiles')
      .select('user_id')
      .eq('user_id',
        (await admin.auth.admin.listUsers()).data?.users?.find(
          (u) => (u.email ?? '').toLowerCase() === effectiveRecipient.toLowerCase(),
        )?.id ?? '00000000-0000-0000-0000-000000000000',
      )
      .maybeSingle()
    if (prefUser?.user_id) {
      const { data: wants, error: prefErr } = await admin.rpc('should_notify', {
        p_user: prefUser.user_id, p_category: prefCategory, p_channel: 'email',
      })
      if (!prefErr && wants === false) {
        await admin.from('email_send_log').insert({
          message_id: messageId,
          template_name: templateName,
          recipient_email: effectiveRecipient,
          status: 'suppressed',
        })
        return json({ success: false, reason: 'pref_disabled' }, 200)
      }
    }
  }
```

> Note: `auth.admin.listUsers()` returns the first page only. For the test seam and current scale this is acceptable; if recipient resolution must scale, swap to a dedicated `get_user_id_by_email(email)` SECURITY DEFINER RPC in a follow-up. The gate fails open if the user isn't found, so a miss never blocks mail.

- [ ] **Step 3: Write the failing test**

Create `supabase/functions/send-transactional-email/index.pref.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const ENV = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  RESEND_API_KEY: "re_test",
};

Deno.test("skips send when the recipient disabled the template's category", async () => {
  const { deps } = makeFakeDeps({
    envVars: ENV,
    usersById: { "u1": { email: "artist@x.com" } },
    tables: {
      suppressed_emails: { data: null, error: null },
      profiles: { data: { user_id: "u1" }, error: null },
      email_send_log: { data: null, error: null },
    },
    rpcs: { should_notify: { data: false, error: null } },
  });
  const req = makeRequest({
    headers: { "content-type": "application/json" },
    body: { templateName: "artist-offer-digest", recipientEmail: "artist@x.com" },
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).reason, "pref_disabled");
});

Deno.test("critical template (no category) always proceeds past the gate", async () => {
  // org-invitation has no category -> gate is skipped. We assert it does NOT
  // short-circuit with pref_disabled (it will fail later on Resend, which is fine).
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: {
      suppressed_emails: { data: null, error: null },
      // existing, unused token -> the function reuses it and proceeds to send
      email_unsubscribe_tokens: { data: { token: "tok", used_at: null }, error: null },
      email_send_log: { data: null, error: null },
    },
    rpcs: { should_notify: { data: false, error: null } },
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ id: "re_1" }), { status: 200 })),
  });
  const req = makeRequest({
    headers: { "content-type": "application/json" },
    body: { templateName: "org-invitation", recipientEmail: "x@x.com", templateData: { inviteUrl: "https://x", orgName: "X" } },
  });
  const res = await handle(req, deps);
  const body = await res.json();
  assertEquals(body.reason === "pref_disabled", false);
});
```

> The second test renders the `org-invitation` template; if it needs specific `templateData` props, copy them from the template's TS definition so `renderAsync` doesn't throw. Adjust `templateData` to satisfy required props.

- [ ] **Step 4: Run the function's tests**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/send-transactional-email/`
Expected: PASS (new tests + existing).

- [ ] **Step 5: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send-transactional-email/index.ts supabase/functions/send-transactional-email/index.pref.test.ts
git commit -m "feat: per-category email preference gate"
```

---

## Task 7: export_my_data RPC

**Files:**
- Migration (apply via MCP): `export_my_data`
- Save: `supabase/migrations/<version>_export_my_data.sql`
- Test: `supabase/tests/rpc/export_my_data.sql` (CI-only)
- Regenerate: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Write the migration SQL**

```sql
-- The caller's full personal-data export (GDPR access + portability).
-- SECURITY DEFINER so it can read the caller's rows uniformly; scoped strictly to auth.uid().
create or replace function public.export_my_data()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'schema_version', 1,
    'exported_at', now(),
    'account', (select to_jsonb(p) from public.profiles p where p.user_id = v_uid),
    'memberships', coalesce((select jsonb_agg(to_jsonb(m)) from public.org_memberships m where m.user_id = v_uid), '[]'::jsonb),
    'artists', coalesce((select jsonb_agg(to_jsonb(a)) from public.artists a where a.user_id = v_uid), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b)) from public.bookings b
                          where b.artist_id in (select id from public.artists where user_id = v_uid)), '[]'::jsonb),
    'availability', coalesce((select jsonb_agg(to_jsonb(bd)) from public.blocked_dates bd
                          where bd.artist_id in (select id from public.artists where user_id = v_uid)), '[]'::jsonb),
    'chat_messages', coalesce((select jsonb_agg(to_jsonb(c)) from public.chat_messages c where c.user_id = v_uid), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n)) from public.notifications n where n.user_id = v_uid), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
```

- [ ] **Step 2: Apply + persist + regenerate types**

Apply via MCP `apply_migration` (name: `export_my_data`). Save SQL to `supabase/migrations/<version>_export_my_data.sql`. Regenerate `src/integrations/supabase/types.ts`.

- [ ] **Step 3: Write the pgTAP test (CI-only)**

Create `supabase/tests/rpc/export_my_data.sql`:

```sql
-- export_my_data: returns the caller's rows; arrays default to []; has schema_version.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000aa0','authenticated','authenticated','ex@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.profiles (user_id, display_name) VALUES ('00000000-0000-0000-0000-000000000aa0','Exie');
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000aa0","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is((public.export_my_data() -> 'account' ->> 'display_name'), 'Exie', 'account block present');
SELECT is((public.export_my_data() -> 'artists')::text, '[]', 'no artists -> empty array');
SELECT is((public.export_my_data() ->> 'schema_version'), '1', 'has schema_version');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ supabase/tests/rpc/export_my_data.sql src/integrations/supabase/types.ts
git commit -m "feat: export_my_data rpc"
```

---

## Task 8: account data-access (exportMyData + deleteMyAccount)

**Files:**
- Create: `src/data/account.ts`
- Test: `src/data/account.test.ts`

> `deleteMyAccount` is implemented here but its edge function arrives in Task 13; the data-access only needs the `functions.invoke` seam, which the fake provides now.

- [ ] **Step 1: Write the failing test**

Create `src/data/account.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { exportMyData, deleteMyAccount } from "./account";

describe("exportMyData", () => {
  it("calls export_my_data and returns the document", async () => {
    const doc = { schema_version: 1, account: { display_name: "Ada" } };
    const fake = createFakeSupabase({ "rpc:export_my_data": { data: doc, error: null } });
    expect(await exportMyData(fake as never)).toEqual(doc);
    expect(fake.calls).toContainEqual({ table: "rpc:export_my_data", method: "rpc", args: [undefined] });
  });
});

describe("deleteMyAccount", () => {
  it("invokes the delete-my-account function", async () => {
    const fake = createFakeSupabase({ "fn:delete-my-account": { data: { success: true }, error: null } });
    await deleteMyAccount(fake as never);
    expect(fake.calls).toContainEqual({ table: "fn:delete-my-account", method: "invoke", args: [{}] });
  });

  it("throws a friendly message on the last-admin block", async () => {
    const fake = createFakeSupabase({
      "fn:delete-my-account": { data: { error: "last_admin", org_name: "Acme" }, error: null },
    });
    await expect(deleteMyAccount(fake as never)).rejects.toThrow(/last admin of Acme/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/account.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/data/account.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** The current user's full personal-data export document (GDPR access/portability). */
export async function exportMyData(client: SupabaseClient<Database>): Promise<unknown> {
  const { data, error } = await client.rpc("export_my_data");
  if (error) throw error;
  return data;
}

/** Permanently delete the current user's account (anonymize-and-retain + auth delete). */
export async function deleteMyAccount(client: SupabaseClient<Database>): Promise<void> {
  const { data, error } = await client.functions.invoke("delete-my-account", { body: {} });
  if (error) throw error;
  const payload = data as { error?: string; org_name?: string } | null;
  if (payload?.error) {
    if (payload.error === "last_admin") {
      throw new Error(
        `You are the last admin of ${payload.org_name ?? "an organization"}. ` +
          `Appoint another admin or have the organization deleted first.`,
      );
    }
    throw new Error(payload.error);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/data/account.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/account.ts src/data/account.test.ts
git commit -m "feat: account export + delete data-access"
```

---

## Task 9: anonymize_user + sole_admin_orgs RPCs

**Files:**
- Migration (apply via MCP): `anonymize_user`
- Save: `supabase/migrations/<version>_anonymize_user.sql`
- Test: `supabase/tests/rpc/anonymize_user.sql` (CI-only)
- Regenerate: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Orgs where p_user is the ONLY admin (used to block account self-deletion that
-- would orphan an org). Mirrors the last-admin guard in set_org_member_role.
create or replace function public.sole_admin_orgs(p_user uuid)
returns table(org_id uuid, org_name text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name
  from public.organizations o
  where exists (
    select 1 from public.org_memberships m
    where m.org_id = o.id and m.user_id = p_user and m.role = 'admin'
  )
  and (
    select count(distinct m2.user_id) from public.org_memberships m2
    where m2.org_id = o.id and m2.role = 'admin' and m2.user_id <> p_user
  ) = 0;
$$;

revoke all on function public.sole_admin_orgs(uuid) from public, anon;
grant execute on function public.sole_admin_orgs(uuid) to authenticated;

-- Account-deletion's SQL half: anonymize shared/audit records, hard-delete
-- purely-personal rows. Idempotent. Does NOT touch auth.users (the edge fn does).
-- Guard reads auth.uid() -> callers MUST invoke with the caller's JWT client.
create or replace function public.anonymize_user(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (auth.uid() = p_user or public.is_super_admin(auth.uid())) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  -- Delete personal availability BEFORE unlinking artists (looked up via artist rows).
  delete from public.blocked_dates
    where artist_id in (select id from public.artists where user_id = p_user);

  -- Anonymize per-org talent records (keep rows for booking/audit integrity).
  update public.artists
    set name = 'Deleted artist', email = null, phone = null, bio = null, user_id = null
    where user_id = p_user;

  -- Detach authored chat messages (retain body as shared history).
  update public.chat_messages set user_id = null where user_id = p_user;

  -- De-identify the audit trail (never delete the rows).
  update public.booking_audit_log set performed_by = null where performed_by = p_user;

  -- Hard-delete purely-personal rows.
  delete from public.notifications where user_id = p_user;
  delete from public.notification_preferences where user_id = p_user;
  delete from public.org_memberships where user_id = p_user;
  delete from public.org_invitations
    where lower(email) = (select lower(email) from auth.users where id = p_user);
  delete from public.profiles where user_id = p_user;
end;
$$;

revoke all on function public.anonymize_user(uuid) from public, anon;
grant execute on function public.anonymize_user(uuid) to authenticated;
```

> Before applying, confirm column names with `types.ts`: `artists(name,email,phone,bio,user_id)`, `chat_messages(user_id)`, `booking_audit_log(performed_by)`, `blocked_dates(artist_id)`, `org_invitations(email)`. Adjust if any differ.

- [ ] **Step 2: Apply + persist + regenerate types**

Apply via MCP `apply_migration` (name: `anonymize_user`). Save SQL to `supabase/migrations/<version>_anonymize_user.sql`. Regenerate `src/integrations/supabase/types.ts`.

- [ ] **Step 3: Write the pgTAP test (CI-only)**

Create `supabase/tests/rpc/anonymize_user.sql`:

```sql
-- anonymize_user: artists anonymized, audit performed_by nulled, profile gone,
-- audit ROW retained, idempotent, and non-owner/non-super-admin rejected.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000bb0','authenticated','authenticated','self@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000bb1','authenticated','authenticated','other@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('00000000-0000-0000-0000-000000000bc0','AnonOrg','anon-org');
INSERT INTO public.profiles (user_id, display_name) VALUES ('00000000-0000-0000-0000-000000000bb0','Self');
INSERT INTO public.artists (id, org_id, name, email, user_id)
VALUES ('00000000-0000-0000-0000-000000000bd0','00000000-0000-0000-0000-000000000bc0','Self Talent','self@x.com','00000000-0000-0000-0000-000000000bb0');
INSERT INTO public.booking_audit_log (id, org_id, action, performed_by)
VALUES ('00000000-0000-0000-0000-000000000be0','00000000-0000-0000-0000-000000000bc0','status_change','00000000-0000-0000-0000-000000000bb0');
SET session_replication_role = DEFAULT;

-- a different, non-super-admin user cannot anonymize someone else
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000bb1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.anonymize_user('00000000-0000-0000-0000-000000000bb0') $$,
  '42501', NULL, 'non-owner cannot anonymize another user');
RESET ROLE;

-- the owner anonymizes themselves
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000bb0","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.anonymize_user('00000000-0000-0000-0000-000000000bb0') $$, 'owner can anonymize self');
RESET ROLE;

SELECT is((SELECT name FROM public.artists WHERE id='00000000-0000-0000-0000-000000000bd0'),
          'Deleted artist', 'artist name anonymized');
SELECT ok((SELECT user_id FROM public.artists WHERE id='00000000-0000-0000-0000-000000000bd0') IS NULL,
          'artist unlinked');
SELECT ok(EXISTS(SELECT 1 FROM public.booking_audit_log WHERE id='00000000-0000-0000-0000-000000000be0'
                 AND performed_by IS NULL),
          'audit row retained with performed_by nulled');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id='00000000-0000-0000-0000-000000000bb0'),
          'profile deleted');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ supabase/tests/rpc/anonymize_user.sql src/integrations/supabase/types.ts
git commit -m "feat: anonymize_user + sole_admin_orgs rpcs"
```

---

## Task 10: delete_org RPC

**Files:**
- Migration (apply via MCP): `delete_org`
- Save: `supabase/migrations/<version>_delete_org.sql`
- Test: `supabase/tests/rpc/delete_org.sql` (CI-only)
- Regenerate: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Discover the exact org-scoped tables**

Run this query (via MCP `execute_sql`) and record the result — it is the authoritative list of `org_id`-bearing tables to delete:

```sql
select table_name from information_schema.columns
where table_schema = 'public' and column_name = 'org_id'
order by table_name;
```

- [ ] **Step 2: Write the migration SQL**

Delete children before parents, ending with `organizations`. Start from this template and reconcile the table list with Step 1's output (add/remove `where org_id = p_org` deletes to match exactly; keep `booking_audit_log` first among the audit/booking group):

```sql
-- Hard tenant teardown (super-admin only). Removes ALL of an org's data,
-- including that org's booking_audit_log (the never-delete rule is per-org-lifetime).
-- Does NOT touch auth.users / profiles / notification_preferences (global/user-scoped):
-- members simply land on NoOrgScreen if this was their only org.
create or replace function public.delete_org(p_org uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden: super-admin only' using errcode = '42501';
  end if;

  delete from public.booking_audit_log where org_id = p_org;
  delete from public.bookings where org_id = p_org;
  delete from public.show_date_offer_tiers where org_id = p_org;
  delete from public.show_date_change_log where org_id = p_org;
  delete from public.show_date_cast_eligibility where org_id = p_org;
  delete from public.show_cast_eligibility where org_id = p_org;
  delete from public.show_assignments where org_id = p_org;
  delete from public.blocked_dates where org_id = p_org;
  delete from public.chat_messages where org_id = p_org;
  delete from public.chats where org_id = p_org;
  delete from public.show_dates where org_id = p_org;
  delete from public.shows where org_id = p_org;
  delete from public.artist_skills where org_id = p_org;
  delete from public.artists where org_id = p_org;
  delete from public.cast_city_priority where org_id = p_org;
  delete from public.cast_members where org_id = p_org;
  delete from public.casts where org_id = p_org;
  delete from public.cities where org_id = p_org;
  delete from public.custom_field_definitions where org_id = p_org;
  delete from public.notifications where org_id = p_org;
  delete from public.org_invitations where org_id = p_org;
  delete from public.app_settings where org_id = p_org;
  delete from public.airtable_sync_record_log where org_id = p_org;
  delete from public.airtable_sync_log where org_id = p_org;
  delete from public.org_memberships where org_id = p_org;
  delete from public.organizations where id = p_org;
end;
$$;

revoke all on function public.delete_org(uuid) from public, anon;
grant execute on function public.delete_org(uuid) to authenticated;
```

> Any table in Step 1's list not present above must be added (with the correct child-before-parent position); any table above not in Step 1's list either lacks `org_id` (delete its rows via its parent FK instead, or drop the line if a parent cascade covers it). The pgTAP test in Step 4 is the safety net — if the order or a name is wrong, it fails in CI.

- [ ] **Step 3: Apply + persist + regenerate types**

Apply via MCP `apply_migration` (name: `delete_org`). Save SQL to `supabase/migrations/<version>_delete_org.sql`. Regenerate `src/integrations/supabase/types.ts`.

- [ ] **Step 4: Write the pgTAP test (CI-only)**

Create `supabase/tests/rpc/delete_org.sql`:

```sql
-- delete_org: super-admin only; removes the org + its audit log; leaves other
-- orgs and members' global profiles intact.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000ca0','authenticated','authenticated','super@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000ca1','authenticated','authenticated','plain@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('00000000-0000-0000-0000-000000000ca0');
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-000000000cc0','Doomed','doomed-org'),
  ('00000000-0000-0000-0000-000000000cc1','Keeper','keeper-org');
INSERT INTO public.profiles (user_id, display_name) VALUES ('00000000-0000-0000-0000-000000000ca1','Plain');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000cc0','00000000-0000-0000-0000-000000000ca1','artist');
INSERT INTO public.booking_audit_log (id, org_id, action) VALUES
  ('00000000-0000-0000-0000-000000000ce0','00000000-0000-0000-0000-000000000cc0','status_change');
SET session_replication_role = DEFAULT;

-- non-super-admin rejected
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000ca1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.delete_org('00000000-0000-0000-0000-000000000cc0') $$,
  '42501', NULL, 'non-super-admin cannot delete an org');
RESET ROLE;

-- super-admin deletes the org
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000ca0","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.delete_org('00000000-0000-0000-0000-000000000cc0') $$, 'super-admin can delete an org');
RESET ROLE;

SELECT ok(NOT EXISTS(SELECT 1 FROM public.organizations WHERE id='00000000-0000-0000-0000-000000000cc0'), 'org row gone');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.booking_audit_log WHERE org_id='00000000-0000-0000-0000-000000000cc0'),
          'org audit log torn down');
SELECT ok(EXISTS(SELECT 1 FROM public.profiles WHERE user_id='00000000-0000-0000-0000-000000000ca1'),
          'member global profile retained');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ supabase/tests/rpc/delete_org.sql src/integrations/supabase/types.ts
git commit -m "feat: delete_org rpc (hard tenant teardown)"
```

---

## Task 11: Add fake auth.admin.deleteUser to the edge test harness

**Files:**
- Modify: `supabase/functions/_shared/testing.ts`
- Test: `supabase/functions/_shared/testing.deleteuser.test.ts`

- [ ] **Step 1: Extend FakeClientOptions and the fake auth.admin**

In `supabase/functions/_shared/testing.ts`, add to `FakeClientOptions` (after `generateLinkResult`):

```ts
  /** Seeded result for auth.admin.deleteUser (default: success). */
  deleteUserResult?: { data?: unknown; error?: unknown };
```

Then in `createFakeClient`, inside `auth.admin`, add a `deleteUser` method (after `generateLink`):

```ts
        deleteUser: (_id: string) =>
          Promise.resolve(opts.deleteUserResult ?? { data: { user: null }, error: null }),
```

- [ ] **Step 2: Write the test**

Create `supabase/functions/_shared/testing.deleteuser.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createFakeClient } from "./testing.ts";

Deno.test("fake auth.admin.deleteUser defaults to success", async () => {
  const { client } = createFakeClient();
  const res = await client.auth.admin.deleteUser("u1");
  assertEquals(res.error, null);
});

Deno.test("fake auth.admin.deleteUser honors a seeded error", async () => {
  const { client } = createFakeClient({ deleteUserResult: { data: null, error: { message: "boom" } } });
  const res = await client.auth.admin.deleteUser("u1");
  assertEquals((res.error as { message: string }).message, "boom");
});
```

- [ ] **Step 3: Run the tests**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/testing.ts supabase/functions/_shared/testing.deleteuser.test.ts
git commit -m "test: fake auth.admin.deleteUser in edge harness"
```

---

## Task 12: delete-my-account edge function

**Files:**
- Create: `supabase/functions/delete-my-account/index.ts`
- Create: `supabase/functions/delete-my-account/deno.json`
- Test: `supabase/functions/delete-my-account/index.test.ts`

- [ ] **Step 1: Write the deno.json**

Create `supabase/functions/delete-my-account/deno.json`:

```json
{}
```

- [ ] **Step 2: Write the failing test**

Create `supabase/functions/delete-my-account/index.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const AUTH = { Authorization: "Bearer user-jwt", "content-type": "application/json" };

Deno.test("blocks when the caller is the sole admin of an org", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    rpcs: { sole_admin_orgs: { data: [{ org_id: "o1", org_name: "Acme" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: {} }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.error, "last_admin");
  assertEquals(body.org_name, "Acme");
});

Deno.test("anonymizes then deletes the auth user on the happy path", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    rpcs: { sole_admin_orgs: { data: [], error: null }, anonymize_user: { data: null, error: null } },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: {} }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).success, true);
});

Deno.test("rejects an unauthenticated request", async () => {
  const { deps } = makeFakeDeps({ authUser: null });
  const res = await handle(makeRequest({ headers: { "content-type": "application/json" }, body: {} }), deps);
  assertEquals(res.status, 401);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/delete-my-account/`
Expected: FAIL (module not found).

- [ ] **Step 4: Write the implementation**

Create `supabase/functions/delete-my-account/index.ts`:

```ts
import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = deps.userClient(authHeader);
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  // Last-admin guard: block if the caller is the sole admin of any org.
  const { data: soleOrgs, error: guardErr } = await deps.admin.rpc("sole_admin_orgs", { p_user: user.id });
  if (guardErr) return json({ error: "verify_failed" }, 200);
  const orgs = (soleOrgs ?? []) as Array<{ org_id: string; org_name: string }>;
  if (orgs.length > 0) {
    return json({ error: "last_admin", org_name: orgs[0].org_name }, 200);
  }

  // Anonymize via the caller's JWT client so anonymize_user's auth.uid() = self.
  const { error: anonErr } = await userClient.rpc("anonymize_user", { p_user: user.id });
  if (anonErr) return json({ error: "anonymize_failed" }, 200);

  // Finally, delete the auth account (admin API).
  const { error: delErr } = await deps.admin.auth.admin.deleteUser(user.id);
  if (delErr) return json({ error: "delete_failed" }, 200);

  return json({ success: true }, 200);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 5: Run to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/delete-my-account/`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/delete-my-account/
git commit -m "feat: delete-my-account edge function"
```

---

## Task 13: export-org-data edge function

**Files:**
- Create: `supabase/functions/export-org-data/index.ts`
- Create: `supabase/functions/export-org-data/deno.json`
- Test: `supabase/functions/export-org-data/index.test.ts`

- [ ] **Step 1: Write the deno.json**

Create `supabase/functions/export-org-data/deno.json`:

```json
{}
```

- [ ] **Step 2: Write the failing test**

Create `supabase/functions/export-org-data/index.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const AUTH = { Authorization: "Bearer jwt", "content-type": "application/json" };

Deno.test("super-admin gets an org bundle", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: {
      platform_admins: { data: { user_id: "sa" }, error: null },
      organizations: { data: [{ id: "o1", name: "Acme" }], error: null },
      org_memberships: { data: [], error: null },
      artists: { data: [], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      bookings: { data: [], error: null },
      booking_audit_log: { data: [], error: null },
      chats: { data: [], error: null },
      chat_messages: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: { org_id: "o1" } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(body.bundle.schema_version, 1);
  assertEquals(body.bundle.organizations[0].name, "Acme");
});

Deno.test("non-super-admin is forbidden", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { platform_admins: { data: null, error: null } } });
  const res = await handle(makeRequest({ headers: AUTH, body: { org_id: "o1" } }), deps);
  assertEquals(res.status, 403);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/export-org-data/`
Expected: FAIL (module not found).

- [ ] **Step 4: Write the implementation**

Create `supabase/functions/export-org-data/index.ts`:

```ts
import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";

const ORG_TABLES = [
  "organizations", "org_memberships", "artists", "shows", "show_dates",
  "bookings", "booking_audit_log", "chats", "chat_messages",
];

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireSuperAdmin(deps, req);
  if (!auth.ok) return auth.response;

  let orgId: string | undefined;
  try {
    const body = await req.json();
    orgId = body.org_id ?? body.orgId;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!orgId) return json({ error: "org_id is required" }, 400);

  const admin = deps.admin;
  const bundle: Record<string, unknown> = {
    schema_version: 1,
    exported_at: deps.now().toISOString(),
    org_id: orgId,
  };
  for (const table of ORG_TABLES) {
    const col = table === "organizations" ? "id" : "org_id";
    const { data, error } = await admin.from(table).select("*").eq(col, orgId);
    if (error) return json({ error: `Failed to read ${table}` }, 500);
    bundle[table] = data ?? [];
  }
  return json({ success: true, bundle }, 200);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 5: Run to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/export-org-data/`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/export-org-data/
git commit -m "feat: export-org-data edge function"
```

---

## Task 14: platform data-access (exportOrgData + deleteOrg)

**Files:**
- Modify: `src/data/platform.ts`
- Test: `src/data/platform.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

Add to `src/data/platform.test.ts`:

```ts
import { exportOrgData, deleteOrg } from "./platform";

describe("exportOrgData", () => {
  it("invokes export-org-data and returns the bundle", async () => {
    const bundle = { schema_version: 1, organizations: [{ id: "o1" }] };
    const fake = createFakeSupabase({ "fn:export-org-data": { data: { success: true, bundle }, error: null } });
    expect(await exportOrgData(fake as never, "o1")).toEqual(bundle);
    expect(fake.calls).toContainEqual({ table: "fn:export-org-data", method: "invoke", args: [{ org_id: "o1" }] });
  });
});

describe("deleteOrg", () => {
  it("calls the delete_org rpc with the org id", async () => {
    const fake = createFakeSupabase({ "rpc:delete_org": { data: null, error: null } });
    await deleteOrg(fake as never, "o1");
    expect(fake.calls).toContainEqual({ table: "rpc:delete_org", method: "rpc", args: [{ p_org: "o1" }] });
  });
});
```

> If `src/data/platform.test.ts` doesn't already import `createFakeSupabase`, add `import { createFakeSupabase } from "@/test/supabaseFake";` at the top.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/platform.test.ts`
Expected: FAIL (exportOrgData/deleteOrg not exported).

- [ ] **Step 3: Write the implementation**

Append to `src/data/platform.ts`:

```ts
/** Export an org's full dataset as a JSON bundle (super-admin only). */
export async function exportOrgData(client: SupabaseClient<Database>, orgId: string): Promise<unknown> {
  const { data, error } = await client.functions.invoke("export-org-data", { body: { org_id: orgId } });
  if (error) throw error;
  const payload = data as { error?: string; bundle?: unknown } | null;
  if (payload?.error) throw new Error(payload.error);
  return payload?.bundle;
}

/** Permanently delete an org and all its data (super-admin only, hard teardown). */
export async function deleteOrg(client: SupabaseClient<Database>, orgId: string): Promise<void> {
  const { error } = await client.rpc("delete_org", { p_org: orgId });
  if (error) throw error;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/data/platform.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/platform.ts src/data/platform.test.ts
git commit -m "feat: exportOrgData + deleteOrg platform data-access"
```

---

## Task 15: ProfilePage — notification preferences card

**Files:**
- Modify: `src/pages/ProfilePage.tsx`
- Test: `src/pages/ProfilePage.notifications.test.tsx`

The card renders a grid: one row per `NOTIFICATION_CATEGORIES` entry, with an Email and an In-app `Switch`. A value is "on" unless `prefs[cat]?.[chan] === false`. Toggling writes the full merged map via the update mutation.

- [ ] **Step 1: Confirm the Switch primitive exists**

Run: `ls src/components/ui/switch.tsx`
Expected: the file exists (shadcn `Switch`). If not, generate it: it is a standard shadcn primitive — add `src/components/ui/switch.tsx` from shadcn's switch component before continuing.

- [ ] **Step 2: Write the failing test**

Create `src/pages/ProfilePage.notifications.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@x.com" } }) }));
vi.mock("@/hooks/useMyProfile", () => ({
  useMyProfile: () => ({ data: { display_name: "Ada", phone: "" }, isLoading: false }),
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));

const updateMutate = vi.fn();
vi.mock("@/hooks/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({ data: { booking_offers: { email: false } }, isLoading: false }),
  useUpdateNotificationPreferences: () => ({ mutate: updateMutate, isPending: false }),
}));
// ProfilePage uses useNavigate (added in Task 17) — mock it so this file passes in the full suite.
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

import ProfilePage from "./ProfilePage";

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

describe("ProfilePage notification preferences", () => {
  it("renders a switch per category and reflects a disabled value", async () => {
    render(wrap(<ProfilePage />));
    await waitFor(() => expect(screen.getByText("Notifications")).toBeInTheDocument());
    // booking_offers email is explicitly false -> that switch is off
    const offersEmail = screen.getByLabelText("Booking offers email");
    expect(offersEmail).not.toBeChecked();
  });

  it("writes the merged map when a switch is toggled", async () => {
    render(wrap(<ProfilePage />));
    await waitFor(() => expect(screen.getByText("Notifications")).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText("Booking offers email"));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ booking_offers: expect.objectContaining({ email: true }) }),
    );
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/pages/ProfilePage.notifications.test.tsx`
Expected: FAIL (no Notifications card).

- [ ] **Step 4: Add the card to ProfilePage**

In `src/pages/ProfilePage.tsx`, add imports near the top:

```tsx
import { Switch } from "@/components/ui/switch";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from "@/lib/notificationCategories";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useNotificationPreferences";
import type { NotificationPrefs } from "@/data/notificationPreferences";
```

Inside the `ProfilePage` component body, before the `return`, add:

```tsx
  const { data: notifPrefs } = useNotificationPreferences();
  const updateNotifPrefs = useUpdateNotificationPreferences();
  const prefs: NotificationPrefs = notifPrefs ?? {};
  const isOn = (cat: string, chan: NotificationChannel) =>
    (prefs as Record<string, Record<string, boolean>>)[cat]?.[chan] !== false;
  const toggle = (cat: string, chan: NotificationChannel, value: boolean) => {
    const next: NotificationPrefs = {
      ...prefs,
      [cat]: { ...(prefs as Record<string, Record<string, boolean>>)[cat], [chan]: value },
    };
    updateNotifPrefs.mutate(next, { onError: (e) => toast.error((e as Error).message) });
  };
```

Add this `Card` inside the returned JSX, after the "Change password" card (before the closing `</div>`):

```tsx
      <Card>
        <CardHeader><CardTitle className="font-display">Notifications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose how you hear about each kind of update. Critical account emails are always sent.
          </p>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-3 items-center">
            <div />
            <span className="text-xs uppercase text-muted-foreground text-center">Email</span>
            <span className="text-xs uppercase text-muted-foreground text-center">In-app</span>
            {NOTIFICATION_CATEGORIES.map((c) => (
              <Fragment key={c.key}>
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                </div>
                {NOTIFICATION_CHANNELS.map((chan) => (
                  <div key={chan} className="flex justify-center">
                    <Switch
                      aria-label={`${c.label} ${chan === "in_app" ? "in-app" : "email"}`}
                      checked={isOn(c.key, chan)}
                      onCheckedChange={(v) => toggle(c.key, chan, v)}
                    />
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </CardContent>
      </Card>
```

Add `Fragment` to the React import at the top of the file: change `import { useEffect } from "react";` to `import { useEffect, Fragment } from "react";`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/pages/ProfilePage.notifications.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProfilePage.tsx src/pages/ProfilePage.notifications.test.tsx src/components/ui/switch.tsx
git commit -m "feat: notification preferences card on ProfilePage"
```

---

## Task 16: ProfilePage — download my data card

**Files:**
- Modify: `src/pages/ProfilePage.tsx`
- Test: `src/pages/ProfilePage.export.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/pages/ProfilePage.export.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@x.com" } }) }));
vi.mock("@/hooks/useMyProfile", () => ({
  useMyProfile: () => ({ data: { display_name: "Ada", phone: "" }, isLoading: false }),
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({ data: {}, isLoading: false }),
  useUpdateNotificationPreferences: () => ({ mutate: vi.fn(), isPending: false }),
}));
const exportSpy = vi.fn().mockResolvedValue({ schema_version: 1 });
vi.mock("@/data/account", () => ({ exportMyData: () => exportSpy(), deleteMyAccount: vi.fn() }));
// ProfilePage uses useNavigate (added in Task 17) — mock it so this file passes in the full suite.
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

import ProfilePage from "./ProfilePage";

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

describe("ProfilePage data export", () => {
  beforeEach(() => {
    exportSpy.mockClear();
    // jsdom lacks these — stub so the download path doesn't throw
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it("calls exportMyData when the download button is clicked", async () => {
    render(wrap(<ProfilePage />));
    await waitFor(() => expect(screen.getByText("Your data")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /download my data/i }));
    await waitFor(() => expect(exportSpy).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pages/ProfilePage.export.test.tsx`
Expected: FAIL (no "Your data" card).

- [ ] **Step 3: Add the card**

In `src/pages/ProfilePage.tsx`, add the import:

```tsx
import { exportMyData } from "@/data/account";
```

Add a handler in the component body (before `return`):

```tsx
  const [exporting, setExporting] = useState(false);
  const downloadMyData = async () => {
    setExporting(true);
    try {
      const doc = await exportMyData(supabase);
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `showflow-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Your data has been downloaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };
```

Add `useState` to the React import: `import { useEffect, useState, Fragment } from "react";`.

Add the card after the Notifications card:

```tsx
      <Card>
        <CardHeader><CardTitle className="font-display">Your data</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download a copy of your personal data (profile, talent records, bookings, availability,
            messages, and notifications) as a JSON file.
          </p>
          <Button variant="outline" onClick={downloadMyData} disabled={exporting}>
            {exporting ? "Preparing…" : "Download my data"}
          </Button>
        </CardContent>
      </Card>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/pages/ProfilePage.export.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProfilePage.tsx src/pages/ProfilePage.export.test.tsx
git commit -m "feat: download-my-data card on ProfilePage"
```

---

## Task 17: ProfilePage — delete account card

**Files:**
- Modify: `src/pages/ProfilePage.tsx`
- Test: `src/pages/ProfilePage.delete.test.tsx`

A `destructive` card with an `AlertDialog`; the Delete button is disabled until the user types `DELETE`. On confirm: `deleteMyAccount(supabase)` → `supabase.auth.signOut()` → navigate to login.

- [ ] **Step 1: Confirm the AlertDialog primitive exists**

Run: `ls src/components/ui/alert-dialog.tsx`
Expected: exists. If not, add the shadcn `alert-dialog` primitive first.

- [ ] **Step 2: Write the failing test**

Create `src/pages/ProfilePage.delete.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@x.com" } }) }));
vi.mock("@/hooks/useMyProfile", () => ({
  useMyProfile: () => ({ data: { display_name: "Ada", phone: "" }, isLoading: false }),
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({ data: {}, isLoading: false }),
  useUpdateNotificationPreferences: () => ({ mutate: vi.fn(), isPending: false }),
}));
const deleteSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/data/account", () => ({ exportMyData: vi.fn(), deleteMyAccount: () => deleteSpy() }));
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

import ProfilePage from "./ProfilePage";

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

describe("ProfilePage delete account", () => {
  it("requires typing DELETE before confirming", async () => {
    render(wrap(<ProfilePage />));
    await waitFor(() => expect(screen.getByText("Delete account")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /delete account/i }));
    const confirm = await screen.findByRole("button", { name: /permanently delete/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("DELETE"), "DELETE");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(deleteSpy).toHaveBeenCalled());
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/pages/ProfilePage.delete.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Add the card**

In `src/pages/ProfilePage.tsx`, add imports:

```tsx
import { useNavigate } from "react-router-dom";
import { deleteMyAccount } from "@/data/account";
import { ROUTES } from "@/config/app.config";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
```

In the component body add:

```tsx
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteMyAccount(supabase);
      await supabase.auth.signOut();
      toast.success("Your account has been deleted");
      navigate(ROUTES.LOGIN);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };
```

> Confirm `ROUTES.LOGIN` exists in `src/config/app.config.ts`; if the login route constant has a different name, use that.

Add the card last in the returned JSX:

```tsx
      <Card className="border-destructive/40">
        <CardHeader><CardTitle className="font-display text-destructive">Delete account</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Permanently delete your account. Your personal details are removed; shared booking
            history is kept but de-identified. This cannot be undone.
          </p>
          <AlertDialog onOpenChange={(o) => { if (!o) setConfirmText(""); }}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete account</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes your account and personal data. Type <strong>DELETE</strong> to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input placeholder="DELETE" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={confirmText !== "DELETE" || deleting}
                  onClick={(e) => { e.preventDefault(); confirmDelete(); }}
                >
                  {deleting ? "Deleting…" : "Permanently delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/pages/ProfilePage.delete.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run all ProfilePage tests**

Run: `npx vitest run src/pages/ProfilePage`
Expected: PASS (notifications + export + delete + any existing).

- [ ] **Step 7: Commit**

```bash
git add src/pages/ProfilePage.tsx src/pages/ProfilePage.delete.test.tsx src/components/ui/alert-dialog.tsx
git commit -m "feat: delete-account card on ProfilePage"
```

---

## Task 18: EditOrgDialog — danger zone (export + delete)

**Files:**
- Modify: `src/components/platform/EditOrgDialog.tsx`
- Test: `src/components/platform/EditOrgDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/platform/EditOrgDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const exportSpy = vi.fn().mockResolvedValue({ schema_version: 1 });
const deleteSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/data/platform", () => ({
  updateOrg: vi.fn().mockResolvedValue(undefined),
  exportOrgData: () => exportSpy(),
  deleteOrg: () => deleteSpy(),
}));

import { EditOrgDialog } from "./EditOrgDialog";

const org = { org_id: "o1", name: "Acme", slug: "acme", status: "active" } as never;
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

describe("EditOrgDialog danger zone", () => {
  beforeEach(() => {
    exportSpy.mockClear(); deleteSpy.mockClear();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it("exports org data", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    await userEvent.click(screen.getByRole("button", { name: /export org data/i }));
    await waitFor(() => expect(exportSpy).toHaveBeenCalled());
  });

  it("requires the org name before deleting", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    await userEvent.click(screen.getByRole("button", { name: /delete organization/i }));
    const confirm = await screen.findByRole("button", { name: /permanently delete/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Acme"), "Acme");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(deleteSpy).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/platform/EditOrgDialog.test.tsx`
Expected: FAIL (no danger zone).

- [ ] **Step 3: Add the danger zone**

Rewrite `src/components/platform/EditOrgDialog.tsx` to add export + delete below the form. Add these imports:

```tsx
import { useState } from "react";
import { updateOrg, exportOrgData, deleteOrg, type OrgStat } from "@/data/platform";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
```

(Replace the existing `import { updateOrg, type OrgStat } from "@/data/platform";` line with the combined one above.)

Inside the component, add state + handlers before `return`:

```tsx
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const handleExport = async () => {
    setBusy(true);
    try {
      const bundle = await exportOrgData(supabase, org!.org_id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `org-${org!.slug}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Org data downloaded");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteOrg(supabase, org!.org_id);
      qc.invalidateQueries({ queryKey: ["platform"] });
      toast.success("Organization deleted");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
```

Add this block inside `<DialogContent>` after the `</form>`:

```tsx
        <div className="mt-6 border-t border-destructive/30 pt-4 space-y-3">
          <p className="text-sm font-medium text-destructive">Danger zone</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handleExport} disabled={busy}>Export org data</Button>
            <AlertDialog onOpenChange={(o) => { if (!o) setConfirmName(""); }}>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={busy}>Delete organization</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {org?.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the organization and all its data. Members keep their
                    accounts. Type the organization name to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input placeholder={org?.name ?? ""} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={confirmName !== org?.name || busy}
                    onClick={(e) => { e.preventDefault(); handleDelete(); }}
                  >
                    Permanently delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/platform/EditOrgDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/EditOrgDialog.tsx src/components/platform/EditOrgDialog.test.tsx
git commit -m "feat: org export + delete danger zone in EditOrgDialog"
```

---

## Task 19: Version bump + changelog

**Files:**
- Modify: `package.json`, `src/config/app.config.ts`, `public/changelog.md`
- Regenerate: `public/changelog.json`

- [ ] **Step 1: Bump the version in both places**

In `package.json`, change `"version": "1.4.0"` → `"version": "1.5.0"`.
In `src/config/app.config.ts`, change `VERSION: '1.4.0'` → `VERSION: '1.5.0'`.

- [ ] **Step 2: Add the changelog block**

At the top of `public/changelog.md` (newest-first), add:

```markdown
## 1.5.0 — Jun 22, 2026

*Your data, your choices*

### New
- **Notification preferences** — Choose exactly how you hear about offers, confirmations, schedule changes, and alerts, with separate email and in-app switches for each. Critical account emails are always delivered.
- **Download my data** — Export a complete copy of your personal data (profile, talent records, bookings, availability, messages, and notifications) as a JSON file from your profile.
- **Delete account** — Permanently delete your account from your profile. Your personal details are removed while shared booking history is kept but de-identified.

### Improved
- **Organization tools (admins)** — Platform admins can now export an organization's full dataset and permanently delete an organization from the console.
```

- [ ] **Step 3: Regenerate the JSON**

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
Expected: `public/changelog.json` rewritten with the 1.5.0 block.

- [ ] **Step 4: Commit**

```bash
git add package.json src/config/app.config.ts public/changelog.md public/changelog.json
git commit -m "chore: release 1.5.0 — data & compliance"
```

---

## Task 20: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the new surfaces**

Add to the "Edge functions" section's bullet list:

```markdown
  - **Account & data (GDPR):** `delete-my-account` (authenticated; last-admin-guarded; calls `anonymize_user` then `auth.admin.deleteUser`) and `export-org-data` (super-admin; full org JSON bundle). Per-user export is the `export_my_data` RPC; org deletion is the `delete_org` RPC; account anonymization is the `anonymize_user` RPC (callers MUST invoke it with the caller's JWT client so its `auth.uid()` guard holds).
```

Add a new decision bullet under "Key decisions":

```markdown
- **Deletion & erasure (GDPR).** Account self-deletion **anonymizes-and-retains**: personal/login rows are hard-deleted, while shared/audit rows are kept and de-identified (`artists` → tombstoned + unlinked, `chat_messages.user_id` → null, `booking_audit_log.performed_by` → null). Org deletion (`delete_org`, super-admin only) is a **hard tenant teardown** that removes ALL of that org's rows including its `booking_audit_log` — the "never delete from `booking_audit_log`" rule is **per-org-lifetime** (it bars deleting audit rows during normal operation, not tearing down an entire tenant). The last-admin guard blocks account self-deletion that would orphan an org.
- **Notification preferences.** Per-user, per-category × per-channel (email / in-app), opt-out default (missing = enabled), stored in `notification_preferences.prefs` (jsonb). The category model is `supabase/functions/_shared/notificationCategories.ts` (re-exported by `src/lib/notificationCategories.ts`). Email is gated in `send-transactional-email` (also covers digests); in-app is gated by the `gate_notification_pref` BEFORE INSERT trigger on `notifications` via `should_notify` + `category_of`. Critical templates (invites, password reset) and unmapped types are never gated.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document GDPR data & compliance surfaces in CLAUDE.md"
```

---

## Task 21: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the full vitest suite**

Run: `npx vitest run`
Expected: PASS (all unit/component/hook tests, including the new ones).

- [ ] **Step 2: Run the full Deno edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS (no regressions; new `delete-my-account`, `export-org-data`, email-gate, harness tests green).

- [ ] **Step 3: Sanity-check for stale references**

Run: `grep -rn "user_roles" supabase/functions src 2>/dev/null`
Expected: no NEW references introduced by this work (the dropped global table must not be reintroduced).

- [ ] **Step 4: Confirm the build types resolve locally where possible**

Run: `npx tsc --noEmit` (if available) — Expected: no type errors. If `tsc` isn't available locally, rely on CI's typecheck/build job.

- [ ] **Step 5: Push and open the PR**

This is handled by the `superpowers:finishing-a-development-branch` skill. Ensure CI (Deno, vitest, pgTAP, lint, typecheck, build, E2E) is green; fix any failures surfaced by the pgTAP `delete_org` order or the email-gate template props before merge.

---

## Self-Review notes (for the implementer)

- **Spec coverage:** export (per-user RPC Task 7/8/16 + super-admin edge Task 13/14/18); deletion (anonymize Task 9, account edge Task 12 + UI Task 17, org RPC Task 10 + UI Task 18); notification prefs (model Task 1, table+RPC Task 2, gate Task 3, data/hook Task 4/5, email gate Task 6, UI Task 15). All three pillars covered.
- **Type consistency:** data-access names used identically across tasks — `fetchMyNotificationPreferences`/`updateMyNotificationPreferences`, `exportMyData`/`deleteMyAccount`, `exportOrgData`/`deleteOrg`; RPC names `should_notify`/`category_of`/`export_my_data`/`anonymize_user`/`sole_admin_orgs`/`delete_org`; edge fns `delete-my-account`/`export-org-data`.
- **Verified present (no action needed):** `ROUTES.LOGIN` (`/login`), `src/components/ui/switch.tsx`, `src/components/ui/alert-dialog.tsx`, and `renderHookWithProviders` (used in Task 5) all exist in the repo today.
- **Watch items flagged inline:** the `delete_org` table list must be reconciled against the live `org_id` column inventory (Task 10 Step 1); the email-gate test's `org-invitation` `templateData` must satisfy the template's required props (Task 6); the three `ProfilePage.*.test.tsx` files all mock `react-router-dom` so they stay green once Task 17 introduces `useNavigate`.
