/**
 * Presentation helpers for organizations, shared by every surface that lists them —
 * the sidebar `OrgSwitcher` and the editor toolbar's org select. They exist so that
 * "what counts as suspended, and how is it shown" has one definition rather than one
 * per control.
 */

/** Structural, not the full `Organization` row: callers pass whatever they hold. */
interface OrgLike {
  name?: string;
  status?: string | null;
}

export function isOrgSuspended(org: OrgLike): boolean {
  return org.status === 'suspended';
}

/**
 * Label for an org inside a flat option list, where there is no room for the separate
 * status chip the sidebar switcher can afford.
 */
export function orgOptionLabel(org: OrgLike & { name: string }): string {
  return isOrgSuspended(org) ? `${org.name} (suspended)` : org.name;
}
