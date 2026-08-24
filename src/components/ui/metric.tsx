import { cn } from '@/lib/utils';

/**
 * Any number the user reads: money, time, duration, count. Geist Sans with
 * tabular figures, so columns line up and digits do not jitter as they tick.
 * Geist Sans with `tabular-nums` measures identically to Geist Mono, so nothing
 * is lost by staying in the body face.
 *
 * A machine token (an id, a key, a scope, an order number) is NOT a Metric: use
 * `<Token>`. See docs/ui-conventions.md section 3.
 *
 * `size="lg"` is the KPI value; the default is the inline 11px meta figure.
 */
export function Metric({
  size = 'inline',
  className,
  children,
}: {
  size?: 'inline' | 'body' | 'lg';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'tabular-nums',
        size === 'lg' && 'text-2xl font-semibold text-foreground',
        size === 'body' && 'text-[13px]',
        size === 'inline' && 'text-[11px]',
        className,
      )}
    >
      {children}
    </span>
  );
}
