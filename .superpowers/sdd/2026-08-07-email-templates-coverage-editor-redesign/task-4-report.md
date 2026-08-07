# Task 4 Report: Shared Send and Preview Presentation Resolution

## Outcome

Implemented a single registry presentation resolver used by both transactional-email delivery and preview. It resolves the subject and injects complete copy, theme, family, and optional highlight-role props into the real React Email component.

- `send-transactional-email` remains service-role-only. Its existing fail-closed suppression/logging behavior, preference gate, attachment validation, idempotency header, unsubscribe token handling, and send logging are unchanged.
- `preview-transactional-email` remains admin/producer read-only and now accepts `copyOverride`, `themeOverride`, and `highlightRole`. The legacy `overrides` payload remains supported, with the documented flattened `copyOverride` taking precedence.
- Send reads `email_copy`, `email_theme`, and the legacy `email_template_overrides`. A missing `email_copy` resolves from legacy; a stored `{}` intentionally suppresses that fallback.
- The frontend data layer exposes `fetchEmailTemplateSettings(client, orgId)` with the same distinction.

## TDD evidence

### Frontend data access

RED: `npx vitest run src/data/emailTemplates.test.ts` failed before implementation because `./emailTemplates` did not exist.

GREEN: the same command passed `4/4` tests after adding the three setting reads. The tests cover new-copy precedence, legacy backfill only when new copy is absent, persisted `{}` suppressing legacy, and absent theme resolving to `{}`.

### Edge handlers

RED (pinned Deno 2.1.14):

```text
npx --yes deno@2.1.14 test --no-lock --no-check --allow-all --node-modules-dir=none \
  supabase/functions/send-transactional-email/index.di.test.ts \
  supabase/functions/preview-transactional-email/index.di.test.ts

FAILED | 70 passed | 3 failed
```

The failures were the intended missing behaviors: preview returned its default subject instead of the supplied `copyOverride`; send returned its default subject instead of `email_copy`; and send still used the legacy subject after a stored new-copy `{}`.

GREEN: after routing both handlers through `resolveTemplatePresentation`, the focused DI command passed `73/73`.

## Verification

- `npx vitest run src/data/emailTemplates.test.ts` — pass, `4/4`.
- `npx vitest run` — pass, `292` files / `2,232` tests.
- `npx tsc -p tsconfig.app.json --noEmit` — pass.
- `npx tsc -p tsconfig.tools.json --noEmit` — pass.
- `npm run lint` — pass, zero warnings.
- `npm run sync:mirrors:check` — pass, all mirrors in sync.
- `git diff --check` — pass.
- Focused email edge and template suites — pass, `132/132`.
- Whole Edge suite (pinned Deno with `--no-lock --no-check --allow-all --node-modules-dir=none`) — `1,021` passed, `2` unrelated failures: existing hire-order PDF golden hash checks for `countersigned-aggregate` and `single-date-preview`. No hire-order files were changed.

Final explicit Deno check was run without `--no-check`:

```text
npx --yes deno@2.1.14 check --no-lock --node-modules-dir=none \
  supabase/functions/send-transactional-email/index.ts \
  supabase/functions/preview-transactional-email/index.ts \
  supabase/functions/_shared/transactional-email-templates/registry.ts
```

It is blocked before checking this task's modules by `133` pre-existing Deno 2.1.14 compatibility errors in the unrelated hire-order PDF modules (`fontInflate.ts` generic `Uint8Array`, and `render.tsx` JSX React UMD-global errors). The pinned runner also requires `--no-lock` because the repository lockfile is newer format version `5`, unsupported by Deno 2.1.14. Behavioral Edge tests were therefore executed with the documented `--node-modules-dir=none` compatibility flag plus `--no-lock --no-check`; the final check above intentionally omitted `--no-check`.

## Self-review

- Subject resolution and all component presentation props have one registry path, so preview and send cannot diverge without changing that helper.
- The new copy setting uses a `null` fallback, preserving the difference between absent configuration and an intentional empty reset.
- No generated mirror target was edited. Mirror validation passed.
- The diff is confined to Task 4 data access, handlers, registry resolver, and adjacent real-module tests/smoke coverage.

## Concerns

No task-specific functional concerns. The two whole-suite hire-order PDF golden failures and the checked-Deno compatibility errors are unrelated baseline/environment concerns noted above.

## Review fix round 1: complete subject resolution

### RED

Before changing production code, added real production-registry coverage in
`registry.presentation.test.ts` and ran:

```text
npx --yes deno@2.1.14 test --no-lock --no-check --allow-all --node-modules-dir=none \
  supabase/functions/_shared/transactional-email-templates/registry.presentation.test.ts

FAILED | 0 passed | 3 failed
```

Concrete failures proved all reviewed gaps: expiry singular returned the default
instead of custom copy; legacy expiry returned the default instead of its generic
legacy subject; and digest returned literal `{{count}} {{pendingOffer}}` instead
of derived values. The three tests also cover expiry plural, both confirmation
branches, legacy confirmation, hire-order issued/countersigned snake_case data,
and cron snake_case data.

### GREEN

- A typed `SUBJECT_RESOLVERS` map in the sole registry presentation resolver now
  derives each template's subject from complete resolved `EmailCopy` and a
  template-specific token context.
- Send and preview pass a generic legacy subject only through an explicit
  compatibility input. A flattened `copyOverride`/stored `email_copy` (including
  an intentional `{}`) wins; legacy subjects remain highest priority only when
  the new setting is absent.
- `send-transactional-email` DI coverage additionally proves both formerly
  affected conditional templates retain legacy generic subjects in the real
  service-role pipeline.
- Root-cause verification found an existing default mismatch: confirmation copy
  said `on ShowFlow`, while the established subject callback and preview test
  said `— ShowFlow`. The editable source default was aligned to the established
  subject behavior and regenerated with `npm run sync:mirrors`.

Focused verification after the fix:

```text
registry presentation: 3 passed
preview-transactional-email DI: 38 passed
send-transactional-email DI: 36 passed
ok | 77 passed | 0 failed

npx vitest run src/data/emailTemplates.test.ts
4 passed

npx tsc --noEmit
exit 0
npm run lint
exit 0
npm run sync:mirrors:check
All mirrors in sync.
git diff --check 961759381c769ddf361177b541581f279e35ee90
exit 0
```

The new registry module also passed explicit Deno checking and testing with no
`--no-check`:

```text
npx --yes deno@2.1.14 check --no-lock --node-modules-dir=none \
  supabase/functions/_shared/transactional-email-templates/registry.ts
npx --yes deno@2.1.14 test --no-lock --allow-all --node-modules-dir=none \
  supabase/functions/_shared/transactional-email-templates/registry.presentation.test.ts

ok | 3 passed | 0 failed
```

The explicit no-`--no-check` run across send and preview still reaches the
unrelated existing hire-order PDF dependency graph first and reports the same
133 Deno 2.1.14 errors (`fontInflate.ts` generic `Uint8Array` and `render.tsx`
React UMD-global JSX), not Task 4 modules.

### Fix-round self-review and concerns

- Subject construction is not duplicated in either handler; both use the one
  typed registry path.
- Service-role authorization, fail-closed suppression/preferences and logging,
  attachment validation, idempotency, and rendering flow were untouched; all
  36 send DI tests passed.
- Preview remains admin/producer-only; all 38 preview DI tests passed.
- No task-specific functional concerns remain. The handler-level Deno type-check
  baseline remains blocked by the unrelated PDF graph described above.
