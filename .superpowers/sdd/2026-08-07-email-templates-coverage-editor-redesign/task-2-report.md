# Task 2 Report — Shared Email Shell and Booking Templates

## Delivered

- Added `EmailShell`, a 600px light React Email shell with presentation tables,
  a family solid-color `bgcolor` fallback, inline gradient hero, light-mode
  metadata, progressive Geist font face, theme role styles, and preview-only
  role outlines.
- Converted exactly the four booking templates to use it:
  `offer-immediate`, `artist-offer-digest`, `offer-expiry-reminder`, and
  `artist-confirmation-digest`.
- The templates accept `_emailCopy`, `_emailTheme`, `_emailFamily`, and
  `_highlightRole`; direct renders retain Task 1 defaults.
- Replaced booking-template body copy and labels with `EmailCopy` entries,
  palette hex values with `EmailTheme` values, and retained preview data, app
  links, data rows, and subject behavior.
- Added shell and real-render integration assertions for default and custom
  booking presentation props.

## TDD evidence

### Shell RED

After writing `EmailShell.test.tsx`, the real renderer failed as required:

```text
error: Module not found ".../_shell/EmailShell.tsx".
```

Command (the compatibility flags are explained below):

```bash
npx --yes deno@2.1.14 test --no-lock --node-modules-dir=none --no-check --allow-all \
  supabase/functions/_shared/transactional-email-templates/_shell/EmailShell.test.tsx
```

### Shell GREEN

The same rendered-output test passed after implementing the shell:

```text
EmailShell renders a resilient violet hero without unsupported layout CSS ... ok
ok | 1 passed | 0 failed
```

### Booking-template RED

After adding default/custom rendering cases for all four booking templates and
before conversion:

```text
FAILED | 11 passed | 8 failed
offer-immediate has the violet Outlook fallback
offer-immediate uses custom heading copy
...same two assertions for each remaining booking template...
```

### Booking-template GREEN

The complete email-template test folder passes after conversion:

```bash
npx --yes deno@2.1.14 test --no-lock --node-modules-dir=none --no-check --allow-all \
  supabase/functions/_shared/transactional-email-templates/
```

```text
ok | 26 passed | 0 failed
```

## Final verification

```bash
npx --yes deno@2.1.14 check --no-lock --node-modules-dir=none \
  supabase/functions/_shared/transactional-email-templates/_shell/EmailShell.tsx \
  supabase/functions/_shared/transactional-email-templates/registry.ts

npx --yes deno@2.1.14 check --no-lock --node-modules-dir=none \
  supabase/functions/_shared/transactional-email-templates/_shell/EmailShell.test.tsx \
  supabase/functions/_shared/transactional-email-templates/app-links.test.ts

npm run sync:mirrors:check
npx vitest run src/lib/emailTemplates/emailTheme.test.ts
git diff --check
```

Results: both Deno checks completed with no diagnostics; mirrors are in sync;
the source theme suite passed 6/6; `git diff --check` produced no output.

## Shared-contract correction

The first full Deno check exposed a Task 1-generated type error in
`compactEmailTheme`: a conditional type over optional `roles` resolved to
`never` under Deno 2.1.14. The source definition now uses
`NonNullable<EmailThemeOverride["roles"]>` and was mirrored with
`npm run sync:mirrors`. The existing compaction behavior test passed (6/6),
and the full shell/registry check is clean.

## Self-review

- The shell emits the required `bgcolor="#322685"`, `background-image`,
  `name="color-scheme"`, and `role="presentation"` markup; its render test
  also rejects `backdrop-filter` and `display:flex`.
- The four converted templates contain no hardcoded email color hex values,
  legacy `_intro`/`_cta_label`/`_footer` props, or duplicated outer page,
  container, button, and footer styles.
- Default violet fallback, app URLs, dynamic preview rows, and custom copy,
  theme, family, and selected-role preview behavior are covered by real
  rendered HTML assertions.
- Immediate-offer subject token interpolation preserves the legacy result even
  when a field is absent; the confirmation-digest subject remains delegated to
  `digestEmailSubject`.

## Concern / environment note

The task brief's literal Deno command cannot execute in this worktree because
Deno 2.1.14 does not read the repository's lockfile version 5, and its default
node-module resolution also selects local React types that Deno cannot load.
The final test command therefore uses `--no-lock --node-modules-dir=none`.
`--no-check` was used only for test execution because the old lock/runtime
combination otherwise blocks it; final explicit Deno `check` commands above
passed without `--no-check`.

`deno fmt` could not run with this pinned version for the same unsupported
lockfile reason. The targeted files passed `git diff --check` instead.

## Fix round 1 — persisted CTA color

Review found that the CTA took `EMAIL_FAMILY_ACCENTS[family].buttonBg` instead
of the resolved `theme.base.colors.buttonBg`. This prevented a valid persisted
org theme override from affecting the CTA, while the family color is intended
only for the hero fallback and gradient.

### RED

Added a second real-render `EmailShell` test with `buttonBg: "#1257A6"`.

```bash
npx --yes deno@2.1.14 test --no-lock --node-modules-dir=none --no-check --allow-all \
  supabase/functions/_shared/transactional-email-templates/_shell/EmailShell.test.tsx
```

It failed as expected because output contained the violet accent CTA background
`background-color:#4738B0`, not `background-color:#1257A6`.

### GREEN

Changed only the CTA declaration to use `colors.buttonBg`; hero `bgcolor` and
gradient remain family-accent-derived. The same test then passed:

```text
ok | 2 passed | 0 failed
```

Final focused-suite, Deno check, mirror-check, and diff-check evidence is
recorded with the fix commit.
