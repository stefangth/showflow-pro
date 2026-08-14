import type { MiniDef, MiniRole } from './types';

/** The viewer context a mini needs to pick its role variant. */
export interface MiniRoleCtx {
  /** Honors editor view-as (delegates to the app's effectiveHasRole). */
  hasRole: (r: 'admin' | 'producer' | 'artist') => boolean;
  isSuperAdmin: boolean;
  /** True when a super-admin is previewing a specific role/user (god-mode off). */
  impersonating: boolean;
}

/** Fallback order when a super-admin has no distinct `super` variant. */
const SUPER_FALLBACK: readonly MiniRole[] = ['admin', 'producer', 'artist'];
/** Order a plain member's roles are checked in. */
const MEMBER_ORDER: readonly ('admin' | 'producer' | 'artist')[] = ['admin', 'producer', 'artist'];

/**
 * Pick the mini variant to render for a viewer, or null if none applies.
 *
 * A super-admin in god-mode (not impersonating) uses the `super` variant, or the
 * highest available page variant as a fallback (super-admins can reach any route).
 * Everyone else — including a super-admin impersonating a role — uses the first of
 * admin/producer/artist that they hold AND the page defines. `hasRole` already
 * reflects view-as, so impersonation is handled by the role check itself.
 */
export function resolveMiniRole(def: MiniDef, ctx: MiniRoleCtx): MiniRole | null {
  const { variants } = def;
  if (ctx.isSuperAdmin && !ctx.impersonating) {
    if (variants.super) return 'super';
    return SUPER_FALLBACK.find((r) => variants[r]) ?? null;
  }
  return MEMBER_ORDER.find((r) => ctx.hasRole(r) && variants[r]) ?? null;
}
