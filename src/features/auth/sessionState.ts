import type { Session } from "@supabase/supabase-js";

export interface SessionIdentityHandlers {
  /** Load memberships + super-admin status for a signed-in user. Should not reject. */
  loadIdentity: (userId: string) => Promise<void>;
  /** Reset all identity/impersonation state for a signed-out user. */
  clearIdentity: () => void;
  /**
   * Record that identity has settled for `userId` (null when signed out).
   * This is what flips `authReady`/`loading` — call it AFTER identity has been
   * loaded (or cleared), so no render ever treats a half-loaded identity as
   * authoritative. Must run even if loadIdentity throws, or the guards strand
   * on the spinner.
   */
  markResolved: (userId: string | null) => void;
}

/**
 * Resolve identity for a (possibly null) auth session — load it for a signed-in
 * user, else clear it — then mark it resolved for that user id.
 *
 * `markResolved` is called in `finally`, strictly after loadIdentity/clearIdentity
 * settle, so readiness only flips once the identity data for the current user is
 * in place (or a fetch failure is accepted). See `computeAuthReady`.
 *
 * Callers set session/user themselves (those are lock-safe and run
 * synchronously); this function owns only the async identity step, which must be
 * deferred out of the Supabase auth-state-change callback to avoid its lock.
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
    // loadIdentity is contracted not to reject, but never let a failure strand
    // the app on the loading spinner — markResolved still runs below.
  } finally {
    h.markResolved(session?.user?.id ?? null);
  }
}

/**
 * Are the route guards allowed to make routing/role decisions yet?
 *
 * Ready iff the initial session check has completed (`bootstrapped`) AND identity
 * is loaded for the *currently authenticated* user — i.e. the user id from the
 * live session matches the user id identity was last resolved for (`null === null`
 * when signed out).
 *
 * This is the load-bearing invariant. Because readiness is DERIVED from
 * (bootstrapped, userId, identityUserId) rather than a separately-sequenced
 * `loading` flag, there is no render — under any auth-callback ordering — where
 * `user` is truthy but identity (isSuperAdmin/currentOrg) is still empty and the
 * guard treats it as authoritative. The instant `user` changes, `userId !==
 * identityUserId`, so the guards show the spinner until `resolveSessionIdentity`
 * calls `markResolved`. The old flash (NoOrgScreen / wrong role gate on login)
 * was a race against clearing `loading`; here it is impossible by construction.
 */
export function computeAuthReady(
  bootstrapped: boolean,
  userId: string | null,
  identityUserId: string | null,
): boolean {
  return bootstrapped && (userId ?? null) === (identityUserId ?? null);
}
