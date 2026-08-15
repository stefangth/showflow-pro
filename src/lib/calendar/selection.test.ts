import { describe, it, expect } from 'vitest';
import { selectedKeys, extendTo, clearSelection } from './selection';

describe('selection', () => {
  it('selectedKeys returns the inclusive keys ascending regardless of anchor/focus order', () => {
    const forward = selectedKeys({ anchor: '2026-08-18', focus: '2026-08-22' });
    expect(forward).toEqual([
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
    ]);

    const reversed = selectedKeys({ anchor: '2026-08-22', focus: '2026-08-18' });
    expect(reversed).toEqual(forward);
  });

  it('selectedKeys returns a single key for a single-day selection', () => {
    expect(selectedKeys({ anchor: '2026-08-18', focus: '2026-08-18' })).toEqual(['2026-08-18']);
  });

  it('selectedKeys returns an empty array for null', () => {
    expect(selectedKeys(null)).toEqual([]);
  });

  it('extendTo starts a new single-day selection from null', () => {
    expect(extendTo(null, '2026-08-18')).toEqual({ anchor: '2026-08-18', focus: '2026-08-18' });
  });

  it('extendTo keeps the anchor fixed and moves the focus', () => {
    const sel = extendTo(null, '2026-08-18');
    expect(extendTo(sel, '2026-08-22')).toEqual({ anchor: '2026-08-18', focus: '2026-08-22' });
  });

  it('clearSelection returns null', () => {
    expect(clearSelection()).toBeNull();
  });
});
