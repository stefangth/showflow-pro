# Task 5 Report: Coverage Registry and Settings Surface

## Status

DONE_WITH_CONCERNS

## Delivered

- Added the ordered `EMAIL_TEMPLATE_COVERAGE` registry for the ten live delivery
  templates plus the external Supabase Auth password-reset message. It includes
  the approved display name, group, family, trigger, recipient, status, and
  category metadata.
- The nine customer templates are editable in metadata. Password reset remains
  external. `cron-health-alert` remains internal, is shown only to super-admins,
  has no preview or edit action, and is not included in frontend editor metadata.
- Added Settings > Automation > Email templates. The grouped surface previews
  only editable templates with the org's saved `email_copy` and `email_theme`,
  rendered inside a sandboxed iframe. Preview stays disabled until those saved
  settings load.
- Removed the obsolete `EmailTemplatesCard` from Booking Flow while preserving
  the Resend from-address input. `email_template_overrides` is no longer a
  Settings-page draft key or Booking Flow audit key.
- No editor route or editor navigation was added. That remains Task 8.

## TDD evidence

### Coverage metadata

RED:

```text
npx vitest run src/lib/emailTemplates/coverage.test.ts
FAIL: Failed to resolve import "./coverage"
```

GREEN after implementing the hand-authored inventory:

```text
src/lib/emailTemplates/coverage.test.ts (4 tests) passed
```

The contract covers ordered live keys, all nine editable customer templates,
external password reset, internal cron health, and category reuse from
`EMAIL_TEMPLATE_CATEGORY` where the opt-out mapping exists.

### Grouped settings IA

RED before the TSX changes:

```text
BookingFlowTab: expected no Email Templates card, but found it
SettingsPage: Unable to find role="tab" and name `/email templates/i`
EmailTemplatesTab: failed to resolve the production module because it did not exist
```

GREEN after adding the tab and moving the IA:

```text
5 files passed, 35 tests passed
```

An additional RED/GREEN cycle proved the external password-reset row and the
internal cron-health row expose neither preview nor edit controls. A separate
RED/GREEN cycle proved preview remains disabled until effective saved
copy/theme data has loaded.

## Verification

- Focused affected suite: `npx vitest run src/lib/emailTemplates/coverage.test.ts src/components/settings/emailTemplates/EmailTemplatesTab.test.tsx src/components/settings/bookingFlow/BookingFlowTab.test.tsx src/pages/SettingsPage.test.tsx src/lib/notificationCategories.test.ts` — pass, 35 tests.
- `npx tsc -p tsconfig.app.json --noEmit` — pass.
- `npx tsc -p tsconfig.tools.json --noEmit` — pass.
- `npm run lint` — pass, zero warnings.
- `npm run sync:mirrors:check` — pass, all mirrors in sync.
- `git diff --check` — pass.
- A complete `npx vitest run` was attempted. It fails on a pre-existing Task 4
  regression at the assigned base: `src/lib/emailTemplates/emailCopy.test.ts`
  rejects the base value `artist-confirmation-digest.subjectUpdates: "Your booking updates — ShowFlow"`.
  The source is already present at `b87f510dde6110fb9e366814759591a8297143d2`
  (`git show <base>:src/lib/emailTemplates/emailCopy.ts`, line 66). No Task 5
  file caused or changes that failure.

## React checklist

- No nested component definitions were added.
- Group visibility and read-only helper copy are derived during render; no
  derived-state effect was introduced.
- Conditional branches use explicit ternaries for rows, actions, loading, and
  iframe states.
- The only data dependency is one React Query request for saved presentation
  settings, so there is no avoidable waterfall.
- New app imports use direct project module paths; no new package barrel import
  was introduced.

## Self-review and concerns

- The registry is deliberately independent from renderer implementation details
  for trigger/recipient truthfulness, while opt-out categories reuse the shared
  notification model.
- Internal and external rows cannot invoke a nonexistent/manual preview path.
- App-surface classes use semantic tokens only.
- The only concern is the documented full-suite baseline failure above. The
  owner explicitly directed that it remain outside this Task 5 commit.
