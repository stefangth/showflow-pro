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

/** Injected surface for the initial-session bootstrap. See {@link bootstrapAuth}. */
export interface AuthBootstrapDeps {
  /** Read the current session. May reject or hang under multi-tab auth-lock contention. */
  getSession: () => Promise<Session | null>;
  /** Apply the freshly read session to state (synchronous setters). */
  applySession: (session: Session | null) => void;
  /** Load-or-clear identity for the session, then mark readiness (resolveSessionIdentity bound to handlers). */
  resolve: (session: Session | null) => Promise<void>;
  /** Last resort when the session can't be established: settle as signed-out so guards leave the spinner. */
  degrade: () => void;
  /**
   * Abandon this bootstrap's effects — checked before applying a result, before
   * each retry, and before degrading. True once the provider unmounts or another
   * path (an onAuthStateChange event) has already resolved a fresher state, so a
   * slow attempt can neither clobber it nor keep retrying. Defaults to never.
   */
  shouldAbort?: () => boolean;
  /** Attempts after the first before degrading (default 2). */
  retries?: number;
  /** Base backoff between attempts, scaled linearly by attempt (default 800ms). */
  backoffMs?: number;
  /**
   * Per-attempt ceiling; a getSession that hasn't settled by then is treated as
   * a failure (default 8000ms). Kept above supabase-js's own 5s lock-acquire
   * timeout so the common case — a contended getSession rejecting on its own —
   * settles and retries without leaving a call abandoned on the lock queue; this
   * ceiling only bites a genuine hang (e.g. a stuck token-refresh fetch).
   */
  timeoutMs?: number;
}

// 2 retries (3 attempts total): rides out transient multi-tab lock contention
// while bounding the worst-case time to the login fallback. A getSession under
// lock contention rejects at supabase-js's ~5s internal timeout, so the common
// failure path degrades in ~17s worst case (typically recovering far sooner);
// a true hang hits the 8s ceiling per attempt.
const DEFAULT_BOOTSTRAP_RETRIES = 2;
const DEFAULT_BOOTSTRAP_BACKOFF_MS = 800;
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 8000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reject if `promise` hasn't settled within `ms`, clearing the timer either way (no leak / no late reject). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`auth bootstrap: getSession exceeded ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Establish the initial session, resilient to a stalled auth bootstrap.
 *
 * supabase-js serializes auth-token access across same-origin tabs with a Web
 * Lock; under multi-tab contention `getSession()` can time out (reject) or hang
 * indefinitely. The previous bootstrap awaited it exactly once with no catch and
 * no timeout, so a single stall stranded route guards on the loading spinner
 * forever (the "endless spinning ball" with several tabs open on one account).
 *
 * Here each attempt is bounded by a timeout and retried with linear backoff.
 * If every attempt fails we `degrade()` (settle as signed-out) so the app can
 * never spin indefinitely — a later onAuthStateChange event re-resolves identity
 * the moment the lock frees.
 *
 * `shouldAbort()` is checked before applying a result, before each retry, and
 * before degrading, so once the provider unmounts or another path resolves a
 * fresher state this bootstrap stops touching state (no clobber, no zombie
 * retries). A timed-out getSession() can't be cancelled, but the timeout sits
 * above supabase-js's own 5s lock-acquire timeout, so contended calls reject and
 * settle on their own rather than being abandoned onto the lock queue.
 */
export async function bootstrapAuth(deps: AuthBootstrapDeps): Promise<void> {
  const shouldAbort = deps.shouldAbort ?? (() => false);
  const retries = deps.retries ?? DEFAULT_BOOTSTRAP_RETRIES;
  const backoffMs = deps.backoffMs ?? DEFAULT_BOOTSTRAP_BACKOFF_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS;

  for (let attempt = 0; ; attempt++) {
    if (shouldAbort()) return;
    try {
      const session = await withTimeout(deps.getSession(), timeoutMs);
      if (shouldAbort()) return; // superseded/unmounted in flight — don't clobber
      deps.applySession(session);
      await deps.resolve(session);
      return;
    } catch {
      if (attempt >= retries) {
        if (!shouldAbort()) deps.degrade();
        return;
      }
      await delay(backoffMs * (attempt + 1));
    }
  }
}
