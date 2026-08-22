import { useTranslation } from 'react-i18next';
import type { SeasonKpis as SeasonKpisData } from '@/lib/calendar/seasonData';
import { cn } from '@/lib/utils';
import { KpiTile } from '@/components/ui/kpi-tile';
import type { Tone } from '@/components/ui/tones';

interface SeasonKpisProps {
  kpis: SeasonKpisData;
  className?: string;
}

/** Per-tile tone (design mock): amber for the "unfilled" warning metric,
 *  brand-violet (accent) for the neutral "heaviest week" metric, green
 *  (confirmed) for the positive "ready for hire order" metric — keyed by
 *  the tile's `key` so the color mapping can't drift out of sync with the
 *  (translated, dynamic) label/value/note strings. */
const KPI_TONE: Record<string, Tone> = {
  unfilledMainSlots: 'waiting',
  heaviestWeek: 'accent',
  readyForHireOrder: 'confirmed',
};

/** The Season lens's 3 KPI tiles (design lines 413-415), built on the shared
 *  `KpiTile` primitive (ADR 0012 Task 12). Each tile carries a context
 *  sub-line derived from the same `kpis` data so the bare number explains
 *  itself (design mock). */
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
        <div key={tile.key} data-testid={`season-kpi-${tile.key}`}>
          <KpiTile label={tile.label} value={tile.value} note={tile.note} tone={KPI_TONE[tile.key]} />
        </div>
      ))}
    </div>
  );
}
