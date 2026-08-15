import { Card, CardContent } from '@/components/ui/card';
import type { SeasonKpis as SeasonKpisData } from '@/lib/calendar/seasonData';
import { cn } from '@/lib/utils';

interface SeasonKpisProps {
  kpis: SeasonKpisData;
  className?: string;
}

/** The Season lens's 3 KPI tiles, mirroring `OrdersKpis`' card markup:
 *  Unfilled main slots · Heaviest week · Ready for hire order. */
export function SeasonKpis({ kpis, className }: SeasonKpisProps) {
  const tiles: { key: string; label: string; value: string }[] = [
    { key: 'unfilledMainSlots', label: 'Unfilled main slots', value: String(kpis.unfilledMainSlots) },
    { key: 'heaviestWeek', label: 'Heaviest week', value: kpis.heaviestWeekLabel || '-' },
    { key: 'readyForHireOrder', label: 'Ready for hire order', value: String(kpis.readyForHireOrder) },
  ];

  return (
    <div data-testid="season-kpis" className={cn('grid grid-cols-1 gap-3 sm:grid-cols-3', className)}>
      {tiles.map(tile => (
        <Card key={tile.key} data-testid={`season-kpi-${tile.key}`}>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{tile.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
