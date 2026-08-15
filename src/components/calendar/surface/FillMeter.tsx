import type { MeterSegment, Tone } from '@/lib/calendar/types';
import { TONE_FILL } from '@/lib/calendar/tone';
import { cn } from '@/lib/utils';

interface FillMeterProps {
  segments: MeterSegment[];
  tone: Tone;
  label?: string;
  className?: string;
}

/**
 * Segmented fill meter — one bar per slot, tinted by `tone` when filled,
 * `bg-foreground/10` when empty. Presentational only; the caller decides
 * how many segments and which tone (see `PRODUCER_TONES`/`ARTIST_TONES`).
 */
export function FillMeter({ segments, tone, label, className }: FillMeterProps) {
  const filled = segments.filter(s => s.filled).length;

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      data-testid="fill-meter"
      data-filled={filled}
      data-total={segments.length}
    >
      <div className="flex items-center gap-0.5" role="img" aria-label={`${filled} of ${segments.length} filled`}>
        {segments.map((segment, i) => (
          <span
            key={i}
            data-testid="fill-meter-segment"
            data-filled={segment.filled}
            className={cn(
              'h-1.5 w-2.5 rounded-[2px]',
              segment.filled ? TONE_FILL[tone] : 'bg-foreground/10'
            )}
          />
        ))}
      </div>
      {label && <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{label}</span>}
    </div>
  );
}
