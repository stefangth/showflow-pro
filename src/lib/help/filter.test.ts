import { describe, it, expect } from 'vitest';
import { selectItems, groupByStage, countParams, findItem } from './filter';
import { HELP_ITEMS } from './items';

describe('help filter', () => {
  it('filters by role', () => {
    expect(selectItems('artist', 'all', '').every((i) => i.role === 'artist')).toBe(true);
  });

  it('"new" filter keeps only new items', () => {
    expect(selectItems('admin', 'new', '').every((i) => i.status === 'new')).toBe(true);
  });

  // The searched noun is a vocabulary placeholder in the copy ({{hireOrder}}), so search
  // has to match the DISPLAYED text: under the production kind {{hireOrder}} renders
  // "contract" (EN) / "Engagementvertrag" (DE), and both must find the same items.
  it('search matches the displayed English product noun', () => {
    expect(selectItems('producer', 'all', 'contract', 'production').length).toBeGreaterThan(0);
  });

  it('search matches the displayed German product noun (regardless of the reader\'s language)', () => {
    expect(selectItems('producer', 'all', 'engagementvertrag', 'production').length).toBeGreaterThan(0);
  });

  // ...and the staffing kind renders the other vocabulary, so its displayed noun matches too.
  it('search matches the staffing-kind displayed noun', () => {
    expect(selectItems('producer', 'all', 'work order', 'staffing').length).toBeGreaterThan(0);
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

describe('findItem', () => {
  it('resolves a known id', () => {
    expect(findItem('A3.11')?.role).toBe('admin');
  });

  it('returns null for an unknown id rather than throwing', () => {
    // A stale `/help?item=` link is a normal outcome, not an error.
    expect(findItem('NOPE')).toBeNull();
  });
});
