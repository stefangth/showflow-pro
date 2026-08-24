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
5. The radius scale is named in words, never letters: `chip` (4) `field` (6) `control` (8)
   `card` (10) `icon` (20) `pill` (999). This was forced, not stylistic. Tailwind's
   `borderRadius` theme keys double as class-name suffixes, and Tailwind independently
   owns the suffixes `t r b l tl tr br bl s e ss se es ee` for its own side, corner and
   logical-property radius utilities (`rounded-l` rounds the LEFT side; `rounded-s` rounds
   the logical START side). The design system's old scale used single-letter keys `l`
   (cards) and `s` (inputs), each of which collided with one of those reserved suffixes.
   Tailwind emitted a second rule under the same class name, and its own rule won the
   cascade on the corners it set. The result was live and undetected for months: measured
   computed radii were `4px 10px 10px 4px` on every card and `4px 6px 6px 4px` on every
   input, against an intended uniform 10px and 6px. Nothing in the build, the type system,
   or a visual glance at a single corner caught it.
6. The 14px hero step is retired. Before this fix there were two card radii, 10px for
   section cards and 14px (`--radius-xl`) for hero cards and sheets. One card radius (10)
   now covers every card, hero included, so there is one fewer thing to get right and one
   fewer place a key collision can hide. `--radius-xl` is deleted from `src/index.css`.
7. Enforcement is two layers, because the config guard and the call site are different
   failure modes. `scripts/tailwindThemeCollisions.test.ts` checks the *config*: it fails
   the build if a custom theme scale (`borderRadius`, `fontSize`, `boxShadow` and
   `colors`) ever defines a key that re-enters a namespace Tailwind already owns.
   `eslint/ui-conventions.js` checks *call sites*: a developer can still type
   `rounded-l` today and get Tailwind's legitimate left-side utility with no config
   involved, which reproduces the exact silent failure this ADR describes. The lint rule
   bans a bare (unsized) Tailwind side, corner or logical radius utility in feature code,
   while leaving sized forms (`rounded-l-md`, `rounded-tl-lg`) and the design-system scale
   itself legal.

## Consequences

- Eight new primitives ship: Eyebrow, StatusPill, StatusDot, KpiTile, EmptyState, Metric,
  CountChip, PageHeader.
- `Button` loses the `link` variant and restricts `ghost` to icon buttons at the type
  level. `Badge` gains a distinct red risk tone. `Card` defaults to no elevation.
- `eslint.config.js` gains a restricted-syntax block that fails on raw hex, bracket type
  sizes, bracket radii and bracket alpha outside `src/components/ui`.
- Feature code becomes shorter and more boring. That is the point.
- The radius scale is renamed from single letters to whole words, and every card and
  input that silently rendered the wrong corners now renders the intended radius.
  `scripts/tailwindThemeCollisions.test.ts` fails the build if a key ever re-enters a
  Tailwind-owned namespace again. It guards four scales, not only `borderRadius`:
  `borderRadius`, `fontSize`, `boxShadow` and `colors`, resolved so that both extend-mode
  and replace-mode keys are covered, and it also flags a `fontSize` or `boxShadow` key
  named after a colour because `text-*` and `shadow-*` render colours too. The other
  extended scales (`fontFamily`, `screens`, `keyframes`, `animation`) stay unguarded: their
  namespaces have no static or directional siblings to collide with. A same-family override
  such as `rounded-lg` or `shadow-inner` emits one rule and is never flagged.
  `eslint/ui-conventions.js` fails the build on a bare Tailwind side
  utility at a call site, closing the gap the config guard alone cannot reach.
