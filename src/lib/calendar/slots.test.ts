import { describe, it, expect } from 'vitest';
import { openToOfferSlots, unconfirmedSlots } from './slots';

describe('openToOfferSlots', () => {
  it('subtracts confirmed, accepted, and pending from mainSlots', () => {
    expect(openToOfferSlots({ mainSlots: 6, confirmedMain: 1, acceptedMain: 2, pendingMain: 1 })).toBe(2);
  });

  it('treats a slot covered by any active booking (confirmed/accepted/pending) as handled', () => {
    expect(openToOfferSlots({ mainSlots: 3, confirmedMain: 1, acceptedMain: 1, pendingMain: 1 })).toBe(0);
  });

  it('floors at 0 when offers exceed the slot count', () => {
    expect(openToOfferSlots({ mainSlots: 2, confirmedMain: 1, acceptedMain: 2, pendingMain: 1 })).toBe(0);
  });
});

describe('unconfirmedSlots', () => {
  it('subtracts only confirmed from mainSlots (offers still count as unconfirmed)', () => {
    expect(unconfirmedSlots({ mainSlots: 6, confirmedMain: 4, acceptedMain: 2, pendingMain: 0 })).toBe(2);
  });

  it('floors at 0 when confirmed meets or exceeds the slot count', () => {
    expect(unconfirmedSlots({ mainSlots: 2, confirmedMain: 3 })).toBe(0);
  });

  it('ignores accepted/pending offers entirely', () => {
    expect(unconfirmedSlots({ mainSlots: 3, confirmedMain: 1, acceptedMain: 2, pendingMain: 0 })).toBe(2);
  });
});

describe('the two metrics are intentionally distinct', () => {
  // A date with an offer in flight is "handled" for casting but still
  // "unconfirmed" for fill progress — the two numbers legitimately differ.
  it('diverges when offers are in flight', () => {
    const entry = { mainSlots: 3, confirmedMain: 1, acceptedMain: 1, pendingMain: 1 };
    expect(openToOfferSlots(entry)).toBe(0);
    expect(unconfirmedSlots(entry)).toBe(2);
  });

  it('agrees when no offers are in flight', () => {
    const entry = { mainSlots: 3, confirmedMain: 1, acceptedMain: 0, pendingMain: 0 };
    expect(openToOfferSlots(entry)).toBe(2);
    expect(unconfirmedSlots(entry)).toBe(2);
  });
});
