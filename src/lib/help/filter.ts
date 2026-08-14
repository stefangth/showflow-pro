import type { Lang } from '@/i18n/config';
import { HELP_ITEMS, type HelpItem } from './items';
import type { HelpRole } from './types';
import { STAGES } from './stages';

export type HelpFilter = 'all' | 'new';

/** Items for one role, narrowed by the active filter + free-text search.
 *  Search matches across BOTH languages and the surface label, so an English
 *  product term still matches for a reader browsing in German. */
export function selectItems(role: HelpRole, filter: HelpFilter, query: string, _lang: Lang): HelpItem[] {
  const q = query.trim().toLowerCase();
  return HELP_ITEMS.filter((i) => {
    if (i.role !== role) return false;
    if (filter === 'new' && i.status !== 'new') return false;
    if (!q) return true;
    const hay = `${i.q.en} ${i.q.de} ${i.a.en} ${i.a.de} ${i.surface}`.toLowerCase();
    return hay.includes(q);
  });
}

/** Group items by journey stage in stage order, dropping empty stages. */
export function groupByStage(items: HelpItem[]): { stage: number; items: HelpItem[] }[] {
  return STAGES.map((_, stage) => ({ stage, items: items.filter((i) => i.stage === stage) }))
    .filter((g) => g.items.length > 0);
}

/** Parameters for the count line. `filtered` decides which i18n string to render. */
export function countParams(role: HelpRole, filter: HelpFilter, query: string, lang: Lang) {
  const mine = HELP_ITEMS.filter((i) => i.role === role);
  const matched = selectItems(role, filter, query, lang);
  return {
    filtered: filter !== 'all' || query.trim() !== '',
    matched: matched.length,
    total: mine.length,
    newCount: mine.filter((i) => i.status === 'new').length,
  };
}
