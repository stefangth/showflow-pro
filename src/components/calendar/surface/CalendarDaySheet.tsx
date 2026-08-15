import type { ActionGates, ArtistDateEntry, ArtistStatus, ProducerDateEntry } from '@/lib/calendar/types';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
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
  onSecondary?: () => void;
  secondaryLabel?: string;
  /** Text button under the date card, shown for both roles — the mobile
   *  equivalent of drilling into the full show-date detail. */
  onOpenDate?: () => void;
  /** Text button under the date card, artist only. */
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
 * `Drawer` wrapping the same `DayDetail` date card + primary/secondary
 * actions used on desktop, plus two mobile-only text buttons ("Open date"
 * for both roles, "Message producer" for artists) below it. Dismiss via the
 * grab handle, scrim, or Escape is vaul's (Radix Dialog-backed) native
 * behavior and calls `onOpenChange(false)` on its own — nothing extra to
 * wire here.
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
  if (!day) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="calendar-day-sheet">
        <div className="mx-auto h-1 w-10 shrink-0 rounded-pill bg-muted-foreground/40" />
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
          />

          <div className="flex flex-col items-center gap-1">
            <Button
              type="button"
              variant="link"
              size="sm"
              data-testid="day-sheet-open-date"
              onClick={() => onOpenDate?.()}
            >
              Open date
            </Button>
            {role === 'artist' && (
              <Button
                type="button"
                variant="link"
                size="sm"
                data-testid="day-sheet-message-producer"
                onClick={() => onMessageProducer?.()}
              >
                Message producer
              </Button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
