import { cn } from '@/lib/utils';
import { Eyebrow } from './eyebrow';
import { Metric } from './metric';
import type { Tone } from './tones';

/**
 * The KPI tile. Uniform 14px padding, no shadow, mono tabular value. Replaces the
 * two divergent implementations (OrdersKpis used Card, SeasonKpis deliberately did
 * not because Card's shadow and asymmetric padding were wrong; Card is now fixed,
 * but the tile is still worth having once).
 */
export function KpiTile({
  label,
  value,
  note,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: string;
  note?: string | null;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn('rounded-card bg-card p-[14px]', className)}>
      <Eyebrow tone={tone}>{label}</Eyebrow>
      <p className="mt-1">
        <Metric size="lg">{value}</Metric>
      </p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
