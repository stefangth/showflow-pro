/**
 * The single status tone map. Every badge, pill, dot and eyebrow tint in the app
 * resolves through this record. Adding a tone is a design decision, not a className:
 * if a surface needs a colour that is not here, that is a conversation, not a patch.
 *
 * Amber means a human is being waited on. Red means risk. They are deliberately
 * distinct (ADR 0012, decision D3) after shipping as identical amber for a year.
 */
export const TONES = {
  confirmed: { bg: 'bg-[var(--green-100)]', fg: 'text-[var(--green-600)]', dot: 'bg-[var(--green-500)]' },
  waiting:   { bg: 'bg-[var(--amber-100)]', fg: 'text-[var(--amber-600)]', dot: 'bg-[var(--amber-500)]' },
  risk:      { bg: 'bg-[var(--red-100)]',   fg: 'text-[var(--red-600)]',   dot: 'bg-[var(--red-500)]' },
  accent:    { bg: 'bg-accent-50',          fg: 'text-accent-text',        dot: 'bg-accent-500' },
  neutral:   { bg: 'bg-muted',              fg: 'text-muted-foreground',   dot: 'bg-muted-foreground' },
} as const;

export type Tone = keyof typeof TONES;
