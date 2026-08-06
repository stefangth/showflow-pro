import { describe, expect, it } from 'vitest';
import { canUseEditor } from './editorAccess';

describe('canUseEditor', () => {
  it('lets an admin of the active org in', () => {
    expect(canUseEditor(['admin'], false)).toBe(true);
  });

  it('lets a super-admin in even with no membership in the active org', () => {
    expect(canUseEditor([], true)).toBe(true);
  });

  it('lets a super-admin in while they hold a non-admin role in the active org', () => {
    expect(canUseEditor(['producer'], true)).toBe(true);
  });

  it('keeps a producer out', () => {
    expect(canUseEditor(['producer'], false)).toBe(false);
  });

  it('keeps an artist out', () => {
    expect(canUseEditor(['artist'], false)).toBe(false);
  });

  it('keeps a member with no roles out', () => {
    expect(canUseEditor([], false)).toBe(false);
  });
});
