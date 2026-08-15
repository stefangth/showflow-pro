import type { ToneSpec, ProducerStatus, ArtistStatus, Tone } from './types';

/** Filled-segment class for a `FillMeter` bar of the given tone. */
export const TONE_FILL: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  muted: 'bg-muted-foreground',
  destructive: 'bg-destructive',
  accent: 'bg-primary',
};

/** Text-color class for chip titles / flags of the given tone. */
export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  muted: 'text-muted-foreground',
  destructive: 'text-destructive',
  accent: 'text-primary',
};

export const PRODUCER_TONES: Record<ProducerStatus, ToneSpec> = {
  fully_filled:     { label: 'Fully filled', badgeClass: 'bg-success/10 text-success',           railClass: 'bg-success',           tone: 'success' },
  partially_filled: { label: 'Casting',      badgeClass: 'bg-warning/10 text-warning',           railClass: 'bg-warning',           tone: 'warning' },
  open:             { label: 'Open',         badgeClass: 'bg-muted text-muted-foreground',       railClass: 'bg-muted-foreground',  tone: 'muted' },
  cancelled:        { label: 'Cancelled',    badgeClass: 'bg-destructive/10 text-destructive',   railClass: 'bg-destructive',       tone: 'destructive' },
  unconfigured:     { label: 'Unconfigured', badgeClass: 'bg-destructive/10 text-destructive',   railClass: 'bg-destructive',       tone: 'destructive' },
};

export const ARTIST_TONES: Record<ArtistStatus, ToneSpec> = {
  confirmed:   { label: 'Confirmed',   badgeClass: 'bg-success/10 text-success',         railClass: 'bg-success',          tone: 'success' },
  soft_booked: { label: 'Hold',        badgeClass: 'bg-warning/10 text-warning',         railClass: 'bg-warning',          tone: 'warning' },
  suggested:   { label: 'Offer',       badgeClass: 'bg-primary/10 text-primary',         railClass: 'bg-primary',          tone: 'accent' },
  blocked:     { label: 'Blocked',     badgeClass: 'bg-destructive/10 text-destructive', railClass: 'bg-destructive',      tone: 'destructive' },
  unanswered:  { label: 'Not offered', badgeClass: 'bg-muted text-muted-foreground',     railClass: 'bg-muted-foreground', tone: 'muted' },
};
