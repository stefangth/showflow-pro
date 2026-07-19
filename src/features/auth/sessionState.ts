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
