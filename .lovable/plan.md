

## Plan: Restore Artists page with role-based access

The Artists page was deleted but should be restored with access restricted to producers and admins only. Artists should not see this page in navigation or be able to access it.

### 1. Restore ArtistsPage component

Recreate `src/pages/ArtistsPage.tsx` from git history (commit 1f84f85). The page includes:
- Artist roster management (list/calendar views)
- Add Artist dialog (admin only)
- Cast management section
- Filters for program, timeframe, sort
- Booking display per artist

### 2. Update route configuration

In `src/App.tsx`:
- Change line 38 from `<Route path="/artists" element={<Navigate to={ROUTES.BOOKINGS} replace />} />` 
- To: `<Route path="/artists" element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><ArtistsPage /></AppLayout></ProtectedRoute>} />`
- Add import for `ArtistsPage`

### 3. Add navigation item with role gating

In `src/components/layout/AppLayout.tsx`:
- Add to `navItems` array: `{ to: '/artists', icon: Users, label: 'Artists', roles: ['admin', 'producer'] as string[] }`
- Add `Users` icon import from lucide-react

### 4. Update Settings page link

In `src/pages/SettingsPage.tsx` line 220:
- Change `<a className="text-primary underline" href="/artists">Artists page</a>`
- To use proper routing or keep as-is since the route will now exist

### 5. Add ROUTES constant (optional)

In `src/config/app.config.ts`:
- Add `ARTISTS: '/artists'` to ROUTES if needed for consistency

