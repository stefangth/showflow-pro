# Admin & member self-service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let org admins rename their own org and change members' roles in-app (no super-admin / no support request), and collapse the duplicate member surfaces into one.

**Architecture:** Three SECURITY DEFINER RPCs (`rename_org`, `set_org_member_role`, enriched `list_org_members`) guarded by `has_org_role(...,'admin')`; thin data-access wrappers tested with `supabaseFake`; an admin-only Settings → Organization tab and an enriched Members tab; the duplicate Users tab and the now-unused `admin-set-role` edge function are retired.

**Tech Stack:** React 18 + TS, react-hook-form + zod, @tanstack/react-query v5, shadcn/ui, Supabase (Postgres RPCs + RLS), vitest + pgTAP + Deno.

**Spec:** `docs/superpowers/specs/2026-06-22-admin-member-self-service-design.md`

---

## Environment & how tests run (read first)

Per project memory (`env-no-node-supabase-cli`): **there is no local Node / supabase-CLI / Docker.**

- **vitest, eslint, build, pgTAP** → run in **CI** (push the branch; watch checks). Write tests first regardless; CI is the red/green verifier.
- **Migrations** → apply via the **Supabase MCP** `apply_migration(name, query)` tool, then mirror the SQL into a local file under `supabase/migrations/`. After a migration, regenerate types via the MCP `generate_typescript_types` and overwrite `src/integrations/supabase/types.ts` (auto-generated — never hand-edit). Smoke-test RPCs via the MCP `execute_sql`.
- **Deno edge-fn suite** → runs **locally**: `deno test --allow-all --node-modules-dir=none supabase/functions/`.
- **Migration file naming:** `apply_migration` records a real-timestamp version. After applying, read it with the MCP `list_migrations`, then `Write` the local file `supabase/migrations/<that_version>_<name>.sql` with identical SQL so the repo matches the remote.
- **Commits:** every `git commit` below also appends `-m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"` (omitted in the steps for brevity). Commit messages are imperative, lowercase, ≤72 chars.

---

## File structure

**New**
- `supabase/migrations/<ts>_rename_org.sql` — `rename_org(uuid,text)` RPC.
- `supabase/migrations/<ts>_set_org_member_role.sql` — `set_org_member_role(uuid,uuid,app_role,text)` RPC.
- `supabase/migrations/<ts>_list_org_members_last_sign_in.sql` — drop+recreate `list_org_members` with `last_sign_in_at`.
- `supabase/tests/rpc/rename_org.sql`, `supabase/tests/rpc/set_org_member_role.sql`, `supabase/tests/rpc/list_org_members.sql` — pgTAP.
- `src/components/settings/OrganizationTab.tsx` (+ `.test.tsx`) — admin-only org-name form.

**Modified**
- `src/data/orgs.ts` (+ `src/data/orgs.test.ts`) — `renameOrg`.
- `src/data/members.ts` (+ `src/data/members.test.ts`) — `setOrgMemberRole`, `OrgMember.last_sign_in_at`.
- `src/hooks/useOrgMembers.ts` — `useSetOrgMemberRole`.
- `src/features/auth/AuthContext.tsx` — expose `refreshOrgs()`.
- `src/components/admin/MembersTab.tsx` (+ `.test.tsx`) — inline role editor + last sign-in.
- `src/pages/SettingsPage.tsx` — admin-only Organization tab.
- `src/pages/AdminPage.tsx` — remove the Users tab + `RoleAssignPopover` + iam query.
- `CLAUDE.md` — drop `admin-set-role` from the edge-fn list.
- `src/integrations/supabase/types.ts` — regenerated (not hand-edited).

**Deleted**
- `supabase/functions/admin-set-role/` (incl. its `*.test.ts`).

---

## Task 1: `rename_org` RPC

**Files:**
- Test: `supabase/tests/rpc/rename_org.sql`
- Create migration (MCP): name `rename_org`; mirror to `supabase/migrations/<ts>_rename_org.sql`

- [ ] **Step 1: Write the failing pgTAP test** — `supabase/tests/rpc/rename_org.sql`

```sql
-- supabase/tests/rpc/rename_org.sql
-- rename_org: org admin renames their org (name only); non-admin rejected; slug untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000003a1','Old Name','rename-me');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000003a1','00000000-0000-0000-0000-0000000003ad','admin');
SET session_replication_role = DEFAULT;

-- non-admin rejected
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000003be","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.rename_org('00000000-0000-0000-0000-0000000003a1','Hacked') $$,
  '42501', NULL, 'non-admin cannot rename the org');
RESET ROLE;

-- admin: blank name rejected
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000003ad","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.rename_org('00000000-0000-0000-0000-0000000003a1','   ') $$,
  '22023', NULL, 'blank name is rejected');

-- admin: rename succeeds
SELECT lives_ok(
  $$ SELECT public.rename_org('00000000-0000-0000-0000-0000000003a1','New Name') $$,
  'org admin can rename the org');
RESET ROLE;

SELECT is(
  (SELECT name FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000003a1'),
  'New Name', 'name was updated');
SELECT is(
  (SELECT slug FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000003a1'),
  'rename-me', 'slug is unchanged');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Apply the migration via the Supabase MCP**

Call `apply_migration` with name `rename_org` and this query:

```sql
create or replace function public.rename_org(p_org uuid, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.has_org_role(v_caller, p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Organization name is required' using errcode = '22023';
  end if;
  update public.organizations set name = btrim(p_name) where id = p_org;
end;
$$;
revoke all on function public.rename_org(uuid, text) from public, anon;
grant execute on function public.rename_org(uuid, text) to authenticated;
```

- [ ] **Step 3: Mirror the migration to a local file**

Read the recorded version (`list_migrations`), then `Write` `supabase/migrations/<version>_rename_org.sql` with the exact SQL from Step 2.

- [ ] **Step 4: Smoke-test via MCP `execute_sql`**

```sql
select public.has_function_privilege('authenticated','public.rename_org(uuid,text)','EXECUTE') as granted;
```
Expected: `granted = true`. (Full pgTAP runs in CI.)

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/rpc/rename_org.sql supabase/migrations/*_rename_org.sql src/integrations/supabase/types.ts
git commit -m "feat(db): add rename_org rpc (org-admin org rename)"
```

- [ ] **Step 6: Regenerate types** — run MCP `generate_typescript_types`, overwrite `src/integrations/supabase/types.ts`. (Staged in Step 5 if already regenerated; otherwise amend.)

---

## Task 2: `renameOrg` data-access

**Files:**
- Modify: `src/data/orgs.ts`
- Test: `src/data/orgs.test.ts` (create)

- [ ] **Step 1: Write the failing test** — `src/data/orgs.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { renameOrg } from "./orgs";

describe("renameOrg", () => {
  it("calls rename_org with org + name", async () => {
    const fake = createFakeSupabase({ "rpc:rename_org": { data: null, error: null } });
    await renameOrg(fake as never, "org-1", "New Name");
    expect(fake.calls).toContainEqual({
      table: "rpc:rename_org", method: "rpc", args: [{ p_org: "org-1", p_name: "New Name" }],
    });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:rename_org": { data: null, error: { message: "Forbidden" } } });
    await expect(renameOrg(fake as never, "org-1", "x")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/data/orgs.test.ts` (CI). Expected: FAIL — `renameOrg` is not exported.

- [ ] **Step 3: Implement** — append to `src/data/orgs.ts`

```ts
/** Rename the caller's org (admin-only RPC; name only — slug is left unchanged). */
export async function renameOrg(
  client: SupabaseClient<Database>,
  orgId: string,
  name: string,
): Promise<void> {
  const { error } = await client.rpc("rename_org", { p_org: orgId, p_name: name });
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/data/orgs.test.ts` (CI). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/orgs.ts src/data/orgs.test.ts
git commit -m "feat(data): add renameOrg wrapper for rename_org rpc"
```

---

## Task 3: `AuthContext.refreshOrgs()`

**Files:**
- Modify: `src/features/auth/AuthContext.tsx`

- [ ] **Step 1: Add `refreshOrgs` to the context type** — in `interface AuthContextType` (after `switchOrg`):

```ts
  /** Re-fetch memberships/orgs for the signed-in user (e.g. after an org rename). */
  refreshOrgs: () => Promise<void>;
```

- [ ] **Step 2: Implement it** — in `AuthProvider`, after the `switchOrg` definition (the loader `loadIdentity` already exists above it):

```ts
  const refreshOrgs = async () => {
    if (user?.id) await loadIdentity(user.id);
  };
```

- [ ] **Step 3: Expose it in the provider value** — add `refreshOrgs` to the `value={{ … }}` object:

```ts
    <AuthContext.Provider value={{ user, session, roles, memberships, orgs, currentOrg, isSuperAdmin, switchOrg, refreshOrgs, loading, signIn, signOut, hasRole, viewAsRole, setViewAsRole, viewAsUser, setViewAsUser }}>
```

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` (CI). Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/AuthContext.tsx
git commit -m "feat(auth): expose refreshOrgs to reflect org renames live"
```

---

## Task 4: Settings → Organization tab (admin-only)

**Files:**
- Create: `src/components/settings/OrganizationTab.tsx`
- Test: `src/components/settings/OrganizationTab.test.tsx`
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Write the failing test** — `src/components/settings/OrganizationTab.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const renameOrg = vi.fn((...a: unknown[]) => Promise.resolve());
const refreshOrgs = vi.fn(() => Promise.resolve());
vi.mock("@/data/orgs", async (orig) => ({ ...(await orig<typeof import("@/data/orgs")>()), renameOrg: (...a: unknown[]) => renameOrg(...a) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Acme", slug: "acme", status: "active" }, refreshOrgs }),
}));

import { OrganizationTab } from "./OrganizationTab";

describe("OrganizationTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prefills the name and shows slug read-only", () => {
    renderWithProviders(<OrganizationTab />);
    expect(screen.getByLabelText(/organization name/i)).toHaveValue("Acme");
    expect(screen.getByLabelText(/slug/i)).toBeDisabled();
  });

  it("rejects a blank name", async () => {
    renderWithProviders(<OrganizationTab />);
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(renameOrg).not.toHaveBeenCalled();
  });

  it("saves a new name then refreshes orgs", async () => {
    renderWithProviders(<OrganizationTab />);
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: "Acme Theatre" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(renameOrg).toHaveBeenCalledWith({}, "org-1", "Acme Theatre"));
    await waitFor(() => expect(refreshOrgs).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/components/settings/OrganizationTab.test.tsx` (CI). Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/components/settings/OrganizationTab.tsx`

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { renameOrg } from "@/data/orgs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({ name: z.string().min(1, "Required") });
type Values = z.infer<typeof schema>;

/** Admin-only: rename the current org (name only; slug is shown read-only). */
export function OrganizationTab() {
  const { currentOrg, refreshOrgs } = useAuth();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: { name: currentOrg?.name ?? "" } });

  const mutation = useMutation({
    mutationFn: (v: Values) => renameOrg(supabase, currentOrg!.id, v.name),
    onSuccess: async () => { await refreshOrgs(); toast.success("Organization renamed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentOrg) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Organization</CardTitle>
        <CardDescription>Your workspace name. The slug is fixed — contact support to change it.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4 max-w-md">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Organization name</Label>
            <Input id="org-name" {...form.register("name")} />
            {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-slug">Slug</Label>
            <Input id="org-slug" value={currentOrg.slug} disabled readOnly />
          </div>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/components/settings/OrganizationTab.test.tsx` (CI). Expected: PASS.

- [ ] **Step 5: Wire into `SettingsPage`** — `src/pages/SettingsPage.tsx`:

Add the import near the other settings-tab imports (line ~26):
```tsx
import { OrganizationTab } from '@/components/settings/OrganizationTab';
```
Add `Building2` to the existing `lucide-react` icon import (line 24).
Make Organization the admin default and add its trigger as the first item in `<TabsList>` (line ~591-593):
```tsx
      <Tabs defaultValue={isAdmin ? 'organization' : 'scheduling'}>
        <TabsList>
          {isAdmin && <TabsTrigger value="organization"><Building2 className="h-4 w-4 mr-2" />Organization</TabsTrigger>}
          {isAdmin && <TabsTrigger value="airtable"><Database className="h-4 w-4 mr-2" />Airtable Sync</TabsTrigger>}
```
Add the content block alongside the other `<TabsContent>` (e.g. just before the `airtable` content at line ~912):
```tsx
        {isAdmin && (
          <TabsContent value="organization" className="mt-4">
            <OrganizationTab />
          </TabsContent>
        )}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/OrganizationTab.tsx src/components/settings/OrganizationTab.test.tsx src/pages/SettingsPage.tsx
git commit -m "feat(settings): admin-only organization tab to rename the org"
```

---

## Task 5: `set_org_member_role` RPC

**Files:**
- Test: `supabase/tests/rpc/set_org_member_role.sql`
- Create migration (MCP): name `set_org_member_role`; mirror to `supabase/migrations/<ts>_set_org_member_role.sql`

- [ ] **Step 1: Write the failing pgTAP test** — `supabase/tests/rpc/set_org_member_role.sql`

```sql
-- supabase/tests/rpc/set_org_member_role.sql
-- set_org_member_role: admin adds/removes roles; non-admin rejected; last-admin guarded.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000005ad','authenticated','authenticated','admin@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-0000000005b0','authenticated','authenticated','bob@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000005c0','Crew','crew-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005ad','admin'),
  ('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005b0','producer');
SET session_replication_role = DEFAULT;

-- non-admin (bob) cannot change roles
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000005b0","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.set_org_member_role('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005b0','admin','add') $$,
  '42501', NULL, 'non-admin cannot change roles');
RESET ROLE;

-- admin adds 'artist' to bob
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000005ad","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.set_org_member_role('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005b0','artist','add') $$,
  'admin can add a role');
SELECT ok(
  EXISTS (SELECT 1 FROM public.org_memberships
          WHERE org_id='00000000-0000-0000-0000-0000000005c0'
            AND user_id='00000000-0000-0000-0000-0000000005b0' AND role='artist'),
  'the artist role row exists');

-- admin cannot remove the last admin (themselves)
SELECT throws_ok(
  $$ SELECT public.set_org_member_role('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005ad','admin','remove') $$,
  '42501', NULL, 'cannot remove the last admin');

-- admin removes bob's producer role
SELECT lives_ok(
  $$ SELECT public.set_org_member_role('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005b0','producer','remove') $$,
  'admin can remove a non-admin role');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Apply the migration via the Supabase MCP** — name `set_org_member_role`:

```sql
create or replace function public.set_org_member_role(
  p_org uuid, p_user uuid, p_role app_role, p_action text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.has_org_role(v_caller, p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if p_action not in ('add','remove') then
    raise exception 'Invalid action' using errcode = '22023';
  end if;

  if p_action = 'add' then
    insert into public.org_memberships (org_id, user_id, role)
    values (p_org, p_user, p_role)
    on conflict (org_id, user_id, role) do nothing;
  else
    lock table public.org_memberships in share row exclusive mode;
    if p_role = 'admin'
       and exists (
         select 1 from public.org_memberships
         where org_id = p_org and user_id = p_user and role = 'admin'
       )
       and (
         select count(distinct user_id) from public.org_memberships
         where org_id = p_org and role = 'admin' and user_id <> p_user
       ) < 1 then
      raise exception 'Cannot remove the last admin of the organization' using errcode = '42501';
    end if;
    delete from public.org_memberships
    where org_id = p_org and user_id = p_user and role = p_role;
  end if;
end;
$$;
revoke all on function public.set_org_member_role(uuid, uuid, app_role, text) from public, anon;
grant execute on function public.set_org_member_role(uuid, uuid, app_role, text) to authenticated;
```

- [ ] **Step 3: Mirror to local file** — `list_migrations` → `Write` `supabase/migrations/<version>_set_org_member_role.sql`.

- [ ] **Step 4: Regenerate types** — MCP `generate_typescript_types` → overwrite `src/integrations/supabase/types.ts`.

- [ ] **Step 5: Smoke-test** — MCP `execute_sql`:
```sql
select public.has_function_privilege('authenticated','public.set_org_member_role(uuid,uuid,app_role,text)','EXECUTE') as granted;
```
Expected: `granted = true`.

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/rpc/set_org_member_role.sql supabase/migrations/*_set_org_member_role.sql src/integrations/supabase/types.ts
git commit -m "feat(db): add set_org_member_role rpc (org-scoped role change)"
```

---

## Task 6: Enrich `list_org_members` with `last_sign_in_at`

**Files:**
- Test: `supabase/tests/rpc/list_org_members.sql`
- Create migration (MCP): name `list_org_members_last_sign_in`; mirror locally
- Modify: `src/data/members.ts` (type only)

- [ ] **Step 1: Write the failing pgTAP test** — `supabase/tests/rpc/list_org_members.sql`

```sql
-- supabase/tests/rpc/list_org_members.sql
-- list_org_members returns members with their last_sign_in_at (admin-guarded).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(2);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000006ad','authenticated','authenticated','adm@x.com',now(),'2026-06-01T10:00:00Z','{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000006c0','Roster','roster-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000006c0','00000000-0000-0000-0000-0000000006ad','admin');
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000006ad","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.list_org_members('00000000-0000-0000-0000-0000000006c0')),
  1::bigint, 'returns the org member');
SELECT is(
  (SELECT last_sign_in_at FROM public.list_org_members('00000000-0000-0000-0000-0000000006c0')),
  '2026-06-01T10:00:00Z'::timestamptz, 'returns last_sign_in_at');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Apply the migration via the Supabase MCP** — name `list_org_members_last_sign_in`:

```sql
drop function if exists public.list_org_members(uuid);
create function public.list_org_members(p_org uuid)
returns table (user_id uuid, email text, display_name text, roles app_role[], last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  return query
    select m.user_id,
           u.email::text,
           p.display_name,
           array_agg(m.role order by m.role) as roles,
           u.last_sign_in_at
    from public.org_memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.org_id = p_org
    group by m.user_id, u.email, p.display_name, u.last_sign_in_at
    order by u.email;
end;
$$;
revoke all on function public.list_org_members(uuid) from public, anon;
grant execute on function public.list_org_members(uuid) to authenticated;
```

- [ ] **Step 3: Mirror to local file** — `list_migrations` → `Write` `supabase/migrations/<version>_list_org_members_last_sign_in.sql`.

- [ ] **Step 4: Regenerate types** — MCP `generate_typescript_types` → overwrite `src/integrations/supabase/types.ts`.

- [ ] **Step 5: Extend the `OrgMember` type** — `src/data/members.ts`, add the field to the interface:

```ts
export interface OrgMember {
  user_id: string;
  email: string | null;
  display_name: string | null;
  roles: AppRole[];
  last_sign_in_at: string | null;
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/rpc/list_org_members.sql supabase/migrations/*_list_org_members_last_sign_in.sql src/data/members.ts src/integrations/supabase/types.ts
git commit -m "feat(db): list_org_members returns last_sign_in_at"
```

---

## Task 7: `setOrgMemberRole` data-access + `useSetOrgMemberRole` hook

**Files:**
- Modify: `src/data/members.ts`, `src/data/members.test.ts`, `src/hooks/useOrgMembers.ts`

- [ ] **Step 1: Write the failing data test** — append to `src/data/members.test.ts`

```ts
import { setOrgMemberRole } from "./members";

describe("setOrgMemberRole", () => {
  it("calls set_org_member_role with org/user/role/action", async () => {
    const fake = createFakeSupabase({ "rpc:set_org_member_role": { data: null, error: null } });
    await setOrgMemberRole(fake as never, "org-1", "u2", "producer", "add");
    expect(fake.calls).toContainEqual({
      table: "rpc:set_org_member_role", method: "rpc",
      args: [{ p_org: "org-1", p_user: "u2", p_role: "producer", p_action: "add" }],
    });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:set_org_member_role": { data: null, error: { message: "last admin" } } });
    await expect(setOrgMemberRole(fake as never, "org-1", "u2", "admin", "remove")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/data/members.test.ts` (CI). Expected: FAIL — `setOrgMemberRole` not exported.

- [ ] **Step 3: Implement** — append to `src/data/members.ts`

```ts
/** Add or remove a single role for a member (admin-only RPC; guards the last admin). */
export async function setOrgMemberRole(
  client: SupabaseClient<Database>,
  orgId: string,
  userId: string,
  role: AppRole,
  action: "add" | "remove",
): Promise<void> {
  const { error } = await client.rpc("set_org_member_role", {
    p_org: orgId, p_user: userId, p_role: role, p_action: action,
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/data/members.test.ts` (CI). Expected: PASS.

- [ ] **Step 5: Add the mutation hook** — `src/hooks/useOrgMembers.ts`:

Update imports:
```ts
import { fetchOrgMembers, removeOrgMember, setOrgMemberRole } from "@/data/members";
import type { AppRole } from "@/config/app.config";
```
Append the hook:
```ts
/** Add/remove a member role, then refresh that org's member list. */
export function useSetOrgMemberRole(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: string; role: AppRole; action: "add" | "remove" }) =>
      setOrgMemberRole(supabase, orgId, vars.userId, vars.role, vars.action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", orgId] }),
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/data/members.ts src/data/members.test.ts src/hooks/useOrgMembers.ts
git commit -m "feat(data): setOrgMemberRole wrapper + useSetOrgMemberRole hook"
```

---

## Task 8: Members tab — inline role editor + last sign-in

**Files:**
- Modify: `src/components/admin/MembersTab.tsx`
- Test: `src/components/admin/MembersTab.test.tsx` (create)

- [ ] **Step 1: Write the failing test** — `src/components/admin/MembersTab.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const setRole = vi.fn((...a: unknown[]) => Promise.resolve());
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useOrgMembers", () => ({
  useOrgMembers: () => ({
    data: [
      { user_id: "admin-1", email: "me@x.com", display_name: "Me", roles: ["admin"], last_sign_in_at: "2026-06-01T10:00:00Z" },
      { user_id: "bob-2", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null },
    ],
    isLoading: false, isError: false, error: null,
  }),
  useRemoveOrgMember: () => ({ mutate: vi.fn() }),
  useSetOrgMemberRole: () => ({ mutate: (vars: unknown) => setRole(vars) }),
}));

import { MembersTab } from "./MembersTab";

describe("MembersTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists members with last sign-in", () => {
    renderWithProviders(<MembersTab />);
    expect(screen.getByText("bob@x.com")).toBeInTheDocument();
    expect(screen.getByText(/never signed in/i)).toBeInTheDocument();
  });

  it("toggles a role via set_org_member_role", async () => {
    renderWithProviders(<MembersTab />);
    fireEvent.click(screen.getByRole("button", { name: /edit roles for bob@x.com/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^admin$/i }));
    await waitFor(() => expect(setRole).toHaveBeenCalledWith({ userId: "bob-2", role: "admin", action: "add" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/components/admin/MembersTab.test.tsx` (CI). Expected: FAIL (no role editor / labels yet).

- [ ] **Step 3: Implement** — replace `src/components/admin/MembersTab.tsx` with:

```tsx
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrgMembers, useRemoveOrgMember, useSetOrgMemberRole } from "@/hooks/useOrgMembers";
import type { AppRole } from "@/config/app.config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ALL_ROLES: AppRole[] = ["admin", "producer", "artist"];

/** Org-admin member management: list members, edit their roles, and remove them. */
export function MembersTab() {
  const { currentOrg, user } = useAuth();
  const { data: members, isLoading, isError, error } = useOrgMembers(currentOrg?.id);
  const remove = useRemoveOrgMember(currentOrg?.id ?? "");
  const setRole = useSetOrgMemberRole(currentOrg?.id ?? "");
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
              <p className="text-xs text-muted-foreground">
                {m.last_sign_in_at ? `Last seen ${format(new Date(m.last_sign_in_at), "dd/MM/yyyy HH:mm")}` : "Never signed in"}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {m.roles.map((r) => <Badge key={r} variant="secondary" className="text-xs capitalize">{r}</Badge>)}
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" aria-label={`Edit roles for ${m.email}`}>
                    <SettingsIcon className="h-3 w-3 mr-1" />Roles
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="end">
                  {ALL_ROLES.map((r) => {
                    const has = m.roles.includes(r);
                    return (
                      <button
                        key={r}
                        onClick={() => setRole.mutate(
                          { userId: m.user_id, role: r, action: has ? "remove" : "add" },
                          { onSuccess: () => toast.success("Role updated"), onError: (e) => toast.error((e as Error).message) },
                        )}
                        className="flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-muted text-left capitalize"
                      >
                        <Check className={cn("h-4 w-4 mr-2", has ? "opacity-100" : "opacity-0")} />
                        {r}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
              <Button
                size="sm" variant="ghost" className="h-7 px-2 text-xs"
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

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/components/admin/MembersTab.test.tsx` (CI). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/MembersTab.tsx src/components/admin/MembersTab.test.tsx
git commit -m "feat(admin): inline role editor + last sign-in in members tab"
```

---

## Task 9: Remove the duplicate Users tab from AdminPage

**Files:**
- Modify: `src/pages/AdminPage.tsx`

- [ ] **Step 1: Delete the Users tab + its machinery.** In `src/pages/AdminPage.tsx`:
  - Remove the `iamUsers` query (the `useQuery` for `['admin-iam-users', …]` invoking `admin-list-users`, lines ~39-51).
  - Remove the `<TabsTrigger value="users">Users</TabsTrigger>` (line ~131).
  - Remove the entire `<TabsContent value="users">…</TabsContent>` block (lines ~144-174).
  - Remove the `RoleAssignPopover` function (lines ~232-274).
  - Remove the `IamUser` type (lines ~25-31) and the now-unused `useMutation` usage.
  - Remove now-unused imports: `Popover, PopoverContent, PopoverTrigger`, `Check`, `Settings as SettingsIcon`, `useMutation` (keep `useQuery`, `useQueryClient` only if still used by the remaining audit/sync/stats queries — they are), `cn`, `useToast`, `ALL_ROLES`. Verify each removed import has no other reference before deleting.

- [ ] **Step 2: Typecheck + lint** — `npx tsc --noEmit && npm run lint` (CI). Expected: no unused-symbol or type errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/AdminPage.tsx
git commit -m "refactor(admin): drop duplicate users tab (members tab is canonical)"
```

---

## Task 10: Retire the `admin-set-role` edge function

**Files:**
- Delete: `supabase/functions/admin-set-role/` (incl. tests)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Confirm there are no remaining references**

```bash
grep -rn "admin-set-role" src/ supabase/ docs/ CLAUDE.md
```
Expected: only matches inside `supabase/functions/admin-set-role/` and the `CLAUDE.md` edge-fn list. If `src/` still references it, stop — Task 9 missed a caller.

- [ ] **Step 2: Delete the function directory**

```bash
git rm -r supabase/functions/admin-set-role
```

- [ ] **Step 3: Update `CLAUDE.md`** — in the "Edge functions → Admin ops" bullet, change:
`**Admin ops:** \`admin-list-users\`, \`admin-set-role\` (both org-scoped via \`?org_id\` / body \`org_id\`).`
to:
`**Admin ops:** \`admin-list-users\` (org-scoped via \`?org_id\` / body \`org_id\`). Member role changes are the \`set_org_member_role\` RPC (not an edge function).`

- [ ] **Step 4: Run the Deno edge-fn suite (LOCAL)**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/
```
Expected: PASS, with no missing-import errors from the deleted function.

- [ ] **Step 5: Commit**

```bash
git add -A supabase/functions CLAUDE.md
git commit -m "refactor: retire admin-set-role edge fn (replaced by rpc)"
```

---

## Task 11: Finalize — full verification + PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin claude/optimistic-noether-131dfb
```

- [ ] **Step 2: Watch CI to all-green** — vitest, pgTAP (`supabase test db`), eslint, build, and E2E. Poll the head commit's check-runs (per memory `repo-no-required-checks-automerge`: do NOT use `--auto`). Fix any failures and re-push.

- [ ] **Step 3: Manual smoke (optional, via the running app)** — as an org admin: Settings → Organization rename reflects in the topbar switcher; Members tab role toggle persists and the last-admin guard blocks removing the final admin.

- [ ] **Step 4: Open the PR** — use the `superpowers:finishing-a-development-branch` skill. PR body summarizes: org rename (admin), inline role change, members/users consolidation, retired `admin-set-role`, and the multi-tenancy bugfix. Link the spec.

---

## Self-Review

**1. Spec coverage**
- Org rename (name-only) → Tasks 1, 2, 4 (+ refresh in 3). ✓
- Inline role change (org-scoped, guarded) → Tasks 5, 7, 8. ✓
- Multi-tenancy bug (role change targeted bootstrap org) → fixed by Tasks 7-9 (role path now uses `currentOrg.id` via the RPC; buggy `admin-set-role` caller removed). ✓
- Enriched `list_org_members` / consolidation → Tasks 6, 8, 9. ✓
- Retire `admin-set-role`; keep `admin-list-users` → Task 10 (and Task 9 leaves `admin-list-users` for the editor). ✓
- Testing across unit/pgTAP/deno → each task; CI in Task 11. ✓
- Non-goals (slug rename, account deletion) → not implemented. ✓

**2. Placeholder scan** — no "TBD/TODO/handle edge cases"; every code/test step has real content. Migration `<ts>`/`<version>` are runtime-resolved per the Environment note, not content gaps. ✓

**3. Type consistency** — `renameOrg(client, orgId, name)`, `setOrgMemberRole(client, orgId, userId, role, action)`, `useSetOrgMemberRole(orgId).mutate({ userId, role, action })`, RPC params `p_org/p_user/p_role/p_action` and `p_org/p_name`, and `OrgMember.last_sign_in_at` are consistent across Tasks 2/5/6/7/8. The Members test mocks `useSetOrgMemberRole` to match the hook's `{ userId, role, action }` shape. ✓
