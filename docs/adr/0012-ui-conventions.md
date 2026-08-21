# 12. UI component conventions and their enforcement

Date: 2026-08-21

## Status

Accepted

## Context

The app ships 517 component files over 54 `src/components/ui` primitives and a complete
token set in `src/index.css`. The tokens are sound. The drift is above them: patterns
that are repeated across features without ever becoming a component, and primitives that
are reimplemented locally because the shared one was slightly wrong.

A review found 13 such patterns. The most expensive were an eyebrow label written four
different ways in about 25 files, a status pill with four independent tone maps, and five
implementations of the same segmented control.

The review also found that the repository contains two conflicting descriptions of the
product. `Design System/` is a brand and spec document describing booking operations for
touring music. `src/` is a bilingual theatre casting product with a CI-enforced copy lint.
Design tooling reads the former by default, which is how outdated conventions kept being
reintroduced.

## Decision

1. `src/` is the single source of truth for conventions. `Design System/` is retained as
   brand history and is no longer a working spec. Any tool or agent surface that reads it
   as a spec must be repointed at `docs/ui-conventions.md`.
2. Every repeated visual pattern gets a primitive in `src/components/ui` before it gets a
   second call site.
3. Conventions that a machine can check are checked by a machine. Conventions that a type
   can express are expressed as a type. Only what survives both is left to review.
4. The eleven decisions listed in `docs/ui-conventions.md` are ratified as written.

## Consequences

- Eight new primitives ship: Eyebrow, StatusPill, StatusDot, KpiTile, EmptyState, Metric,
  CountChip, PageHeader.
- `Button` loses the `link` variant and restricts `ghost` to icon buttons at the type
  level. `Badge` gains a distinct red risk tone. `Card` defaults to no elevation.
- `eslint.config.js` gains a restricted-syntax block that fails on raw hex, bracket type
  sizes, bracket radii and bracket alpha outside `src/components/ui`.
- Feature code becomes shorter and more boring. That is the point.
