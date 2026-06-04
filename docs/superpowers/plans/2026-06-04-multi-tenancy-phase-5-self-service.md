# Multi-Tenancy Phase 5 — Self-Service Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship end-user self-service (profile edit, password reset + in-app change, member removal, org-admin resend-invite) and unify the two divergent org-invitation mechanisms so a net-new invitee always gets a working password path.

**Architecture:** Pooled multi-tenant Supabase app (one DB + RLS). Frontend = React 18 + Vite + React Query + react-hook-form/zod + shadcn. Backend = Deno edge functions (DI `handle(req, deps)`) + Postgres `SECURITY DEFINER` RPCs. New work follows the established data-access-extraction (frontend) and dependency-injection (edge) test patterns. The invite unification routes net-new users through a Supabase `generateLink('invite')` action link embedded in the existing branded `org-invitation` email, landing them on the new `/reset-password` set-password page which then chains to `/accept-invite`.

**Tech Stack:** TypeScript, React Query v5, react-hook-form + zod, shadcn/ui (incl. `AlertDialog`), Supabase JS v2 (`auth.admin.generateLink`), Deno test, pgTAP, Playwright.

**Design spec:** `docs/superpowers/specs/2026-06-04-multi-tenancy-phase-5-self-service-design.md`.

---

## Execution environment & verification (read first)

This repo has **no Node / Supabase CLI / Docker locally — only Deno** (see memory `env-no-node-supabase-cli`). Work is **CI-driven**, exactly like Phases 2–4:

- **Frontend unit tests (Vitest), eslint, `tsc`, Playwright e2e, pgTAP** run **in CI**. The oracle is `gh pr checks <PR#>` after pushing to a PR that targets `dev`. The `npx vitest run …` / `npx playwright test …` commands below are the canonical invocation; if you have no local Node, push and read CI instead of running locally.
- **Edge-function Deno tests** run locally: `deno test --allow-all <path>`.
- **Migrations** are applied through the **Supabase MCP** (`apply_migration`) against the PR's Supabase **preview branch**, never by hand-editing `supabase/migrations/`. After a migration lands on the preview branch, regenerate `src/integrations/supabase/types.ts` via the MCP `generate_typescript_types(<preview ref>)` and commit it (this is what makes new `.rpc()` calls typecheck — the CI Typecheck job will fail until you do).
- **Branch:** create `feature/multi-tenancy-phase-5` off `dev`; open the PR against `dev`; squash-merge `… (#NN)`.

**Per-task discipline:** each task is test-first where the layer supports it. Commit after every green task. Task **groups A, B, D, E, F are independent**; **group C depends on group B** (it reuses the `/reset-password` set page). Within C, do C1→C7 then C8.

**Repo testing conventions that override generic TDD here (per CLAUDE.md):**
- Test **data-access functions** with the `src/test/supabaseFake.ts` fake; **hooks are thin wrappers and are NOT unit-tested** (they only wrap a tested data fn in `useQuery`/`useMutation`). Don't hand-roll `vi.mock` of the client.
- Edge functions export `handle(req, deps)` and are tested with `makeFakeDeps`/`makeRequest`. New edge tests go in `index.di.test.ts`.
- Never re-implement production logic in a test; import the real module.

---

## File structure (what each new/changed file owns)

**Frontend — data access (tested):**
- `src/data/profiles.ts` *(new)* — `fetchMyProfile`, `updateMyProfile`, `updateMyPassword`, `requestPasswordReset`, `setNewPassword`.
- `src/data/members.ts` *(new)* — `fetchOrgMembers`, `removeOrgMember`.
- `src/data/invitations.ts` *(modify)* — add `resendInvitation` (moved from `platform.ts`); `createInvitation` gains `app_origin`.
- `src/data/platform.ts` *(modify)* — remove `resendInvitation` (re-export from invitations for back-compat is unnecessary; update the one importer).
- `src/features/auth/resetPassword.ts` *(new)* — pure helpers `parseRecoveryHash`, `safeRelativeRedirect`, `newPasswordSchema`.

**Frontend — hooks (thin, untested):**
- `src/hooks/useMyProfile.ts` *(new)* — `useMyProfile`, `useUpdateMyProfile`.
- `src/hooks/useOrgMembers.ts` *(new)* — `useOrgMembers`, `useRemoveOrgMember`.

**Frontend — pages/components (covered by e2e):**
- `src/pages/ProfilePage.tsx` *(new)* — identity card + change-password card.
- `src/pages/ResetPasswordPage.tsx` *(new)* — request + set modes (public route).
- `src/components/admin/MembersTab.tsx` *(new)* — org-admin member list + remove.
- `src/components/platform/OrgMembersPopover.tsx` *(new)* — platform per-org member removal.
- `src/components/admin/InvitesTab.tsx` *(modify)* — Resend button + email zod.
- `src/pages/AdminPage.tsx` *(modify)* — add "Members" tab.
- `src/pages/LoginPage.tsx` *(modify)* — "Forgot password?" link.
- `src/components/layout/AppLayout.tsx` *(modify)* — "Profile" link in the user cluster.
- `src/App.tsx` *(modify)* — register `/profile` (protected) + `/reset-password` (public).
- `src/components/platform/{PlatformAdminsTab,PlatformDefaultsTab,OrganizationsTab}.tsx` *(modify)* — folded nits.

**Frontend — test harness:**
- `src/test/supabaseFake.ts` *(modify)* — add an `auth` stub.

**Backend — edge:**
- `supabase/functions/_shared/invitations.ts` *(new)* — `userExistsByEmail`, `deliverOrgInvitation`.
- `supabase/functions/_shared/testing.ts` *(modify)* — add `generateLink` to the admin fake.
- `supabase/functions/_shared/transactional-email-templates/org-invitation.tsx` *(modify)* — optional `actionLink`.
- `supabase/functions/{create-invitation,provision-org,resend-invitation}/index.ts` *(modify)* — call `deliverOrgInvitation`; add `app_origin`; slug/email validation.

**Backend — DB:**
- `supabase/migrations/20260604160000_org_member_management.sql` *(new, via MCP)* — `list_org_members`, `remove_org_member`.
- `supabase/tests/db/org_member_management.sql` *(new)* — pgTAP.

**E2e:**
- `e2e/profile.spec.ts`, `e2e/reset-password.spec.ts`, `e2e/invite-unified.spec.ts`, `e2e/member-removal.spec.ts` *(new)*.

---

# Group A — Profile page + in-app change-password

### Task A1: Add an `auth` stub to the frontend Supabase fake

**Files:**
- Modify: `src/test/supabaseFake.ts`
- Test: `src/test/supabaseFake.auth.test.ts` *(new)*

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/supabaseFake.auth.test.ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";

describe("createFakeSupabase auth stub", () => {
  it("records signInWithPassword and returns the seeded result", async () => {
    const fake = createFakeSupabase({ "auth:signInWithPassword": { data: { user: { id: "u1" } }, error: null } });
    const res = await fake.auth.signInWithPassword({ email: "a@b.com", password: "x" });
    expect(res).toEqual({ data: { user: { id: "u1" } }, error: null });
    expect(fake.calls).toContainEqual({ table: "auth", method: "signInWithPassword", args: [{ email: "a@b.com", password: "x" }] });
  });

  it("records updateUser and resetPasswordForEmail with sensible defaults", async () => {
    const fake = createFakeSupabase();
    expect(await fake.auth.updateUser({ password: "new" })).toEqual({ data: { user: null }, error: null });
    expect(await fake.auth.resetPasswordForEmail("a@b.com", { redirectTo: "/r" })).toEqual({ data: {}, error: null });
    expect(fake.calls).toContainEqual({ table: "auth", method: "updateUser", args: [{ password: "new" }] });
    expect(fake.calls).toContainEqual({ table: "auth", method: "resetPasswordForEmail", args: ["a@b.com", { redirectTo: "/r" }] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/supabaseFake.auth.test.ts`
Expected: FAIL — `fake.auth` is undefined.

- [ ] **Step 3: Implement** — add an `auth` object to the returned client in `createFakeSupabase`. Insert it right after the `functions: { … }` block (before the closing `};` of the `return`):

```typescript
    auth: {
      signInWithPassword(creds: unknown) {
        calls.push({ table: "auth", method: "signInWithPassword", args: [creds] });
        return Promise.resolve(seed["auth:signInWithPassword"] ?? { data: { user: null, session: null }, error: null });
      },
      updateUser(attrs: unknown) {
        calls.push({ table: "auth", method: "updateUser", args: [attrs] });
        return Promise.resolve(seed["auth:updateUser"] ?? { data: { user: null }, error: null });
      },
      resetPasswordForEmail(email: unknown, opts?: unknown) {
        calls.push({ table: "auth", method: "resetPasswordForEmail", args: [email, opts] });
        return Promise.resolve(seed["auth:resetPasswordForEmail"] ?? { data: {}, error: null });
      },
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/supabaseFake.auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/test/supabaseFake.ts src/test/supabaseFake.auth.test.ts
git commit -m "test: add auth stub to frontend supabase fake"
```

### Task A2: `fetchMyProfile` / `updateMyProfile` data access

**Files:**
- Create: `src/data/profiles.ts`
- Test: `src/data/profiles.test.ts` *(new)*

- [ ] **Step 1: Write the failing test**

```typescript
// src/data/profiles.test.ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchMyProfile, updateMyProfile } from "./profiles";

const aProfile = { user_id: "u1", display_name: "Ada", phone: "123", email: "ada@x.com", avatar_url: null };

describe("fetchMyProfile", () => {
  it("selects the profile row by user_id and returns it", async () => {
    const fake = createFakeSupabase({ profiles: { data: aProfile, error: null } });
    const result = await fetchMyProfile(fake as never, "u1");
    expect(result).toEqual(aProfile);
    expect(fake.calls).toContainEqual({ table: "profiles", method: "eq", args: ["user_id", "u1"] });
    expect(fake.calls).toContainEqual({ table: "profiles", method: "maybeSingle", args: [] });
  });

  it("returns null when there is no row", async () => {
    const fake = createFakeSupabase({ profiles: { data: null, error: null } });
    expect(await fetchMyProfile(fake as never, "u1")).toBeNull();
  });
});

describe("updateMyProfile", () => {
  it("updates display_name + phone scoped to the user_id", async () => {
    const fake = createFakeSupabase({ profiles: { data: null, error: null } });
    await updateMyProfile(fake as never, "u1", { display_name: "Ada L.", phone: "999" });
    expect(fake.calls).toContainEqual({ table: "profiles", method: "update", args: [{ display_name: "Ada L.", phone: "999" }] });
    expect(fake.calls).toContainEqual({ table: "profiles", method: "eq", args: ["user_id", "u1"] });
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ profiles: { data: null, error: { message: "boom" } } });
    await expect(updateMyProfile(fake as never, "u1", { display_name: "x" })).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/profiles.test.ts`
Expected: FAIL — `./profiles` does not exist.

- [ ] **Step 3: Implement**

```typescript
// src/data/profiles.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface MyProfile {
  user_id: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
}

/** The signed-in user's global profile row (or null). */
export async function fetchMyProfile(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<MyProfile | null> {
  const { data, error } = await client
    .from("profiles")
    .select("user_id, display_name, phone, email, avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as MyProfile | null) ?? null;
}

/** Update the editable profile fields for the signed-in user. */
export async function updateMyProfile(
  client: SupabaseClient<Database>,
  userId: string,
  patch: { display_name?: string | null; phone?: string | null },
): Promise<void> {
  const { error } = await client.from("profiles").update(patch).eq("user_id", userId);
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/profiles.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/profiles.ts src/data/profiles.test.ts
git commit -m "feat: profiles data access (fetch/update)"
```

### Task A3: `updateMyPassword` (verify current password, then update)

**Files:**
- Modify: `src/data/profiles.ts`
- Modify: `src/data/profiles.test.ts`

- [ ] **Step 1: Write the failing test** (append to `profiles.test.ts`)

```typescript
import { updateMyPassword } from "./profiles";

describe("updateMyPassword", () => {
  it("verifies the current password then updates to the new one", async () => {
    const fake = createFakeSupabase({
      "auth:signInWithPassword": { data: { user: { id: "u1" } }, error: null },
      "auth:updateUser": { data: { user: { id: "u1" } }, error: null },
    });
    await updateMyPassword(fake as never, { email: "ada@x.com", currentPassword: "old", newPassword: "newpass12" });
    expect(fake.calls).toContainEqual({ table: "auth", method: "signInWithPassword", args: [{ email: "ada@x.com", password: "old" }] });
    expect(fake.calls).toContainEqual({ table: "auth", method: "updateUser", args: [{ password: "newpass12" }] });
  });

  it("rejects with a clear message when the current password is wrong (and never updates)", async () => {
    const fake = createFakeSupabase({
      "auth:signInWithPassword": { data: { user: null }, error: { message: "Invalid login credentials" } },
    });
    await expect(
      updateMyPassword(fake as never, { email: "ada@x.com", currentPassword: "bad", newPassword: "newpass12" }),
    ).rejects.toThrow(/current password is incorrect/i);
    expect(fake.calls.find((c) => c.method === "updateUser")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/profiles.test.ts`
Expected: FAIL — `updateMyPassword` not exported.

- [ ] **Step 3: Implement** (append to `src/data/profiles.ts`)

```typescript
/**
 * Change the signed-in user's password. Supabase's updateUser does NOT verify the
 * current password, so we re-authenticate with it first (a wrong password fails here,
 * before any change is made).
 */
export async function updateMyPassword(
  client: SupabaseClient<Database>,
  args: { email: string; currentPassword: string; newPassword: string },
): Promise<void> {
  const { error: verifyErr } = await client.auth.signInWithPassword({
    email: args.email,
    password: args.currentPassword,
  });
  if (verifyErr) throw new Error("Current password is incorrect");
  const { error } = await client.auth.updateUser({ password: args.newPassword });
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/profiles.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/profiles.ts src/data/profiles.test.ts
git commit -m "feat: in-app change-password (verify then update)"
```

### Task A4: `useMyProfile` / `useUpdateMyProfile` hooks (thin wrappers — no unit test)

**Files:**
- Create: `src/hooks/useMyProfile.ts`

> Per repo convention, hooks that only wrap a tested data fn in `useQuery`/`useMutation` are not unit-tested (testing them would mean mocking the singleton — the anti-pattern the harness avoids). They're covered by the data-fn tests above and the e2e below.

- [ ] **Step 1: Implement**

```typescript
// src/hooks/useMyProfile.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchMyProfile, updateMyProfile } from "@/data/profiles";

/** The signed-in user's profile row. */
export function useMyProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: () => fetchMyProfile(supabase, user!.id),
  });
}

/** Update display name / phone, then refresh the profile query. */
export function useUpdateMyProfile() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (patch: { display_name?: string | null; phone?: string | null }) => {
      if (!user?.id) throw new Error("Not signed in");
      return updateMyProfile(supabase, user.id, patch);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (or rely on CI Typecheck)
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMyProfile.ts
git commit -m "feat: useMyProfile / useUpdateMyProfile hooks"
```

### Task A5: ProfilePage + route + user-menu link

**Files:**
- Create: `src/pages/ProfilePage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// src/pages/ProfilePage.tsx
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyProfile, useUpdateMyProfile } from "@/hooks/useMyProfile";
import { updateMyPassword } from "@/data/profiles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const identitySchema = z.object({
  display_name: z.string().max(120, "Too long").optional().or(z.literal("")),
  phone: z.string().max(40, "Too long").optional().or(z.literal("")),
});
type IdentityValues = z.infer<typeof identitySchema>;

const passwordSchema = z
  .object({
    current: z.string().min(1, "Required"),
    next: z.string().min(8, "At least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "Passwords don't match", path: ["confirm"] });
type PasswordValues = z.infer<typeof passwordSchema>;

export default function ProfilePage() {
  const { user } = useAuth();
  const { data: profile, isLoading } = useMyProfile();
  const updateProfile = useUpdateMyProfile();

  const identity = useForm<IdentityValues>({ resolver: zodResolver(identitySchema), values: { display_name: profile?.display_name ?? "", phone: profile?.phone ?? "" } });

  const password = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { current: "", next: "", confirm: "" } });

  const changePassword = useMutation({
    mutationFn: (v: PasswordValues) => updateMyPassword(supabase, { email: user?.email ?? "", currentPassword: v.current, newPassword: v.next }),
    onSuccess: () => { toast.success("Password changed"); password.reset(); },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => { document.title = "Profile · Showflow Pro"; }, []);

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground mt-1">Your account details and password</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-display">Details</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <form
              onSubmit={identity.handleSubmit((v) =>
                updateProfile.mutate(
                  { display_name: v.display_name || null, phone: v.phone || null },
                  { onSuccess: () => toast.success("Profile saved"), onError: (e) => toast.error((e as Error).message) },
                ),
              )}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={profile?.email ?? user?.email ?? ""} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="display_name">Display name</Label>
                <Input id="display_name" {...identity.register("display_name")} />
                {identity.formState.errors.display_name && <p className="text-xs text-destructive">{identity.formState.errors.display_name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" {...identity.register("phone")} />
                {identity.formState.errors.phone && <p className="text-xs text-destructive">{identity.formState.errors.phone.message}</p>}
              </div>
              <Button type="submit" disabled={updateProfile.isPending}>{updateProfile.isPending ? "Saving…" : "Save"}</Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display">Change password</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={password.handleSubmit((v) => changePassword.mutate(v))} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current">Current password</Label>
              <Input id="current" type="password" {...password.register("current")} />
              {password.formState.errors.current && <p className="text-xs text-destructive">{password.formState.errors.current.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="next">New password</Label>
              <Input id="next" type="password" {...password.register("next")} />
              {password.formState.errors.next && <p className="text-xs text-destructive">{password.formState.errors.next.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input id="confirm" type="password" {...password.register("confirm")} />
              {password.formState.errors.confirm && <p className="text-xs text-destructive">{password.formState.errors.confirm.message}</p>}
            </div>
            <Button type="submit" disabled={changePassword.isPending}>{changePassword.isPending ? "Changing…" : "Change password"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Register the protected route in `src/App.tsx`**

Add the import near the other page imports:
```tsx
import ProfilePage from "./pages/ProfilePage";
```
Add this `<Route>` inside `<Routes>` (e.g. right after the `CHATS` route):
```tsx
            <Route path={ROUTES.PROFILE} element={<ProtectedRoute><AppLayout><ProfilePage /></AppLayout></ProtectedRoute>} />
```

- [ ] **Step 3: Add a "Profile" link to the user cluster in `src/components/layout/AppLayout.tsx`**

Add `User` to the lucide import:
```tsx
import { Settings, LogOut, Bell, ChevronLeft, ChevronRight, Menu, EyeOff, User } from 'lucide-react';
```
In the user section (the `div` with `border-t-[0.5px] … space-y-1`), add a Profile button immediately **above** the existing Sign Out `<Button>`:
```tsx
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2.5 text-sidebar-foreground/70 hover:bg-foreground/[0.04] hover:text-sidebar-foreground"
          onClick={() => navigate(ROUTES.PROFILE)}
        >
          <User className="h-[14px] w-[14px]" />
          {!collapsed && 'Profile'}
        </Button>
```
(`navigate` and `ROUTES` are already in scope.)

- [ ] **Step 4: Verify build/typecheck**

Run: `npx tsc --noEmit && npx vitest run` (or push and read `gh pr checks`)
Expected: PASS (no test regressions; types clean)

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProfilePage.tsx src/App.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: profile page (details + change password) + route + nav link"
```

### Task A6: e2e — profile edit + change password

**Files:**
- Create: `e2e/profile.spec.ts`

- [ ] **Step 1: Write the e2e spec**

```typescript
// e2e/profile.spec.ts
import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { ensureUserWithRole, deleteUserByEmail } from "./helpers/users";
import { loginAsAndAwaitDashboard, loginAs } from "./helpers/auth";

const EMAIL = tagEmail("phase5-profile", "fixed");
const PASSWORD = "E2eProfile!1";
const NEW_PASSWORD = "E2eProfile!2new";

test.describe.configure({ mode: "serial" });

test.describe("Profile self-service", () => {
  test.beforeAll(async () => { await ensureUserWithRole(EMAIL, PASSWORD, "producer"); });
  test.afterAll(async () => { await deleteUserByEmail(EMAIL); });

  test("edits display name (DB is the oracle)", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, EMAIL, PASSWORD);
    await page.goto("/profile");
    await page.getByLabel("Display name").fill("Phase Five Tester");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(async () => {
      const { data } = await adminClient().from("profiles").select("display_name").eq("email", EMAIL).single();
      expect(data?.display_name).toBe("Phase Five Tester");
    }).toPass({ timeout: 15_000 });
  });

  test("changes password and can sign in with the new one", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, EMAIL, PASSWORD);
    await page.goto("/profile");
    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByLabel("New password").fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /change password/i }).click();
    await expect(page.getByText(/password changed/i)).toBeVisible({ timeout: 15_000 });

    await page.context().clearCookies();
    await loginAs(page, EMAIL, NEW_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
```

- [ ] **Step 2: Run (CI)** — push; `gh pr checks <PR#>` → the e2e job runs `e2e/profile.spec.ts`. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/profile.spec.ts
git commit -m "test(e2e): profile edit + password change round-trip"
```

---

# Group B — `/reset-password` (request + set) + Forgot-password link

### Task B1: Pure reset helpers

**Files:**
- Create: `src/features/auth/resetPassword.ts`
- Test: `src/features/auth/resetPassword.test.ts` *(new)*

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/auth/resetPassword.test.ts
import { describe, it, expect } from "vitest";
import { parseRecoveryHash, safeRelativeRedirect, newPasswordSchema } from "./resetPassword";

describe("parseRecoveryHash", () => {
  it("reads the type param from a recovery hash", () => {
    expect(parseRecoveryHash("#access_token=abc&type=recovery&x=1").type).toBe("recovery");
  });
  it("reads invite type and handles missing/leading-hash", () => {
    expect(parseRecoveryHash("type=invite").type).toBe("invite");
    expect(parseRecoveryHash("").type).toBeNull();
  });
});

describe("safeRelativeRedirect", () => {
  it("accepts a relative path", () => {
    expect(safeRelativeRedirect("/accept-invite?token=t", "/login")).toBe("/accept-invite?token=t");
  });
  it("rejects protocol-relative and absolute URLs and null", () => {
    expect(safeRelativeRedirect("//evil.com", "/login")).toBe("/login");
    expect(safeRelativeRedirect("https://evil.com", "/login")).toBe("/login");
    expect(safeRelativeRedirect(null, "/login")).toBe("/login");
  });
});

describe("newPasswordSchema", () => {
  it("rejects short passwords and mismatches, accepts a good pair", () => {
    expect(newPasswordSchema.safeParse({ password: "short", confirm: "short" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "longenough", confirm: "different" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "longenough", confirm: "longenough" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/auth/resetPassword.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/features/auth/resetPassword.ts
import { z } from "zod";

/** Read the `type` param (recovery|invite|…) from a URL hash like `#access_token=…&type=recovery`. */
export function parseRecoveryHash(hash: string): { type: string | null } {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  return { type: new URLSearchParams(h).get("type") };
}

/** Return `redirect` only when it is a safe in-app relative path; otherwise `fallback`. */
export function safeRelativeRedirect(redirect: string | null, fallback: string): string {
  return redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : fallback;
}

export const newPasswordSchema = z
  .object({ password: z.string().min(8, "At least 8 characters"), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/auth/resetPassword.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/resetPassword.ts src/features/auth/resetPassword.test.ts
git commit -m "feat: pure reset-password helpers (hash/redirect/schema)"
```

### Task B2: `requestPasswordReset` / `setNewPassword` data access

**Files:**
- Modify: `src/data/profiles.ts`
- Modify: `src/data/profiles.test.ts`

- [ ] **Step 1: Write the failing test** (append to `profiles.test.ts`)

```typescript
import { requestPasswordReset, setNewPassword } from "./profiles";

describe("requestPasswordReset", () => {
  it("calls resetPasswordForEmail with the redirect", async () => {
    const fake = createFakeSupabase({ "auth:resetPasswordForEmail": { data: {}, error: null } });
    await requestPasswordReset(fake as never, "ada@x.com", "https://app/reset-password");
    expect(fake.calls).toContainEqual({ table: "auth", method: "resetPasswordForEmail", args: ["ada@x.com", { redirectTo: "https://app/reset-password" }] });
  });
});

describe("setNewPassword", () => {
  it("calls updateUser with the new password", async () => {
    const fake = createFakeSupabase({ "auth:updateUser": { data: { user: { id: "u1" } }, error: null } });
    await setNewPassword(fake as never, "brandnewpass");
    expect(fake.calls).toContainEqual({ table: "auth", method: "updateUser", args: [{ password: "brandnewpass" }] });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "auth:updateUser": { data: { user: null }, error: { message: "weak" } } });
    await expect(setNewPassword(fake as never, "x")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/profiles.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement** (append to `src/data/profiles.ts`)

```typescript
/** Send a password-recovery email (Supabase built-in), returning the user to `redirectTo`. */
export async function requestPasswordReset(
  client: SupabaseClient<Database>,
  email: string,
  redirectTo: string,
): Promise<void> {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

/** Set a new password for the user in the current (recovery/invite) session. */
export async function setNewPassword(client: SupabaseClient<Database>, newPassword: string): Promise<void> {
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/profiles.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/profiles.ts src/data/profiles.test.ts
git commit -m "feat: password reset request + set data access"
```

### Task B3: ResetPasswordPage + public route + Forgot-password link

**Files:**
- Create: `src/pages/ResetPasswordPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/LoginPage.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// src/pages/ResetPasswordPage.tsx
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requestPasswordReset, setNewPassword } from "@/data/profiles";
import { parseRecoveryHash, safeRelativeRedirect, newPasswordSchema } from "@/features/auth/resetPassword";
import { ROUTES, APP_META } from "@/config/app.config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StageMark } from "@/components/brand/StageMark";
import { z } from "zod";

type SetValues = z.infer<typeof newPasswordSchema>;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"request" | "set">(() => {
    const t = typeof window !== "undefined" ? parseRecoveryHash(window.location.hash).type : null;
    return t === "recovery" || t === "invite" ? "set" : "request";
  });
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  // A recovery/invite link may resolve the session slightly after mount; flip to set-mode then.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("set");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const form = useForm<SetValues>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: "", confirm: "" } });

  const onRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      await requestPasswordReset(supabase, email, `${window.location.origin}${ROUTES.RESET_PASSWORD}`);
      toast.success("If that email exists, a reset link is on its way");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onSet = form.handleSubmit(async (v) => {
    try {
      await setNewPassword(supabase, v.password);
      toast.success("Password updated");
      navigate(safeRelativeRedirect(searchParams.get("redirect"), ROUTES.DASHBOARD), { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto"><StageMark variant="tile" size={52} /></div>
          <CardTitle className="font-display text-2xl font-semibold tracking-tight">
            {mode === "set" ? "Set a new password" : "Reset your password"}
          </CardTitle>
          <CardDescription>
            {mode === "set" ? "Choose a new password for your account." : `Enter your email and we'll send a reset link for ${APP_META.NAME}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "set" ? (
            <form onSubmit={onSet} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input id="password" type="password" {...form.register("password")} />
                {form.formState.errors.password && <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input id="confirm" type="password" {...form.register("confirm")} />
                {form.formState.errors.confirm && <p className="text-xs text-destructive">{form.formState.errors.confirm.message}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>Set password</Button>
            </form>
          ) : (
            <form onSubmit={onRequest} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              <Button type="submit" className="w-full" disabled={sending || !email}>{sending ? "Sending…" : "Send reset link"}</Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => navigate(ROUTES.LOGIN)}>Back to sign in</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Register the PUBLIC route in `src/App.tsx`**

Import:
```tsx
import ResetPasswordPage from "./pages/ResetPasswordPage";
```
Add next to the other public routes (e.g. right after `ACCEPT_INVITE`):
```tsx
            <Route path={ROUTES.RESET_PASSWORD} element={<ResetPasswordPage />} />
```

- [ ] **Step 3: Add the "Forgot password?" link to `src/pages/LoginPage.tsx`**

Inside the `<form>`, immediately after the password field's `<div className="space-y-2">…</div>` (before the submit `<Button>`), add:
```tsx
              <div className="text-right -mt-1">
                <Link to={ROUTES.RESET_PASSWORD} className="text-xs text-muted-foreground underline hover:text-foreground">
                  Forgot password?
                </Link>
              </div>
```
(`Link` and `ROUTES` are already imported in LoginPage.)

- [ ] **Step 4: Verify build/typecheck**

Run: `npx tsc --noEmit && npx vitest run` (or CI)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/ResetPasswordPage.tsx src/App.tsx src/pages/LoginPage.tsx
git commit -m "feat: reset-password page (request + set) + forgot-password link"
```

### Task B4: e2e — password reset round-trip

**Files:**
- Create: `e2e/reset-password.spec.ts`

> The reset email can't be read in CI, so we mint the recovery action link with the **admin API** (`generateLink({ type: 'recovery', … })`) and drive the browser through it — the same DB/admin-oracle style as `platform-console.spec.ts`. The test project must allow the e2e base URL as an auth redirect (it already serves the e2e app).

- [ ] **Step 1: Write the e2e spec**

```typescript
// e2e/reset-password.spec.ts
import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { ensureUserWithRole, deleteUserByEmail } from "./helpers/users";
import { loginAs } from "./helpers/auth";

const EMAIL = tagEmail("phase5-reset", "fixed");
const OLD_PASSWORD = "E2eReset!1old";
const NEW_PASSWORD = "E2eReset!2new";

test.describe.configure({ mode: "serial" });

test.describe("Password reset", () => {
  test.beforeAll(async () => { await ensureUserWithRole(EMAIL, OLD_PASSWORD, "producer"); });
  test.afterAll(async () => { await deleteUserByEmail(EMAIL); });

  test("request mode renders and accepts an email", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible();
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByRole("button", { name: /send reset link/i }).click();
    await expect(page.getByText(/reset link is on its way/i)).toBeVisible({ timeout: 15_000 });
  });

  test("recovery link → set new password → sign in with it", async ({ page, baseURL }) => {
    const { data, error } = await adminClient().auth.admin.generateLink({
      type: "recovery",
      email: EMAIL,
      options: { redirectTo: `${baseURL}/reset-password` },
    });
    expect(error).toBeNull();
    const link = data!.properties!.action_link;

    await page.goto(link);
    await expect(page.getByRole("heading", { name: /set a new password/i })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("New password").fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /set password/i }).click();

    await page.context().clearCookies();
    await loginAs(page, EMAIL, NEW_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
```

- [ ] **Step 2: Run (CI)** — push; `gh pr checks <PR#>`. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/reset-password.spec.ts
git commit -m "test(e2e): password reset request + recovery-link set round-trip"
```

---

# Group C — Invite unification (depends on Group B)

### Task C1: Add `generateLink` to the edge admin fake

**Files:**
- Modify: `supabase/functions/_shared/testing.ts`

- [ ] **Step 1: Implement** — in `FakeClientOptions` add a field:
```typescript
  /** Seeded result for auth.admin.generateLink (default: an invite action link). */
  generateLinkResult?: { data?: unknown; error?: unknown };
```
In `createFakeClient`'s `auth.admin` object, add a `generateLink` method beside `inviteUserByEmail`:
```typescript
        generateLink: (_params: unknown) =>
          Promise.resolve(opts.generateLinkResult ?? { data: { properties: { action_link: "https://link.test/invite" } }, error: null }),
```

- [ ] **Step 2: Quick smoke test** — this is exercised by Task C3's tests. Run the existing edge suite to confirm nothing broke:

Run: `deno test --allow-all supabase/functions/`
Expected: PASS (no regressions).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/testing.ts
git commit -m "test: add generateLink to edge admin fake"
```

### Task C2: `org-invitation` template — optional `actionLink`

**Files:**
- Modify: `supabase/functions/_shared/transactional-email-templates/org-invitation.tsx`

- [ ] **Step 1: Implement** — add `actionLink` to `Props` and prefer it for the CTA + pasted link.

Change the `interface Props` to include:
```tsx
  actionLink?: string
```
Change the destructure and `acceptUrl`:
```tsx
const OrgInvitationEmail = ({ orgName, role, inviterEmail, token, actionLink, _intro, _cta_label, _footer }: Props) => {
  const org = orgName || 'an organization'
  const acceptUrl = actionLink || (token ? `${APP_URL}/accept-invite?token=${token}` : APP_URL)
```
(Leave everything else unchanged. `previewData` may optionally gain `actionLink`, but it is not required.)

- [ ] **Step 2: Verify the template still type-checks / renders** — covered by the existing preview/email tests if present; otherwise rely on C3 + CI:

Run: `deno test --allow-all supabase/functions/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/transactional-email-templates/org-invitation.tsx
git commit -m "feat: org-invitation email supports an explicit actionLink"
```

### Task C3: Shared `deliverOrgInvitation` helper

**Files:**
- Create: `supabase/functions/_shared/invitations.ts`
- Test: `supabase/functions/_shared/invitations.test.ts` *(new)*

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/invitations.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deliverOrgInvitation } from "./invitations.ts";
import { makeFakeDeps } from "./testing.ts";

const base = {
  orgName: "Acme",
  role: "artist",
  token: "tok-1",
  inviterEmail: "boss@acme.com",
  appOrigin: "https://app.test",
  idempotencyKey: "org-invitation-1",
  orgId: "org-1",
};

Deno.test("deliverOrgInvitation: net-new user → generateLink action link embedded in branded email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    usersById: {}, // no existing user with this email → net-new
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=%2Faccept-invite%3Ftoken%3Dtok-1" } }, error: null },
  });
  await deliverOrgInvitation(deps, { ...base, email: "new@acme.com" });
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const body = sent[0].body as { template_name: string; templateData: { actionLink?: string } };
  assertEquals(body.template_name, "org-invitation");
  assertEquals(body.templateData.actionLink, "https://app.test/reset-password?redirect=%2Faccept-invite%3Ftoken%3Dtok-1");
});

Deno.test("deliverOrgInvitation: existing user → branded email with NO actionLink", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    usersById: { u9: { email: "old@acme.com" } }, // existing
  });
  await deliverOrgInvitation(deps, { ...base, email: "old@acme.com" });
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const body = sent[0].body as { templateData: { actionLink?: string } };
  assertEquals(body.templateData.actionLink, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all supabase/functions/_shared/invitations.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// supabase/functions/_shared/invitations.ts
import type { Deps } from "./deps.ts";

export interface DeliverInviteArgs {
  email: string;
  orgName?: string;
  role?: string;
  token: string;
  inviterEmail?: string;
  appOrigin: string;
  idempotencyKey: string;
  orgId?: string;
}

/** True if an auth user already exists for `email` (paginated listUsers). */
export async function userExistsByEmail(deps: Deps, email: string): Promise<boolean> {
  const target = email.toLowerCase();
  for (let page = 1; ; page++) {
    const { data: list } = await deps.admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = (list?.users ?? []) as Array<{ email?: string }>;
    if (users.some((u) => u.email?.toLowerCase() === target)) return true;
    if (users.length < 200) return false;
  }
}

/**
 * Deliver ONE branded org-invitation email. For a net-new user we mint a Supabase
 * invite action link (this also creates the account; Supabase sends no email of its
 * own) that lands on /reset-password?redirect=/accept-invite?token=… so the user sets
 * a password and then accepts. Existing users get the plain accept link.
 */
export async function deliverOrgInvitation(deps: Deps, args: DeliverInviteArgs): Promise<void> {
  const acceptPath = `/accept-invite?token=${args.token}`;
  const exists = await userExistsByEmail(deps, args.email);

  let actionLink: string | undefined;
  if (!exists) {
    const redirectTo = `${args.appOrigin}/reset-password?redirect=${encodeURIComponent(acceptPath)}`;
    const { data, error } = await deps.admin.auth.admin.generateLink({
      type: "invite",
      email: args.email,
      options: { redirectTo },
    });
    if (error) throw error;
    actionLink = (data as { properties?: { action_link?: string } })?.properties?.action_link;
  }

  await deps.sendEmail({
    template_name: "org-invitation",
    recipient_email: args.email,
    org_id: args.orgId,
    templateData: {
      orgName: args.orgName,
      role: args.role,
      token: args.token,
      inviterEmail: args.inviterEmail,
      actionLink,
    },
    idempotency_key: args.idempotencyKey,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all supabase/functions/_shared/invitations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/invitations.ts supabase/functions/_shared/invitations.test.ts
git commit -m "feat: deliverOrgInvitation — unified branded invite + net-new account bootstrap"
```

### Task C4: Rewire `create-invitation` (use helper + app_origin + validation)

**Files:**
- Modify: `supabase/functions/create-invitation/index.ts`
- Modify: `supabase/functions/create-invitation/index.di.test.ts` *(create if absent)*

- [ ] **Step 1: Write/extend the failing test** (`create-invitation/index.di.test.ts`)

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const body = { org_id: "org-1", email: "new@acme.com", role: "artist", app_origin: "https://app.test" };

function depsFor(opts: Record<string, unknown> = {}) {
  return makeFakeDeps({
    authUser: { id: "admin-1" },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null }, // requireOrgRole passes
      org_invitations: { data: { id: "inv-1", org_id: "org-1", email: "new@acme.com", role: "artist", status: "pending", token: "tok-1", expires_at: "2026-07-01" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
    ...opts,
  });
}

Deno.test("create-invitation: net-new invitee → sends branded email WITH actionLink", async () => {
  const { deps, invokeCalls } = depsFor({
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  assertEquals((sent[0].body as { templateData: { actionLink?: string } }).templateData.actionLink, "https://app.test/reset-password?redirect=x");
});

Deno.test("create-invitation: rejects a malformed email with 400", async () => {
  const { deps } = depsFor();
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { ...body, email: "not-an-email" } }), deps);
  assertEquals(res.status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all supabase/functions/create-invitation/`
Expected: FAIL (no actionLink yet / email not validated).

- [ ] **Step 3: Implement** — replace `create-invitation/index.ts` with:

```typescript
import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { deliverOrgInvitation } from "../_shared/invitations.ts";

type Body = {
  org_id: string;
  email: string;
  role: 'admin' | 'producer' | 'artist';
  app_origin: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const email = body?.email?.trim().toLowerCase();
    const appOrigin = body?.app_origin?.replace(/\/$/, "");
    if (!body?.org_id || !email || !body?.role || !appOrigin) {
      return json({ error: 'Invalid payload' }, 400);
    }
    if (!EMAIL_RE.test(email)) return json({ error: 'Invalid email address' }, 400);
    if (!['admin', 'producer', 'artist'].includes(body.role)) {
      return json({ error: 'Invalid role' }, 400);
    }

    // Caller must be an admin of the target org.
    const auth = await requireOrgRole(deps, req, body.org_id, ["admin"]);
    if (!auth.ok) return auth.response;

    const admin = deps.admin;

    // Insert the invitation (token / status / expires_at use DB defaults) and read it back.
    const { data: invite, error: insErr } = await admin
      .from('org_invitations')
      .insert({ org_id: body.org_id, email, role: body.role, invited_by: auth.userId })
      .select('id, org_id, email, role, status, token, expires_at')
      .single();
    if (insErr || !invite) {
      return json({ error: insErr?.message ?? 'Could not create invitation' }, 500);
    }

    // Best-effort delivery. The invitation already exists, so a send failure does not
    // fail the request — the admin can copy the accept link instead.
    try {
      const { data: org } = await admin
        .from('organizations').select('name').eq('id', body.org_id).maybeSingle();
      const inviter = auth.userId ? await admin.auth.admin.getUserById(auth.userId) : null;
      await deliverOrgInvitation(deps, {
        email: invite.email,
        orgName: (org as { name?: string } | null)?.name ?? undefined,
        role: invite.role,
        token: invite.token,
        inviterEmail: inviter?.data?.user?.email ?? undefined,
        appOrigin,
        idempotencyKey: `org-invitation-${invite.id}`,
        orgId: body.org_id,
      });
    } catch (e) {
      console.error('create-invitation: delivery failed', (e as Error).message);
    }

    return json({ ok: true, invitation: invite });
  } catch (e) {
    console.error('create-invitation error', e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all supabase/functions/create-invitation/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/create-invitation/index.ts supabase/functions/create-invitation/index.di.test.ts
git commit -m "feat: create-invitation uses unified delivery + email validation + app_origin"
```

### Task C5: Rewire `provision-org` (drop `inviteUserByEmail`)

**Files:**
- Modify: `supabase/functions/provision-org/index.ts`
- Modify: `supabase/functions/provision-org/index.di.test.ts`

- [ ] **Step 1: Update the failing tests** — replace the two delivery tests in `index.di.test.ts` (net-new now emails):

```typescript
Deno.test("provision-org: net-new admin → RPC + branded email with actionLink, returns org_id", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: {}, // net-new
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).org_id, "org-9");
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  assertEquals((sent[0].body as { templateData: { actionLink?: string } }).templateData.actionLink, "https://app.test/reset-password?redirect=x");
});

Deno.test("provision-org: existing admin → branded email with NO actionLink", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: { user_id: "u1" }, error: null } },
    rpcs: { provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null } },
    usersById: { u2: { email: "a@acme.com" } }, // existing
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  assertEquals((sent[0].body as { templateData: { actionLink?: string } }).templateData.actionLink, undefined);
});
```
(Keep the existing "403 for non-super-admin" and "409 on duplicate slug" tests unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all supabase/functions/provision-org/`
Expected: FAIL (still 0 emails on net-new / uses inviteUserByEmail).

- [ ] **Step 3: Implement** — replace the delivery `try { … }` block (the one that branches on `exists` with `inviteUserByEmail` vs `sendEmail`) in `provision-org/index.ts` with:

```typescript
    // Bootstrap + branded invite via the unified helper (net-new gets an account + set-password link).
    try {
      const inviter = auth.userId ? await deps.admin.auth.admin.getUserById(auth.userId) : null;
      await deliverOrgInvitation(deps, {
        email,
        orgName: name,
        role,
        token,
        inviterEmail: inviter?.data?.user?.email ?? undefined,
        appOrigin,
        idempotencyKey: `org-invitation-${org_id}`,
        orgId: org_id,
      });
    } catch (e) {
      console.error("provision-org: invite delivery failed", (e as Error).message);
    }
```
Add the import at the top:
```typescript
import { deliverOrgInvitation } from "../_shared/invitations.ts";
```
Remove the now-unused `acceptUrl` line and the `listUsers`/`exists` loop (the helper owns existence-detection). `appOrigin` is already computed near the top of the handler.

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all supabase/functions/provision-org/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/provision-org/index.ts supabase/functions/provision-org/index.di.test.ts
git commit -m "refactor: provision-org uses unified invite delivery (drops inviteUserByEmail)"
```

### Task C6: Rewire `resend-invitation` (use helper + app_origin)

**Files:**
- Modify: `supabase/functions/resend-invitation/index.ts`
- Modify/Create: `supabase/functions/resend-invitation/index.di.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const body = { invitation_id: "inv-1", app_origin: "https://app.test" };

Deno.test("resend-invitation: net-new pending invite → branded email with actionLink", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "admin-1" },
    tables: {
      org_invitations: { data: { id: "inv-1", org_id: "org-1", email: "new@acme.com", role: "artist", token: "tok-1", status: "pending" }, error: null },
      org_memberships: { data: { role: "admin" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  assertEquals((sent[0].body as { templateData: { actionLink?: string } }).templateData.actionLink, "https://app.test/reset-password?redirect=x");
});

Deno.test("resend-invitation: 409 when not pending", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "admin-1" },
    tables: {
      org_invitations: { data: { id: "inv-1", org_id: "org-1", email: "x@acme.com", role: "artist", token: "t", status: "accepted" }, error: null },
      org_memberships: { data: { role: "admin" }, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all supabase/functions/resend-invitation/`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `resend-invitation/index.ts`: add `app_origin` to `Body`, import the helper, and replace the inline `sendEmail` block. Full file:

```typescript
import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { deliverOrgInvitation } from "../_shared/invitations.ts";

type Body = { invitation_id: string; app_origin: string };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const appOrigin = body?.app_origin?.replace(/\/$/, "");
    if (!body?.invitation_id || !appOrigin) return json({ error: "Invalid payload" }, 400);

    const { data: invite } = await deps.admin
      .from("org_invitations")
      .select("id, org_id, email, role, token, status")
      .eq("id", body.invitation_id)
      .maybeSingle();

    // Authorize BEFORE disclosing anything (same 403 whether missing or unauthorized).
    if (!invite) return json({ error: "Forbidden" }, 403);
    const auth = await requireOrgRole(deps, req, invite.org_id, ["admin"]);
    if (!auth.ok) return auth.response;

    if (invite.status !== "pending") return json({ error: "Invitation is not pending" }, 409);

    const { data: org } = await deps.admin
      .from("organizations").select("name").eq("id", invite.org_id).maybeSingle();
    await deliverOrgInvitation(deps, {
      email: invite.email,
      orgName: (org as { name?: string } | null)?.name ?? undefined,
      role: invite.role,
      token: invite.token,
      appOrigin,
      idempotencyKey: `org-invitation-resend-${invite.id}`,
      orgId: invite.org_id,
    });

    return json({ ok: true });
  } catch (e) {
    console.error("resend-invitation error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all supabase/functions/resend-invitation/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/resend-invitation/index.ts supabase/functions/resend-invitation/index.di.test.ts
git commit -m "feat: resend-invitation uses unified delivery + app_origin"
```

### Task C7: Frontend data layer — `app_origin` + move `resendInvitation`

**Files:**
- Modify: `src/data/invitations.ts`
- Modify: `src/data/platform.ts`
- Modify: `src/components/platform/OrgInvitePopover.tsx`
- Test: `src/data/invitations.test.ts` *(new)*

- [ ] **Step 1: Write the failing test**

```typescript
// src/data/invitations.test.ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { createInvitation, resendInvitation } from "./invitations";

describe("createInvitation", () => {
  it("invokes create-invitation with org_id, email, role and app_origin", async () => {
    const fake = createFakeSupabase({ "fn:create-invitation": { data: { invitation: { id: "inv-1" } }, error: null } });
    await createInvitation(fake as never, { orgId: "o1", email: "a@b.com", role: "artist" });
    expect(fake.calls).toContainEqual({
      table: "fn:create-invitation",
      method: "invoke",
      args: [{ org_id: "o1", email: "a@b.com", role: "artist", app_origin: window.location.origin }],
    });
  });
});

describe("resendInvitation", () => {
  it("invokes resend-invitation with invitation_id and app_origin", async () => {
    const fake = createFakeSupabase({ "fn:resend-invitation": { data: { ok: true }, error: null } });
    await resendInvitation(fake as never, "inv-9");
    expect(fake.calls).toContainEqual({
      table: "fn:resend-invitation",
      method: "invoke",
      args: [{ invitation_id: "inv-9", app_origin: window.location.origin }],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/invitations.test.ts`
Expected: FAIL (no app_origin; `resendInvitation` not exported from invitations).

- [ ] **Step 3: Implement**

In `src/data/invitations.ts`, change `createInvitation`'s invoke body to include `app_origin`:
```typescript
  const { data, error } = await client.functions.invoke("create-invitation", {
    body: { org_id: args.orgId, email: args.email, role: args.role, app_origin: window.location.origin },
  });
```
Append a `resendInvitation` (moved here from `platform.ts`):
```typescript
/** Re-send a pending org invitation (org admin or super-admin). */
export async function resendInvitation(
  client: SupabaseClient<Database>,
  invitationId: string,
): Promise<void> {
  const { error } = await client.functions.invoke("resend-invitation", {
    body: { invitation_id: invitationId, app_origin: window.location.origin },
  });
  if (error) throw error;
}
```
In `src/data/platform.ts`, **delete** the existing `resendInvitation` function.
In `src/components/platform/OrgInvitePopover.tsx`, change the import:
```typescript
import { fetchOrgInvitations, revokeInvitation, resendInvitation } from "@/data/invitations";
```
(remove `import { resendInvitation } from "@/data/platform";`).

- [ ] **Step 4: Run test to verify it passes + typecheck**

Run: `npx vitest run src/data/invitations.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/invitations.ts src/data/platform.ts src/components/platform/OrgInvitePopover.tsx src/data/invitations.test.ts
git commit -m "refactor: createInvitation/resendInvitation pass app_origin; consolidate resendInvitation"
```

### Task C8: e2e — net-new invite is no longer stranded

**Files:**
- Create: `e2e/invite-unified.spec.ts`

> Proves the fix: an org-admin invites a **brand-new** email; the invitee now has an auth account (previously they had none) and can authenticate + accept. We bootstrap a known password via the admin API (standing in for the user clicking the action link → set-password page, which the page-level logic + `reset-password.spec.ts` already cover).

- [ ] **Step 1: Write the e2e spec**

```typescript
// e2e/invite-unified.spec.ts
import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { ensureUserWithRole, deleteUserByEmail, findUserByEmail, BOOTSTRAP_ORG_ID } from "./helpers/users";
import { loginAsAndAwaitDashboard, loginAs } from "./helpers/auth";

const ADMIN_EMAIL = tagEmail("phase5-invadmin", "fixed");
const ADMIN_PASSWORD = "E2eInvAdmin!1";
const stamp = Date.now();
const NEW_INVITEE = tagEmail("phase5-newinvitee", stamp);
const INVITEE_PASSWORD = "E2eInvitee!1";

test.describe.configure({ mode: "serial" });

test.describe("Unified invite — net-new invitee", () => {
  test.beforeAll(async () => {
    await ensureUserWithRole(ADMIN_EMAIL, ADMIN_PASSWORD, "admin");
    await deleteUserByEmail(NEW_INVITEE); // ensure truly net-new
  });
  test.afterAll(async () => {
    const admin = adminClient();
    await admin.from("org_invitations").delete().eq("email", NEW_INVITEE);
    await deleteUserByEmail(NEW_INVITEE);
    await deleteUserByEmail(ADMIN_EMAIL);
  });

  test("org admin invites a net-new email → account is bootstrapped → invitee accepts", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin?tab=invites");
    await page.getByPlaceholder("invitee@email.com").fill(NEW_INVITEE);
    await page.getByRole("button", { name: /^invite$/i }).click();
    await expect(page.getByText(/invitation sent/i)).toBeVisible({ timeout: 15_000 });

    // The unified flow created an auth account for the net-new invitee (the Phase-5 fix).
    await expect(async () => {
      const u = await findUserByEmail(NEW_INVITEE);
      expect(u).not.toBeNull();
    }).toPass({ timeout: 15_000 });

    // Read the pending token; set a known password (stands in for the action-link set-password step).
    const admin = adminClient();
    const { data: invite } = await admin
      .from("org_invitations").select("token").eq("email", NEW_INVITEE).eq("status", "pending").single();
    expect(invite?.token).toBeTruthy();
    const u = await findUserByEmail(NEW_INVITEE);
    await admin.auth.admin.updateUserById(u!.id, { password: INVITEE_PASSWORD });

    // Invitee authenticates and accepts.
    await page.context().clearCookies();
    await loginAs(page, NEW_INVITEE, INVITEE_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await page.goto(`/accept-invite?token=${invite!.token}`);

    await expect(async () => {
      const { count } = await admin
        .from("org_memberships")
        .select("*", { count: "exact", head: true })
        .eq("org_id", BOOTSTRAP_ORG_ID)
        .eq("user_id", u!.id);
      expect(count ?? 0).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });
  });
});
```

- [ ] **Step 2: Run (CI)** — push; `gh pr checks <PR#>`. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/invite-unified.spec.ts
git commit -m "test(e2e): net-new org invite bootstraps account + accepts"
```

---

# Group D — Member removal

### Task D1: Migration — `list_org_members` + `remove_org_member` RPCs

**Files:**
- Create (via Supabase MCP `apply_migration`): `supabase/migrations/20260604160000_org_member_management.sql`
- Modify (regen): `src/integrations/supabase/types.ts`

- [ ] **Step 1: Apply the migration via the Supabase MCP**

Use MCP `apply_migration` with name `org_member_management` and this SQL:

```sql
-- Phase 5: org member management. list_org_members (admin-guarded, aggregates roles)
-- and remove_org_member (admin-guarded, last-admin + self-removal guards).

create or replace function public.list_org_members(p_org uuid)
returns table (user_id uuid, email text, display_name text, roles app_role[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  return query
    select m.user_id,
           u.email::text,
           p.display_name,
           array_agg(m.role order by m.role) as roles
    from public.org_memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.org_id = p_org
    group by m.user_id, u.email, p.display_name
    order by u.email;
end;
$$;
revoke all on function public.list_org_members(uuid) from public, anon;
grant execute on function public.list_org_members(uuid) to authenticated;

create or replace function public.remove_org_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.has_org_role(v_caller, p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if p_user = v_caller then
    raise exception 'You cannot remove your own membership' using errcode = '42501';
  end if;
  lock table public.org_memberships in share row exclusive mode;
  -- If the target is an admin, block removal that would leave the org with no admins.
  if exists (
        select 1 from public.org_memberships
        where org_id = p_org and user_id = p_user and role = 'admin'
     )
     and (
        select count(distinct user_id) from public.org_memberships
        where org_id = p_org and role = 'admin' and user_id <> p_user
     ) < 1 then
    raise exception 'Cannot remove the last admin of the organization' using errcode = '42501';
  end if;
  delete from public.org_memberships where org_id = p_org and user_id = p_user;
end;
$$;
revoke all on function public.remove_org_member(uuid, uuid) from public, anon;
grant execute on function public.remove_org_member(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Regenerate types** — once the migration is on the PR's Supabase preview branch, run MCP `generate_typescript_types(<preview ref>)` and write the result to `src/integrations/supabase/types.ts`. Confirm `list_org_members` / `remove_org_member` now appear under `Database['public']['Functions']`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260604160000_org_member_management.sql src/integrations/supabase/types.ts
git commit -m "feat(db): list_org_members + remove_org_member RPCs"
```

### Task D2: pgTAP for the member-management RPCs

**Files:**
- Create: `supabase/tests/db/org_member_management.sql`

- [ ] **Step 1: Write the test** (runs in CI via `supabase test db`; mirrors `platform_console.sql`)

```sql
-- Phase 5: org member management RPC guards.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

-- Seed two orgs + users: org A has admin aA1 + producer aP1 + admin aA2; org B unrelated.
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('bbbbbbbb-0000-4000-a000-0000000000a1','authenticated','authenticated','a1@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('bbbbbbbb-0000-4000-a000-0000000000a2','authenticated','authenticated','a2@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('bbbbbbbb-0000-4000-a000-0000000000p1','authenticated','authenticated','p1@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug)
VALUES ('bbbbbbbb-0000-4000-0000-00000000a000','Org A','org-a-phase5');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000a1','admin'),
  ('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000a2','admin'),
  ('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000p1','producer');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- list_org_members: an admin sees all 3 members.
SELECT pg_temp.act_as('bbbbbbbb-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.list_org_members('bbbbbbbb-0000-4000-0000-00000000a000')),3,'admin lists 3 members');
RESET ROLE;

-- list_org_members: a non-admin (producer) is forbidden.
SELECT pg_temp.act_as('bbbbbbbb-0000-4000-a000-0000000000p1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.list_org_members('bbbbbbbb-0000-4000-0000-00000000a000')$$,'42501',NULL,'non-admin cannot list members');
RESET ROLE;

-- remove_org_member: admin removes the producer.
SELECT pg_temp.act_as('bbbbbbbb-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.remove_org_member('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000p1'::uuid)$$,'admin removes a producer');
SELECT is((SELECT count(*)::int FROM public.org_memberships WHERE org_id='bbbbbbbb-0000-4000-0000-00000000a000' AND user_id='bbbbbbbb-0000-4000-a000-0000000000p1'),0,'producer membership deleted');

-- remove_org_member: self-removal blocked.
SELECT throws_ok($$SELECT public.remove_org_member('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000a1'::uuid)$$,'42501',NULL,'cannot remove own membership');

-- remove_org_member: removing one admin is fine while another remains…
SELECT lives_ok($$SELECT public.remove_org_member('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000a2'::uuid)$$,'can remove a co-admin when another remains');
RESET ROLE;

-- …but a non-admin still cannot call remove at all.
SELECT pg_temp.act_as('bbbbbbbb-0000-4000-a000-0000000000p1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.remove_org_member('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000a1'::uuid)$$,'42501',NULL,'non-admin cannot remove members');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run (CI)** — push; the pgTAP job runs `supabase/tests/db/org_member_management.sql`. Expected: 8 passing assertions.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/db/org_member_management.sql
git commit -m "test(db): pgTAP for list_org_members + remove_org_member guards"
```

### Task D3: `members.ts` data access

**Files:**
- Create: `src/data/members.ts`
- Test: `src/data/members.test.ts` *(new)*

- [ ] **Step 1: Write the failing test**

```typescript
// src/data/members.test.ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchOrgMembers, removeOrgMember } from "./members";

describe("fetchOrgMembers", () => {
  it("calls list_org_members and returns the rows", async () => {
    const rows = [{ user_id: "u1", email: "a@x.com", display_name: "Ada", roles: ["admin"] }];
    const fake = createFakeSupabase({ "rpc:list_org_members": { data: rows, error: null } });
    const result = await fetchOrgMembers(fake as never, "org-1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "rpc:list_org_members", method: "rpc", args: [{ p_org: "org-1" }] });
  });
});

describe("removeOrgMember", () => {
  it("calls remove_org_member with org + user", async () => {
    const fake = createFakeSupabase({ "rpc:remove_org_member": { data: null, error: null } });
    await removeOrgMember(fake as never, "org-1", "u1");
    expect(fake.calls).toContainEqual({ table: "rpc:remove_org_member", method: "rpc", args: [{ p_org: "org-1", p_user: "u1" }] });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:remove_org_member": { data: null, error: { message: "last admin" } } });
    await expect(removeOrgMember(fake as never, "org-1", "u1")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/members.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/data/members.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "@/config/app.config";

export interface OrgMember {
  user_id: string;
  email: string | null;
  display_name: string | null;
  roles: AppRole[];
}

/** Members of an org (admin-only RPC; aggregates a user's roles). */
export async function fetchOrgMembers(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<OrgMember[]> {
  const { data, error } = await client.rpc("list_org_members", { p_org: orgId });
  if (error) throw error;
  return (data ?? []) as unknown as OrgMember[];
}

/** Remove a member from an org (admin-only RPC; guards last-admin + self). */
export async function removeOrgMember(
  client: SupabaseClient<Database>,
  orgId: string,
  userId: string,
): Promise<void> {
  const { error } = await client.rpc("remove_org_member", { p_org: orgId, p_user: userId });
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/members.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/members.ts src/data/members.test.ts
git commit -m "feat: org members data access (list/remove)"
```

### Task D4: `useOrgMembers` / `useRemoveOrgMember` hooks (thin — no unit test)

**Files:**
- Create: `src/hooks/useOrgMembers.ts`

- [ ] **Step 1: Implement**

```typescript
// src/hooks/useOrgMembers.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchOrgMembers, removeOrgMember } from "@/data/members";

/** Members of an org (admin surface). */
export function useOrgMembers(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["members", orgId],
    enabled: !!orgId,
    queryFn: () => fetchOrgMembers(supabase, orgId!),
  });
}

/** Remove a member, then refresh that org's member list. */
export function useRemoveOrgMember(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeOrgMember(supabase, orgId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", orgId] }),
  });
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` (or CI). Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useOrgMembers.ts
git commit -m "feat: useOrgMembers / useRemoveOrgMember hooks"
```

### Task D5: Org-admin Members tab

**Files:**
- Create: `src/components/admin/MembersTab.tsx`
- Modify: `src/pages/AdminPage.tsx`

- [ ] **Step 1: Implement the Members tab**

```tsx
// src/components/admin/MembersTab.tsx
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrgMembers, useRemoveOrgMember } from "@/hooks/useOrgMembers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Org-admin member management: list members and remove them (guarded by remove_org_member). */
export function MembersTab() {
  const { currentOrg, user } = useAuth();
  const { data: members, isLoading, isError, error } = useOrgMembers(currentOrg?.id);
  const remove = useRemoveOrgMember(currentOrg?.id ?? "");
  const [target, setTarget] = useState<{ user_id: string; email: string | null } | null>(null);

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Members</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-10 w-full" />}
        {isError && <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>}
        {(members ?? []).map((m) => (
          <div key={m.user_id} className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border">
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">{m.display_name || m.email}</p>
              <p className="text-xs text-muted-foreground truncate">{m.email}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {m.roles.map((r) => <Badge key={r} variant="secondary" className="text-xs capitalize">{r}</Badge>)}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={m.user_id === user?.id}
                onClick={() => setTarget({ user_id: m.user_id, email: m.email })}
              >
                {m.user_id === user?.id ? "You" : "Remove"}
              </Button>
            </div>
          </div>
        ))}
        {members?.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No members yet.</p>}
      </CardContent>

      <AlertDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {target?.email} will lose access to this organization. Their bookings and artist profile are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!target) return;
                remove.mutate(target.user_id, {
                  onSuccess: () => toast.success("Member removed"),
                  onError: (e) => toast.error((e as Error).message),
                });
                setTarget(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
```

- [ ] **Step 2: Add the "Members" tab to `src/pages/AdminPage.tsx`**

Import:
```tsx
import { MembersTab } from '@/components/admin/MembersTab';
```
Add a trigger in `<TabsList>` (after the Invites trigger):
```tsx
          <TabsTrigger value="members">Members</TabsTrigger>
```
Add the content (after the `invites` `<TabsContent>`):
```tsx
        <TabsContent value="members" className="mt-4">
          <MembersTab />
        </TabsContent>
```

- [ ] **Step 3: Verify build/typecheck**

Run: `npx tsc --noEmit && npx vitest run` (or CI)
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/MembersTab.tsx src/pages/AdminPage.tsx
git commit -m "feat: org-admin Members tab with guarded remove"
```

### Task D6: Platform-console member removal (`OrgMembersPopover`)

**Files:**
- Create: `src/components/platform/OrgMembersPopover.tsx`
- Modify: `src/components/platform/OrganizationsTab.tsx`

- [ ] **Step 1: Implement the popover**

```tsx
// src/components/platform/OrgMembersPopover.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchOrgMembers, removeOrgMember } from "@/data/members";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

/** Super-admin per-org member removal (reuses the org member data layer; RPC guards apply). */
export function OrgMembersPopover({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data: members } = useQuery({
    queryKey: ["members", orgId],
    queryFn: () => fetchOrgMembers(supabase, orgId),
    enabled: open,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeOrgMember(supabase, orgId, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["members", orgId] }); qc.invalidateQueries({ queryKey: ["platform"] }); toast.success("Member removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label="Members"><Users className="h-3.5 w-3.5" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 space-y-2">
        {(members ?? []).length === 0 && <p className="text-sm text-muted-foreground px-1 py-2">No members</p>}
        {(members ?? []).map((m) => (
          <div key={m.user_id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{m.display_name || m.email}</span>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => remove.mutate(m.user_id)}>Remove</Button>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Mount it in `src/components/platform/OrganizationsTab.tsx`**

Import:
```tsx
import { OrgMembersPopover } from "./OrgMembersPopover";
```
In the actions cell, add it next to `<OrgInvitePopover orgId={o.org_id} />`:
```tsx
                  <OrgMembersPopover orgId={o.org_id} />
```

- [ ] **Step 3: Verify build/typecheck**

Run: `npx tsc --noEmit` (or CI)
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/platform/OrgMembersPopover.tsx src/components/platform/OrganizationsTab.tsx
git commit -m "feat: platform-console per-org member removal"
```

### Task D7: e2e — admin removes a member → access lost

**Files:**
- Create: `e2e/member-removal.spec.ts`

- [ ] **Step 1: Write the e2e spec**

```typescript
// e2e/member-removal.spec.ts
import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { ensureUserWithRole, deleteUserByEmail, findUserByEmail, BOOTSTRAP_ORG_ID } from "./helpers/users";
import { loginAsAndAwaitDashboard } from "./helpers/auth";

const ADMIN_EMAIL = tagEmail("phase5-rmadmin", "fixed");
const ADMIN_PASSWORD = "E2eRmAdmin!1";
const MEMBER_EMAIL = tagEmail("phase5-rmmember", "fixed");
const MEMBER_PASSWORD = "E2eRmMember!1";

test.describe.configure({ mode: "serial" });

test.describe("Member removal", () => {
  test.beforeAll(async () => {
    await ensureUserWithRole(ADMIN_EMAIL, ADMIN_PASSWORD, "admin");
    await ensureUserWithRole(MEMBER_EMAIL, MEMBER_PASSWORD, "producer");
  });
  test.afterAll(async () => {
    await deleteUserByEmail(ADMIN_EMAIL);
    await deleteUserByEmail(MEMBER_EMAIL);
  });

  test("admin removes a member via the Members tab (DB is the oracle)", async ({ page }) => {
    const member = await findUserByEmail(MEMBER_EMAIL);
    await loginAsAndAwaitDashboard(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin?tab=members");

    await expect(page.getByText(MEMBER_EMAIL)).toBeVisible({ timeout: 15_000 });
    // MembersTab renders rows as <div>s (not a <table>). The admin's own row shows a
    // disabled "You" button, so the only enabled "Remove" is the member's.
    await page.getByRole("button", { name: /^remove$/i }).first().click();
    await page.getByRole("button", { name: /^remove$/i }).last().click(); // AlertDialog confirm

    await expect(async () => {
      const { count } = await adminClient()
        .from("org_memberships")
        .select("*", { count: "exact", head: true })
        .eq("org_id", BOOTSTRAP_ORG_ID)
        .eq("user_id", member!.id);
      expect(count ?? 0).toBe(0);
    }).toPass({ timeout: 15_000 });
  });
});
```

- [ ] **Step 2: Run (CI)** — push; `gh pr checks <PR#>`. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/member-removal.spec.ts
git commit -m "test(e2e): admin removes a member and they lose access"
```

---

# Group E — Org-admin resend-invite

### Task E1: "Resend" button in InvitesTab

**Files:**
- Modify: `src/components/admin/InvitesTab.tsx`

> `resendInvitation` is already tested (Task C7) and the `resend-invitation` edge fn already authorizes org-admins. This task only wires the button.

- [ ] **Step 1: Implement** — in `src/components/admin/InvitesTab.tsx`:

Update the import to include `resendInvitation`:
```tsx
import { fetchOrgInvitations, createInvitation, revokeInvitation, resendInvitation, acceptInviteUrl } from '@/data/invitations';
```
Add a `RefreshCw` icon to the lucide import:
```tsx
import { Copy, X, RefreshCw } from 'lucide-react';
```
Add a resend mutation beside `revoke`:
```tsx
  const resend = useMutation({
    mutationFn: (id: string) => resendInvitation(supabase, id),
    onSuccess: () => toast.success('Invitation re-sent'),
    onError: (e: any) => toast.error(e?.message ?? 'Could not resend invitation'),
  });
```
In the pending-row actions (the `inv.status === 'pending'` branch), add a Resend button before the revoke button:
```tsx
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => resend.mutate(inv.id)} aria-label="Resend invitation">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
```

- [ ] **Step 2: Verify build/typecheck**

Run: `npx tsc --noEmit && npx vitest run` (or CI)
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/InvitesTab.tsx
git commit -m "feat: org-admin resend-invite button"
```

---

# Group F — Folded-in cleanups

### Task F1: Replace `window.confirm` in PlatformAdminsTab with AlertDialog

**Files:**
- Modify: `src/components/platform/PlatformAdminsTab.tsx`

- [ ] **Step 1: Implement** — add the AlertDialog import + state, and replace the inline `confirm()`:

Add imports:
```tsx
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
```
Add state inside the component:
```tsx
  const [toRemove, setToRemove] = useState<{ user_id: string; email: string } | null>(null);
```
Change the Remove button's `onClick` from the `confirm(...)` form to:
```tsx
                onClick={() => setToRemove({ user_id: a.user_id, email: a.email })}
```
Add the dialog before the closing `</CardContent>`:
```tsx
        <AlertDialog open={toRemove !== null} onOpenChange={(o) => !o && setToRemove(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove platform admin?</AlertDialogTitle>
              <AlertDialogDescription>{toRemove?.email} will lose access to the platform console.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { if (toRemove) remove.mutate(toRemove.user_id); setToRemove(null); }}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
```

- [ ] **Step 2: Verify build/typecheck** — `npx tsc --noEmit` (or CI). Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/platform/PlatformAdminsTab.tsx
git commit -m "refactor: AlertDialog confirm for platform-admin removal (drop window.confirm)"
```

### Task F2: `as never` → `as unknown as Json` in PlatformDefaultsTab

**Files:**
- Modify: `src/components/platform/PlatformDefaultsTab.tsx`

- [ ] **Step 1: Implement** — ensure `Json` is imported and replace the cast.

Add `Json` to the existing supabase types import (or add a new import):
```tsx
import type { Json } from "@/integrations/supabase/types";
```
Change `} as never)` to:
```tsx
    } as unknown as Json),
```

- [ ] **Step 2: Verify typecheck** — `npx tsc --noEmit` (or CI). Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/platform/PlatformDefaultsTab.tsx
git commit -m "refactor: type starter-catalog payload as Json (drop as never)"
```

### Task F3: Suspend-org confirmation in OrganizationsTab

**Files:**
- Modify: `src/components/platform/OrganizationsTab.tsx`

- [ ] **Step 1: Implement** — gate the suspend action behind an AlertDialog (reactivate stays one-click).

Add imports:
```tsx
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
```
Add state:
```tsx
  const [toSuspend, setToSuspend] = useState<OrgStat | null>(null);
```
Change the suspend/reactivate button so suspend opens the dialog and reactivate fires immediately:
```tsx
                  <Button size="sm" variant="ghost" aria-label={o.status === "suspended" ? "Reactivate" : "Suspend"}
                    onClick={() => o.status === "suspended"
                      ? statusMutation.mutate({ id: o.org_id, status: "active" })
                      : setToSuspend(o)}>
                    {o.status === "suspended" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </Button>
```
Add the dialog before the closing `</div>` of the component (after `<EditOrgDialog … />`):
```tsx
      <AlertDialog open={toSuspend !== null} onOpenChange={(o) => !o && setToSuspend(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend organization?</AlertDialogTitle>
            <AlertDialogDescription>Members of {toSuspend?.name} will be blocked from acting until you reactivate it. Data is preserved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (toSuspend) statusMutation.mutate({ id: toSuspend.org_id, status: "suspended" }); setToSuspend(null); }}>Suspend</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

> **Update `e2e/platform-console.spec.ts`** (its suspend step now needs the dialog confirm). After the line `await row.getByRole("button", { name: /suspend/i }).click();` insert:
> ```typescript
>     await page.getByRole("button", { name: /^suspend$/i }).last().click(); // confirm in the AlertDialog
> ```
> Reactivate stays one-click (no dialog), so leave the reactivate step unchanged.

- [ ] **Step 2: Verify build/typecheck + e2e (CI)** — `npx tsc --noEmit`; push and confirm `platform-console.spec.ts` still green. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/platform/OrganizationsTab.tsx e2e/platform-console.spec.ts
git commit -m "feat: confirm dialog before suspending an org"
```

### Task F4: Email format validation on the org-admin invite form

**Files:**
- Modify: `src/components/admin/InvitesTab.tsx`

- [ ] **Step 1: Implement** — block obviously-invalid emails client-side before invoking (the server already validates after Task C4). Replace the inline submit guard:

Change the form's `onSubmit` to validate with a small regex and toast on failure:
```tsx
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = email.trim();
            if (!currentOrg) return;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { toast.error('Enter a valid email address'); return; }
            create.mutate();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
```

- [ ] **Step 2: Verify build/typecheck** — `npx tsc --noEmit` (or CI). Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/InvitesTab.tsx
git commit -m "feat: client-side email validation on invite form"
```

---

## Stretch (NOT committed — see design §11)

`NoOrgScreen` flash + parallelizing AuthContext fetches. Touches the auth hot path; only attempt if time permits after F, in its own commit, with the auth e2e (invite/switch) green. Not part of the Phase-5 acceptance bar.

---

## Final integration & PR

- [ ] **Open the PR** against `dev`:
```bash
git push -u origin feature/multi-tenancy-phase-5
gh pr create --base dev --title "Multi-tenancy Phase 5 — self-service polish (profile/reset/members/resend) + invite unification" --body "Implements docs/superpowers/plans/2026-06-04-multi-tenancy-phase-5-self-service.md"
```
- [ ] **Watch CI** (`gh pr checks <PR#>` is the oracle): Typecheck, eslint, Vitest, Deno, pgTAP, Supabase preview, Playwright e2e — all green.
- [ ] **Triage `claude[bot]` review**: fix real correctness/security findings; defer Minor style nits to a follow-up (don't chase the bot in a loop).
- [ ] **Squash-merge** `… (#NN)` into `dev` and delete the branch. The `dev → main` promotion is a separate, owner-approved step (out of scope for this plan).

---

## Self-review (coverage map)

| Design §| Requirement | Task(s) |
|---|---|---|
| §3 | `/profile` edit name + phone | A2, A4, A5 |
| §4.1 | `/reset-password` request + set, public route, forgot-password link | B1–B3 |
| §4.2 | In-app change password (verify-then-update) | A3, A5 |
| §5 | Invite unification (`deliverOrgInvitation`, net-new bootstrap, `actionLink`, drop `inviteUserByEmail`, reuse `/reset-password`) | C1–C8 |
| §6 | `list_org_members` + `remove_org_member` (guards), data layer, org-admin Members tab, platform parity | D1–D7 |
| §7 | Org-admin resend (reuse `resend-invitation`) | C6, C7, E1 |
| §8 | Folded nits: `window.confirm`→AlertDialog, `as never`→`Json`, slug/email validation | C4, C5, F1, F2, F3, F4 |
| §9 | Test layers: data (vitest), edge (deno), pgTAP, e2e | throughout |
| §10 | Task groups A–F + sequencing (C after B) | this plan |
| §11/§12 | Out-of-scope avatar/branded-recovery; stretch NoOrgScreen | noted, not built |
