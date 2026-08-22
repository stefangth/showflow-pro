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
and bracket alpha.

**[review]** Radii use the design-system scale (`xs s m l xl xxl pill`). The shadcn
aliases `rounded-sm`, `rounded-md` and `rounded-lg` are retired.

**[review]** Radii nest inward. A card at 10 holds a button at 8 holds a chip at 4. Never
reversed.

**[review]** A hairline carries elevation on the page. Shadow only where the surface
floats above another one.

**[review]** Tint backgrounds use the token roles: `bg-hover-tint` for hover washes, `bg-well-tint` for recessed wells / inactive chips / tracks, `bg-accent-tint` for the active count chip / accent wash. Ad-hoc `bg-muted` and `bg-foreground/N` washes are retired in feature code **[ci]**. Solid accent fills stay on the accent scale (`bg-accent-500` etc.); only the low accent washes moved to `bg-accent-tint`.

## 3. Type

The scale is **48 / 32 / 22 / 17 / 14 / 13 / 12 / 11**.

**13 is the control size** (D5). Buttons, inputs, table cells, tabs and nav rows are 13.
14 is body copy. 11 is the eyebrow and the badge.

**[ci]** Half-pixel sizes are gone. 10.5, 11.5, 12.5 and 13.5 do not exist.

**[review]** Every number the user reads is Geist Mono with `tabular-nums`: money, time,
duration, count, id. Use `<Metric>`.

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

## 7. Icons

**[review]** Lucide only, `currentColor` only. Size follows the control: 14 for small and
inline, 16 default, 18 sidebar nav, 20 empty states and section heroes. 15 is not a size.

## 8. When a rule is wrong

Open a PR against this file with the reasoning. Do not work around it in a feature
component, and do not add a second component that quietly disagrees. That is how the
thirteen findings happened.
