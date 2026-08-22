import { useTranslation } from 'react-i18next';
import type { SeasonKpis as SeasonKpisData } from '@/lib/calendar/seasonData';
import { cn } from '@/lib/utils';

interface SeasonKpisProps {
  kpis: SeasonKpisData;
  className?: string;
}

/** Per-tile eyebrow tint (design mock): amber for the "unfilled" warning
 *  metric, brand-violet for the neutral "heaviest week" metric, green for
 *  the positive "ready for hire order" metric — keyed by the tile's `key`
 *  so the color mapping can't drift out of sync with the (translated,
 *  dynamic) label/value/note strings. */
const KPI_EYEBROW_TONE_CLASS: Record<string, string> = {
  unfilledMainSlots: 'text-[var(--amber-600)]',
  heaviestWeek: 'text-accent-text',
  readyForHireOrder: 'text-[var(--green-600)]',
};

/** The Season lens's 3 KPI tiles (design lines 413-415): a plain `bg-card`
 *  box, uniform 14px padding, no shadow. This is the same shape as the shared
 *  `KpiTile` primitive (ADR 0012); a later pass can migrate these tiles to it.
 *  Each tile carries a context sub-line derived from the same `kpis` data so
 *  the bare number explains itself (design mock). */
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
        <div key={tile.key} data-testid={`season-kpi-${tile.key}`} className="rounded-l bg-card p-[14px]">
          <p
            className={cn(
              // eslint-disable-next-line no-restricted-syntax -- 12px/font-medium tile label, not the standard 11px/font-semibold eyebrow; <Eyebrow> would change size and weight
              'text-xs font-medium uppercase tracking-wide',
              KPI_EYEBROW_TONE_CLASS[tile.key] ?? 'text-muted-foreground'
            )}
          >
            {tile.label}
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">{tile.value}</p>
          {tile.note && <p className="mt-1 text-xs text-muted-foreground">{tile.note}</p>}
        </div>
      ))}
    </div>
  );
}
