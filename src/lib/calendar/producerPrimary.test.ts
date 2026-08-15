import { describe, it, expect } from 'vitest';
import { resolveProducerPrimary } from './producerPrimary';
import type { ProducerDateEntry } from './types';

function producerEntry(overrides: Partial<ProducerDateEntry> = {}): ProducerDateEntry {
  return {
    id: 'pd-1',
    date: new Date(2026, 7, 20),
    program: 'Cirque Noir',
    subProgram: null,
    venue: 'Big Top',
    city: 'Berlin',
    session1: '19:00',
    session2: null,
    session3: null,
    status: 'partially_filled',
    mainSlots: 6,
    confirmedMain: 3,
    acceptedMain: 0,
    pendingMain: 1,
    understudySlots: 0,
    confirmedUs: 0,
    custom: null,
    hireOrderId: null,
    hireOrderStatus: null,
    ...overrides,
  };
}

describe('resolveProducerPrimary', () => {
  it('picks the accepted-holds entry over a fully-filled one when both are present, kind "confirmHolds"', () => {
    const accepted = producerEntry({ id: 'pd-accepted', acceptedMain: 2 });
    const filled = producerEntry({ id: 'pd-filled', status: 'fully_filled', acceptedMain: 0, confirmedMain: 6 });
    const resolved = resolveProducerPrimary([filled, accepted]);
    expect(resolved).toEqual({ kind: 'confirmHolds', label: 'Confirm holds', entry: accepted });
  });

  it('falls back to a fully-filled entry with no active order, kind "generateHireOrder"', () => {
    const filled = producerEntry({ id: 'pd-filled', status: 'fully_filled', acceptedMain: 0, confirmedMain: 6, hireOrderId: null });
    const resolved = resolveProducerPrimary([filled]);
    expect(resolved).toEqual({ kind: 'generateHireOrder', label: 'Generate hire order', entry: filled });
  });

  it('returns null when a fully-filled entry already has an active order and nothing is accepted', () => {
    const ordered = producerEntry({
      status: 'fully_filled',
      acceptedMain: 0,
      confirmedMain: 6,
      hireOrderId: 'ho-1',
      hireOrderStatus: 'issued',
    });
    expect(resolveProducerPrimary([ordered])).toBeNull();
  });

  it('returns null for an empty entry list', () => {
    expect(resolveProducerPrimary([])).toBeNull();
  });
});
