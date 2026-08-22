import { useTranslation } from 'react-i18next';
import type { ActionGates, ArtistDateEntry, ArtistStatus, ProducerDateEntry } from '@/lib/calendar/types';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { DayDetail } from './DayDetail';

export interface CalendarDaySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: 'producer' | 'artist';
  day: Date | null;
  producerEntries?: ProducerDateEntry[];
  artistEntries?: ArtistDateEntry[];
  onPrimary?: () => void;
  primaryLabel?: string;
  /** Passed through to `DayDetail`, but `DayDetail`'s own secondary button
   *  is always suppressed in this sheet (see `hideSecondary` below) — kept
   *  on the props shape for interface parity with `DayDetail`/`DayRail`,
   *  not currently exercised. The sheet's own "Open date" / "Message
   *  producer" text buttons below are the mobile secondary actions. */
  onSecondary?: () => void;
  secondaryLabel?: string;
  /** Text button under the date card, shown for both roles — the mobile
   *  equivalent of drilling into the full show-date detail. This is the
   *  sheet's sole "Open date" control; `DayDetail`'s own secondary button
   *  (which defaults to the same label) is suppressed inside the sheet. */
  onOpenDate?: () => void;
  /** Text button under the date card, artist only. This is the sheet's
   *  sole "Message producer" control, for the same reason as `onOpenDate`. */
  onMessageProducer?: () => void;
  /** Flow-aware artist status label override, passed straight through to
   *  `DayDetail` — see its doc comment. */
  statusLabels?: Partial<Record<ArtistStatus, string>>;
  /** Capability gates for the producer primary action, passed straight
   *  through to `DayDetail` — see its doc comment. */
  actionGates?: ActionGates;
}

/**
 * Bottom sheet that replaces the desktop `DayRail` on mobile: a vaul
 * `Drawer` wrapping the same `DayDetail` date card + primary action used on
 * desktop, plus two mobile-only text buttons ("Open date" for both roles,
 * "Message producer" for artists) below it. `DrawerContent` already renders
 * its own grab handle (`src/components/ui/drawer.tsx`, not edited here), so
 * this component adds no handle of its own — there is exactly one. Dismiss
 * via that handle, the scrim, or Escape is vaul's (Radix Dialog-backed)
 * native behavior and calls `onOpenChange(false)` on its own — nothing
 * extra to wire here.
 *
 * `DayDetail`'s own secondary button is suppressed here (`hideSecondary`)
 * so its default "Open date" / "Message producer" label never duplicates
 * this sheet's own dedicated buttons for the same actions — see
 * `CalendarDaySheetProps.onOpenDate`/`onMessageProducer`.
 *
 * First production consumer of `src/components/ui/drawer.tsx`: it is
 * controlled entirely by `open`/`onOpenChange`, no `DrawerTrigger`. When
 * `day` is `null` there is nothing to show, so the component renders
 * nothing at all rather than an open-but-empty sheet.
 */
export function CalendarDaySheet({
  open,
  onOpenChange,
  role,
  day,
  producerEntries,
  artistEntries,
  onPrimary,
  primaryLabel,
  onSecondary,
  secondaryLabel,
  onOpenDate,
  onMessageProducer,
  statusLabels,
  actionGates,
}: CalendarDaySheetProps) {
  const { t } = useTranslation(['availability', 'common']);

  if (!day) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="calendar-day-sheet">
        <div className="flex flex-col gap-3 px-4 pb-6 pt-3">
          <DayDetail
            role={role}
            day={day}
            producerEntries={producerEntries}
            artistEntries={artistEntries}
            onPrimary={onPrimary}
            primaryLabel={primaryLabel}
            onSecondary={onSecondary}
            secondaryLabel={secondaryLabel}
            statusLabels={statusLabels}
            actionGates={actionGates}
            hideSecondary
            showInfoTiles={role === 'artist'}
          />

          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              className="text-control font-medium text-accent-text hover:underline"
              data-testid="day-sheet-open-date"
              onClick={() => onOpenDate?.()}
            >
              {t('common:calendar.day.openDate')}
            </button>
            {role === 'artist' && (
              <button
                type="button"
                className="text-control font-medium text-accent-text hover:underline"
                data-testid="day-sheet-message-producer"
                onClick={() => onMessageProducer?.()}
              >
                {t('calendar.day.messageProducer')}
              </button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
