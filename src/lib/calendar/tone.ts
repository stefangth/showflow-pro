import type { ToneSpec, ProducerStatus, ArtistStatus } from './types';

export const PRODUCER_TONES: Record<ProducerStatus, ToneSpec> = {
  fully_filled:     { label: 'Fully filled', badgeClass: 'bg-success/10 text-success',           railClass: 'bg-success' },
  partially_filled: { label: 'Casting',      badgeClass: 'bg-warning/10 text-warning',           railClass: 'bg-warning' },
  open:             { label: 'Open',         badgeClass: 'bg-muted text-muted-foreground',       railClass: 'bg-muted-foreground' },
  cancelled:        { label: 'Cancelled',    badgeClass: 'bg-destructive/10 text-destructive',   railClass: 'bg-destructive' },
  unconfigured:     { label: 'Unconfigured', badgeClass: 'bg-destructive/10 text-destructive',   railClass: 'bg-destructive' },
};

export const ARTIST_TONES: Record<ArtistStatus, ToneSpec> = {
  confirmed:   { label: 'Confirmed',   badgeClass: 'bg-success/10 text-success',         railClass: 'bg-success' },
  soft_booked: { label: 'Hold',        badgeClass: 'bg-warning/10 text-warning',         railClass: 'bg-warning' },
  suggested:   { label: 'Offer',       badgeClass: 'bg-primary/10 text-primary',         railClass: 'bg-primary' },
  blocked:     { label: 'Blocked',     badgeClass: 'bg-destructive/10 text-destructive', railClass: 'bg-destructive' },
  unanswered:  { label: 'Not offered', badgeClass: 'bg-muted text-muted-foreground',     railClass: 'bg-muted-foreground' },
};
