# Sidebar restyle — design

**Date:** 2026-06-26
**Status:** Approved (brainstorming)

## Goal

Apply the layout/design from the provided mock to the existing app sidebar. The
mock introduces: a two-tone wordmark + version pill, section-grouped nav,
right-aligned count badges on rows, and a boxed bottom profile card.

This is a **visual/structural restyle of the existing navigation** — every row
links to a real route, every badge reads real data. No new pages, no fabricated
numbers. The colour palette is untouched: `index.css` already carries the warm
beige background (`#F6F4EF`), violet accent (`#6E5CF6`), and the active-row tint
(accent-100 bg / accent-700 text) the mock uses, and `StageMark` is the same
proscenium-arch mark.

## Decisions (from brainstorming)

- **Nav content:** restyle the real nav (not a literal copy of the mock's
  Today/Routing/Pipeline/Venues/Agents/Settlements/Holds labels, which have no
  routes).
- **Sections:** `WORKSPACE / CATALOG / SYSTEM`.
- **Badges:** build *real* counts for the two rows that have a genuine
  action-needed source; no badge elsewhere.

## Components & changes

### 1. Wordmark + version pill (`AppLayout.tsx`)
Render `Show` (`text-foreground`) + `Flow` (`text-primary`). Version becomes a
bordered monospace pill showing the real `APP_META.VERSION` (`v1.6.0`). Applied
in both the desktop sidebar header and the mobile topbar.

### 2. Sectioned nav (`navItems.ts`, `AppLayout.tsx`)
Extend `NavItem` with `section: 'workspace' | 'catalog' | 'system'` and an
optional `badge: 'pendingConfirmations' | 'openOffers'` key. Grouping:

| Section | Items |
|---|---|
| WORKSPACE | Dashboard, Shows & Bookings, Availability, Chats |
| CATALOG | Productions, Artists |
| SYSTEM | Admin, Settings, Platform |

A pure helper groups the already role-filtered items by section, preserving
declared order. **A section with zero visible items is not rendered** (an artist
sees only WORKSPACE → Dashboard, Availability, Chats). Section header: uppercase,
`text-muted-foreground`, letter-spaced, small. Hidden when the sidebar is
collapsed. Active-row styling unchanged. `navItems.test.ts` extended to assert
each item's section and that grouping drops empty sections per role.

### 3. Real count badges
New data-access fns in `src/data/bookings.ts` (TDD against `supabaseFake.ts`):

- `fetchPendingConfirmationsCount(client, orgId)` →
  `bookings` where `org_id = orgId AND status = 'soft_booked'`
  (`count: 'exact', head: true`). Rows awaiting producer confirmation.
- `fetchMyOpenOffersCount(client, artistId)` →
  `bookings` where `artist_id = artistId AND status = 'suggested'`.
  Open offers awaiting the artist's response.

A `useNavCounts()` hook returns `{ pendingConfirmations, openOffers }`:
- `pendingConfirmations` query enabled only for admin/producer with a current
  org; keyed `['bookings','nav-pending-confirmations',orgId]`.
- `openOffers` query enabled only when `useMyArtist()` resolves; keyed
  `['bookings','nav-open-offers',artistId]`.

Both live under the `['bookings', …]` domain so existing booking mutations'
`invalidateQueries(['bookings'])` refresh them automatically (per CLAUDE.md
invalidation rule). AppLayout maps each nav item's `badge` key to the count and
renders a right-aligned pill **only when count > 0**. Settings keeps its existing
warning **dot** (separate `useSettingsWarnings` boolean — unchanged).

### 4. Bottom profile card (`AppLayout.tsx`)
Boxed card (elevated surface, rounded, `border-sidebar-border`):
- Avatar initials, display name (`useMyProfile().display_name` → fallback to
  email prefix), secondary line `{Role} · {currentOrg.name}` (super-admin with no
  org → "Super Admin").
- A gear icon button opens a popover menu: **Profile** (→ `ROUTES.PROFILE`) and
  **Sign out** (existing `handleSignOut`). No functionality lost vs. today's
  Profile / Sign Out buttons.
- Editor "Viewing as…" badges preserved in/under the card when in editor mode.
- Collapsed sidebar: card degrades to the centred avatar; gear menu still
  reachable.

### 5. Preserved unchanged
Collapse toggle (labels/section headers/badges degrade to icons + dots when
collapsed), `OrgSwitcher` below the logo, notification bell + breadcrumb in the
topbar, editor toolbar, route/role gating.

## Testing
- Unit: `fetchPendingConfirmationsCount` / `fetchMyOpenOffersCount`
  (supabaseFake), `useNavCounts` enable/disable + projection, section grouping
  helper + extended `navItems.test.ts`.
- Manual: run the app, screenshot the sidebar for artist vs admin/producer vs
  super-admin, and collapsed state.

## Out of scope
New routes/pages; renaming nav items; chats unread (no per-user read model);
palette/token changes.
