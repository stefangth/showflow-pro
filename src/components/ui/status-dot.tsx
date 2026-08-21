import { cn } from '@/lib/utils';
import { TONES, type Tone } from './tones';

/**
 * A 6px filled square. Not a circle: the spec has always called for a square, and
 * four different circle sizes had shipped instead. `shape="bar"` is the rail
 * variant (a 10x4 lozenge), kept as a prop so it stays the same component.
 */
export function StatusDot({ tone, shape = 'dot', className }: { tone: Tone; shape?: 'dot' | 'bar'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 rounded-[2px]',
        shape === 'bar' ? 'h-1 w-2.5' : 'h-1.5 w-1.5',
        TONES[tone].dot,
        className,
      )}
    />
  );
}
