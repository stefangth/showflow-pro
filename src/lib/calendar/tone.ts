import type { ToneSpec, ProducerStatus, ArtistStatus, Tone } from './types';

/**
 * The three-hex-per-status tone system: a light **tint** (chip/block
 * background), a darker readable **fg** (text), and a saturated **rail**
 * (stripe/dot/meter fill) — see design-gap-analysis.md §0 [TONE-COLLAPSE].
 * Each is its own DS token var, NOT one semantic token reused with an
 * opacity modifier, so light/dark mode can pick genuinely different tint
 * and fg hues rather than just scaling alpha.
 */

/** Filled-segment class for a `FillMeter` bar of the given tone (the rail). */
export const TONE_FILL: Record<Tone, string> = {
  success: 'bg-[var(--green-500)]',
  warning: 'bg-[var(--amber-500)]',
  muted: 'bg-[var(--text-faint)]',
  destructive: 'bg-[var(--red-500)]',
  accent: 'bg-primary',
};

/** Text-color class for chip titles / flags of the given tone (the fg). */
export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-[var(--green-600)]',
  warning: 'text-[var(--amber-600)]',
  muted: 'text-muted-foreground',
  destructive: 'text-[var(--red-600)]',
  accent: 'text-accent-700',
};

/** Chip/block tint (background) class for the given tone. */
export const TONE_BG: Record<Tone, string> = {
  success: 'bg-[var(--green-100)]',
  warning: 'bg-[var(--amber-100)]',
  muted: 'bg-[var(--surface-3)]',
  destructive: 'bg-[var(--red-100)]',
  accent: 'bg-accent-50',
};

export const PRODUCER_TONES: Record<ProducerStatus, ToneSpec> = {
  fully_filled:     { label: 'Fully filled', badgeClass: 'bg-[var(--green-100)] text-[var(--green-600)]', railClass: 'bg-[var(--green-500)]', tone: 'success' },
  partially_filled: { label: 'Casting',      badgeClass: 'bg-[var(--amber-100)] text-[var(--amber-600)]', railClass: 'bg-[var(--amber-500)]', tone: 'warning' },
  open:             { label: 'Open',         badgeClass: 'bg-[var(--surface-3)] text-muted-foreground',  railClass: 'bg-[var(--text-faint)]', tone: 'muted' },
  cancelled:        { label: 'Cancelled',    badgeClass: 'bg-[var(--red-100)] text-[var(--red-600)]',    railClass: 'bg-[var(--red-500)]',   tone: 'destructive' },
  unconfigured:     { label: 'Unconfigured', badgeClass: 'bg-[var(--red-100)] text-[var(--red-600)]',    railClass: 'bg-[var(--red-500)]',   tone: 'destructive' },
};

/**
 * Solid bar colour for a Season heatmap cell, keyed to producer *status*
 * (fully_filled → success, partially_filled/casting → warning, open → muted,
 * cancelled/unconfigured → destructive) rather than to a monochrome fill
 * ramp. Shared by the desktop `SeasonLens` and the mobile `SeasonStripMobile`
 * so the two encodings can never drift apart. A null status (only reachable
 * for an empty, no-date cell, which renders no bar) falls back to the muted
 * "open" tone. */
export function seasonBarClass(status: ProducerStatus | null): string {
  return status ? PRODUCER_TONES[status].railClass : PRODUCER_TONES.open.railClass;
}

export const ARTIST_TONES: Record<ArtistStatus, ToneSpec> = {
  confirmed:   { label: 'Confirmed',   badgeClass: 'bg-[var(--green-100)] text-[var(--green-600)]', railClass: 'bg-[var(--green-500)]',  tone: 'success' },
  soft_booked: { label: 'Hold',        badgeClass: 'bg-[var(--amber-100)] text-[var(--amber-600)]', railClass: 'bg-[var(--amber-500)]',  tone: 'warning' },
  suggested:   { label: 'Offer',       badgeClass: 'bg-accent-50 text-accent-700',                  railClass: 'bg-primary',             tone: 'accent' },
  blocked:     { label: 'Blocked',     badgeClass: 'bg-[var(--red-100)] text-[var(--red-600)]',     railClass: 'bg-[var(--red-500)]',    tone: 'destructive' },
  unanswered:  { label: 'Not offered', badgeClass: 'bg-[var(--surface-3)] text-muted-foreground',   railClass: 'bg-[var(--text-faint)]', tone: 'muted' },
};

/**
 * The artist status label to display, honoring an optional flow-aware override
 * (e.g. a direct-booking org's `bookingStatusLabels(flow)` wording — "Not
 * booked" instead of the fixed "Not offered") before falling back to
 * `ARTIST_TONES`' default. A missing/undefined override key falls back the
 * same way, so callers may pass a partial map without special-casing gaps
 * (e.g. `blocked`, which has no flow-aware equivalent).
 */
export function artistStatusLabel(
  status: ArtistStatus,
  overrides?: Partial<Record<ArtistStatus, string>>,
): string {
  return overrides?.[status] ?? ARTIST_TONES[status].label;
}
