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

export interface MeterSegment { filled: boolean }
export interface MonthGridChip { title: string; time?: string; tone: Tone; meter?: MeterSegment[] }
export interface MonthGridCell {
  day: Date | null; dayNum: number | null;
  isToday: boolean; isPast: boolean; isSelected: boolean; inRange: boolean;
  flag?: { text: string; tone: Tone };
  chips: MonthGridChip[];
  moreCount: number;
}
