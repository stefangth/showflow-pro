import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isToday,
} from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IconTooltip } from '@/components/common/IconTooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toDateKey, pastRowClassName, weekdayShortLabels } from '@/lib/dates';
import { AvailabilityPicker } from './AvailabilityPicker';
import { OfferResponseButtons } from './OfferResponseButtons';
import type { EligibleDate } from '@/hooks/useArtistEligibleDates';

type BookingRow = { id: string; show_date_id: string; status: string; show_date: { date: string } };

interface Props {
  artistId: string;
  eligibleDates: EligibleDate[];
}

/**
 * Month-grid calendar:
 *  - Bold blue outline → eligible date
 *  - Green shade       → Confirmed booking ("Booked" label)
 *  - Primary blue fill → Soft-booked / hold placed ("Hold" label)
 *  - Yellow shade      → Suggested offer pending ("Offer" label)
 *  - Red shade         → Blocked date
 *  - No shade          → Eligible, no offer yet
 * Tapping a cell opens a popover with a blocked-date toggle.
 */
export function ArtistAvailabilityCalendar({ artistId, eligibleDates }: Props) {
  const { t } = useTranslation('availability');
  const [currentMonth, setCurrentMonth] = useState<Date>(startOfMonth(new Date()));

  // useArtistEligibleDates filters by BOTH cast membership and unmet hard skill
  // requirements, so the explanation has to name both, "offered dates come from
  // your casts" alone is only half the story for an artist missing a required skill.
  const ineligibleDayReason = t('calendar.ineligibleReason');

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const monthStartKey = toDateKey(monthStart);
  const monthEndKey = toDateKey(monthEnd);

  // Fetch all non-cancelled bookings for this artist
  const { data: bookings, isError: bookingsError } = useQuery({
    queryKey: ['bookings', 'artist', artistId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, show_date_id, status, show_date:show_dates!inner(date)')
        .eq('artist_id', artistId)
        .neq('status', 'cancelled');
      if (error) throw error;
      return (data ?? []) as unknown as BookingRow[];
    },
  });

  const { data: blockedDates, isError: blockedError } = useQuery({
    queryKey: ['blocked-dates', artistId, format(currentMonth, 'yyyy-MM')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blocked_dates')
        .select('date')
        .eq('artist_id', artistId)
        .gte('date', monthStartKey)
        .lte('date', monthEndKey);
      if (error) throw error;
      return data ?? [];
    },
  });

  const eligibleSet = useMemo(
    () => new Set(eligibleDates.map((d) => d.date)),
    [eligibleDates]
  );

  const blockedSet = useMemo(() => {
    const s = new Set<string>();
    blockedDates?.forEach((b) => s.add(b.date));
    return s;
  }, [blockedDates]);

  const confirmedSet = useMemo(() => {
    const s = new Set<string>();
    bookings?.forEach((b) => {
      const d = b.show_date?.date;
      if (b.status === 'confirmed' && d && d >= monthStartKey && d <= monthEndKey) s.add(d);
    });
    return s;
  }, [bookings, monthStartKey, monthEndKey]);

  const softBookedSet = useMemo(() => {
    const s = new Set<string>();
    bookings?.forEach((b) => {
      const d = b.show_date?.date;
      if (b.status === 'soft_booked' && d && d >= monthStartKey && d <= monthEndKey) s.add(d);
    });
    return s;
  }, [bookings, monthStartKey, monthEndKey]);

  const suggestedSet = useMemo(() => {
    const s = new Set<string>();
    bookings?.forEach((b) => {
      const d = b.show_date?.date;
      if (b.status === 'suggested' && d && d >= monthStartKey && d <= monthEndKey) s.add(d);
    });
    return s;
  }, [bookings, monthStartKey, monthEndKey]);

  // Maps date string → booking ID for suggested offers (for offer-response popover)
  const suggestedIdByDate = useMemo(() => {
    const m = new Map<string, string>();
    bookings?.forEach((b) => {
      const d = b.show_date?.date;
      if (b.status === 'suggested' && d) m.set(d, b.id);
    });
    return m;
  }, [bookings]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <IconTooltip label={t('calendar.prevMonth')}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('calendar.prevMonth')}
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </IconTooltip>
          <CardTitle className="font-display">{format(currentMonth, 'MMMM yyyy')}</CardTitle>
          <IconTooltip label={t('calendar.nextMonth')}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('calendar.nextMonth')}
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </IconTooltip>
        </div>
      </CardHeader>
      <CardContent>
        {(bookingsError || blockedError) && (
          <p className="mb-3 text-sm text-destructive">
            {t('calendar.loadError')}
          </p>
        )}
        {eligibleDates.length === 0 && (
          <p className="text-sm text-muted-foreground mb-4">
            {t('calendar.empty')}
          </p>
        )}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekdayShortLabels().map((d) => (
            <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {/* Monday-based leading pad: Mon=0, …, Sun=6 */}
          {Array.from({ length: (monthStart.getDay() + 6) % 7 }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {days.map((day) => {
            const dateStr = toDateKey(day);
            const isEligible = eligibleSet.has(dateStr);
            const isConfirmed = confirmedSet.has(dateStr);
            const isSoftBooked = !isConfirmed && softBookedSet.has(dateStr);
            const isSuggested = !isConfirmed && !isSoftBooked && suggestedSet.has(dateStr);
            const isBlocked = blockedSet.has(dateStr);
            const shade = isConfirmed
              ? 'bg-success/30 text-success-foreground'
              : isSoftBooked
              ? 'bg-primary/20 text-primary'
              : isSuggested
              ? 'bg-warning/20 text-warning'
              : isBlocked
              ? 'bg-destructive/25 text-destructive'
              : '';

            const cell = (
              <button
                disabled={!isEligible}
                className={cn(
                  'relative w-full p-2 rounded-lg text-center min-h-[60px] transition-colors',
                  'border',
                  isEligible ? 'border-2 border-info shadow-sm' : 'border-border',
                  shade,
                  isToday(day) && 'ring-2 ring-primary ring-offset-1',
                  isEligible
                    ? 'hover:opacity-90 cursor-pointer'
                    : isBlocked
                    ? 'opacity-60 cursor-default'
                    : 'opacity-50 cursor-default',
                  // Bespoke grid (not shadcn Calendar/EntityCalendar), so it doesn't
                  // get DayPicker's `modifiersClassNames` past-date dimming for free
                  // -- apply the same shared, opacity-only tint by hand. Never
                  // combine with `disabled`/`pointer-events-none`: a past eligible
                  // date must stay clickable (availability toggling, offer response).
                  pastRowClassName(day),
                )}
              >
                <span className="text-sm font-medium">{format(day, 'd')}</span>
                {isConfirmed && (
                  <span className="block text-[9px] mt-0.5 font-semibold uppercase tracking-wide">
                    {t('calendar.label.booked')}
                  </span>
                )}
                {isSoftBooked && (
                  <span className="block text-[9px] mt-0.5 font-semibold uppercase tracking-wide">
                    {t('calendar.label.hold')}
                  </span>
                )}
                {isSuggested && (
                  <span className="block text-[9px] mt-0.5 font-semibold uppercase tracking-wide">
                    {t('calendar.label.offer')}
                  </span>
                )}
                {isBlocked && !isConfirmed && !isSoftBooked && !isSuggested && (
                  <span className="block text-[9px] mt-0.5 font-semibold uppercase tracking-wide">
                    {t('calendar.label.blocked')}
                  </span>
                )}
              </button>
            );

            if (!isEligible) {
              // `title` gives mouse users the reason on hover. The screen-reader
              // explanation is stated ONCE for the whole grid (the sr-only note after
              // the legend below), not repeated on every disabled cell, which would
              // make an assistive-tech user hear the same sentence 25-30 times a month.
              return <div key={dateStr} title={ineligibleDayReason}>{cell}</div>;
            }

            return (
              <Popover key={dateStr}>
                <PopoverTrigger asChild>{cell}</PopoverTrigger>
                <PopoverContent className="w-56 p-3" align="center">
                  <p className="text-xs text-muted-foreground mb-2">
                    {format(day, 'EEE, dd/MM/yyyy')}
                  </p>
                  {isConfirmed ? (
                    <p className="text-xs text-center text-success">
                      {t('calendar.popover.confirmed')}
                    </p>
                  ) : isSoftBooked ? (
                    <p className="text-xs text-center text-muted-foreground">
                      {t('calendar.popover.hold')}
                    </p>
                  ) : suggestedIdByDate.has(dateStr) ? (
                    <OfferResponseButtons bookingId={suggestedIdByDate.get(dateStr)!} size="sm" />
                  ) : (
                    <AvailabilityPicker artistId={artistId} date={dateStr} size="sm" />
                  )}
                </PopoverContent>
              </Popover>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-border">
          <span className="text-xs text-muted-foreground">{t('calendar.legend.title')}</span>
          {eligibleDates.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded border-2 border-info" />
              <span className="text-xs">{t('calendar.legend.eligible')}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded bg-success/30" />
            <span className="text-xs">{t('calendar.legend.confirmed')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded bg-primary/20" />
            <span className="text-xs">{t('calendar.legend.hold')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded bg-warning/20" />
            <span className="text-xs">{t('calendar.legend.offerPending')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded bg-destructive/25" />
            <span className="text-xs">{t('calendar.legend.blocked')}</span>
          </div>
        </div>
        {/* Stated once for assistive tech (each disabled cell carries only a hover
            `title`, not a repeated sr-only sentence). */}
        <p className="sr-only">
          {t('calendar.srIneligible')}
        </p>
      </CardContent>
    </Card>
  );
}
