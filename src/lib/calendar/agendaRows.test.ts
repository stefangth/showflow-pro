import { describe, it, expect } from 'vitest';
import { buildAgendaRows } from './agendaRows';
import type { ProducerDateEntry } from './types';

function entry(overrides: Partial<ProducerDateEntry> = {}): ProducerDateEntry {
  return {
    id: 'pd-1',
    date: new Date(2026, 7, 10),
    program: 'Cirque Noir',
    subProgram: null,
    venue: 'Big Top',
    city: 'Berlin',
    session1: '19:30:00',
    session2: '22:00:00',
    session3: null,
    status: 'open',
    mainSlots: 6,
    confirmedMain: 0,
    acceptedMain: 0,
    pendingMain: 0,
    understudySlots: 0,
    confirmedUs: 0,
    custom: null,
    hireOrderId: null,
    hireOrderStatus: null,
    ...overrides,
  };
}

describe('buildAgendaRows', () => {
  it('per-date: folds session2/session3 into a single row with extraSessions + HH:MM time', () => {
    const e = entry({ session1: '19:30:00', session2: '22:00:00', session3: null });

    const rows = buildAgendaRows(e, 'per-date');

    expect(rows).toEqual([{ key: 'pd-1', entry: e, time: '19:30', extraSessions: 1, showAction: true }]);
  });

  it('per-show: expands each non-null session into its own row, first row shows action', () => {
    const e = entry({ session1: '19:30:00', session2: '22:00:00', session3: null });

    const rows = buildAgendaRows(e, 'per-show');

    expect(rows).toEqual([
      { key: 'pd-1-s1', entry: e, time: '19:30', extraSessions: 0, showAction: true },
      { key: 'pd-1-s2', entry: e, time: '22:00', extraSessions: 0, showAction: false },
    ]);
  });

  it('per-show: an entry with no sessions still renders a single row with a -s0 key and empty time', () => {
    const e = entry({ session1: null, session2: null, session3: null });

    const rows = buildAgendaRows(e, 'per-show');

    expect(rows).toEqual([{ key: 'pd-1-s0', entry: e, time: '', extraSessions: 0, showAction: true }]);
  });

  it('per-date: no extra sessions yields extraSessions 0', () => {
    const e = entry({ session1: '19:00:00', session2: null, session3: null });

    const rows = buildAgendaRows(e, 'per-date');

    expect(rows[0].extraSessions).toBe(0);
  });

  it('per-date: both session2 and session3 present counts as 2 extra sessions', () => {
    const e = entry({ session1: '19:00:00', session2: '21:00:00', session3: '23:00:00' });

    const rows = buildAgendaRows(e, 'per-date');

    expect(rows[0].extraSessions).toBe(2);
  });

  it('per-show: expands all three sessions in order, only the first shows the action', () => {
    const e = entry({ session1: '18:00:00', session2: '20:00:00', session3: '22:30:00' });

    const rows = buildAgendaRows(e, 'per-show');

    expect(rows.map(r => r.key)).toEqual(['pd-1-s1', 'pd-1-s2', 'pd-1-s3']);
    expect(rows.map(r => r.time)).toEqual(['18:00', '20:00', '22:30']);
    expect(rows.map(r => r.showAction)).toEqual([true, false, false]);
  });
});
