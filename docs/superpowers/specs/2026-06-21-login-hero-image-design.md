# Login page hero image — design

**Date:** 2026-06-21
**Status:** Approved (design)
**Branch:** `claude/musing-robinson-005701`

## Goal

Reskin the login page (`src/pages/LoginPage.tsx`) to feature the brand hero
photograph as an immersive, full-bleed background with a frosted-glass sign-in
card — a best-in-class SaaS login. Presentational only; no auth logic changes.

## Source asset

- `hero-show.jpg` (2400×1350, ~92 KB progressive JPEG) from the private
  landing-page repo `stefangth/showflow-pro.landingpage` at `public/hero-show.jpg`.
- Content: profile silhouette of a person with magenta hair holding a tablet,
  against a navy→violet→magenta→coral dusk gradient. Subject is center-right; the
  left third is darker negative space (ideal for overlaying the card).
- Committed into this repo at `src/assets/auth/hero-show.jpg` and imported so Vite
  hashes / cache-busts it.

## Chosen direction

Option B — Immersive (full-screen photo + frosted glass card). Card
**left-aligned**. **With a headline.**

Headline copy (no em-dash, no "calm"):
> Casting, scheduling and confirmations, all in one place.

## Layout & composition

- Viewport is the photo (`object-cover`, `object-position` ~60% center to keep the
  subject framed).
- Base layer: the landing page dusk gradient (radial + linear, navy `#0a1130` →
  `#271a47` → `#4c2a5e` → `#8d3a5f` → coral `#d7705f`) painted instantly — also the
  graceful fallback if the image fails to load.
- Photo layer fades in on mount (opacity 0→1, scale 1.06→1, brightness 0.45→1) via
  framer-motion, gated by `prefers-reduced-motion`. `fetchpriority="high"`, eager.
- Scrim: left-weighted linear gradient (`rgba(11,9,18,.85)` → `.5` @48% → `.2`) for
  legibility, plus a subtle top scrim.
- Content column: left-aligned, ~420 px max, vertically centered, responsive
  padding. Contains:
  - StageMark (mono white) + "Showflow Pro" wordmark.
  - Headline over the photo (font-display, ~28–32 px, white).
  - Frosted glass sign-in card beneath.

## Theming (always-dark) & frosted card

- The page renders **always-dark** regardless of the viewer's theme: wrap content
  in a `dark` class container (`darkMode: ["class"]`) so the immersive look is
  consistent and the form primitives pick up dark tokens.
- The glass panel is a plain styled `div` (not the shadcn `Card`) to avoid a
  `bg-card` override conflict: `bg-[rgba(18,16,27,0.55)]` + `backdrop-blur-xl` +
  `border-white/10` + `shadow-2xl`. Note the color tokens are defined as
  `hsl(var(--card))` **without** an `<alpha-value>` placeholder, so `bg-card/55`
  would render opaque — hence the explicit `rgba()`.
- `Input`, `Button`, the destructive `Alert`, and focus rings inherit dark tokens
  automatically. Violet primary (`#6E5CF6`) stays vibrant for the Sign-in button +
  focus ring. No bespoke form CSS, no new primitives.

## Accessibility

- Image is decorative: `alt=""`.
- Headline placed over the darkest scrim region; verify ≥ WCAG AA contrast.
- Preserve label/input associations, keyboard nav, focus-visible rings.
- `prefers-reduced-motion`: skip fade/scale; image appears immediately.
- Error `Alert` keeps `aria-live="assertive"` / `aria-atomic`.

## Responsive

- Desktop (md+): left column with headline + card.
- Mobile (<md): photo stays full-bleed, column centers, headline shrinks, card goes
  full-width with horizontal margins.

## Behavior preserved (no logic change)

`handleSubmit`, `friendlyAuthError`, `?redirect=` safety, loading state, the
"Book a demo" link, and the Privacy / Impressum / Cookie-settings footer all stay
exactly as-is.

## Testing

- This is a presentational reskin that adds **no new logic** — `handleSubmit`,
  `friendlyAuthError`, redirect handling, and all links are preserved verbatim.
- No new automated test is added: `LoginPage` is auth/router/consent-coupled and
  the shared `renderWithProviders` only wraps React Query, so a smoke test would
  need bespoke provider wiring — and there is no local Node toolchain to verify it
  against (Vitest/ESLint/`tsc`/build run in CI only). An unrunnable, provider-heavy
  test is a net negative here.
- Verification: CI (typecheck, lint, build) + a manual visual check of the running
  login page (desktop + mobile widths, light/dark host theme, reduced-motion).

## Out of scope

- WebP/AVIF generation, multiple responsive `srcset` sources, blur-up LQIP beyond
  the gradient fallback.
- Other auth pages (reset password, accept invite).
