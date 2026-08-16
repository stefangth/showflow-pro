import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import type { SeasonKpis as SeasonKpisData } from '@/lib/calendar/seasonData';
import { cn } from '@/lib/utils';

interface SeasonKpisProps {
  kpis: SeasonKpisData;
  className?: string;
}

/** The Season lens's 3 KPI tiles, mirroring `OrdersKpis`' card markup:
 *  Unfilled main slots · Heaviest week · Ready for hire order. Each tile
 *  carries a context sub-line derived from the same `kpis` data so the bare
 *  number explains itself (design mock). */
export function SeasonKpis({ kpis, className }: SeasonKpisProps) {
  const { t } = useTranslation('bookings');
  const tiles: { key: string; label: string; value: string; note: string | null }[] = [
    {
      key: 'unfilledMainSlots',
      label: t('calendar.seasonKpis.unfilledMainSlotsLabel'),
      value: String(kpis.unfilledMainSlots),
      note:
        kpis.unfilledMainSlots > 0
          ? t('calendar.seasonKpis.unfilledMainSlotsNote', { count: kpis.unfilledDates })
          : t('calendar.seasonKpis.allMainCastFilled'),
    },
    {
      key: 'heaviestWeek',
      label: t('calendar.seasonKpis.heaviestWeekLabel'),
      value: kpis.heaviestWeekLabel || '-',
      note: kpis.heaviestWeekLabel
        ? t('calendar.seasonKpis.heaviestWeekNote', { count: kpis.heaviestWeekDates, open: kpis.heaviestWeekOpen })
        : null,
    },
    {
      key: 'readyForHireOrder',
      label: t('calendar.seasonKpis.readyForHireOrderLabel'),
      value: String(kpis.readyForHireOrder),
      note:
        kpis.readyForHireOrder > 0
          ? t('calendar.seasonKpis.readyForHireOrderNoteFilled')
          : t('calendar.seasonKpis.readyForHireOrderNoteNone'),
    },
  ];

  return (
    <div data-testid="season-kpis" className={cn('grid grid-cols-1 gap-3 sm:grid-cols-3', className)}>
      {tiles.map(tile => (
        <Card key={tile.key} data-testid={`season-kpi-${tile.key}`}>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{tile.value}</p>
            {tile.note && <p className="mt-1 text-xs text-muted-foreground">{tile.note}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
