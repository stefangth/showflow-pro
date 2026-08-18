// One-time post-login landing on the Get running board.
//
// The onboarding gate in DashboardPage redirects a non-artist to /get-running while the
// board is incomplete. That redirect must fire only ONCE per session — as the post-login
// landing target — never on every subsequent visit to the dashboard, or the user could
// never reach the dashboard by hand (clicking "Dashboard" would bounce straight back).
//
// We record "the landing has been consumed" in sessionStorage: it survives in-tab reloads
// and route changes, and is cleared automatically when the tab closes. AuthContext also
// clears it on sign-out, so a fresh login in the same tab re-arms the landing. All access
// is wrapped in try/catch so a disabled/blocked storage (private mode, SSR) degrades to
// "not yet landed" rather than throwing.

const LANDED_KEY = 'showflow.getRunning.landed';

/** Has the one-time Get running landing already happened this session? */
export function hasLandedGetRunning(): boolean {
  try {
    return sessionStorage.getItem(LANDED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Mark the one-time Get running landing as consumed for this session. */
export function markLandedGetRunning(): void {
  try {
    sessionStorage.setItem(LANDED_KEY, '1');
  } catch {
    // no-op: storage unavailable → we simply treat the landing as not-yet-consumed
  }
}

/** Re-arm the landing (called on sign-out so the next login lands on the board again). */
export function resetGetRunningLanding(): void {
  try {
    sessionStorage.removeItem(LANDED_KEY);
  } catch {
    // no-op
  }
}
