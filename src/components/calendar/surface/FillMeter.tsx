import { useTranslation } from 'react-i18next';
import type { MeterSegment, Tone } from '@/lib/calendar/types';
import { TONE_FILL } from '@/lib/calendar/tone';
import { cn } from '@/lib/utils';

type FillMeterSize = 'chip' | 'row';

interface FillMeterProps {
  segments: MeterSegment[];
  tone: Tone;
  label?: string;
  /** `'row'` (default) = wider bars for queue-card / rail rows.
   *  `'chip'` = small vertical ticks for a month-grid chip. */
  size?: FillMeterSize;
  className?: string;
}

/** Segment dimensions per size, matching the canonical mock: row bars are
 *  14x7px with a 2px gap; chip ticks are 4x8px with a 1.5px gap. */
const SIZE_CLASSES: Record<FillMeterSize, { gap: string; bar: string }> = {
  row: { gap: 'gap-0.5', bar: 'h-1.5 w-3.5 rounded-chip' },
  chip: { gap: 'gap-[1.5px]', bar: 'h-2 w-1 rounded-chip' },
};

/**
 * Segmented fill meter — one bar per slot, tinted by `tone` when filled,
 * `bg-well-tint` when empty. Presentational only; the caller decides
 * how many segments and which tone (see `PRODUCER_TONES`/`ARTIST_TONES`).
 */
export function FillMeter({ segments, tone, label, size = 'row', className }: FillMeterProps) {
  const { t } = useTranslation('common');
  const filled = segments.filter(s => s.filled).length;
  const { gap, bar } = SIZE_CLASSES[size];

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      data-testid="fill-meter"
      data-filled={filled}
      data-total={segments.length}
      data-size={size}
    >
      <div className={cn('flex items-center', gap)} role="img" aria-label={t('calendar.fillMeter.filled', { filled, total: segments.length })}>
        {segments.map((segment, i) => (
          <span
            key={i}
            data-testid="fill-meter-segment"
            data-filled={segment.filled}
            className={cn(bar, segment.filled ? TONE_FILL[tone] : 'bg-well-tint')}
          />
        ))}
      </div>
      {label && <span className="font-mono text-eyebrow tabular-nums text-muted-foreground">{label}</span>}
    </div>
  );
}
