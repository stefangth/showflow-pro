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
  /** Highlighted range for the drag-select flow — inert until Phase 4. */
  rangeKeys?: string[];
  onRangeExtend?: (key: string) => void;
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
 * `rangeKeys`/`onRangeExtend` are forwarded but range selection stays inert
 * until Phase 4 (default: no range).
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
  onRangeExtend,
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
      onRangeExtend={onRangeExtend}
      className={className}
    />
  );
}
