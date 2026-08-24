import { cn } from '@/lib/utils';

/**
 * A machine token: a string a system produced that a person may need to copy,
 * paste, or quote back. An id, a reference number, a key, a scope, a function
 * name, a status code, a version string.
 *
 * This is the ONLY reason to reach for Geist Mono in feature code. A number the
 * user reads as a quantity, a date, or a time is not a token: that is `Metric`,
 * which renders tabular figures in the sans face. See docs/ui-conventions.md
 * section 3.
 */
export function Token({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cn('font-mono', className)}>{children}</span>;
}
