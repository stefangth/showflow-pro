import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Monitor, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

const noop = () => () => {};
/** True only after client hydration. useSyncExternalStore returns the server
 *  snapshot (false) through hydration, then the client snapshot (true), which
 *  avoids a setState-in-effect while still dodging the theme hydration mismatch. */
function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}

const OPTIONS = [
  { value: 'light', icon: Sun, label: 'Light theme' },
  { value: 'system', icon: Monitor, label: 'System theme' },
  { value: 'dark', icon: Moon, label: 'Dark theme' },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // Avoid a hydration/first-paint mismatch: `theme` is undefined until mounted.
  const mounted = useHydrated();

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-well-tint p-1"
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
