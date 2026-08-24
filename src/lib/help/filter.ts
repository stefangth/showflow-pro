import { HELP_ITEMS, type HelpItem } from './items';
import type { HelpRole } from './types';
import { STAGES } from './stages';

export type HelpFilter = 'all' | 'new';

/** Items for one role, narrowed by the active filter + free-text search.
 *  Search matches across BOTH languages and the surface label, so an English
 *  product term still matches for a reader browsing in German (and vice versa). */
export function selectItems(role: HelpRole, filter: HelpFilter, query: string): HelpItem[] {
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

/** Parameters for the count line. `filtered` decides which i18n string to render.
 *  Pass an already-computed `matched` list to avoid filtering twice per render. */
export function countParams(
  role: HelpRole,
  filter: HelpFilter,
  query: string,
  matched: HelpItem[] = selectItems(role, filter, query),
) {
  const mine = HELP_ITEMS.filter((i) => i.role === role);
  return {
    filtered: filter !== 'all' || query.trim() !== '',
    matched: matched.length,
    total: mine.length,
    newCount: mine.filter((i) => i.status === 'new').length,
  };
}

/** One item by its stable id, or null. The id is what `/help?item=` carries, so an id
 *  that no longer exists must resolve to null rather than throw: a stale link from an
 *  older build is a normal outcome, and the page falls back to its plain render. */
export function findItem(id: string): HelpItem | null {
  return HELP_ITEMS.find((i) => i.id === id) ?? null;
}
