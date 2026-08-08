# Admin People pane — converge Invites + Members

*Design — 2026-08-08*

## Problem

The Admin panel (`src/pages/AdminPage.tsx`) exposes org identity management as two
separate tabs, **Invites** (`InvitesTab`) and **Members** (`MembersTab`). Managing a
team means bouncing between them: you invite someone in one tab, then switch to the
other to see who is already in the org, and there is no single place to answer "who
is in this org, and who has an invite outstanding?". The two surfaces also don't talk
to each other — you can send an invite to an address that is already a member without
any warning.

## Goal

Converge the two tabs into one **People** pane: an invite control on top and a single
searchable directory below, so a producer/admin manages the whole team from one
surface. Audit Log and Sync Status tabs are untouched.

Best-in-class details the pane must hit:

- One search field spans **both** pending invites and active members.
- Every result row carries an explicit **state label** (`Pending` / `Active`).
- The invite bar **detects duplicates live**: typing an address that is already a
  member or already invited surfaces that state inline instead of letting you send a
  dead invite.

## Non-goals

- No backend, RPC, RLS, edge-function, or entitlement changes. This is a pure
  frontend convergence over existing data-access functions and hooks.
- No changes to the Audit Log or Sync Status tabs.
- No change to how invites are accepted or how membership is stored.

## Layout

Inside AdminPage the `invites` and `members` tabs are replaced by a single **People**
tab (`value="people"`). Order top-to-bottom within the pane:

1. **Invite bar** — inline `email + role + Invite`, plus a secondary **Bulk invite**
   button that opens a modal.
2. **Search field** — one input; filters both sections below.
3. **Pending section** — pending invite rows. Hidden entirely when there are no
   pending invites and no active search. Under an active search, hidden when it has
   zero matches.
4. **Members section** — member rows.

Each row shows a small **state pill** beside the existing role badges:

- Pending invite row → `Pending` (amber/warning styling via semantic token).
- Member row → `Active`.

Sections are visually distinct (own headers), but the shared search + per-row state
label keep it legible as one directory.

### Tab routing

The tab is named **People**. `AdminPage` currently persists the active tab via
`?tab=` search param with default `invites`. New default becomes `people`. For
backward-compatible deep links, `?tab=invites` and `?tab=members` both resolve to the
People pane (normalize on read).

## Invite bar + live duplicate detection

As a **valid** email is typed into the bar, it is matched case-insensitively against
the current members' emails and pending invites' emails:

- **Already a member** → inline hint under the field ("Already a member"), Invite
  button disabled.
- **Already invited (pending)** → inline hint ("Already invited") with an inline
  **Resend** action (reuses `resendInvitation`) in place of a live Invite button.
- **No match** → normal Invite enabled.

Matching is only performed once the address passes the same email regex the current
`InvitesTab` uses, to avoid flicker while typing.

### Bulk invite modal

- A textarea; addresses are split on comma / newline / whitespace.
- A single **role** select applied to the whole batch (per-email role is a non-goal).
- On submit, each parsed address is classified: `invalid`, `member` (dupe),
  `pending` (dupe), or `ok`. A compact per-address result list shows the skips.
- The `ok` addresses are sent via `createInvitation` (looped — the edge function is
  one invite per call). A summary toast reports counts, e.g.
  "3 invited · 1 skipped (already a member) · 1 skipped (invalid)".
- On completion invalidate `['org-invitations']` and close the modal.

## Search behavior

- One controlled query string.
- Members match on `display_name` + `email`; pending invites match on `email`.
- A section with zero matches hides its header. If both are empty under a non-empty
  query, one empty state renders: "No people match '<query>'".
- Clearing the query restores both full sections (Pending still subject to the
  "hide when no pending invites" rule).

## Components & files

New, under `src/components/admin/people/`:

- `PeopleTab.tsx` — orchestrator. Owns the two queries (`org-invitations`,
  `useOrgMembers`), the search state, and composes the bar + both sections.
- `InviteBar.tsx` — inline invite with live duplicate detection; hosts the Bulk
  invite trigger.
- `BulkInviteDialog.tsx` — the bulk modal.
- `MemberRow.tsx` — one member row (role popover + remove dialog), lifted from
  `MembersTab`.
- `InviteRow.tsx` — one pending-invite row (copy link / resend / revoke), lifted
  from `InvitesTab`.

Pure helpers (co-located `*.test.ts`, written test-first):

- `peopleMatch.ts`
  - `matchContact(email, members, invites): 'member' | 'pending' | 'none'`
  - `filterPeople(query, members, invites): { members, invites }`
  - `parseEmails(text): string[]` (split + trim + dedupe, drop empties)
  - `isValidEmail(email): boolean` (the shared regex, extracted once)

Reused unchanged:

- Hooks: `useOrgMembers`, `useRemoveOrgMember`, `useSetOrgMemberRole`.
- Data: `fetchOrgInvitations`, `createInvitation`, `revokeInvitation`,
  `resendInvitation`, `acceptInviteUrl`.

Removed once folded in: `src/components/admin/InvitesTab.tsx`,
`src/components/admin/MembersTab.tsx`.

## Testing

Follows the repo's test-first rule and five-layer model (unit/hook layer here).

- **Pure helpers** — direct unit tests for `matchContact` (member vs pending vs none,
  case-insensitivity), `filterPeople` (name + email match, empty query passthrough),
  `parseEmails` (separators, dedupe, empties), `isValidEmail`.
- **MemberRow** — rebase the existing `MembersTab.test.tsx` coverage (role add/remove,
  remove-member dialog, self-row "You" guard) onto `MemberRow`, rendered with
  `renderWithProviders` + `fixtures`.
- **InviteBar** — duplicate-detection states (member → disabled + hint; pending →
  resend affordance; none → enabled), rendered with the harness.
- No new data-access functions, so no `supabaseFake` additions beyond existing
  fixtures.

## Risks / edge cases

- **Null member email** — `OrgMember.email` is nullable; matching and search must
  null-guard (`display_name` fallback already used for the label).
- **Deep-link `?tab=invites|members`** — normalized to `people` so old links and the
  `NotificationsList`/sidebar entry points (if any) don't 404 the tab.
- **Bulk send partial failure** — a mid-batch `createInvitation` rejection must not
  abort the rest; collect per-address outcomes and report in the summary toast.

## Changelog

User-facing, so `public/changelog.md` gets an `### Improved` bullet under the current
version (e.g. "**People pane** — invites and members are now one searchable directory
with live duplicate detection"), then regenerate `public/changelog.json` via the deno
script. Per convention, no super-admin/platform wording.
