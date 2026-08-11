# Admin UI Isolated Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four isolated, conflict-free admin/UX fixes: a Platform→Users invite-state column, a slots-step empty state, a warmer unlinked-artist dashboard screen, and linking the 3 stranded TERBE 73 artist accounts.

**Architecture:** Each task is an independent vertical slice touching non-overlapping files. The booking-setup step-registry reorder (production-team step, new order, count-based rail) is DELIBERATELY EXCLUDED — it lives in the shared onboarding registry that a parallel producer-view session is editing, and is deferred to a later rebase (tracked separately).

**Tech Stack:** React 18 + Vite + TS, TanStack Query v5, shadcn/ui, Supabase (Postgres + Deno edge functions), Vitest + jsdom, Deno test.

## Global Constraints

- Test-first (TDD). Tests import the real module; never re-implement production logic in a test.
- Edge functions: `handle(req, deps)` + `makeFakeDeps(...)` from `_shared/testing.ts`. Never construct clients/CORS/auth inline.
- `any` is banned (CI `--max-warnings 0`). Use an explicit row `interface` + one `as unknown as` cast at the query boundary.
- Styling: semantic tokens only (`bg-accent-100`, `text-accent-700`, `text-muted-foreground`). Accent numbered stops (`accent-50`–`900`) are solid — no `/opacity` modifiers.
- Copy: no em/en dashes. Use periods, commas, middot (·). Sentence case.
- Role literal is `'producer'`; display label is "Production Team" via `roleLabel()`. Never compare against the display string.
- `platform-list-users` is NOT a generated mirror — edit directly. No `config.toml` change (existing function).
- Do not touch `src/lib/dashboard/moduleOnboarding.ts`, `src/lib/dashboard/firstRun.ts`, `src/lib/bookings/setupStatus.ts`, `BookingSetupRail.tsx`, `DashboardWelcome.tsx` progress rail — those are the deferred shared registry.

---

### Task 1: Platform → Users invite-state column

**Files:**
- Modify (DONE): `supabase/functions/platform-list-users/index.ts` — added `InvitationRow`, 5th `org_invitations` read, `pendingInvite` set, per-membership `invitePending`.
- Modify (DONE): `src/data/platformUsers.ts:7-12` — added `invitePending: boolean` to `PlatformUserMembership`.
- Modify: `src/components/platform/UsersTab.tsx` — new "Invite" column + `colSpan` 7→8.
- Test: `supabase/functions/platform-list-users/index.test.ts`, `src/components/platform/UsersTab.test.tsx`.

**Interfaces:**
- Consumes: `PlatformUser.memberships[].invitePending: boolean` (produced by the edge fn / type).
- Produces: nothing downstream; terminal UI.

- [x] **Step 1: Edge fn — add `org_invitations` read + `invitePending`** (already applied)

The `Promise.all` gained `admin.from("org_invitations").select("org_id, email, status").eq("status", "pending")`; each membership entry is marked `invitePending` when `pendingInvite.has(\`${org_id}|${lower(email)}\`)`.

- [ ] **Step 2: Edge test — assert the pending flag**

Add to `index.test.ts` (the fake ignores `.eq()` on list reads, so seed pre-filtered pending rows):

```ts
Deno.test("flags a membership as pending when a matching pending invitation exists", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: {
      platform_admins: { data: { user_id: "sa" }, error: null },
      org_memberships: { data: [
        { org_id: "o1", user_id: "u1", role: "artist" },
        { org_id: "o2", user_id: "u1", role: "producer" },
      ], error: null },
      organizations: { data: [{ id: "o1", name: "Org One" }, { id: "o2", name: "Org Two" }], error: null },
      artists: { data: [], error: null },
      profiles: { data: [], error: null },
      org_invitations: { data: [{ org_id: "o1", email: "U1@Test.com", status: "pending" }], error: null },
    },
    authUsers: [{ id: "u1", email: "u1@test.com", created_at: "2026-01-01", last_sign_in_at: null, banned_until: null }],
  });
  const res = await handle(new Request("http://x", { method: "POST", headers: AUTH, body: "{}" }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  const mems = body.users[0].memberships as Array<{ org_id: string; invitePending: boolean }>;
  assertEquals(mems.find((m) => m.org_id === "o1")!.invitePending, true);
  assertEquals(mems.find((m) => m.org_id === "o2")!.invitePending, false);
});
```

Also append to the existing "assembles per-user memberships" test: `assertEquals(body.users[0].memberships[0].invitePending, false);`

- [ ] **Step 3: Run the edge test — expect PASS** (backend already implemented)

Run: `deno test --allow-all supabase/functions/platform-list-users/index.test.ts`
Expected: all PASS.

- [ ] **Step 4: UI — render the column**

In `UsersTab.tsx`: add `<TableHead>Invite</TableHead>` before the `Status` head. Inside the row `.map`, after `overflowCount`:

```tsx
const pendingOrgs = u.memberships.filter((m) => m.invitePending);
const inviteLabel = pendingOrgs.length === 0
  ? null
  : pendingOrgs.length < u.memberships.length
    ? `Pending · ${pendingOrgs.map((m) => m.org_name).join(", ")}`
    : "Pending";
```

Add the cell before the Status cell:

```tsx
<TableCell>
  {inviteLabel ? (
    <Badge variant="accent" dot>{inviteLabel}</Badge>
  ) : (
    <span className="text-muted-foreground">—</span>
  )}
</TableCell>
```

Bump the empty-state row `colSpan={7}` → `colSpan={8}`.

- [ ] **Step 5: UI test**

In `UsersTab.test.tsx`, add `invitePending: false` to every membership in the `ADA` and `GRACE` fixtures, then add:

```tsx
const PENDING: PlatformUser = {
  id: "u3", email: "milo@x.com", display_name: "Milo", created_at: "",
  last_sign_in_at: null, suspended: false,
  memberships: [{ org_id: "o3", org_name: "Gamma", roles: ["artist"], artist: null, invitePending: true }],
};
const MULTI: PlatformUser = {
  id: "u4", email: "nan@x.com", display_name: "Nan", created_at: "",
  last_sign_in_at: null, suspended: false,
  memberships: [
    { org_id: "o1", org_name: "Acme", roles: ["producer"], artist: null, invitePending: false },
    { org_id: "o5", org_name: "Delta", roles: ["artist"], artist: null, invitePending: true },
  ],
};

it("shows a Pending badge for a user with an unaccepted invitation, not for members", () => {
  usePlatformUsersMock.mockReturnValue({ data: { users: [ADA, PENDING], truncated: false }, isLoading: false, isError: false, error: null });
  renderWithProviders(<UsersTab />);
  expect(screen.getAllByText("Pending")).toHaveLength(1);
});

it("names the org when a multi-org user is pending in only some orgs", () => {
  usePlatformUsersMock.mockReturnValue({ data: { users: [MULTI], truncated: false }, isLoading: false, isError: false, error: null });
  renderWithProviders(<UsersTab />);
  expect(screen.getByText(/Pending · Delta/)).toBeInTheDocument();
});
```

- [ ] **Step 6: Run vitest + lint + typecheck**

Run: `npx vitest run src/components/platform/UsersTab.test.tsx src/data/platformUsers.test.ts`
Then: `npx tsc -p tsconfig.app.json --noEmit` and `deno check --node-modules-dir=none supabase/functions/platform-list-users/index.ts`
Expected: all PASS/clean.

- [ ] **Step 7: Commit** — `git commit -m "feat: surface pending-invite state in platform users table"`

---

### Task 2: Slots-step empty state

**Files:**
- Modify: `src/components/bookings/setup/SlotsStep.tsx` — render an empty state when the org has no unset shows instead of a dead "Save slot counts" button.
- Test: `src/components/bookings/setup/SlotsStep.test.tsx` (add no-shows case).

**Interfaces:**
- Consumes: `fetchShowsWithSlots`, `activeShows`, `showSlots` (unchanged). `ROUTES.PRODUCTIONS`.
- Produces: nothing downstream.

Root cause: `unset` (line 24) is empty when the org has no active shows missing slots, but the button renders unconditionally (line 73) and its mutation throws `"Enter a main and understudy count"` (line 35). A brand-new org has zero shows, so the panel is a dead button.

- [ ] **Step 1: Failing test — empty state, no dead button**

Add to `SlotsStep.test.tsx` (mirror existing fixture/mocking there):

```tsx
it("shows an empty state and no save button when there are no shows to set", async () => {
  // fetchShowsWithSlots resolves to [] (no shows). Mirror how this file stubs the query.
  renderWithProviders(<SlotsStep orgId="o1" onDone={() => {}} />);
  expect(await screen.findByText(/no shows yet/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /save slot counts/i })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /add a show/i })).toHaveAttribute("href", expect.stringContaining("/productions"));
});
```

- [ ] **Step 2: Run — expect FAIL** (`Save slot counts` still present).

Run: `npx vitest run src/components/bookings/setup/SlotsStep.test.tsx`

- [ ] **Step 3: Implement the empty state**

Add `Link` from `react-router-dom` and `ROUTES` import. After the `shows.isLoading` guard, before the return, branch on empty:

```tsx
if (unset.length === 0) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        A date with no slot count never reads as full, so it can't reach fully filled or auto-draft a hire order.
      </p>
      <div className="flex items-center gap-2.5 rounded-md border border-dashed border-border p-3">
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">
          No shows yet. Add a show first, then set its slot counts here.
        </span>
        <Button asChild size="sm" variant="outline">
          <Link to={ROUTES.PRODUCTIONS}>Add a show</Link>
        </Button>
      </div>
    </div>
  );
}
```

(The existing return with inputs + "Save slot counts" stays for the has-unset-shows case.)

- [ ] **Step 4: Run — expect PASS.** Re-run the existing has-shows tests too (same file) to confirm no regression.

- [ ] **Step 5: Lint + typecheck** — `npx tsc -p tsconfig.app.json --noEmit`

- [ ] **Step 6: Commit** — `git commit -m "fix: slots setup step shows an add-a-show empty state instead of a dead save button"`

---

### Task 3: Warmer unlinked-artist dashboard screen

**Files:**
- Modify: `src/components/dashboard/ArtistDashboard.tsx:126-139` — replace the bare "No artist profile linked" card.
- Test: `src/components/dashboard/ArtistDashboard.test.tsx` (add/adjust unlinked-state case if a harness exists; otherwise create a minimal one).

**Interfaces:**
- Consumes: `useMyArtist` (`{ data: artist }`), `useAuth` (`currentOrg`) — both already in scope. `Theater` icon already imported.
- Produces: nothing downstream.

**Approved design (covered by pre-approval):** a welcoming, reassuring card (org name, accent icon, no alarm), not a bare sentence.

- [ ] **Step 1: Failing test — new copy renders for an unlinked artist**

Mirror the mocking pattern in this repo's dashboard tests. Mock `useMyArtist` to return `{ data: null }` (and stub any hook that throws without data). Assert:

```tsx
expect(screen.getByText(/on the .* roster|you're on the roster/i)).toBeInTheDocument();
expect(screen.getByText(/an admin still needs to link/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

Replace the `if (!artist)` block with (uses `currentOrg` already destructured at line 55, `Theater` already imported):

```tsx
if (!artist) {
  const orgName = currentOrg?.name;
  return (
    <div className="space-y-6">
      <h1 className="font-display text-[32px] font-semibold tracking-tight">Dashboard</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-100 text-accent-700">
            <Theater className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <p className="font-display text-lg font-semibold">
              {orgName ? `You're on the ${orgName} roster` : "You're on the roster"}
            </p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Your account is set up. An admin still needs to link it to your artist profile before
              your dates, casts and offers show up here. You'll get an email as soon as you're booked,
              so there's nothing you need to do right now.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Lint + typecheck** — `npx tsc -p tsconfig.app.json --noEmit`

- [ ] **Step 6: Commit** — `git commit -m "feat: warmer unlinked-artist dashboard state with org context"`

---

### Task 4: Link the 3 stranded TERBE 73 artist accounts (production data op)

**Not TDD — a guarded production data operation.** Owner pre-authorized all three; report exactly which accounts were linked when done. Do NOT run as a subagent — the main session performs this directly against production via the Supabase MCP.

**Files:** none (data only).

- [ ] **Step 1: Identify.** Read-only SQL: find TERBE 73's org id, then the artist-role `org_memberships` whose user has no linked `artists` row in that org, and the catalog `artists` row (same org, `user_id IS NULL`) whose lowercased email matches the user's email.

```sql
-- org id
select id, name from organizations where name = 'TERBE 73';
-- unlinked artist-role members + candidate catalog artist by email
select m.user_id, u.email as user_email, a.id as artist_id, a.name as artist_name, a.email as artist_email
from org_memberships m
join auth.users u on u.id = m.user_id
left join artists la on la.org_id = m.org_id and la.user_id = m.user_id
left join artists a on a.org_id = m.org_id and a.user_id is null and lower(a.email) = lower(u.email)
where m.org_id = '<terbe73>' and m.role = 'artist' and la.id is null;
```

- [ ] **Step 2: Present the mapping** (user → catalog artist) before writing. Only proceed on rows with an unambiguous single email match; flag any user with 0 or >1 candidate artists rather than guessing.

- [ ] **Step 3: Link.** For each confirmed row, guarded UPDATE (service role): `update artists set user_id = '<user>' where id = '<artist>' and org_id = '<terbe73>' and user_id is null;` Verify one row affected each.

- [ ] **Step 4: Verify.** Re-run Step 1's query; expect zero unlinked artist-role members remaining (or only the genuinely-no-catalog-artist ones).

- [ ] **Step 5: Report** to the owner the exact list of `(email → artist name)` links made, and any that were skipped and why.

---

## Deferred (NOT in this plan)

Booking-setup registry reorder + wired admin-only "Add your production team" step + count-based progress rail + "Get your shows in" step. Held until the parallel producer-view session lands, then rebased. Tracked as task #5 in the session task list. Order once resumed: production-team → get-shows-in → slots → booking-flow(4) → add-artists(5) → cast-priorities → eligibility → email-timing. Booking-flow "done" = flow active (unchanged). "Off on first run" already satisfied by provisioning; docs/System-Map gating already super-admin only.
