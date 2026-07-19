import type { Session } from "@supabase/supabase-js";

export interface SessionIdentityHandlers {
  /** Load memberships + super-admin status for a signed-in user. Should not reject. */
  loadIdentity: (userId: string) => Promise<void>;
  /** Reset all identity/impersonation state for a signed-out user. */
  clearIdentity: () => void;
  setLoading: (loading: boolean) => void;
}

/**
 * Resolve identity for a (possibly null) auth session — load it for a signed-in
 * user, else clear it — then clear `loading` ONLY after identity has settled.
 *
 * This ordering is load-bearing: the route guards (ProtectedRoute /
 * PlatformRoute) read `loading` to decide when isSuperAdmin/currentOrg are
 * trustworthy. Clearing it while identity is still empty makes them misfire —
 * a hard load of /platform bounces to the dashboard/no-org screen, and other
 * routes flash the wrong role gate — because `loading:false` is read as
 * "identity resolved" when it hasn't been.
 *
 * Callers set session/user themselves (those are lock-safe and run
 * synchronously); this function owns only the async identity + loading step,
 * which is the part that must be deferred out of the Supabase auth-state-change
 * callback to avoid its lock.
 */
export async function resolveSessionIdentity(
  session: Session | null,
  h: SessionIdentityHandlers,
): Promise<void> {
  try {
    if (session?.user) {
      await h.loadIdentity(session.user.id);
    } else {
      h.clearIdentity();
    }
  } catch {
    // loadIdentity is contracted not to reject, but never let a failure
    // strand the app on the loading spinner.
  } finally {
    h.setLoading(false);
  }
}

/**
 * Should `loading` be raised (spinner) for an incoming auth session?
 *
 * `resolveSessionIdentity` only ever *clears* `loading`. That is enough on a
 * hard load, where `loading` starts `true` at mount and stays true until
 * identity settles. But once it has gone `false`, a *new* signed-in session
 * (the sign-in transition, or an account switch in a live tab) makes `user`
 * truthy while isSuperAdmin/currentOrg are still empty — and the deferred
 * identity load hasn't run yet. Guards that read `loading:false` as
 * "identity resolved" then flash NoOrgScreen / the wrong role gate on the way
 * to the destination route.
 *
 * Raise `loading` exactly when a session's user has no loaded identity yet
 * (`loadedUserId` is the user id `loadIdentity` last resolved for). Background
 * events for the already-loaded user (TOKEN_REFRESHED / USER_UPDATED) and
 * signed-out sessions (guards redirect to /login) must NOT re-raise it — that
 * would flash a full-app spinner over an already-usable screen.
 */
export function shouldRaiseLoading(
  session: Session | null,
  loadedUserId: string | null,
): boolean {
  return !!session?.user && session.user.id !== loadedUserId;
}
