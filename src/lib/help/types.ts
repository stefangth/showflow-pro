import type { Lang } from '@/i18n/config';
import type { TermKey } from '@/i18n/terms';

export type HelpRole = 'admin' | 'producer' | 'artist';

/** Answer status. NOTE: the design's third value, 'open' ("still open"), is
 *  deliberately removed — every question here is answered. */
export type HelpStatus = 'new' | 'ok';

export interface HelpItem {
  /** Stable id, e.g. 'A0.1'. */
  id: string;
  role: HelpRole;
  /** Index into STAGES (0..STAGES.length-1). */
  stage: number;
  status: HelpStatus;
  /** The "where" chip: a stable label for the app surface the answer lives on. */
  surface: string;
  /** Provenance: when this answer was last authored/updated (ISO date). */
  updated: string;
  q: Record<Lang, string>;
  a: Record<Lang, string>;
}

export interface StageDef {
  title: Record<Lang, string>;
  moment: Record<Lang, string>;
}

export interface GlossaryEntry {
  term: TermKey;
  def: Record<Lang, string>;
}
