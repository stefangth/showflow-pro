import type { Lang } from '@/i18n/config';

/**
 * Page minis — the per-route explainer pinned above each page body. One mini per
 * route: four steps, each a numbered label + a miniature of the real UI + one line
 * of plain explanation. The mini follows the viewer's role in the active org.
 *
 * Copy is authored here as a typed bilingual data module (the src/lib/help pattern),
 * EN canonical + DE informal "Du", reusing the src/i18n/terms.ts glossary. The four
 * illustration nodes live with the component (keyed by PageKey), not in this data.
 */

/** A bilingual string. EN is canonical; DE must be present and actually German. */
export type Bi = Record<Lang, string>;

/** The role a mini variant addresses. `super` is the super-admin (god-mode) variant;
 *  where a page has no distinct super copy it simply reuses the admin variant. */
export type MiniRole = 'admin' | 'producer' | 'artist' | 'super';

/** One page mini per route. Add a new page here + a data module under ./pages. */
export type PageKey =
  | 'settings'
  | 'bookings'
  | 'availability'
  | 'chats'
  | 'productions'
  | 'artists'
  | 'platform'
  | 'hireOrders';

export interface MiniStepCopy {
  /** Short uppercase step label, e.g. "Booking engine". */
  label: Bi;
  /** One line of explanation under the illustration. */
  text: Bi;
}

/** Exactly four steps, left to right. */
export type MiniSteps = readonly [MiniStepCopy, MiniStepCopy, MiniStepCopy, MiniStepCopy];

export interface MiniDef {
  page: PageKey;
  /** The route this mini explains (from ROUTES), for reference/debugging. */
  route: string;
  /** The card's eyebrow, e.g. "What settings decide". */
  eyebrow: Bi;
  /** Optional muted note in the header's top-right, e.g. where a setting lives. */
  subnote?: Bi;
  /** Per-role step copy. A viewer with no matching variant sees no mini. */
  variants: Partial<Record<MiniRole, MiniSteps>>;
}
