# Editor mode org selector + changelog link on the version pill

**Date:** 2026-08-06
**Branch:** `claude/editor-org-selector-changelog-f3ab0b`
**Target version:** 1.14.0

Two independent, small changes:

1. Editor mode gains a third scoping selector that re-scopes the app to another organization.
2. The version pill in the brand wordmark becomes a link that opens the public changelog in a new tab.

They ship together because both are one-file UI changes in the app shell.

---

## 1. Org selector in the editor toolbar

### Problem

`EditorToolbar` already carries two scoping selectors, "Viewing as" (role) and "as user"
(impersonation). The editor's configs are per-org: `EditorContext` reads
`app_settings` under `['app-settings', 'editor', orgId]` and custom field definitions
under `['custom-field-definitions', orgId]`. But there is no way to change the org from
inside editor mode, so configuring a second org means leaving the toolbar, using the
sidebar `OrgSwitcher`, and re-entering. For a super-admin, who sees every org via
`effectiveOrgs`, that is the common case rather than the exception.

### Decision: the selector re-scopes the whole app

Selecting an org calls `switchOrg`, exactly as the sidebar switcher does. Data, editor
config, custom fields and the impersonation user list all move to the chosen org
together.

The alternative, re-targeting only the editor's config reads and writes while the app
keeps rendering the current org's data, was rejected: it produces a misleading preview
(org X's column template drawn over org Y's rows, resolved against org Y's custom field
definitions), which is the opposite of what a WYSIWYG editor is for.

### Placement and shape

A third `Select` **inline in `src/features/editor/EditorToolbar.tsx`**, before the
"Viewing as" group, so the toolbar reads org, then role, then user, outermost scope
first.

Inline rather than extracted to its own component file. The two sibling selectors are
inline; extracting only the third would leave the toolbar with two inline controls and
one imported, which is less coherent than either extreme. The file goes from 184 to
roughly 210 lines, which is not a file doing too much, and the control is testable
through the toolbar with `renderWithProviders` (see Testing).

It uses the shadcn `Select` primitive, not the `Popover` the sidebar switcher uses, so
it matches the controls beside it.

### Behavior

- Reads `orgs`, `currentOrg`, `switchOrg` from the `useAuth()` call the toolbar already
  makes.
- Renders nothing when `orgs.length <= 1`, matching `OrgSwitcher`. Single-org admins see
  no change.
- Sits in the same `flex items-center gap-2 shrink-0` group the siblings use, introduced
  by a `Building2` icon (the sidebar switcher's icon) and the label `Org:`, with a
  `SelectTrigger` of `h-7 w-44 text-xs`.
- Value is `currentOrg?.id`. Options are `orgs`, each labelled `o.name`, with a
  ` (suspended)` suffix when `o.status === 'suspended'` (as the sidebar does). Switching
  into a suspended org drops a non-super-admin onto `SuspendedOrgScreen`; the suffix is
  the warning.
- On change, when the value actually differs from the current org: clear the
  impersonated user, then switch.

  ```ts
  onValueChange={(v) => {
    if (v === currentOrg?.id) return;
    setViewAsUser(null);
    switchOrg(v);
  }}
  ```

  Clearing `viewAsUser` is required, not cosmetic: that user belongs to the previous org,
  and the `admin-list-users` query is keyed by `currentOrg?.id`, so leaving it set
  strands a cross-org identity that no longer appears in its own dropdown. `viewAsRole`
  is one of `admin | producer | artist` and carries no org, so it persists across the
  switch.

### What does not change

`EditorContext` needs no edit. Its queries are already keyed by `orgId`, and `switchOrg`
calls `queryClient.invalidateQueries()`, so the whole editor re-reads the new org on its
own.

---

## 2. Editor access gate

### Problem this fixes

Four sites gate editor mode on `roles.includes('admin')`:

| Site | Line |
|---|---|
| `EditorProvider` (`isRealAdmin`) | `src/features/editor/EditorContext.tsx:52` |
| `EditorToolbar` | `src/features/editor/EditorToolbar.tsx:41` |
| `EditorModeToggle` | `src/features/editor/EditorToolbar.tsx:162` |
| `AppLayout` (toggle, toolbar, page badge) | `src/components/layout/AppLayout.tsx:346,377,381` |

`roles` comes from `rolesForOrg(memberships, currentOrg.id)`, which is membership-only.
A super-admin who switches into an org they are not a member of gets `roles === []`, so
the entire editor disappears, including the pencil that would let them back in. The org
selector in part 1 makes that reachable in one click, so it has to be fixed in the same
change.

### Decision

A single pure predicate, `src/features/editor/editorAccess.ts`:

```ts
import type { AppRole } from '@/config/app.config';

/**
 * Who may use editor mode: an admin of the active org, or a super-admin, including in
 * an org they hold no membership in. `roles` is membership-scoped, so a super-admin
 * viewing a non-member org has none, and would otherwise lose the toolbar entirely.
 */
export function canUseEditor(roles: readonly AppRole[], isSuperAdmin: boolean): boolean {
  return isSuperAdmin || roles.includes('admin');
}
```

Applied at all four sites, including as the `enabled` condition on the toolbar's
`admin-list-users` query.

In `AppLayout` this is a **new** `canEditor` const, not a widening of the existing
`isRealAdmin`. That same `isRealAdmin` is passed to `visibleNavItems`, which already
receives `isSuperAdmin` separately and handles god-mode its own way; widening it would
silently change navigation visibility. Only lines 346, 377 and 381 switch to `canEditor`.

### Server side is already symmetric

No migration or RLS work. `is_org_member` and `has_org_role` both return true for a
super-admin on any org, and `app_settings` is deliberately excluded from the
`x-active-org` narrowing added in `20260806104215_active_org_scoping.sql` (it also holds
the `org_id IS NULL` platform defaults). A super-admin's editor writes against another
org therefore land.

---

## 3. Version pill opens the changelog

### Target

`https://showflow.pro/changelog`, the marketing site's changelog page. Verified live: it
renders a real page titled "ShowFlow · Changelog" with content current through 1.13.0.
This keeps one canonical public changelog rather than adding a second in-app rendering of
the same source.

### Changes

`src/config/app.config.ts`, below `APP_META`:

```ts
/** Public changelog on the marketing site, opened from the version pill. */
export const CHANGELOG_URL = `${APP_META.MARKETING_URL}/changelog`;
```

Derived from the existing `MARKETING_URL` constant, so no new hardcoded host.

`src/components/brand/BrandWordmark.tsx:17`: the pill `<span>` becomes an `<a>` with the
same classes plus a hover affordance.

- `href={CHANGELOG_URL}`, `target="_blank"`, `rel="noopener noreferrer"`.
- An `aria-label` of ``View changelog (version ${APP_META.VERSION})`` — the visible text
  is only `v1.13.0`, which does not say where the link goes.
- `title="What's new in ShowFlow"`. A plain `title` rather than a shadcn `Tooltip`,
  because `BrandWordmark` renders in the mobile topbar as well and should not depend on a
  `TooltipProvider` being above it.
- Hover: `hover:text-foreground hover:border-foreground/30 transition-colors`.

Both call sites, `AppLayout.tsx:102` (desktop sidebar) and `AppLayout.tsx:317` (mobile
topbar), are plain `<div>`s, so there is no nested-anchor problem.

---

## Testing

Test-first, per `CLAUDE.md`.

| File | Covers |
|---|---|
| `src/features/editor/editorAccess.test.ts` | `canUseEditor` truth table: org admin, super-admin with no memberships, both, producer, artist, empty roles |
| `src/features/editor/EditorToolbar.test.tsx` (new) | org select hidden at one org; lists every org with the suspended suffix; selecting an org calls `switchOrg` **and** `setViewAsUser(null)`; re-selecting the current org is a no-op; toolbar renders for a super-admin whose `roles` are empty |
| `src/components/brand/BrandWordmark.test.tsx` (new) | pill is a link to `CHANGELOG_URL`, `target="_blank"`, `rel` contains `noopener`, label carries `APP_META.VERSION` |

`EditorToolbar.test.tsx` renders the real toolbar with `renderWithProviders` (which
supplies the `QueryClientProvider`), mocks `useAuth` with `partialMock` as
`OrgSwitcher.test.tsx` does, and stubs the `admin-list-users` edge call through the
`supabaseFake` client, the pattern already used in `NewOrderWizard.test.tsx`.

No existing test covers `EditorToolbar`, `EditorContext`'s gate or `AppLayout`, so
nothing regresses.

## Release

User-facing, so version 1.14.0 (new features): bump `package.json` and
`APP_META.VERSION`, add a newest-first `## 1.14.0 — August 6, 2026` block to
`public/changelog.md`, then regenerate the JSON with
`deno run --allow-read --allow-write scripts/changelog-to-json.ts`.

The changelog covers the org selector (a multi-org admin feature) and the changelog link.
The access-gate fix is not mentioned: it is only observable to super-admins, and
`CLAUDE.md` forbids super-admin and platform-admin material in the public changelog.

Also add `editorAccess.ts` to the `src/features/editor/` entry in `CLAUDE.md`'s
architecture map.

## Out of scope

- Copying editor config from one org to another.
- An in-app changelog page or route.
- The general `roles` vs. super-admin asymmetry anywhere outside editor mode.
