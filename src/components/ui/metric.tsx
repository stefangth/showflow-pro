import { cn } from '@/lib/utils';

/**
 * Any number the user reads: money, time, duration, count, id. Geist Mono with
 * tabular figures so columns of them line up and none of them jitter as they tick.
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
        'font-mono tabular-nums',
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
