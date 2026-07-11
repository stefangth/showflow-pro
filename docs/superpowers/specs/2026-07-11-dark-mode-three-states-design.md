# Dark mode — three-state theme toggle (System / Light / Dark)

**Date:** 2026-07-11
**Branch:** `claude/dark-mode-three-states-80cdb8`
**Status:** Approved design

## Goal

Give users a best-in-class three-state appearance control — **System**, **Light**, **Dark** — matching the segmented pill on the marketing site (https://showflow.pro). Selecting **System** follows the OS preference live; **Light**/**Dark** pin the choice. The preference persists across reloads and tabs.

## Context: what already exists

The design system is already dark-ready; the only missing pieces are activation and a control.

- `src/index.css` contains a complete `.dark {}` token block (surfaces, primary, semantic scales, sidebar, shadows, borders) alongside the light `:root` defaults. No token work is required.
- `tailwind.config.ts` sets `darkMode: ["class"]`, so applying `class="dark"` to `<html>` flips the whole app.
- `next-themes@^0.3.0` is already a dependency, and `src/components/ui/sonner.tsx` already calls `useTheme()` — but **no `ThemeProvider` is mounted**, so it is a no-op today and the app is stuck in light mode.

## Reference control (measured from showflow.pro)

The site's `.sh-theme` control, for visual parity:

- Track: `display:flex`, `gap:2px`, `padding:4px`, `border-radius:999px`, `background: rgba(16,15,22,.66)`, `border: 1px solid rgba(255,255,255,.12)`.
- Buttons: three `<button>`s, order **Light → System → Dark**, lucide `Sun` / `Monitor` / `Moon` at 15px, `aria-label` = "Light theme" / "System theme" / "Dark theme", `aria-pressed` reflecting the active choice.
- Active segment: circular thumb, `border-radius:999px`, `background: rgba(255,255,255,.92)`, `color: rgb(21,19,28)`. Inactive: transparent bg, `color: rgba(255,255,255,.7)`.

The reference colors are dark-only (the site is dark). In the app the control must read correctly in **both** modes, so those literals map to semantic tokens (see below), per the repo's "semantic tokens only" rule.

## Design

Three units, each with one clear responsibility.

### 1. Theme engine — `next-themes` `ThemeProvider` at the app root

In `src/App.tsx`, wrap the app tree in:

```tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
```

- `attribute="class"` → applies `class="dark"` / `class="light"` on `<html>`, which is exactly what `darkMode:["class"]` consumes. (`light` on `<html>` is inert — `:root` is the light default.)
- `defaultTheme="system"` + `enableSystem` → resolves `system` via `matchMedia('(prefers-color-scheme: dark)')` and tracks OS changes live.
- Persists to `localStorage` and syncs across tabs automatically.
- `disableTransitionOnChange` suppresses transition churn during the switch.
- **Bonus:** makes the existing `sonner` `useTheme()` correct with no extra work.

**Provider placement:** outermost inside `<QueryClientProvider>`/`<TooltipProvider>`, wrapping `<BrowserRouter>` and everything under it, so every route (including LoginPage and public pages) renders in the active theme.

### 2. Zero flash-of-wrong-theme — inline pre-hydration script in `index.html`

Vite is a client-only SPA, so first paint happens after JS loads; without a guard there is a brief light flash before next-themes mounts. Add a tiny blocking `<script>` in `<head>` that reads the stored key and stamps the class before React mounts:

```html
<script>
  try {
    var t = localStorage.getItem('theme');
    var d = t === 'dark' || ((!t || t === 'system') &&
      matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', d);
  } catch (e) {}
</script>
```

next-themes uses the same default `localStorage` key (`theme`) and reconciles on mount, so the script and the provider agree. This is the documented pattern for next-themes outside Next.js.

### 3. `ThemeToggle` component — `src/components/layout/ThemeToggle.tsx`

A segmented pill replicating `.sh-theme` with semantic tokens:

- Track: `inline-flex items-center gap-0.5 rounded-full border border-border bg-muted p-1`.
- Options array: `[{ value:'light', icon:Sun, label:'Light theme' }, { value:'system', icon:Monitor, label:'System theme' }, { value:'dark', icon:Moon, label:'Dark theme' }]`.
- Each `<button>`: `h-7 w-7` (or `px-1.5 py-1`) `rounded-full` `inline-flex items-center justify-center transition-colors`, icon `h-[15px] w-[15px]`, `aria-label` from the option, `aria-pressed={theme === value}`, `onClick={() => setTheme(value)}`.
- Active vs inactive classes:
  - active: `bg-background text-foreground shadow-sm`
  - inactive: `text-muted-foreground hover:text-foreground`
- **Selection source of truth:** highlight by the raw `theme` value (not `resolvedTheme`), so **System** stays lit when chosen even though it resolves to light/dark under the hood.
- **Hydration guard:** a `const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), [])` flag; before mount, render the track with no segment marked active (avoids a hydration/first-paint mismatch). Standard next-themes pattern.

### 4. Placement — `src/components/layout/AppLayout.tsx`

Insert `<ThemeToggle />` into the existing top-bar right cluster (the `<div className="flex items-center gap-1">`), **before** the notification-bell `Popover`. The `<header>` renders on both desktop and mobile, so the control is always reachable. The 98px-ish pill fits the 52px bar comfortably.

## Testing

- **Unit — `src/components/layout/ThemeToggle.test.tsx`** (via `src/test/renderWithProviders.tsx`):
  - renders exactly three buttons with `aria-label`s "Light theme", "System theme", "Dark theme";
  - clicking each calls `setTheme` with `'light'` / `'system'` / `'dark'`;
  - the button matching the current `theme` has `aria-pressed="true"`, the others `"false"`.
  - Mock `next-themes`' `useTheme` at the test boundary (return a controllable `theme` + a spy `setTheme`) — the component imports the real module; only the hook is stubbed. Import the real `ThemeToggle`.
- **Manual — browser preview:** cycle all three states; confirm `<html>` gains/loses `dark`; set System and flip the OS/emulated `prefers-color-scheme` to confirm it follows; reload in Dark and confirm no light flash.

## Scope boundaries (YAGNI)

- **In scope:** engine wiring, no-flash script, the `ThemeToggle`, and its placement in the authenticated app's top bar.
- **Out of scope:**
  - A separate toggle on LoginPage / public pages — they render correctly in the active theme via the provider; LoginPage keeps its theme-independent immersive art (`--auth-*` tokens).
  - Server-side per-user persistence — `localStorage` is the standard and matches the reference.
  - A duplicate control on the Profile/Settings pages.
- **No token changes** — the `.dark` palette already exists and is out of scope to revise here.

## Files touched

| File | Change |
|---|---|
| `index.html` | Add pre-hydration no-flash `<script>` in `<head>`. |
| `src/App.tsx` | Import + mount `next-themes` `ThemeProvider` around the tree. |
| `src/components/layout/ThemeToggle.tsx` | **New** — segmented three-state pill. |
| `src/components/layout/ThemeToggle.test.tsx` | **New** — unit tests. |
| `src/components/layout/AppLayout.tsx` | Insert `<ThemeToggle />` in the top-bar right cluster. |
