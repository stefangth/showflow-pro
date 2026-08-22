/**
 * Who may use editor mode: super-admins only.
 *
 * The UI editor (page access, table permissions, column templates) is a
 * platform-operator tool, not an org-admin feature. Org admins no longer see the
 * editor toolbar or the on-page table and column editor, so the gate depends only on
 * the platform-admin flag. Org roles are intentionally not a factor: a super-admin
 * passes even in an org they hold no membership in, and no org role (admin included)
 * ever confers editor access.
 */
export function canUseEditor(isSuperAdmin: boolean): boolean {
  return isSuperAdmin;
}
