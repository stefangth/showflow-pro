# Sidebar Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing app sidebar to match the approved mock — two-tone wordmark + version pill, section-grouped nav, real count badges, and a boxed profile card — with every row wired to a real route and every badge to real data.

**Architecture:** Data-access count functions in `src/data/bookings.ts` (tested with `supabaseFake`), surfaced by a thin `useNavCounts()` hook. `navItems.ts` gains `section`/`badge` fields plus a pure `groupNavBySections()` helper. `AppLayout.tsx` consumes both to render grouped sections, badges, the wordmark, and the profile card. Palette/tokens are untouched.

**Tech Stack:** React 18 + TS, react-router-dom v6, @tanstack/react-query v5, Vitest + @testing-library/react, Tailwind + shadcn.

## Global Constraints

- Semantic tokens only — no hardcoded colors. Accent `-50..-900` stops take **no** opacity modifier.
- Query keys are hierarchical under a domain; the new count queries live under `['bookings', ...]` so existing `invalidateQueries(['bookings'])` mutations refresh them.
- Tests import the real module; data-access tested via `src/test/supabaseFake.ts` (no `vi.mock` of the supabase client for data fns).
- Week-start, route/role gating, and existing functionality (collapse, OrgSwitcher, bell, breadcrumb, editor toolbar) must be preserved.
- Run tests via the working node: `export PATH="/Users/stefanschaal/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"` then `node node_modules/.bin/vitest run <path>`.

---

### Task 1: Booking count data-access functions

**Files:**
- Modify: `src/data/bookings.ts`
- Test: `src/data/bookings.test.ts`

**Interfaces:**
- Produces:
  - `fetchPendingConfirmationsCount(client: SupabaseClient<Database>, orgId: string): Promise<number>`
  - `fetchMyOpenOffersCount(client: SupabaseClient<Database>, artistId: string): Promise<number>`

- [ ] **Step 1: Write the failing tests** (append to `src/data/bookings.test.ts`; if the file has no `createFakeSupabase` import yet, add `import { createFakeSupabase } from "@/test/supabaseFake";`)

```ts
import { fetchPendingConfirmationsCount, fetchMyOpenOffersCount } from "./bookings";

describe("fetchPendingConfirmationsCount", () => {
  it("counts soft_booked bookings for the org", async () => {
    const fake = createFakeSupabase({
      bookings: { data: [{ id: "b1" }, { id: "b2" }, { id: "b3" }], error: null },
    });
    const n = await fetchPendingConfirmationsCount(fake as any, "org-1");
    expect(n).toBe(3);
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "soft_booked"] });
  });

  it("returns 0 when none", async () => {
    const fake = createFakeSupabase({ bookings: { data: [], error: null } });
    expect(await fetchPendingConfirmationsCount(fake as any, "org-1")).toBe(0);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ bookings: { data: null, error: { message: "boom" } } });
    await expect(fetchPendingConfirmationsCount(fake as any, "org-1")).rejects.toBeTruthy();
  });
});

describe("fetchMyOpenOffersCount", () => {
  it("counts suggested bookings for the artist", async () => {
    const fake = createFakeSupabase({
      bookings: { data: [{ id: "b1" }, { id: "b2" }], error: null },
    });
    const n = await fetchMyOpenOffersCount(fake as any, "artist-1");
    expect(n).toBe(2);
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["artist_id", "artist-1"] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "suggested"] });
  });

  it("returns 0 when none", async () => {
    const fake = createFakeSupabase({ bookings: { data: [], error: null } });
    expect(await fetchMyOpenOffersCount(fake as any, "artist-1")).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node node_modules/.bin/vitest run src/data/bookings.test.ts`
Expected: FAIL — `fetchPendingConfirmationsCount is not a function`.

- [ ] **Step 3: Implement** (append to `src/data/bookings.ts`)

```ts
/** Count of bookings awaiting producer confirmation (soft_booked) in an org. */
export async function fetchPendingConfirmationsCount(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<number> {
  const { data, error } = await client
    .from("bookings")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "soft_booked");
  if (error) throw error;
  return (data ?? []).length;
}

/** Count of open offers (suggested) awaiting a given artist's response. */
export async function fetchMyOpenOffersCount(
  client: SupabaseClient<Database>,
  artistId: string,
): Promise<number> {
  const { data, error } = await client
    .from("bookings")
    .select("id")
    .eq("artist_id", artistId)
    .eq("status", "suggested");
  if (error) throw error;
  return (data ?? []).length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/.bin/vitest run src/data/bookings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/bookings.ts src/data/bookings.test.ts
git commit -m "feat: nav booking count data-access fns"
```

---

### Task 2: useNavCounts hook

**Files:**
- Create: `src/hooks/useNavCounts.ts`
- Test: `src/hooks/useNavCounts.test.ts`

**Interfaces:**
- Consumes: `fetchPendingConfirmationsCount`, `fetchMyOpenOffersCount` (Task 1); `useAuth` (`roles`, `currentOrg`, `hasRole`); `useMyArtist`.
- Produces: `useNavCounts(): { pendingConfirmations: number; openOffers: number }`

- [ ] **Step 1: Write the failing test** (`src/hooks/useNavCounts.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: vi.fn() }));
vi.mock("@/data/bookings", () => ({
  fetchPendingConfirmationsCount: vi.fn(),
  fetchMyOpenOffersCount: vi.fn(),
}));

import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { fetchPendingConfirmationsCount, fetchMyOpenOffersCount } from "@/data/bookings";
import { useNavCounts } from "./useNavCounts";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useNavCounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches pending confirmations for a producer with an org; no offers without an artist", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: (r: string) => r === "producer",
    } as any);
    vi.mocked(useMyArtist).mockReturnValue({ data: null } as any);
    vi.mocked(fetchPendingConfirmationsCount).mockResolvedValue(5);

    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pendingConfirmations).toBe(5));
    expect(fetchPendingConfirmationsCount).toHaveBeenCalledWith(expect.anything(), "org-1");
    expect(fetchMyOpenOffersCount).not.toHaveBeenCalled();
    expect(result.current.openOffers).toBe(0);
  });

  it("fetches open offers for an artist; no org-confirmations query", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: () => false,
    } as any);
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: "artist-1" } } as any);
    vi.mocked(fetchMyOpenOffersCount).mockResolvedValue(3);

    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.openOffers).toBe(3));
    expect(fetchMyOpenOffersCount).toHaveBeenCalledWith(expect.anything(), "artist-1");
    expect(fetchPendingConfirmationsCount).not.toHaveBeenCalled();
    expect(result.current.pendingConfirmations).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/.bin/vitest run src/hooks/useNavCounts.test.ts`
Expected: FAIL — cannot resolve `./useNavCounts`.

- [ ] **Step 3: Implement** (`src/hooks/useNavCounts.ts`)

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { fetchPendingConfirmationsCount, fetchMyOpenOffersCount } from "@/data/bookings";

/**
 * Real, role-specific counts for sidebar nav badges.
 * - pendingConfirmations: soft_booked bookings awaiting a producer/admin (current org).
 * - openOffers: suggested bookings awaiting the signed-in artist's response.
 * Both live under the ['bookings', ...] key domain so booking mutations refresh them.
 */
export function useNavCounts(): { pendingConfirmations: number; openOffers: number } {
  const { currentOrg, hasRole } = useAuth();
  const { data: artist } = useMyArtist();

  const orgId = currentOrg?.id ?? null;
  const canSeeOrgBookings = hasRole("admin") || hasRole("producer");
  const artistId = artist?.id ?? null;

  const pending = useQuery({
    queryKey: ["bookings", "nav-pending-confirmations", orgId],
    enabled: canSeeOrgBookings && !!orgId,
    queryFn: () => fetchPendingConfirmationsCount(supabase, orgId!),
  });

  const offers = useQuery({
    queryKey: ["bookings", "nav-open-offers", artistId],
    enabled: !!artistId,
    queryFn: () => fetchMyOpenOffersCount(supabase, artistId!),
  });

  return {
    pendingConfirmations: pending.data ?? 0,
    openOffers: offers.data ?? 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/.bin/vitest run src/hooks/useNavCounts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNavCounts.ts src/hooks/useNavCounts.test.ts
git commit -m "feat: useNavCounts hook for sidebar badges"
```

---

### Task 3: Sections + badge metadata in navItems

**Files:**
- Modify: `src/components/layout/navItems.ts`
- Test: `src/components/layout/navItems.test.ts`

**Interfaces:**
- Produces:
  - `NavSection = 'workspace' | 'catalog' | 'system'`
  - `NavItem` gains `section: NavSection` and optional `badge?: 'pendingConfirmations' | 'openOffers'`
  - `NavSectionGroup = { section: NavSection; label: string; items: NavItem[] }`
  - `groupNavBySections(items: NavItem[]): NavSectionGroup[]`

- [ ] **Step 1: Write the failing tests** (append to `src/components/layout/navItems.test.ts`)

```ts
import { groupNavBySections } from "./navItems";

describe("sections", () => {
  it("every nav item declares a section", () => {
    for (const i of NAV_ITEMS) expect(i.section).toBeTruthy();
  });

  it("an artist sees only the Workspace section", () => {
    const groups = groupNavBySections(visibleNavItems(NAV_ITEMS, ctx({ roles: ["artist"] })));
    expect(groups.map((g) => g.section)).toEqual(["workspace"]);
    expect(groups[0].items.map((i) => i.label)).toEqual(["Dashboard", "Availability", "Chats"]);
  });

  it("an admin sees workspace, catalog and system", () => {
    const groups = groupNavBySections(visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"] })));
    expect(groups.map((g) => g.section)).toEqual(["workspace", "catalog", "system"]);
  });

  it("drops empty sections", () => {
    const groups = groupNavBySections([]);
    expect(groups).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node node_modules/.bin/vitest run src/components/layout/navItems.test.ts`
Expected: FAIL — `groupNavBySections` is not exported / `section` undefined.

- [ ] **Step 3: Implement** — replace the contents of `src/components/layout/navItems.ts` with:

```ts
import { LayoutDashboard, BookOpen, Clock, Settings, Shield, MessageSquare, Users, Building2, Theater } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROUTES } from '@/config/app.config';

export type NavSection = 'workspace' | 'catalog' | 'system';
export type NavBadge = 'pendingConfirmations' | 'openOffers';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  section: NavSection;
  badge?: NavBadge;
  roles?: string[];
  superAdmin?: boolean;
}

export const SECTION_LABELS: Record<NavSection, string> = {
  workspace: 'Workspace',
  catalog: 'Catalog',
  system: 'System',
};

const SECTION_ORDER: NavSection[] = ['workspace', 'catalog', 'system'];

export const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.DASHBOARD, icon: LayoutDashboard, label: 'Dashboard', section: 'workspace' },
  { to: ROUTES.BOOKINGS, icon: BookOpen, label: 'Shows & Bookings', section: 'workspace', roles: ['admin', 'producer'], badge: 'pendingConfirmations' },
  { to: ROUTES.AVAILABILITY, icon: Clock, label: 'Availability', section: 'workspace', roles: ['artist'], badge: 'openOffers' },
  { to: ROUTES.CHATS, icon: MessageSquare, label: 'Chats', section: 'workspace' },
  { to: ROUTES.PRODUCTIONS, icon: Theater, label: 'Productions', section: 'catalog', roles: ['admin', 'producer'] },
  { to: ROUTES.ARTISTS, icon: Users, label: 'Artists', section: 'catalog', roles: ['admin', 'producer'] },
  { to: ROUTES.ADMIN, icon: Shield, label: 'Admin', section: 'system', roles: ['admin'] },
  { to: ROUTES.SETTINGS, icon: Settings, label: 'Settings', section: 'system', roles: ['admin', 'producer'] },
  { to: ROUTES.PLATFORM, icon: Building2, label: 'Platform', section: 'system', superAdmin: true },
];

export interface NavSectionGroup { section: NavSection; label: string; items: NavItem[]; }

/** Group already role-filtered items by section, in fixed order, dropping empty sections. */
export function groupNavBySections(items: NavItem[]): NavSectionGroup[] {
  return SECTION_ORDER
    .map((section) => ({ section, label: SECTION_LABELS[section], items: items.filter((i) => i.section === section) }))
    .filter((g) => g.items.length > 0);
}

/** Base nav visibility (before editor view-as styling). */
export function visibleNavItems(
  items: NavItem[],
  ctx: { isEditorMode: boolean; isRealAdmin: boolean; isSuperAdmin: boolean; hasRole: (r: string) => boolean },
): NavItem[] {
  if (ctx.isEditorMode && ctx.isRealAdmin) {
    return items.filter((i) => !i.superAdmin || ctx.isSuperAdmin);
  }
  return items.filter((item) => {
    if (item.superAdmin) return ctx.isSuperAdmin;
    if (!item.roles) return true;
    return item.roles.some((r) => ctx.hasRole(r));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/.bin/vitest run src/components/layout/navItems.test.ts`
Expected: PASS (existing tests + new section tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/navItems.ts src/components/layout/navItems.test.ts
git commit -m "feat: section + badge metadata and grouping for nav items"
```

---

### Task 4: AppLayout — wordmark, version pill, sectioned nav + badges

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

**Interfaces:**
- Consumes: `groupNavBySections`, `SECTION_LABELS` (Task 3); `useNavCounts` (Task 2).

- [ ] **Step 1: Add imports** — update the existing imports:

Change the navItems import line to:
```tsx
import { NAV_ITEMS, visibleNavItems, groupNavBySections, SECTION_LABELS } from '@/components/layout/navItems';
```
Add after the `useNotifications` import:
```tsx
import { useNavCounts } from '@/hooks/useNavCounts';
```

- [ ] **Step 2: Compute grouped nav + counts** — after the line `const filteredNav = visibleNavItems(...)` (≈ line 57), add:

```tsx
  const navCounts = useNavCounts();
  const navGroups = groupNavBySections(filteredNav);
```

- [ ] **Step 3: Replace the wordmark block** — replace the `{!collapsed && ( ... )}` block inside the logo `div` (≈ lines 72-81) with:

```tsx
        {!collapsed && (
          <div className="flex items-baseline gap-1.5 min-w-0">
            {/* ShowFlow product wordmark — two-tone is intentional brand styling */}
            <span className="font-display text-[15px] font-semibold tracking-[-0.02em] truncate">
              <span className="text-foreground">Show</span>
              <span className="text-primary">Flow</span>
            </span>
            <span className="shrink-0 rounded border border-border px-1 py-px font-mono text-[9px] font-medium tabular-nums text-muted-foreground">
              v{APP_META.VERSION}
            </span>
          </div>
        )}
```

- [ ] **Step 4: Replace the `<nav>` block** — replace the whole `<nav className="flex-1 ...">...</nav>` (≈ lines 90-129) with section-grouped rendering:

```tsx
      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {navGroups.map(group => (
          <div key={group.section} className="space-y-0.5">
            {!collapsed && (
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                {group.label}
              </p>
            )}
            {group.items.map(item => {
              const showWarningDot = item.to === ROUTES.SETTINGS && hasAnyWarning;
              const hiddenForRole = isHiddenForViewAs(item);
              const badgeCount = item.badge ? navCounts[item.badge] : 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] font-medium transition-colors',
                      hiddenForRole ? 'opacity-40' : '',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                        : 'text-sidebar-foreground/70 hover:bg-foreground/[0.04] hover:text-sidebar-foreground'
                    )
                  }
                >
                  <span className="relative shrink-0">
                    <item.icon className="h-[14px] w-[14px]" />
                    {showWarningDot && (
                      <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-destructive ring-2 ring-background" />
                    )}
                    {collapsed && badgeCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-background" />
                    )}
                    {hiddenForRole && !collapsed && (
                      <EyeOff className="absolute -bottom-1 -right-1 h-2.5 w-2.5 text-muted-foreground" />
                    )}
                  </span>
                  {!collapsed && (
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="truncate">{item.label}</span>
                      {badgeCount > 0 && (
                        <span className="ml-auto shrink-0 rounded-full bg-sidebar-accent px-1.5 py-px text-[10px] font-semibold tabular-nums text-sidebar-accent-foreground">
                          {badgeCount}
                        </span>
                      )}
                      {showWarningDot && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                      )}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
```

- [ ] **Step 5: Typecheck + run nav/hook tests**

Run: `export PATH="/Users/stefanschaal/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" && node node_modules/.bin/tsc --noEmit && node node_modules/.bin/vitest run src/components/layout/navItems.test.ts src/hooks/useNavCounts.test.ts`
Expected: typecheck clean; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/AppLayout.tsx
git commit -m "feat: sectioned sidebar nav with wordmark, version pill, badges"
```

---

### Task 5: AppLayout — bottom profile card

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

**Interfaces:**
- Consumes: `useMyProfile` (display_name); `useAuth` (`roles`, `currentOrg`, `isSuperAdmin`); existing `handleSignOut`.

- [ ] **Step 1: Add imports + profile data** — add import:
```tsx
import { useMyProfile } from '@/hooks/useMyProfile';
```
Add a controlled-popover state near the other `useState`s:
```tsx
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
```
After `const { data: notifications = [] } = useNotifications();` add:
```tsx
  const { currentOrg } = useAuth(); // already destructured above — extend the existing useAuth destructure instead of re-calling
  const { data: myProfile } = useMyProfile();
```
> NOTE: `currentOrg` and `isSuperAdmin` must be added to the EXISTING `const { ... } = useAuth();` destructure at the top of the component (do not call `useAuth()` twice). The existing destructure already includes `isSuperAdmin`; add `currentOrg`.

- [ ] **Step 2: Compute display fields** — add near the other derived consts:

```tsx
  const displayName = (myProfile?.display_name?.trim() || user?.email?.split('@')[0] || 'Account');
  const initials = displayName.slice(0, 2).toUpperCase();
  const primaryRole = roles[0];
  const roleLabel = primaryRole
    ? primaryRole[0].toUpperCase() + primaryRole.slice(1)
    : (isSuperAdmin ? 'Super Admin' : 'No role');
  const profileSubtitle = currentOrg ? `${roleLabel} · ${currentOrg.name}` : roleLabel;
```

- [ ] **Step 3: Replace the user section** — replace the whole `{/* User section */}` block (the `<div className="border-t-[0.5px] border-sidebar-border px-2 py-3 space-y-1">...</div>`, ≈ lines 132-179) with:

```tsx
      {/* User / profile card */}
      <div className="border-t-[0.5px] border-sidebar-border p-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback seed={user?.email ?? ''}>{initials}</AvatarFallback>
            </Avatar>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-sidebar-foreground/70"
              onClick={() => navigate(ROUTES.PROFILE)}
              aria-label="Profile"
            >
              <Settings className="h-[14px] w-[14px]" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-sidebar-foreground/70"
              onClick={handleSignOut}
              aria-label="Sign out"
            >
              <LogOut className="h-[14px] w-[14px]" />
            </Button>
          </div>
        ) : (
          <div className="rounded-[10px] border border-sidebar-border bg-background/70 px-2.5 py-2 shadow-sm">
            <div className="flex items-center gap-2.5">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback seed={user?.email ?? ''}>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold leading-tight truncate">{displayName}</p>
                <p className="text-[10.5px] text-muted-foreground leading-tight truncate">{profileSubtitle}</p>
              </div>
              <Popover open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground" aria-label="Account menu">
                    <Settings className="h-[15px] w-[15px]" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" side="top" sideOffset={8} className="w-44 p-1">
                  <button
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-foreground hover:bg-foreground/[0.05] transition-colors"
                    onClick={() => { setProfileMenuOpen(false); navigate(ROUTES.PROFILE); }}
                  >
                    <User className="h-[14px] w-[14px]" /> Profile
                  </button>
                  <button
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-foreground hover:bg-foreground/[0.05] transition-colors"
                    onClick={() => { setProfileMenuOpen(false); handleSignOut(); }}
                  >
                    <LogOut className="h-[14px] w-[14px]" /> Sign out
                  </button>
                </PopoverContent>
              </Popover>
            </div>
            {viewAsRole && isEditorMode && !viewAsUser && (
              <Badge variant="outline" className="mt-2 border-warning text-warning">
                Viewing as: {viewAsRole}
              </Badge>
            )}
            {viewAsUser && isEditorMode && (
              <div className="mt-2 space-y-0.5">
                <Badge variant="outline" className="border-warning text-warning">
                  Viewing as: {viewAsUser.roles.join(', ') || 'no role'}
                </Badge>
                <p className="text-[10px] font-mono text-warning truncate">{viewAsUser.email}</p>
              </div>
            )}
          </div>
        )}
      </div>
```

- [ ] **Step 4: Typecheck + full unit run**

Run: `export PATH="/Users/stefanschaal/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" && node node_modules/.bin/tsc --noEmit && node node_modules/.bin/vitest run`
Expected: typecheck clean; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppLayout.tsx
git commit -m "feat: boxed sidebar profile card with account menu"
```

---

### Task 6: Mobile topbar wordmark parity

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Update the mobile header wordmark** — in the `lg:hidden flex items-center gap-2` block (≈ lines 227-231), replace the `<span>{APP_META.NAME}</span>` + version `<span>` with:

```tsx
            <span className="font-display font-semibold text-[15px] tracking-[-0.02em]">
              <span className="text-foreground">Show</span><span className="text-primary">Flow</span>
            </span>
            <span className="rounded border border-border px-1 py-px font-mono text-[9px] font-medium tabular-nums text-muted-foreground">
              v{APP_META.VERSION}
            </span>
```

- [ ] **Step 2: Lint + build**

Run: `export PATH="/Users/stefanschaal/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" && node node_modules/.bin/eslint src/components/layout/AppLayout.tsx && node node_modules/.bin/vite build`
Expected: lint clean; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppLayout.tsx
git commit -m "feat: two-tone wordmark in mobile topbar"
```

---

### Task 7: Manual verification

- [ ] Start dev server: `export PATH="/Users/stefanschaal/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" && node node_modules/.bin/vite` (port 8080).
- [ ] Open `http://localhost:8080/` in the browser and sign in (or use an existing session).
- [ ] Screenshot the sidebar and confirm: two-tone wordmark + version pill; WORKSPACE/CATALOG/SYSTEM headers; active-row tint; profile card with name/role·org and a working gear menu (Profile, Sign out).
- [ ] If signed in as admin/producer, confirm the Shows & Bookings badge matches the count of soft_booked bookings; as an artist, confirm the Availability badge matches open offers (or no badge when zero).
- [ ] Toggle collapse and confirm sections/labels/badges degrade to icons + dots and the avatar/menu remain reachable.

## Self-Review

- **Spec coverage:** wordmark+pill (T4/T6), sections (T3/T4), real badges (T1/T2/T4), profile card (T5), preserved features (T4/T5 keep collapse/OrgSwitcher/bell/editor) — all covered.
- **Placeholder scan:** none.
- **Type consistency:** `fetchPendingConfirmationsCount`/`fetchMyOpenOffersCount` names match across T1/T2; `groupNavBySections`/`SECTION_LABELS`/`NavBadge` match across T3/T4; `navCounts[item.badge]` keys (`pendingConfirmations`/`openOffers`) match the hook's return shape and the `NavBadge` union.
