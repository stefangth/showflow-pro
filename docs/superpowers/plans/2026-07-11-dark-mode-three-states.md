# Three-State Dark Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a best-in-class System/Light/Dark appearance control (a segmented sun/monitor/moon pill in the top bar) that activates the app's existing dark token palette and persists the choice.

**Architecture:** Mount `next-themes`' `ThemeProvider` at the app root to drive a `class="dark"`/`"light"` attribute on `<html>` (which Tailwind's `darkMode:["class"]` already consumes), with a tiny pre-hydration inline script in `index.html` to prevent a flash of the wrong theme. A new `ThemeToggle` component reads/writes the theme via `useTheme()` and renders three `aria-pressed` buttons.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind CSS v3, `next-themes@^0.3.0` (already installed), `lucide-react` (Sun/Monitor/Moon), Vitest + @testing-library/react.

## Global Constraints

- **Semantic tokens only** — no hardcoded `bg-white`/`text-black`. The control uses `bg-muted`, `border-border`, `bg-background`, `text-foreground`, `text-muted-foreground`.
- **No new dependencies** — `next-themes` is already in `package.json`; do not add another theme lib.
- **Do not edit `src/components/ui/**` primitives by hand.**
- **Order of segments is Light → System → Dark** (matches the reference site DOM and the requested icon order sun/monitor/moon).
- **Selection highlights the raw `theme`** (not `resolvedTheme`) so **System** stays lit when selected.
- **TDD** — test first for the component. **Frequent commits** — one per task.
- `localStorage` key is next-themes' default `"theme"`; the inline no-flash script MUST use the same key.

---

### Task 1: `ThemeToggle` component (TDD)

Builds the segmented pill in isolation. `useTheme` is mocked, so this task needs no provider wiring and is fully unit-testable.

**Files:**
- Create: `src/components/layout/ThemeToggle.tsx`
- Test: `src/components/layout/ThemeToggle.test.tsx`

**Interfaces:**
- Consumes: `useTheme` from `next-themes` — `{ theme: string | undefined, setTheme: (t: string) => void }`.
- Produces: `export function ThemeToggle(): JSX.Element` — a segmented control rendering three `<button>`s with `aria-label`s `"Light theme"`, `"System theme"`, `"Dark theme"`, each with `aria-pressed` and an `onClick` calling `setTheme('light'|'system'|'dark')`. Imported by `AppLayout` in Task 2.

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/ThemeToggle.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTheme } from 'next-themes';
import { ThemeToggle } from './ThemeToggle';

vi.mock('next-themes', () => ({ useTheme: vi.fn() }));

const setTheme = vi.fn();

beforeEach(() => {
  setTheme.mockClear();
  vi.mocked(useTheme).mockReturnValue({ theme: 'system', setTheme } as any);
});

describe('ThemeToggle', () => {
  it('renders three theme buttons with accessible labels', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Light theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeInTheDocument();
  });

  it('marks the current theme button as pressed and others as not', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'System theme' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Light theme' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Dark theme' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls setTheme with the chosen value on click', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(setTheme).toHaveBeenCalledWith('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }));
    expect(setTheme).toHaveBeenCalledWith('light');
    fireEvent.click(screen.getByRole('button', { name: 'System theme' }));
    expect(setTheme).toHaveBeenCalledWith('system');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/layout/ThemeToggle.test.tsx`
Expected: FAIL — cannot resolve `./ThemeToggle` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `src/components/layout/ThemeToggle.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Monitor, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', icon: Sun, label: 'Light theme' },
  { value: 'system', icon: Monitor, label: 'System theme' },
  { value: 'dark', icon: Moon, label: 'Dark theme' },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // Avoid a hydration/first-paint mismatch: `theme` is undefined until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted p-1"
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => setTheme(value)}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-[15px] w-[15px]" />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/layout/ThemeToggle.test.tsx`
Expected: PASS — 3 tests. (React Testing Library flushes the `useEffect` inside `act`, so `mounted` is `true` and the pressed-state assertions hold.)

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/ThemeToggle.tsx src/components/layout/ThemeToggle.test.tsx
git commit -m "feat: add three-state ThemeToggle component"
```

---

### Task 2: Activate the theme engine, prevent flash, and place the toggle

Wires `next-themes` at the root, adds the no-flash script, and drops `<ThemeToggle />` into the top bar. Verified end-to-end in the browser preview (provider wiring is not meaningfully unit-testable; the component's own behavior is already covered by Task 1).

**Files:**
- Modify: `index.html` (add pre-hydration `<script>` in `<head>`)
- Modify: `src/App.tsx` (wrap tree in `ThemeProvider`)
- Modify: `src/components/layout/AppLayout.tsx` (import + render `<ThemeToggle />` in the top-bar right cluster)

**Interfaces:**
- Consumes: `ThemeToggle` from `./ThemeToggle` (Task 1); `ThemeProvider` from `next-themes`.
- Produces: a mounted `ThemeProvider` so `useTheme()` works app-wide (including the existing `sonner` toaster), and `<html>` carries `class="dark"`/`"light"`.

- [ ] **Step 1: Add the no-flash inline script to `index.html`**

In `index.html`, insert this block in `<head>` immediately after the `<meta name="author" content="ShowFlow" />` line:

```html
    <script>
      // Apply the persisted (or system) theme before React mounts to avoid a flash.
      // Must use the same localStorage key ("theme") that next-themes uses.
      try {
        var t = localStorage.getItem('theme');
        var dark = t === 'dark' ||
          ((!t || t === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', dark);
      } catch (e) {}
    </script>
```

- [ ] **Step 2: Mount `ThemeProvider` in `src/App.tsx`**

Add the import at the top of `src/App.tsx` (with the other imports):

```tsx
import { ThemeProvider } from "next-themes";
```

Then wrap the existing tree: change the opening of the `App` component from

```tsx
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
```

to

```tsx
const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <TooltipProvider>
```

and change the closing of the component from

```tsx
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);
```

to

```tsx
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);
```

(`ThemeProvider` must wrap `<Sonner />` too, since `sonner.tsx` already calls `useTheme()`.)

- [ ] **Step 3: Render `<ThemeToggle />` in the top bar**

In `src/components/layout/AppLayout.tsx`, add the import near the other layout imports (e.g. after the `NotificationsList` import):

```tsx
import { ThemeToggle } from '@/components/layout/ThemeToggle';
```

Then, in the top-bar right cluster, insert the toggle before the notification-bell `Popover`. Change:

```tsx
          <div className="flex items-center gap-1">
            {isRealAdmin && <EditorModeToggle />}

            {/* Notification bell — wired to NotificationsList popover */}
            <Popover open={notifOpen} onOpenChange={setNotifOpen}>
```

to:

```tsx
          <div className="flex items-center gap-1">
            {isRealAdmin && <EditorModeToggle />}

            <ThemeToggle />

            {/* Notification bell — wired to NotificationsList popover */}
            <Popover open={notifOpen} onOpenChange={setNotifOpen}>
```

- [ ] **Step 4: Verify the full app still builds and unit tests pass**

Run: `npx vitest run src/components/layout/ThemeToggle.test.tsx`
Expected: PASS (unchanged from Task 1).

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Manual verification in the browser preview**

Start the dev server and drive it (do NOT ask the user to check manually):
1. `preview_start` with `{ name: "<dev server from .claude/launch.json, or create one running npm run dev on port 5173> }`. Navigate to the app and sign in (or land on any AppLayout page).
2. Confirm the pill shows in the top bar with three icons; the segment matching the current theme is highlighted.
3. Click **Dark** → `read_page`/`javascript_tool` to confirm `document.documentElement.classList.contains('dark') === true` and the UI is dark. Click **Light** → confirm the class is removed and the UI is light.
4. Click **System**, then use `resize_window` with `colorScheme: 'dark'` and `colorScheme: 'light'` to confirm the app follows the emulated OS preference while System is selected.
5. Reload the page while in **Dark** and confirm there is no light flash before the app paints (the inline script covers this).
6. Take a screenshot in each of light and dark to share as proof.

- [ ] **Step 6: Commit**

```bash
git add index.html src/App.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: activate dark mode and add theme toggle to top bar"
```

---

## Self-Review

**Spec coverage:**
- Three-state engine (System/Light/Dark, system follows OS, persists) → Task 2 Step 2 (`ThemeProvider` with `defaultTheme="system" enableSystem`, default `localStorage` persistence).
- No flash of wrong theme → Task 2 Step 1 (inline script).
- Segmented pill, semantic tokens, Sun/Monitor/Moon, `aria-label`+`aria-pressed`, System stays lit → Task 1.
- Placement in top-bar right cluster → Task 2 Step 3.
- Tests (unit + manual browser) → Task 1 Steps 1–4; Task 2 Step 5.
- Scope boundaries (no separate public-page toggle, no server persistence, no token changes) → honored; no task touches `index.css`, LoginPage, or the Profile page.

**Placeholder scan:** none — every code step contains full content; no "TBD"/"handle edge cases"/"similar to Task N".

**Type consistency:** `ThemeToggle` (no props) is defined in Task 1 and consumed by name in Task 2 Step 3. `useTheme` shape (`theme`, `setTheme`) is consistent between the component and its test mock. `localStorage` key `"theme"` is consistent between the inline script (Task 2 Step 1) and next-themes' default (Task 2 Step 2).
