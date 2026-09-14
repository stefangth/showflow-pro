# UI conventions

This file is the spec. If it disagrees with `Design System/`, this file wins (ADR 0012).
If it disagrees with the code, the code is a bug or this file is stale: fix one of them in
the same PR.

Every rule below is marked with how it is enforced:

- **[ci]** a lint rule or test fails the build
- **[type]** the compiler rejects it
- **[review]** a human blocks the PR

---

## 1. Use the primitive

**[review]** If it exists in `src/components/ui`, use it. Passing `className` to adjust it
is fine. Reimplementing it locally is not.

**[review]** A new visual pattern is a PR against `src/components/ui` first, then a call
site. Never the other way round.

## 2. Tokens

**[ci]** No raw hex, no `rgba()`, no bracket sizes in a feature component. Tokens only.
Outside `src/components/ui` the lint fails on `#rrggbb`, `text-[Npx]`, `rounded-[Npx]`
or `rounded-[Nrem]`, `rounded-[var(--radius-…)]`, and bracket alpha.

**[review]** Radii use the design-system scale, which is named in words, not letters:
`chip` (4) `field` (6) `control` (8) `card` (10) `icon` (20) `pill` (999).
There is no hero step: every card is 10px, including a full bleed feature card.
The shadcn aliases `rounded-sm`, `rounded-md` and `rounded-lg` are retired.

**[ci]** Never name a radius key with a single letter. Tailwind owns the suffixes
`t r b l tl tr br bl s e ss se es ee` for its side, corner and logical-property
utilities, and a key that reuses one silently loses the cascade on those corners.
`scripts/tailwindThemeCollisions.test.ts` fails the build if a key re-enters that namespace.
It guards four scales: `borderRadius`, `fontSize`, `boxShadow` and `colors`, in both extend
and replace mode. It also flags a `fontSize` or `boxShadow` key named after a colour, since
`text-*` and `shadow-*` render colours too. `fontFamily`, `screens`, `keyframes` and
`animation` are extended but not guarded: those namespaces have no static or directional
siblings for a key to collide with. Redefining a key of Tailwind's own scale for the same
utility (`rounded-lg`, `shadow-inner`) is a same-family override, not a collision, and is
deliberately not flagged.

**[review]** Radii nest inward. A card at 10 holds a row or button at 8 holds a chip at 4.
Never reversed, never tied. A card inside a card steps down to 8; it does not repeat 10.

**[review]** A hairline carries elevation on the page. Shadow only where the surface
floats above another one.

**[review]** Tint backgrounds use the token roles: `bg-hover-tint` for hover washes, `bg-well-tint` for recessed wells / inactive chips / tracks, `bg-accent-tint` for the active count chip / accent wash. Ad-hoc `bg-muted` and `bg-foreground/N` washes are retired in feature code **[ci]**. Solid accent fills stay on the accent scale (`bg-accent-500` etc.); only the low accent washes moved to `bg-accent-tint`.

**[ci]** No solid fixed-light accent background: `bg-accent-50`, `bg-accent-100`,
`bg-accent-200` (and their `hover:`/other variants) are lint-banned in feature code. The
numbered accent scale is immutable across modes (see section 4), so `accent-50` stays the
same near-white violet in dark mode. Put mode-flipping text (`text-foreground`,
`text-muted-foreground`, or an inherited default) on top of it and the text goes light in
dark mode and disappears. For a mode-aware accent surface use the semantic pair
`bg-accent` / `text-accent-foreground` (it flips: light-violet band + accent-600 text in
light, accent-900 band + accent-100 text in dark). A deliberate fixed-on-fixed surface (a
permanently-light chip that pairs the fixed background with a fixed dark stop like
`text-accent-700`) is the one legitimate exception: annotate it with an
`eslint-disable-next-line no-restricted-syntax` and a reason (see
`HeroCard.tsx`'s open-step button for the pattern).

## 3. Type

The scale is **48 / 32 / 22 / 17 / 16 / 14 / 13 / 12 / 11**.

**13 is the control size** (D5). Buttons, inputs, table cells, tabs and nav rows are 13.
14 is body copy. 11 is the eyebrow and the badge.

**16 is the page-header sub** (the lead paragraph directly under a page H1): `text-lead`.
It is the one place body copy steps up from 14. A page sub with no size class inherits the
browser default, which happens to be 16 but is not a scale token, so it reads as correct
while being invisible to the token guard. Always write `text-lead` explicitly. Use it only
for the H1 sub, not for card or section subs, which stay at `text-body` (14).

**[ci]** Half-pixel sizes are gone. 10.5, 11.5, 12.5 and 13.5 do not exist.

**[review]** Every number the user reads is Geist Sans with `tabular-nums`: money, time,
duration, count, ratio. Use `<Metric>`. Geist Sans with tabular figures measures
identically to Geist Mono, so a column of `<Metric>` lines up exactly and nothing is
gained by switching face.

**[review]** Mono means one thing: a machine token. A string a system produced that a
person may copy, paste, or quote back. An id, a reference number, a key, a scope, a
function name, a status code, a version. Use `<Token>`. A label is never a token, only
a value can be.

**[ci]** Raw `font-mono` is banned in feature code, in a plain string and in a template
literal alike. Go through `<Token>`. The `ignores` array in `eslint/ui-conventions.js`
carries the full exemption list: `src/components/ui/**` (where `Token` itself lives),
`src/**/*.test.{ts,tsx}`, the PDF and email renderers (`src/lib/hireOrders/pdf/**`,
`src/lib/emailTemplates/**`), and `src/lib/avatar.ts`. A generated document is allowed
its own typography.

## 4. Color roles

**[review]** One primary button per view. Two violets in a row is a rejected review.

**[review]** Red means risk. It is never emphasis, never a brand accent, never a hover
state. Amber means waiting on a human (D3).

**[review]** Accent text is `text-accent-text`, never `text-accent-700`. The accent scale
is immutable across modes; only the role token flips.

## 5. Components with rules attached

| Component | Rule |
|---|---|
| `Button` | `ghost` is icon only **[type]**. There is no `link` variant **[type]**: a standalone action is `secondary`, an inline reference is an `<a>` (D1, D2). |
| `Badge` | Radius 4, never a pill. Tones come from `TONES`, never from a local map. |
| `Card` | No elevation by default. Pass `elevation="2"` only on a non-white ground. |
| `SegmentedControl` | The only segmented control (D4). `size="sm"` covers what Tabs used to do. |
| `Table` | 34px rows, 13px cells, eyebrow header. `numeric` on any numeric column (D6). |
| `EmptyState` | Never renders without an action, or an explicit `reason` prop saying why there is none (D8). |
| `Eyebrow` | The only way to render an uppercase label. |

## 6. Copy

**[ci]** No em dashes, no en dashes, in either language. Use a period, a colon, or the
word "to" in a range (D9). Enforced by `src/i18n/copyLint.test.ts`.

**[ci]** German is Du-form. Formal Sie mid-sentence fails.

**[ci]** No exclamation marks. No emoji.

**[review]** Plain language in the UI, domain terms in code (D10). The user reads
"Waiting on you"; the identifier stays `hold`. `src/i18n/terms.ts` is the glossary and is
the only place a user-facing term is decided.

**[review]** Sentence case everywhere. Uppercase is the eyebrow, and only the eyebrow.

**[review]** Empty states state the fact, then the next action. No apology.

**[ci]** Domain nouns in locale files are `{{vocabulary}}` variables resolved from
`src/lib/orgKind.ts` per the org's workspace type, never bare words. Enforced by
`src/i18n/vocabularyLint.test.ts`.

## 7. Icons

**[review]** Lucide only, `currentColor` only. Size follows the control: 14 for small and
inline, 16 default, 18 sidebar nav, 20 empty states and section heroes. 15 is not a size.

## 8. When a rule is wrong

Open a PR against this file with the reasoning. Do not work around it in a feature
component, and do not add a second component that quietly disagrees. That is how the
thirteen findings happened.
