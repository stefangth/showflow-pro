import type { ArtistDateEntry, ProducerDateEntry } from '@/lib/calendar/types';
import { monthCellsArtist } from '@/lib/calendar/artistData';
import { monthCellsProducer } from '@/lib/calendar/producerData';
import { toDateKey } from '@/lib/dates';
import { MonthGrid } from './MonthGrid';

interface MonthLensProps {
  role: 'producer' | 'artist';
  anchor: Date;
  selectedDay: Date | null;
  onSelectDay: (day: Date) => void;
  onOpenDay: (day: Date) => void;
  /** Fired on Space when provided; forwarded straight through to `MonthGrid`. */
  onPeekDay?: (day: Date) => void;
  producerEntries?: ProducerDateEntry[];
  artistEntries?: ArtistDateEntry[];
  /** Highlighted range for the drag-select flow (Phase 4, producer-only —
   *  see `CalendarSurface`, which never feeds these to the artist lens). */
  rangeKeys?: string[];
  onRangeStart?: (key: string) => void;
  onRangeExtend?: (key: string) => void;
  onRangeCommit?: () => void;
  /** True while a range selection exists — forwarded straight through to
   *  `MonthGrid`, which applies `select-none` to suppress text selection
   *  during a drag. Producer-only, same as the other range props. */
  rangeActive?: boolean;
  /** Mobile "status-bar per day" variant — forwarded straight through to
   *  `MonthGrid`. Default/absent (false) is the unchanged desktop grid. */
  dense?: boolean;
  /** Override for "today", so tests get a deterministic today-marker. */
  today?: Date;
  className?: string;
}

/**
 * Producer/artist Month lens: builds the role-appropriate `MonthGridCell[]`
 * for the month containing `anchor` via `monthCellsProducer`/`monthCellsArtist`
 * (`src/lib/calendar/{producer,artist}Data.ts`), then renders the shared
 * `<MonthGrid>`. The design's month block (lines 267-307) is already the kit's
 * `MonthGrid` — this lens only owns the role-specific cell derivation.
 * `rangeKeys`/`onRangeStart`/`onRangeExtend`/`onRangeCommit`/`rangeActive`
 * are forwarded straight through to `MonthGrid`; `CalendarSurface` owns the
 * actual `RangeSelection` state and only wires these for the producer role
 * (default: no range, so the artist lens is unaffected).
 */
export function MonthLens({
  role,
  anchor,
  selectedDay,
  onSelectDay,
  onOpenDay,
  onPeekDay,
  producerEntries,
  artistEntries,
  rangeKeys = [],
  onRangeStart,
  onRangeExtend,
  onRangeCommit,
  rangeActive,
  dense,
  today = new Date(),
  className,
}: MonthLensProps) {
  const selectedKey = selectedDay ? toDateKey(selectedDay) : '';

  const cells =
    role === 'producer'
      ? monthCellsProducer(producerEntries ?? [], anchor, selectedKey, rangeKeys, today)
      : monthCellsArtist(artistEntries ?? [], anchor, selectedKey, today);

  return (
    <MonthGrid
      cells={cells}
      onSelectDay={onSelectDay}
      onOpenDay={onOpenDay}
      onPeekDay={onPeekDay}
      onRangeStart={onRangeStart}
      onRangeExtend={onRangeExtend}
      onRangeCommit={onRangeCommit}
      rangeActive={rangeActive}
      dense={dense}
      className={className}
    />
  );
}
