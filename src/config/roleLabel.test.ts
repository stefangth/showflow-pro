import { describe, it, expect } from 'vitest';
import { roleLabel, ROLE_LABELS } from './app.config';

describe('roleLabel', () => {
  it('defaults to the production table', () => {
    expect(roleLabel('producer')).toBe(ROLE_LABELS.producer);
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('unknown')).toBe('unknown');
  });
  it('reads the producer label from the vocabulary for staffing', () => {
    expect(roleLabel('producer', 'staffing')).toBe('Booking team');
    expect(roleLabel('artist', 'staffing')).toBe('Artist'); // only the producer label is kind-aware in this PR
  });
});
