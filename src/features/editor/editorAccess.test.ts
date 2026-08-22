import { describe, expect, it } from 'vitest';
import { canUseEditor } from './editorAccess';

describe('canUseEditor', () => {
  it('lets a super-admin use the editor', () => {
    expect(canUseEditor(true)).toBe(true);
  });

  // Org roles are intentionally not a factor: nobody who is not a super-admin may use
  // the editor, org admins included.
  it('keeps every non-super-admin out', () => {
    expect(canUseEditor(false)).toBe(false);
  });
});
