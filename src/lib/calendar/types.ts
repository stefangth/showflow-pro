export type Tone = 'success' | 'warning' | 'muted' | 'destructive' | 'accent';
export interface ToneSpec { label: string; badgeClass: string; railClass: string; tone: Tone; }

export type ProducerStatus = 'open' | 'partially_filled' | 'fully_filled' | 'cancelled' | 'unconfigured';
export interface ProducerDateEntry {
  id: string; date: Date;
  program: string; subProgram: string | null;
  venue: string | null; city: string | null;
  session1: string | null; session2: string | null; session3: string | null;
  status: ProducerStatus;
  mainSlots: number; confirmedMain: number; acceptedMain: number; pendingMain: number;
  understudySlots: number; confirmedUs: number;
  custom: Record<string, unknown> | null;
  /** The active (non-void) hire order covering this date, if any — mirrors
   *  `hireOrderReady.orderByDate[dateId]` (see `useDatesReadyForHireOrder`).
   *  `null` when no order exists yet, which is what makes a `fully_filled`
   *  date eligible for "Generate hire order". */
  hireOrderId: string | null;
  hireOrderStatus: string | null;
  /** `show_dates.cast_notified_at` — non-null once a producer has notified the
   *  cast that this date is cancelled. Optional so the many inline
   *  `ProducerDateEntry` fixtures elsewhere keep compiling unchanged; treat a
   *  missing field the same as `null` (not yet notified). Drives the "Needs
   *  you" queue's `cancelled` group — see `src/lib/calendar/needsYou.ts`. */
  castNotifiedAt?: string | null;
}

export type ArtistStatus = 'confirmed' | 'soft_booked' | 'suggested' | 'blocked' | 'unanswered';
export interface ArtistDateEntry {
  id: string; date: Date; bookingId: string | null;
  program: string; subProgram: string | null;
  venue: string | null; city: string | null;
  session1: string | null;
  myStatus: ArtistStatus;
  hireOrderId: string | null;
}

/** Capability-gating for the producer action buttons (Confirm holds /
 *  Generate hire order / Open casting) surfaced by `DayRail` and
 *  `AgendaLens`. When an entry maps to a gated key that is `disabled`, the
 *  button renders `disabled` and exposes `title` as its tooltip instead of
 *  silently no-opping on click — the app's established
 *  disabled-button-with-tooltip pattern for capability gaps. */
export type ProducerActionKey = 'confirmHolds' | 'generateHireOrder' | 'openCasting';
export interface ActionGate { disabled: boolean; title?: string }
export type ActionGates = Partial<Record<ProducerActionKey, ActionGate>>;

export interface MeterSegment { filled: boolean }
export interface MonthGridChip { title: string; time?: string; tone: Tone; meter?: MeterSegment[] }
export interface MonthGridCell {
  day: Date | null; dayNum: number | null;
  isToday: boolean; isPast: boolean; isSelected: boolean; inRange: boolean;
  flag?: { text: string; tone: Tone };
  chips: MonthGridChip[];
  moreCount: number;
}
