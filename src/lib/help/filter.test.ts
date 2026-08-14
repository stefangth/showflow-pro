import { describe, it, expect } from 'vitest';
import { selectItems, groupByStage, countParams } from './filter';
import { HELP_ITEMS } from './items';

describe('help filter', () => {
  it('filters by role', () => {
    expect(selectItems('artist', 'all', '').every((i) => i.role === 'artist')).toBe(true);
  });

  it('"new" filter keeps only new items', () => {
    expect(selectItems('admin', 'new', '').every((i) => i.status === 'new')).toBe(true);
  });

  it('search matches an English product term (regardless of the reader\'s language)', () => {
    expect(selectItems('producer', 'all', 'hire order').length).toBeGreaterThan(0);
  });

  it('search matches a German term (regardless of the reader\'s language)', () => {
    expect(selectItems('producer', 'all', 'engagementvertrag').length).toBeGreaterThan(0);
  });

  it('groupByStage drops empty stages and preserves order', () => {
    const groups = groupByStage(selectItems('admin', 'all', ''));
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    expect(groups.map((g) => g.stage)).toEqual([...groups.map((g) => g.stage)].sort((a, b) => a - b));
  });

  it('count params: unfiltered reports totals, filtered reports matched/total', () => {
    const all = countParams('admin', 'all', '');
    expect(all.filtered).toBe(false);
    expect(all.total).toBe(HELP_ITEMS.filter((i) => i.role === 'admin').length);

    const filtered = countParams('admin', 'new', '');
    expect(filtered.filtered).toBe(true);
    expect(filtered.matched).toBeLessThanOrEqual(filtered.total);
  });
});
